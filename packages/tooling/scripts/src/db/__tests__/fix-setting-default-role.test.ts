/**
 * `fix-setting-default-role` 的纯函数用例（连接装配不在此测 —— E2E 见
 * apps/server 的 pg.fix-default-role.int-spec，指向集成库实跑脚本）。
 *
 * 盯幂等边界：已是 uuid 必须跳过（重跑 no-op）、hex 必须过 Mongo 存量角色白名单、
 * 脏值必须拒绝 —— 三条路都错一格就会静默改坏 setting。
 */
import { describe, expect, it } from 'vitest'
import { buildDefaultRoleFixPlan, parseFixArgs } from '../fix-setting-default-role.ts'
import { deriveUuidFromObjectId, WALNUT_ADMIN_ETL_NAMESPACE } from '../uuid5.ts'

const VISITOR_HEX = '5fb27aee3a30b717d8078eb5'
const VISITOR_UUID = deriveUuidFromObjectId(VISITOR_HEX)

describe('buildDefaultRoleFixPlan', () => {
  const validHexes = new Set([VISITOR_HEX])

  it('hex 且在存量角色白名单内 → rewrite 为 v5 uuid', () => {
    const plan = buildDefaultRoleFixPlan(VISITOR_HEX, validHexes)

    expect(plan).toEqual({ action: 'rewrite', currentValue: VISITOR_HEX, nextValue: VISITOR_UUID })
    expect(plan.nextValue).toBe(deriveUuidFromObjectId(VISITOR_HEX, WALNUT_ADMIN_ETL_NAMESPACE))
  })

  it('已是规范 uuid → no-op（订正可重跑）', () => {
    expect(buildDefaultRoleFixPlan(VISITOR_UUID, validHexes)).toEqual({
      action: 'noop-already-uuid',
      currentValue: VISITOR_UUID,
    })
  })

  it('hex 不在存量角色里 → 前置条件失败（不盲改）', () => {
    expect(() => buildDefaultRoleFixPlan('5fb27aee3a30b717d8078eb5', new Set())).toThrow(/sys_role/)
  })

  it('脏值（既非 uuid 也非 hex）→ 拒绝改写', () => {
    expect(() => buildDefaultRoleFixPlan('role-visitor', validHexes)).toThrow(/拒绝改写/)
  })
})

describe('parseFixArgs', () => {
  it('默认 key 与开关解析', () => {
    const opts = parseFixArgs(['--dry-run', '--pg-db', 'walnut-admin-integration'])

    expect(opts.key).toBe('app.default.role')
    expect(opts.dryRun).toBe(true)
    expect(opts.pgDbName).toBe('walnut-admin-integration')
  })

  it('未知参数报错（不静默忽略）', () => {
    expect(() => parseFixArgs(['--nope'])).toThrow(/未知参数/)
  })
})
