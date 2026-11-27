/**
 * 一轮 E2E 的编排入口（包脚本 `e2e` / `e2e:default` / `e2e:smoke` / `e2e:risk` /
 * `e2e:network` 都走它）。
 *
 * 顺序是**硬约束**，每一步都在解决上一段的时序问题：
 * 1. **抢 run 级 advisory lock 并整轮持有** —— restore / prepare-db 的 `DROP DATABASE` 与随后
 *    所有用例都假设「这个库此刻只属于我」；锁只罩准备阶段时，两个并发 run 的后一个会把前一个
 *    正在用的库删掉（见 scripts/pg-lock.ts 头注释）；
 * 2. preflight（环境没准备好 ⇒ 退出码 2，此时库还没被碰过）；
 * 3. **基线决策**（scripts/baseline.ts 的 `ensureTestDatabase`）：
 *    清单有效、dataKey 一致且数据路径干净 ⇒ 从基线 restore；没有基线 ⇒ 全量 prepare 后自动封板；
 *    dataKey 漂移 / 数据路径脏 / 基线文件对不上 ⇒ 退出码 2 并提示重新封板；
 *    `--rebuild-baseline`（或 `E2E_REBUILD_BASELINE=1`）⇒ 强制全量 prepare + seal；
 *    `E2E_SKIP_BASELINE=1` ⇒ 忽略基线、全量 prepare（不封板）。整段在锁内；
 * 4. **Redis 设备键对账**（P2-2，`scripts/redis-gc.ts`）：库刚重建完，「不在 `sys_device`
 *    里的 deviceId」就是确定的孤儿 —— 按精确键名删掉它们（绝不 FLUSH）。
 *    默认开（`E2E_REDIS_GC=0` 关）；失败只报警，cleanup 不该把一轮测试拦下来；
 * 5. stack-info（本轮栈信息 + 产物真实 mtime）；
 * 6. `pnpm exec playwright test <剩余参数>` —— 参数原样透传（`e2e:smoke` 就是
 *    `--project=smoke`），退出码也原样返回（Playwright 的契约不在这一层改写）。
 *
 * 并发行为：第二个 run 在**第一步**就等锁；120s 内抢不到就报「谁在持锁」并以退出码 2 收场
 * （一轮全量远超 2 分钟，所以实际表现是「第二个 run 报错退出」而不是排队跑完）。
 *
 * **profile（P1-6 Phase A）**：`E2E_STACK_PROFILE=smoke|risk|network` 时库 / 端口 / 基线目录
 * 都来自 `scripts/stack-profiles.ts`；锁是**两把** —— 先全局（`2026112401`，一台机器一个 run），
 * 再 profile（key + 序号，日志归属与同 profile 重入保护）。本地多 profile 仍串行：第二个
 * profile 会在全局锁上等待。命名 profile 只能跑同名 project（`resolveProfileTestArgs`），
 * 没给 `--project` 时补上 —— 别让一个 profile 的用例跑在另一个 profile 的库上。
 */
import process from 'node:process'
import { ensureTestDatabase } from './baseline.ts'
import { assertE2eDatabase, assertE2ePgPort, E2E_PG_DB, E2E_PG_PORT, E2E_ROOT } from './env.ts'
import { reportFailure } from './failure.ts'
import { acquirePgLock, connectMaintenance, E2E_PG_LOCK_KEY, E2E_PROFILE_LOCK_KEY, releasePgLock } from './pg-lock.ts'
import { spawnPnpm } from './pnpm.ts'
import { runPreflight } from './preflight.ts'
import { runRedisGc } from './redis-gc.ts'
import { writeStackInfo } from './stack-info.ts'
import { resolveProfileTestArgs, STACK_PROFILE } from './stack-profiles.ts'

async function main(): Promise<void> {
  // 常量实参时的机械标记（真正对运行态的断言见 lib/pg.ts、prepare-db 与 baseline）
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)
  console.log(
    `[e2e/run] profile=${STACK_PROFILE.name}  db=${E2E_PG_DB}  `
    + `backend=${STACK_PROFILE.backendPort} socket=${STACK_PROFILE.socketPort} web=${STACK_PROFILE.webPort}  `
    + `baseline=${STACK_PROFILE.artifactDir}`,
  )

  // 允许 `pnpm … e2e -- -g "登录"` 这种写法：包管理器会把分隔符一起传进来
  const passthrough = process.argv.slice(2)
  if (passthrough[0] === '--') {
    passthrough.shift()
  }

  // `--rebuild-baseline` 是**本脚本自己的**参数，不能进 Playwright 的命令行
  const rebuild = passthrough.includes('--rebuild-baseline') || process.env.E2E_REBUILD_BASELINE === '1'
  const testArgs = passthrough.filter(arg => arg !== '--rebuild-baseline')
  // profile 与 project 的 1:1 约束在**动锁 / 动库之前**校验：配错直接退 2，不白重建一次库
  const finalTestArgs = resolveProfileTestArgs(STACK_PROFILE, testArgs)

  // 可发现性（R-C §4.1）：不设 --project 的 default 全量现在会带上 pages / journey
  // （5 个 project，10 分钟级）。在开始等之前说清楚，并指向日常入口。
  const hasProjectFilter = finalTestArgs.some(arg => arg === '--project' || arg.startsWith('--project='))
  if (STACK_PROFILE.name === 'default' && !hasProjectFilter) {
    console.log(
      '[e2e/run] 注意：本次为全量 5 个 project（default 面 + pages + journey），预计 13–15 分钟；'
      + '日常验收请用 `pnpm walnut e2e:default`（smoke + risk + network + mobile，约 5 分钟级）',
    )
  }

  const lock = await connectMaintenance()
  try {
    // 全局锁：不变量 6（一台机器同一时间一个 E2E run）；profile 锁必须嵌套在它之后
    await acquirePgLock(lock, E2E_PG_LOCK_KEY, 'global')
    const profileLocked = E2E_PROFILE_LOCK_KEY !== E2E_PG_LOCK_KEY
    if (profileLocked) {
      await acquirePgLock(lock, E2E_PROFILE_LOCK_KEY, `profile=${STACK_PROFILE.name}`)
    }

    try {
      await runPreflight()
      await ensureTestDatabase({
        maintenance: lock,
        rebuild,
        skipBaseline: process.env.E2E_SKIP_BASELINE === '1',
      })

      // P2-2：库刚重建完（restore 或全量 prepare），`sys_device` 里没有的 deviceId 的键就是
      // 上一轮 / 崩溃 run 的残留。默认开：不跑它，RSA 公钥（30 天）与 challenge 标记（24h）
      // 会跨轮堆积；`E2E_REDIS_GC=0` 可关。失败只警告 —— 这是 cleanup，不是前置条件。
      if (process.env.E2E_REDIS_GC !== '0') {
        try {
          await runRedisGc()
        }
        catch (error) {
          console.warn(`[e2e/run] WARN Redis 设备键对账失败（不影响本轮用例）：${error instanceof Error ? error.message : String(error)}`)
        }
      }

      writeStackInfo()
      console.log(`[e2e/run] pnpm exec playwright test ${finalTestArgs.join(' ')}`.trimEnd())
      process.exitCode = spawnPnpm(['exec', 'playwright', 'test', ...finalTestArgs], E2E_ROOT, { ...process.env })
    }
    finally {
      // 释放顺序与获取相反；同一把 key 时它已经在全局锁那一步释放
      if (profileLocked) {
        await releasePgLock(lock, E2E_PROFILE_LOCK_KEY)
      }
    }
  }
  finally {
    await releasePgLock(lock, E2E_PG_LOCK_KEY)
    await lock.end().catch(() => {})
  }
}

main().catch((error) => {
  process.exitCode = reportFailure('e2e/run', error)
})
