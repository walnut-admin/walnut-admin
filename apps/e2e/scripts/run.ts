/**
 * 一轮 E2E 的编排入口（包脚本 `e2e` / `e2e:smoke` / `e2e:risk` / `e2e:network` 都走它）。
 *
 * 顺序是**硬约束**，每一步都在解决上一段的时序问题：
 * 1. **抢 run 级 advisory lock 并整轮持有** —— prepare-db 的 `DROP DATABASE` 与随后所有用例
 *    都假设「这个库此刻只属于我」；锁只罩 prepare 时，两个并发 run 的后一个会把前一个正在用
 *    的库删掉（见 scripts/pg-lock.ts 头注释）；
 * 2. preflight（环境没准备好 ⇒ 退出码 2，此时库还没被碰过）；
 * 3. `prepareDatabase({ lockHeld: true })` —— 重建 / 迁移 / seed 的实现在 scripts/prepare-db.ts，
 *    这里只是把它接进「整轮持锁」；
 * 4. stack-info（本轮栈信息 + 产物真实 mtime）；
 * 5. `pnpm exec playwright test <剩余参数>` —— 参数原样透传（`e2e:smoke` 就是
 *    `--project=smoke`），退出码也原样返回（Playwright 的契约不在这一层改写）。
 *
 * 并发行为：第二个 run 在**第一步**就等锁；120s 内抢不到就报「谁在持锁」并以退出码 2 收场
 * （一轮全量远超 2 分钟，所以实际表现是「第二个 run 报错退出」而不是排队跑完）。
 */
import process from 'node:process'
import { assertE2eDatabase, assertE2ePgPort, E2E_PG_DB, E2E_PG_PORT, E2E_ROOT } from './env.ts'
import { reportFailure } from './failure.ts'
import { acquirePgLock, connectMaintenance, releasePgLock } from './pg-lock.ts'
import { spawnPnpm } from './pnpm.ts'
import { runPreflight } from './preflight.ts'
import { prepareDatabase } from './prepare-db.ts'
import { writeStackInfo } from './stack-info.ts'

async function main(): Promise<void> {
  // 常量实参时的机械标记（真正对运行态的断言见 lib/pg.ts 与 preflight）
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  // 允许 `pnpm … e2e -- -g "登录"` 这种写法：包管理器会把分隔符一起传进来
  const passthrough = process.argv.slice(2)
  if (passthrough[0] === '--') {
    passthrough.shift()
  }

  const lock = await connectMaintenance()
  try {
    await acquirePgLock(lock)
    await runPreflight()
    await prepareDatabase({ lockHeld: true })
    writeStackInfo()
    console.log(`[e2e/run] pnpm exec playwright test ${passthrough.join(' ')}`.trimEnd())
    process.exitCode = spawnPnpm(['exec', 'playwright', 'test', ...passthrough], E2E_ROOT, { ...process.env })
  }
  finally {
    await releasePgLock(lock)
    await lock.end().catch(() => {})
  }
}

main().catch((error) => {
  process.exitCode = reportFailure('e2e/run', error)
})
