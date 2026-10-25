/**
 * `src/db/uuid5.ts` 的用例 —— v5 派生是 ETL / seed / 订正脚本共用的**ID 真源**，
 * 错一格整库 id 换世界，所以用例盯死三件事：
 * - **算法正确性**：RFC 4122 §4.3 的公开向量（NAMESPACE_DNS + 'python.org'）逐字对上；
 * - **确定性 / 幂等**：同输入恒同输出（重跑 / 双跑对拍的前提），不同 namespace 不串台；
 * - **形态契约**：version 位 = 5、variant 位 = RFC4122、namespace 非法要抛 ——
 *   订正脚本靠这些位区分「待派生」与「已是 uuid」。
 */
import { describe, expect, it } from 'vitest'
import {
  deriveUuidFromObjectId,
  isObjectIdHex,
  uuidV5,
  WALNUT_ADMIN_ETL_NAMESPACE,
} from '../uuid5.ts'

/** RFC 4122 附录 B / Python 文档的公开向量：uuid5(NAMESPACE_DNS, 'python.org') */
const RFC_NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const RFC_VECTOR = '886313e1-3b8a-5372-9b90-0c9aee199e5d'

describe('uuidV5（RFC 4122 §4.3）', () => {
  it('公开向量：NAMESPACE_DNS + python.org', () => {
    expect(uuidV5('python.org', RFC_NAMESPACE_DNS)).toBe(RFC_VECTOR)
  })

  it('确定性：同输入恒同输出（ETL 重跑 / 双跑对拍的前提）', () => {
    const first = uuidV5('68635668a1f084bfd66da715', WALNUT_ADMIN_ETL_NAMESPACE)
    const second = uuidV5('68635668a1f084bfd66da715', WALNUT_ADMIN_ETL_NAMESPACE)

    expect(first).toBe(second)
  })

  it('namespace 隔离：同一 name 在不同 namespace 下得到不同 uuid', () => {
    const a = uuidV5('5fb27aee3a30b717d8078eb5', WALNUT_ADMIN_ETL_NAMESPACE)
    const b = uuidV5('5fb27aee3a30b717d8078eb5', RFC_NAMESPACE_DNS)

    expect(a).not.toBe(b)
  })

  it('形态契约：version 位 5、variant 位 RFC4122、全小写规范格式', () => {
    const uuid = uuidV5('5fb27aee3a30b717d8078eb5', WALNUT_ADMIN_ETL_NAMESPACE)

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(uuid[14]).toBe('5')
    expect(['8', '9', 'a', 'b']).toContain(uuid[19])
  })

  it('namespace 不是规范 uuid 时抛错（防手滑传 hex 片段）', () => {
    expect(() => uuidV5('anything', 'not-a-uuid')).toThrow()
  })
})

describe('deriveUuidFromObjectId（ETL / seed 统一入口）', () => {
  // 已知输入输出向量（由本实现 + RFC 向量共同钉住；改动即红）
  const SEED_VISITOR_HEX = '5fb27aee3a30b717d8078eb5'
  const SEED_VISITOR_UUID = 'd6e8ca57-1faf-56d7-b090-9ff0c0b78ce6'
  const SEED_ROOT_HEX = '68635668a1f084bfd66da715'
  const SEED_ROOT_UUID = '3055c85c-8f55-53c9-8c7a-366fef0a8183'

  it('已知输入输出向量：seed 库 visitor / root 两个角色 id', () => {
    expect(deriveUuidFromObjectId(SEED_VISITOR_HEX)).toBe(SEED_VISITOR_UUID)
    expect(deriveUuidFromObjectId(SEED_ROOT_HEX)).toBe(SEED_ROOT_UUID)
  })

  it('幂等：重复派生同一 hex 结果不变（订正脚本可重跑的前提）', () => {
    const once = deriveUuidFromObjectId(SEED_VISITOR_HEX)
    const twice = deriveUuidFromObjectId(SEED_VISITOR_HEX)

    expect(once).toBe(twice)
    expect(once).not.toMatch(/^[0-9a-f]{24}$/)
  })

  it('非 24 位 hex（uuid / 短串 / 大写 hex）一律抛，不许静默换值', () => {
    expect(() => deriveUuidFromObjectId(SEED_VISITOR_UUID)).toThrow()
    expect(() => deriveUuidFromObjectId('5fb27aee3a30b717d8078eb')).toThrow()
    expect(() => deriveUuidFromObjectId('5FB27AEE3A30B717D8078EB5')).toThrow()
  })
})

describe('isObjectIdHex', () => {
  it('24 位小写 hex 为真；uuid / 空 / 带横杠为假', () => {
    expect(isObjectIdHex('5fb27aee3a30b717d8078eb5')).toBe(true)
    expect(isObjectIdHex('d6e8ca57-1faf-56d7-b090-9ff0c0b78ce6')).toBe(false)
    expect(isObjectIdHex('')).toBe(false)
  })
})
