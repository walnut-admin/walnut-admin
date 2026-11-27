/**
 * E2E 的**栈 profile 单一真源**（优化文档 P1-6 Phase A「stack-per-profile」）。
 *
 * 并行单元是 **stack profile**，不是 Playwright worker：每份 profile 有独立的库、后端 / socket /
 * 静态代理端口、IP 段与基线目录。`default` 保持今天的行为逐字不变（库 `walnut_e2e`、
 * 3001 / 3002 / 4173、基线在 `.e2e/` 根）；`smoke` / `risk` / `network` 各用一套偏移端口与
 * `.e2e/<profile>/` 基线目录；`pages` / `journey` 是扩面批次（E4 / E5'）的 profile，继承同一套
 * 槽位公式（端口 3104 / 3105 起，IP 槽位 4 / 5），对应 spec 已落地。
 *
 * 选择方式只有环境变量 `E2E_STACK_PROFILE`（不设 = `default`），**只选 profile，不开放端口 /
 * 库名的独立覆盖** —— 任意覆盖会让 `assertE2eDatabase` 那层安全闸失去意义。未知值 **fail-fast**
 * （退出码 2），不静默回落。
 *
 * 本地仍是一条串行全量（不变量 6）：`run.ts` 先抢全局锁再抢 profile 锁，第二个 profile 的 run
 * 会在全局锁上等待；CI 每个 job 是独立 runner，天然隔离。profile 锁不是并发通行证。
 *
 * ## Redis：不加 profile 前缀，也不换逻辑库（设计结论，别「顺手」改）
 *
 * 1. 键形由 server 拥有（`apps/server/libs/const/src/app/cache.ts` 与各 `*.cache.ts`），E2E 只是
 *    逐条对齐的消费者（不变量 5）；加前缀要么改 server，要么让 E2E 的删除 / 断言键形与服务端漂移。
 * 2. 现有清理是 **deviceId 精确删**（`deleteDeviceScopedKeys` / `deleteRiskDeviceState`），deviceId
 *    每轮随机（`d1_` + 32 hex），跨 profile 撞不上；fixture 只删本进程登记过的 id。
 * 3. 会跨 profile 共享的只有全局键（`WALNUT_CACHE_APP:SETTING` / `APP:SETTING`），它们的值由同一份
 *    基线数据派生；本地串行、CI 每个 job 独立 Redis service，当前不存在「两个 profile 同时写一个
 *    Redis」的场景。
 * 4. **IP 段隔离的真实边界（R-D 实测修正，别读成「风控桶也隔离」）**：
 *    - 隔离成立的是 `POST /system/device/initial` 的 **throttler**（4 次 / 60s per **raw**
 *      realIp，进程内桶）—— 每个 profile 一个后端进程，本就各自计数；{@link localIpFor}
 *      按 profile 偏移第三段（每个 profile 两个 /24）让**将来**同机多进程也不会撞同一地址。
 *    - **风控的 `risk:rate:ip:<ip>:<分钟>` 不隔离**：`ip.service.ts` 的 `normalizeIp` 把
 *      所有 loopback 一律归一成 `127.0.0.1`（实测 Redis 里只有 `risk:rate:ip:127.0.0.1:*`），
 *      所以同机共享 Redis 时所有 profile 的 RATE 因子都计入同一组桶；`risk:ip_blacklist`
 *      的临时拉黑同样归一到 127.0.0.1（30 分钟 TTL），本地并发 profile 会互相影响。
 *    - 结论：本地多 profile **仍必须串行**（全局锁，不变量 6）。将来若要并发，先加
 *      **每 profile 一个 Redis 实例**（端口再分配），而不是键前缀 —— 服务端没有逻辑库配置项
 *      （`APP_REDIS_*` 只到 host / port / pass）。
 *
 * ## `.env.e2e` 的固定路径约束
 *
 * `apps/server/env-local/.env.e2e` 是 typeorm CLI 的固定通道（CLI 用 `process.cwd()/env-local`
 * 定位，没有 `--env-file` 参数，文件里也没有 profile 名的位置）—— **同一个 checkout 上不能并发
 * 两个 profile 的 prepare**。本地靠全局锁串行；CI 每个 job 独立 checkout，没有冲突。
 */
import process from 'node:process'
import { E2ePreconditionError } from './failure.ts'

/** 可选的 profile 名（`default` = 本地全量；其余与 Playwright project 同名 1:1） */
export const STACK_PROFILE_NAMES = ['default', 'smoke', 'risk', 'network', 'pages', 'journey'] as const
export type StackProfileName = (typeof STACK_PROFILE_NAMES)[number]

/** 命名 profile（有独立 `.e2e/<profile>/` 基线目录的那些） */
export const NAMED_STACK_PROFILES = ['smoke', 'risk', 'network', 'pages', 'journey'] as const satisfies readonly StackProfileName[]
export type NamedStackProfileName = (typeof NAMED_STACK_PROFILES)[number]

export interface StackProfile {
  /** profile 名；命名 profile 与 Playwright project 同名 1:1 */
  name: StackProfileName
  /** 独立库名（安全闸的判据之一） */
  database: string
  /** 后端 dist-stage 端口 */
  backendPort: number
  /** 后端 socket.io 端口 */
  socketPort: number
  /** 静态代理端口（浏览器入口） */
  webPort: number
  /**
   * `uniqueLocalIp()` 的 IP 段槽位：第三段 = `slot × 10 + 1 + floor(seq / 200)`。
   * `default` = 0 时产出 `127.0.1.*` / `127.0.2.*`，与改造前逐字一致。
   */
  ipSlot: number
  /** 基线 / 运行态目录相对 `apps/e2e` 的路径；`default` = `.e2e`（根），命名 profile = `.e2e/<name>` */
  artifactDir: string
  /** 凭据目录相对 `apps/e2e` 的路径；`default` = `.auth`，命名 profile = `.auth/<name>` */
  authDir: string
  /** profile 锁的 PG advisory lock key（全局锁之后再抢；`default` 与全局锁同 key，不重复抢） */
  lockKey: number
}

/** 全局 run 锁的 key（「这台机器的这个数据栈上同时只有一个 E2E run」；不变量 6） */
export const E2E_PG_GLOBAL_LOCK_KEY = 2026112401

/** profile 表（端口 / IP 段 / 库名 / 锁 key 的唯一真源；改动必须同步优化文档 P1-6 的表格） */
export const STACK_PROFILES: Readonly<Record<StackProfileName, StackProfile>> = {
  default: {
    name: 'default',
    database: 'walnut_e2e',
    backendPort: 3001,
    socketPort: 3002,
    webPort: 4173,
    ipSlot: 0,
    artifactDir: '.e2e',
    authDir: '.auth',
    lockKey: E2E_PG_GLOBAL_LOCK_KEY,
  },
  smoke: {
    name: 'smoke',
    database: 'walnut_e2e_smoke',
    backendPort: 3101,
    socketPort: 3011,
    webPort: 4181,
    ipSlot: 1,
    artifactDir: '.e2e/smoke',
    authDir: '.auth/smoke',
    lockKey: E2E_PG_GLOBAL_LOCK_KEY + 1,
  },
  risk: {
    name: 'risk',
    database: 'walnut_e2e_risk',
    backendPort: 3102,
    socketPort: 3012,
    webPort: 4182,
    ipSlot: 2,
    artifactDir: '.e2e/risk',
    authDir: '.auth/risk',
    lockKey: E2E_PG_GLOBAL_LOCK_KEY + 2,
  },
  network: {
    name: 'network',
    database: 'walnut_e2e_network',
    backendPort: 3103,
    socketPort: 3013,
    webPort: 4183,
    ipSlot: 3,
    artifactDir: '.e2e/network',
    authDir: '.auth/network',
    lockKey: E2E_PG_GLOBAL_LOCK_KEY + 3,
  },
  // 扩面批次（E4）：admin 逐页渲染与导航的用例落 `tests/pages/`，profile 与 project 同名。
  pages: {
    name: 'pages',
    database: 'walnut_e2e_pages',
    backendPort: 3104,
    socketPort: 3014,
    webPort: 4184,
    ipSlot: 4,
    artifactDir: '.e2e/pages',
    authDir: '.auth/pages',
    lockKey: E2E_PG_GLOBAL_LOCK_KEY + 4,
  },
  // 扩面批次（E5）：socket / auth / 锁屏的旅程用例落 `tests/journey/`，profile 与 project 同名。
  journey: {
    name: 'journey',
    database: 'walnut_e2e_journey',
    backendPort: 3105,
    socketPort: 3015,
    webPort: 4185,
    ipSlot: 5,
    artifactDir: '.e2e/journey',
    authDir: '.auth/journey',
    lockKey: E2E_PG_GLOBAL_LOCK_KEY + 5,
  },
}

/**
 * 严格库名形态：`walnut_e2e` 或 `walnut_e2e_<小写字母>`（挡住 dev 库与注入形态）。
 *
 * 只凭它不够 —— 还必须逐字等于当前 profile 的库名（挡住 `walnut_e2e_foo` 这类拼错），
 * 见 `env.ts` 的 `assertE2eDatabase`。
 */
export const E2E_DATABASE_PATTERN = /^walnut_e2e(?:_[a-z]+)?$/

/** 解析 `E2E_STACK_PROFILE`（纯函数；空 / 未设 = `default`，未知值抛前置错误） */
export function resolveStackProfile(raw: string | undefined): StackProfile {
  const name = (raw ?? '').trim()
  if (name === '' || name === 'default') {
    return STACK_PROFILES.default
  }
  if ((STACK_PROFILE_NAMES as readonly string[]).includes(name)) {
    return STACK_PROFILES[name as StackProfileName]
  }
  throw new E2ePreconditionError(
    `E2E_STACK_PROFILE=${raw} 不认识：只接受 ${STACK_PROFILE_NAMES.join(' / ')}（不设 = default）。\n`
    + '  profile 名是端口 / 库名 / 基线目录的唯一选择方式；**不开放**端口或库名的独立覆盖'
    + '（任意覆盖会让 assertE2eDatabase 的安全闸失去意义）。',
  )
}

/**
 * 当前进程的 profile。模块加载时解析一次（所有派生常量都从它来）。
 *
 * 未知值在这里 **fail-fast**：打印可读原因并以退出码 2 结束 —— 不让一个拼错的 profile 名
 * 悄悄落回 `walnut_e2e`（那会把 smoke / risk 的用例跑在默认库上）。
 */
function selectStackProfile(raw: string | undefined): StackProfile {
  try {
    return resolveStackProfile(raw)
  }
  catch (error) {
    console.error(`[e2e/profile] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}

/** 本进程使用的 profile（`E2E_STACK_PROFILE`；不设 = `default`） */
export const STACK_PROFILE: StackProfile = selectStackProfile(process.env.E2E_STACK_PROFILE)

/**
 * profile 的 device/initial IP（**纯函数**，单测直击）。
 *
 * 公式来自设计稿：`127.0.<slot × 10 + 1 + floor(seq / 200)>.<10 + seq>`，`seq` 在 0..239 回绕，
 * 即每个 profile 两个 /24、240 个地址。用途是 **device/initial 的 4 次/60s per raw realIp**
 * 不被同一进程内不同用例互相吃掉；**不要**把它读成「风控 rate 桶也隔离」—— 风控的
 * `normalizeIp` 把所有 loopback 归一成 `127.0.0.1`，详见文件头第 4 条。
 */
export function localIpFor(slot: number, seq: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > 24) {
    throw new RangeError(`[e2e/profile] IP 槽位必须是 0..24 的整数（收到 ${slot}）`)
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > 239) {
    throw new RangeError(`[e2e/profile] IP 序号必须是 0..239 的整数（收到 ${seq}）`)
  }
  return `127.0.${slot * 10 + 1 + Math.floor(seq / 200)}.${10 + seq}`
}

/** 命名 profile 的基线目录名（`clean.ts` 需要保留这些子目录的活文件；纯数据） */
export function namedProfileArtifactDirs(): string[] {
  return NAMED_STACK_PROFILES.map(name => STACK_PROFILES[name].artifactDir)
}

/** 当前 profile 是否命名 profile（default 没有同名 Playwright project） */
export function isNamedProfile(profile: StackProfile = STACK_PROFILE): boolean {
  return profile.name !== 'default'
}

/**
 * 把 Playwright 参数与 profile 对齐（**纯函数**，单测直击）。
 *
 * - `default`：原样返回（本地全量 / 子集都可以）；
 * - 命名 profile：**不允许跑别的 profile 的用例**。没有 `--project` 时补上同名 project；
 *   指定了别的 project ⇒ 前置错误。这样 `E2E_STACK_PROFILE=smoke pnpm walnut e2e` 不会
 *   把 risk / network 的用例跑在 smoke 库上，CI 的每个 job 也只会跑自己的 project。
 */
export function resolveProfileTestArgs(profile: StackProfile, args: readonly string[]): string[] {
  if (!isNamedProfile(profile)) {
    return [...args]
  }

  const projects: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg.startsWith('--project=')) {
      projects.push(arg.slice('--project='.length))
      continue
    }
    if (arg === '--project') {
      const value = args[index + 1]
      if (value !== undefined && !value.startsWith('-')) {
        projects.push(value)
      }
    }
  }

  const foreign = projects.filter(project => project !== profile.name)
  if (foreign.length > 0) {
    throw new E2ePreconditionError(
      `E2E_STACK_PROFILE=${profile.name} 只能跑 --project=${profile.name} 的用例，`
      + `收到 ${foreign.map(project => `--project=${project}`).join(' / ')}。\n`
      + '  profile 与 Playwright project 同名 1:1（设计稿 P1-6）：换 project 就同时换 profile —— '
      + '否则会把一个 profile 的用例跑在另一个 profile 的库 / 端口上。',
    )
  }

  return projects.length > 0 ? [...args] : [...args, `--project=${profile.name}`]
}
