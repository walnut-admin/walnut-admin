/**
 * 封板清单（manifest）的**形态定义与校验** —— 纯模块，不含任何 I/O。
 *
 * 为什么独立成文件：它是「restore 能不能信这份基线」的唯一判据（版本 / dataKey / 三个文件的
 * sha），但校验逻辑本身是纯函数 —— 与 git、pg、文件系统解耦后，vitest 可以直接钉住每一条
 * 「不可用」的形态，而不必真起一套数据栈。
 *
 * **版本 3（P1-6 Phase A）**：新增 `profile` 与 `database` —— restore 前断言清单里的库名等于
 * 当前 profile 的库名，所以即使把 smoke 的 dump 拷进 risk 目录也恢复不了（先 sha 校验、再库名）。
 * **版本 2（P1-1）**：清单同时充当「封板 meta」—— dump 与 credentials 的 sha / 字节数都在这里，
 * 三者是一对。版本 1（只有 dump 的 sha、没有 dataKey / credentials 的 sha）**不做迁移**：
 * 读到旧版本一律判「不可用」，提示重新封板。
 *
 * v2 → v3 与 v1 → v2 同口径：**缺字段就无法安全证明配对**，不迁移。升级后默认 profile 首次
 * 运行会提示重封板（显式 `--rebuild-baseline`，一次性成本）。
 */

/** 当前清单格式版本（形态变化时 +1；旧版本由 baseline.ts 判「不可用」并提示重封板） */
export const MANIFEST_VERSION = 3

/**
 * 封板清单（版本 3）= 「这份快照是什么」的全部可核对信息。
 *
 * 它不是单纯记账：restore 逐个校验 —— manifest 的 `profile` / `database` 与当前 profile 一致、
 * dump 的 sha / 字节数、credentials 的 sha / 字节数、dataKey（HEAD 数据树）、迁移头与菜单行数
 * （恢复后的 sanity 断言）。任何一项对不上都拒绝恢复。
 */
export interface BaselineManifest {
  /** 清单格式版本（{@link MANIFEST_VERSION}） */
  manifestVersion: number
  /** 封板时刻（ISO 8601） */
  sealedAt: string
  /**
   * 封板时的仓库 HEAD（40 位）。**只作展示**（`sealedAt` 旁边那句「封板于哪个提交」）——
   * 漂移判定已换成 `dataKey`：只改文档的提交不再让基线失效。
   */
  gitCommit: string
  /** 封板时的 stack profile（`default` / `smoke` / `risk` / `network`）；restore 前断言一致 */
  profile: string
  /** 封板时的库名（`walnut_e2e` / `walnut_e2e_<profile>`）；restore 前断言等于当前 profile 的库名 */
  database: string
  /**
   * 数据树哈希：HEAD 上 {@link import('./e2e-data-paths.ts').E2E_DATA_PATHS} 的组合树哈希。
   * restore 前与当前快照比对，不一致说明「迁移 / seed 相对封板时已变化」→ 退出码 2。
   */
  dataKey: string
  /**
   * 封板时数据路径是否**有未提交改动**。true 的清单**永不可用**（restore 直接拒绝）：
   * 那份快照的数据无法证明与仓库一致 —— 要么提交后重封板，要么丢弃改动后重封板。
   */
  dataDirty: boolean
  /** 库内 `migrations` 表的最大 id 与迁移名（快照的迁移头） */
  migrationsHead: { id: number; name: string }
  /** dump 的 sha256（hex）与字节数 —— 防手工替换 / 半写文件 */
  dumpSha256: string
  dumpBytes: number
  /** credentials（封板时的 admin 口令文件）的 sha256 与字节数 —— 防「新 dump 配旧口令」 */
  credentialsSha256: string
  credentialsBytes: number
  /** 封板时 `sys_menu` 的行数；restore 后断言 ≥ 它（root 的菜单树靠它不留空壳） */
  menuRows: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * 清单形态校验：缺字段 / 形态不对都算「不可用」，绝不「尽量读」。
 *
 * 每一条都是 restore 的安全前提：少校验一项，坏文件就可能被当成基线恢复进库。
 */
export function isBaselineManifest(value: unknown): value is BaselineManifest {
  if (!isRecord(value)) {
    return false
  }
  const head = value.migrationsHead
  return (
    value.manifestVersion === MANIFEST_VERSION &&
    typeof value.sealedAt === 'string' &&
    value.sealedAt !== '' &&
    typeof value.gitCommit === 'string' &&
    /^[0-9a-f]{40}$/.test(value.gitCommit) &&
    // profile 名只做形态校验；「是否等于当前 profile」由 baseline.ts 断言（本模块保持无环境依赖）
    typeof value.profile === 'string' &&
    /^[a-z]+$/.test(value.profile) &&
    // 库名形态与 env.ts 的 E2E_DATABASE_PATTERN 同一口径（纯模块不 import env，避免拖进进程级副作用）
    typeof value.database === 'string' &&
    /^walnut_e2e(?:_[a-z]+)?$/.test(value.database) &&
    isSha256Hex(value.dataKey) &&
    typeof value.dataDirty === 'boolean' &&
    isRecord(head) &&
    isPositiveInt(head.id) &&
    typeof head.name === 'string' &&
    head.name !== '' &&
    isSha256Hex(value.dumpSha256) &&
    isPositiveInt(value.dumpBytes) &&
    isSha256Hex(value.credentialsSha256) &&
    isPositiveInt(value.credentialsBytes) &&
    typeof value.menuRows === 'number' &&
    Number.isInteger(value.menuRows) &&
    value.menuRows >= 0
  )
}

/**
 * 读出清单的版本号（不是 JSON 对象 / 没有数字版本 ⇒ null）。
 * 用于把「旧格式」与「损坏」分开报：前者给重封板指引，后者给形态错误。
 */
export function manifestVersionOf(value: unknown): number | null {
  if (!isRecord(value) || typeof value.manifestVersion !== 'number') {
    return null
  }
  return value.manifestVersion
}
