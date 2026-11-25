/**
 * 一轮 E2E 的编排入口（包脚本 `e2e` / `e2e:smoke` / `e2e:risk` / `e2e:network` 都走它）。
 *
 * 顺序是**硬约束**，每一步都在解决上一段的时序问题：
 * 1. **抢 run 级 advisory lock 并整轮持有** —— restore / prepare-db 的 `DROP DATABASE` 与随后
 *    所有用例都假设「这个库此刻只属于我」；锁只罩准备阶段时，两个并发 run 的后一个会把前一个
 *    正在用的库删掉（见 scripts/pg-lock.ts 头注释）；
 * 2. preflight（环境没准备好 ⇒ 退出码 2，此时库还没被碰过）；
 * 3. **基线决策**（scripts/baseline.ts 的 `ensureTestDatabase`）：
 *    清单有效且 HEAD 一致 ⇒ 从基线 restore；没有基线 ⇒ 全量 prepare 后自动封板；
 *    漂移 / 基线文件对不上 ⇒ 退出码 2 并提示重新封板；
 *    `--rebuild-baseline`（或 `E2E_REBUILD_BASELINE=1`）⇒ 强制全量 prepare + seal；
 *    `E2E_SKIP_BASELINE=1` ⇒ 忽略基线、全量 prepare（不封板）。整段在锁内；
 * 4. stack-info（本轮栈信息 + 产物真实 mtime）；
 * 5. `pnpm exec playwright test <剩余参数>` —— 参数原样透传（`e2e:smoke` 就是
 *    `--project=smoke`），退出码也原样返回（Playwright 的契约不在这一层改写）。
 *
 * 并发行为：第二个 run 在**第一步**就等锁；120s 内抢不到就报「谁在持锁」并以退出码 2 收场
 * （一轮全量远超 2 分钟，所以实际表现是「第二个 run 报错退出」而不是排队跑完）。
 */
import process from 'node:process'
import { ensureTestDatabase } from './baseline.ts'
import { assertE2eDatabase, assertE2ePgPort, E2E_PG_DB, E2E_PG_PORT, E2E_ROOT } from './env.ts'
import { reportFailure } from './failure.ts'
import { acquirePgLock, connectMaintenance, releasePgLock } from './pg-lock.ts'
import { spawnPnpm } from './pnpm.ts'
import { runPreflight } from './preflight.ts'
import { writeStackInfo } from './stack-info.ts'

async function main(): Promise<void> {
  // 常量实参时的机械标记（真正对运行态的断言见 lib/pg.ts、prepare-db 与 baseline）
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  // 允许 `pnpm … e2e -- -g "登录"` 这种写法：包管理器会把分隔符一起传进来
  const passthrough = process.argv.slice(2)
  if (passthrough[0] === '--') {
    passthrough.shift()
  }

  // `--rebuild-baseline` 是**本脚本自己的**参数，不能进 Playwright 的命令行
  const rebuild = passthrough.includes('--rebuild-baseline') || process.env.E2E_REBUILD_BASELINE === '1'
  const testArgs = passthrough.filter(arg => arg !== '--rebuild-baseline')

  const lock = await connectMaintenance()
  try {
    await acquirePgLock(lock)
    await runPreflight()
    await ensureTestDatabase({
      maintenance: lock,
      rebuild,
      skipBaseline: process.env.E2E_SKIP_BASELINE === '1',
    })
    writeStackInfo()
    console.log(`[e2e/run] pnpm exec playwright test ${testArgs.join(' ')}`.trimEnd())
    process.exitCode = spawnPnpm(['exec', 'playwright', 'test', ...testArgs], E2E_ROOT, { ...process.env })
  }
  finally {
    await releasePgLock(lock)
    await lock.end().catch(() => {})
  }
}

main().catch((error) => {
  process.exitCode = reportFailure('e2e/run', error)
})
