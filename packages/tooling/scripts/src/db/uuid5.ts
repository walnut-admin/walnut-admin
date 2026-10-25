/**
 * uuid v5 确定性派生（RFC 4122 §4.3）—— ObjectId hex → uuid 的**唯一真源实现**。
 *
 * ## 为什么存在
 *
 * Phase 4 ETL 与 seed 重建共用同一条 v5 通道（phase2 §3.2/§3.3）：同输入恒得同输出，
 * 重跑 / 断点续跑 / 双跑对拍都不产生新 id；跨集合引用重写（如 `app.default.role` 里的
 * role hex）可直接函数求值，无需查映射表。phase2 勘误过：Mongo 的 `$type: string`
 * partial unique 与「数组 multikey unique 误声明」不迁移，唯一性由各自的 PG 索引承接。
 *
 * ## 派生规则（phase2 §3.2 定稿）
 *
 * - **全库统一 namespace**（下方常量；「同一个 hex 在任何集合里都映射到同一个 uuid」，
 *   排查跨集合引用时不需要知道来源集合）；
 * - name = 原 24 位 hex 字符串本体；
 * - sha1(namespace_bytes || name) → 截 16 字节 → 置 version=5、variant=RFC4122。
 *
 * 实现零依赖（node:crypto sha1），与 RFC 4122 §4.3 的算法逐句对齐；namespace 常量
 * 以本文件为唯一来源（postgres-migration-phase2.md §3.3 回写引用，改这里必须同步文档）。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

/**
 * 全库统一派生 namespace（phase2 §3.2：「一个全库统一 namespace」）。
 * 2026-10-25 B5 定稿：随机生成一次后**硬编码进版本管理**——此后所有环境（本地 / demo /
 * CI / 生产 ETL）的存量 id 派生都必须用它，**永不可改**（改了等于全部 id 换世界）。
 */
export const WALNUT_ADMIN_ETL_NAMESPACE = 'c1882c14-e4d4-4f2b-b728-346db51c312e'

/** 24 位 ObjectId hex（Mongo 侧存量 id 的本体形态） */
const OBJECT_ID_HEX_RE = /^[0-9a-f]{24}$/

/** RFC 4122 规范形态的 uuid 字面量 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ObjectId hex 判别（订正脚本用来区分「待派生」与「已是 uuid / 脏值」） */
export function isObjectIdHex(value: string): boolean {
  return OBJECT_ID_HEX_RE.test(value)
}

/** namespace uuid 字符串 → 16 字节（RFC 4122 要求 big-endian 原样进哈希） */
function namespaceToBytes(namespace: string): Buffer {
  if (!UUID_RE.test(namespace)) {
    throw new Error(`uuid v5 namespace 必须是规范 uuid：${namespace}`)
  }

  return Buffer.from(namespace.replaceAll('-', ''), 'hex')
}

/**
 * @description RFC 4122 §4.3 uuid v5：sha1(namespace + name) 截前 16 字节，
 * version 位置 5、variant 位置 RFC4122。
 */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
    .update(namespaceToBytes(namespace))
    .update(name, 'utf8')
    .digest()

  // RFC 4122 只取前 16 字节（拷贝出来再就地置位，不动 digest 原缓冲）
  const bytes = Buffer.from(hash.subarray(0, 16))

  // version = 高 4 位置 0101；variant = 高 2 位置 10（RFC 4122 §4.1.1/§4.1.3）
  bytes[6] = (bytes[6] & 0x0F) | 0x50
  bytes[8] = (bytes[8] & 0x3F) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * @description ETL / seed 通道的派生入口：统一 namespace + ObjectId hex 本体作 name。
 * 输入不是 24 位 hex 时直接抛（ETL 侧该类输入属于数据错误，不许静默换值）。
 */
export function deriveUuidFromObjectId(hex: string, namespace: string = WALNUT_ADMIN_ETL_NAMESPACE): string {
  if (!isObjectIdHex(hex)) {
    throw new Error(`deriveUuidFromObjectId 需要 24 位 ObjectId hex，收到：${hex}`)
  }

  return uuidV5(hex, namespace)
}
