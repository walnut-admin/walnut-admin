/**
 * Extended JSON 的**读写兼容器** —— 只服务「历史导出」这一条通道，不再是 seed 真源的格式。
 *
 * ## 现在谁在用它（唯一的两个消费点）
 *
 * 1. `db:export:pg` 写「PG 生态回灌快照」（`_id` 是 uuid 本体、时间是 `{$date}`）—— 给人看/跨生态搬运用；
 * 2. `db:seed:reshape` **读**那份快照，拍平成 PG 行形态（`{ id, created_at, … }`）写进仓内 seed。
 *
 * 也就是说：**读能力保留**（历史导出能一直导进来），但**仓内真源不是这个格式**了 ——
 * `apps/server/db/seed/*.json` 是纯 JSON 行数组，`lint:seed` 还会把残留的 `$oid` / `$date` 判红
 * （见 `ci/check-seed.ts` 的 `LEGACY_EJSON_MARKERS`）。
 *
 * ## 为什么当初是 Extended JSON
 *
 * 1. **精度**：`ObjectId` 与 `Date` 是两类会在导出-导入之间被弄坏的值（前者可能被当字符串、
 *    后者会退化成 ISO 字符串），而它们恰好是每个集合的 `_id` 与 `createdAt`。走 Extended JSON
 *    是**无损**的。
 * 2. **兼容老路子**：Compass / `mongoimport --jsonArray` 直接认这个格式。
 *
 * 精度这条理由在 PG 之后已经不成立：PG 主键本身就是 uuid 文本、timestamptz 直接吃 ISO 字符串，
 * 没有"会被弄坏的包装类型"了 —— 这就是 D5=B 重建真源的根据。
 *
 * 只认 `$oid` / `$date` 两个形状，别的一律原样返回。
 */
/** 形状判定：恰好只有 `$oid` / `$date` 一个键的对象才算包装 */
function isWrapper(value: unknown, key: string): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === key
}

/** Extended JSON → JS 值（`$oid` → 24 位 hex 字符串，`$date` → `Date`），递归 */
export function fromExtendedJson(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(fromExtendedJson)
  if (isWrapper(value, '$oid'))
    return value.$oid
  if (isWrapper(value, '$date'))
    return new Date(value.$date)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value))
      out[k] = fromExtendedJson(v)
    return out
  }
  return value
}

/** JS 值 → Extended JSON，递归（`Date` → `{$date}`；uuid / hex 字符串原样） */
export function toExtendedJson(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(toExtendedJson)
  if (value instanceof Date)
    return { $date: value.toISOString() }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value))
      out[k] = toExtendedJson(v)
    return out
  }
  return value
}

/** 解析一整个历史导出文件（必须是文档数组） */
export function parseCollectionFile(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed))
    throw new TypeError('集合文件必须是一个文档数组（JSON array）')
  return parsed.map(fromExtendedJson) as Record<string, unknown>[]
}

/** 序列化一整个集合文件（稳定 2 空格缩进 + 结尾换行，便于 diff） */
export function stringifyCollectionFile(docs: readonly unknown[]): string {
  return `${JSON.stringify(docs.map(toExtendedJson), null, 2)}\n`
}
