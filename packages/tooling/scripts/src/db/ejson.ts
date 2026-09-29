/**
 * Extended JSON 的读写 —— seed 数据的格式。
 *
 * 为什么是 Extended JSON（`{"$oid": …}` / `{"$date": …}`）而不是裸 JSON：
 *
 * 1. **精度**：`ObjectId` 与 `Date` 是两类会在导出-导入之间被弄坏的值（前者可能被当字符串、
 *    后者会退化成 ISO 字符串），而它们恰好是每个集合的 `_id` 与 `createdAt`。走 Extended JSON
 *    是**无损**的。
 * 2. **兼容老路子**：Compass / `mongoimport --jsonArray` 直接认这个格式 ⇒ 在这个脚本还没跑通
 *    的机器上，人肉导入照样能用（老文档描述的就是那条路）。
 *
 * 只认这四个形状，别的一律原样返回：`$oid` / `$date` / （写出时的）`$numberLong` 不处理
 * —— seed 里没有会溢出双精度的整数，处理它反而会引入"看起来像 Extended JSON 的普通对象"
 * 被误转的风险。
 */
import { ObjectId } from 'mongodb'

/** 形状判定：恰好只有 `$oid` / `$date` 一个键的对象才算包装 */
function isWrapper(value: unknown, key: string): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === key
}

/** Extended JSON → JS 值（`$oid` → `ObjectId`，`$date` → `Date`），递归 */
export function fromExtendedJson(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(fromExtendedJson)
  if (isWrapper(value, '$oid'))
    return new ObjectId(value.$oid)
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

/** JS 值 → Extended JSON，递归（`ObjectId` → `{$oid}`，`Date` → `{$date}`） */
export function toExtendedJson(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(toExtendedJson)
  if (value instanceof ObjectId)
    return { $oid: value.toHexString() }
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

/** 解析一整个集合文件（必须是文档数组） */
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
