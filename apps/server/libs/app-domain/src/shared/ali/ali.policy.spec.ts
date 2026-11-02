import { Role } from '@walnut/contract'
import { describe, expect, it } from 'vitest'
import { buildAliOSSStsPolicy } from './ali.policy'

/**
 * F-12：STS policy 三态（visitor 只读 / 非 visitor 上传 / 显式前缀收窄）。
 *
 * 这组断言的底线是**不许再出现 fail-open**：改造前非 visitor 拿到的是「无 policy」→
 * 继承 roleArn 全部权限（默认 OSS FullAccess），visitor 虽然带 policy 但 Resource 是 *。
 * 所以除三态外还有两条哨兵：任何 statement 的 Resource 都不许是裸 *；bucket 缺失时
 * 必须抛错而不是退回 *。
 */

const BUCKET = 'walnut-admin-test'

interface IPolicyStatement {
  Effect: string
  Action: string[]
  Resource: string[]
  Condition?: { StringLike: Record<string, string[]> }
}

interface IPolicy {
  Version: string
  Statement: IPolicyStatement[]
}

function parsePolicy(policy: string) {
  return JSON.parse(policy) as IPolicy
}

function actionsOf(policy: IPolicy) {
  return policy.Statement.flatMap(statement => statement.Action)
}

function resourcesOf(policy: IPolicy) {
  return policy.Statement.flatMap(statement => statement.Resource)
}

describe('buildAliOSSStsPolicy：visitor 只读', () => {
  it('visitor 只有 GetObject / ListObjects，且不再有 * 资源', () => {
    const policy = parsePolicy(buildAliOSSStsPolicy({
      currentRoleName: Role.VISITOR,
      bucket: BUCKET,
    }))

    expect(policy.Version).toBe('1')
    expect(actionsOf(policy)).toEqual(['oss:GetObject', 'oss:ListObjects'])
    expect(actionsOf(policy)).not.toContain('oss:PutObject')
    expect(actionsOf(policy)).not.toContain('oss:DeleteObject')
    expect(resourcesOf(policy)).toEqual([
      `acs:oss:*:*:${BUCKET}/*`,
      `acs:oss:*:*:${BUCKET}`,
    ])
  })
})

describe('buildAliOSSStsPolicy：非 visitor 上传', () => {
  it('非 visitor 只拿到本 bucket 内的读写上传动作（含分片续传/中止），不给删除', () => {
    const policy = parsePolicy(buildAliOSSStsPolicy({
      currentRoleName: Role.ADMIN,
      bucket: BUCKET,
    }))

    expect(actionsOf(policy)).toEqual([
      'oss:GetObject',
      'oss:PutObject',
      'oss:AbortMultipartUpload',
      'oss:ListParts',
      'oss:ListObjects',
    ])

    // 删除能力没有出现在 admin 侧上传链路里，默认不给（否则被前端漏洞放大成整桶删除）
    expect(actionsOf(policy)).not.toContain('oss:DeleteObject')
    expect(resourcesOf(policy)).toEqual([
      `acs:oss:*:*:${BUCKET}/*`,
      `acs:oss:*:*:${BUCKET}`,
    ])
  })

  it('对象级动作只落在本 bucket 上 —— 其他 bucket 的资源一个都不出现', () => {
    const resources = resourcesOf(parsePolicy(buildAliOSSStsPolicy({
      currentRoleName: 'admin',
      bucket: BUCKET,
    })))

    expect(resources.every(resource => resource.includes(BUCKET))).toBe(true)
    expect(resources.some(resource => resource.includes('other-bucket'))).toBe(false)
  })
})

describe('buildAliOSSStsPolicy：用户前缀收窄（第三态）', () => {
  it('给出前缀 → 对象资源收窄到该前缀，ListObjects 用 oss:Prefix 条件收窄', () => {
    const policy = parsePolicy(buildAliOSSStsPolicy({
      currentRoleName: 'admin',
      bucket: BUCKET,
      objectKeyPrefix: '/u/user-1/',
    }))

    // 首尾多余的 / 会被归一化掉（避免 acs:oss:*:*:bucket//u// 这种无效资源）
    expect(resourcesOf(policy)).toEqual([
      `acs:oss:*:*:${BUCKET}/u/user-1/*`,
      `acs:oss:*:*:${BUCKET}`,
    ])

    // 列目录也必须收窄：否则能列出整桶（含别人的对象键）
    const listStatement = policy.Statement.find(statement => statement.Action.includes('oss:ListObjects'))
    expect(listStatement?.Condition).toEqual({
      StringLike: { 'oss:Prefix': ['u/user-1/*'] },
    })
    expect(resourcesOf(policy)).not.toContain(`acs:oss:*:*:${BUCKET}/*`)
  })

  it('前缀 + visitor → 还是只读（前缀不放大动作集）', () => {
    const policy = parsePolicy(buildAliOSSStsPolicy({
      currentRoleName: Role.VISITOR,
      bucket: BUCKET,
      objectKeyPrefix: 'u/user-1',
    }))

    expect(actionsOf(policy)).toEqual(['oss:GetObject', 'oss:ListObjects'])
    expect(resourcesOf(policy)).toEqual([
      `acs:oss:*:*:${BUCKET}/u/user-1/*`,
      `acs:oss:*:*:${BUCKET}`,
    ])
  })

  it('空串 / 空白前缀视为不收窄（回落到本 bucket 全量对象，不产出畸形资源）', () => {
    const policy = parsePolicy(buildAliOSSStsPolicy({
      currentRoleName: 'admin',
      bucket: BUCKET,
      objectKeyPrefix: '  ',
    }))

    expect(resourcesOf(policy)).toEqual([
      `acs:oss:*:*:${BUCKET}/*`,
      `acs:oss:*:*:${BUCKET}`,
    ])
    expect(policy.Statement.every(statement => statement.Condition === undefined)).toBe(true)
  })
})

describe('buildAliOSSStsPolicy：fail-open 回归哨兵', () => {
  it('bucket 未配置 → 抛错（绝不退回 Resource: *）', () => {
    expect(() => buildAliOSSStsPolicy({ currentRoleName: 'admin', bucket: '' })).toThrow(/VENDOR_KEYS_ALI_OSS_BUCKET/)
    expect(() => buildAliOSSStsPolicy({
      currentRoleName: Role.VISITOR,
      bucket: '   ',
    })).toThrow(/VENDOR_KEYS_ALI_OSS_BUCKET/)
  })

  it('任何角色、任何前缀下 Resource 都不许是裸 *', () => {
    const roles = [Role.VISITOR, 'admin']
    const prefixes = [null, '', 'u/user-1']

    for (const currentRoleName of roles) {
      for (const objectKeyPrefix of prefixes) {
        const resources = resourcesOf(parsePolicy(buildAliOSSStsPolicy({
          currentRoleName,
          bucket: BUCKET,
          objectKeyPrefix,
        })))

        expect(resources).not.toContain('*')
        expect(resources.every(resource => resource.startsWith('acs:oss:*:*:'))).toBe(true)
      }
    }
  })
})
