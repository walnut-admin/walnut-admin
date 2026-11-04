import { plainToClass } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { EnvironmentVariables } from '../validation'
// class-transformer 的装饰器元数据依赖 reflect-metadata（app 侧由 main.ts 引入，单测需自带）
import 'reflect-metadata'

/**
 * F-01（admin UI 门禁）env schema 单测：SOCKET_ADMIN_UI_USER / SOCKET_ADMIN_UI_PASSWORD
 * 是**可选对** —— 两者同时配置才挂载 admin UI（不配置 = 不挂载，fail-closed）。
 * PASSWORD 必须是 bcrypt hash：@socket.io/admin-ui 0.5.1 只收 bcrypt（明文会在
 * instrument() 启动时抛错）—— MinLength(8) 约束的是生成 hash 的原强口令下限，
 * Matches 校验的是 env 里存的 hash 形态，两者双保险。
 */

const BCRYPT_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0'

function socketAdminUiErrors(value: Record<string, unknown>) {
  return validateSync(
    plainToClass(EnvironmentVariables, value, { enableImplicitConversion: true }),
    { skipMissingProperties: false },
  ).filter(error =>
    error.property === 'SOCKET_ADMIN_UI_USER' || error.property === 'SOCKET_ADMIN_UI_PASSWORD')
}

describe('env schema：socket admin UI 可选对（F-01）', () => {
  it('两个变量都不配置 → 这两个属性零错误（不配置 = 不挂载）', () => {
    expect(socketAdminUiErrors({})).toEqual([])
  })

  it('user + bcrypt hash → 零错误', () => {
    expect(socketAdminUiErrors({
      SOCKET_ADMIN_UI_USER: 'admin',
      SOCKET_ADMIN_UI_PASSWORD: BCRYPT_HASH,
    })).toEqual([])
  })

  it('明文强口令作为 PASSWORD → Matches 报错（bcrypt hash 要求）', () => {
    const errors = socketAdminUiErrors({
      SOCKET_ADMIN_UI_USER: 'admin',
      SOCKET_ADMIN_UI_PASSWORD: 'strong-pass-123',
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.property).toBe('SOCKET_ADMIN_UI_PASSWORD')
    expect(errors[0]?.constraints?.matches).toContain('bcrypt hash')
  })

  it('过短口令（< 8 位）→ MinLength + Matches 双报错（强口令下限 8 位）', () => {
    const errors = socketAdminUiErrors({
      SOCKET_ADMIN_UI_USER: 'admin',
      SOCKET_ADMIN_UI_PASSWORD: '1234567',
    })

    // 同一属性的多个失败约束合并在一个 ValidationError 里
    expect(errors).toHaveLength(1)
    expect(errors[0]?.property).toBe('SOCKET_ADMIN_UI_PASSWORD')
    expect(errors[0]?.constraints?.minLength).toContain('最少 8 位')
    expect(errors[0]?.constraints?.matches).toContain('bcrypt hash')
  })

  it('只配 user 不配 password → schema 层零错误（两者同配的运行时门禁在 gateway）', () => {
    expect(socketAdminUiErrors({ SOCKET_ADMIN_UI_USER: 'admin' })).toEqual([])
  })
})
/**
 * F-11（trust proxy 跳数）：APP_TRUST_PROXY_HOPS 是**可选**项，默认 1（docker 单层 nginx，
 * 见 deploy/nginx/conf.d/api.conf:50-57 的 XFF 覆写口径）。这里守三件事：
 * 1) 完全不配置时字段仍存在且等于 1（回落到「恰好一跳」而不是 trust proxy=true）；
 * 2) env 里的字符串会被 class-transformer 隐式转成 number（Express 对字符串会当 IP 网段解析，
 *    所以类型必须是数字）；
 * 3) 非整数被 IsInt 拒（1.5 / 文字都不许静默通过）。
 */
function trustProxyHopsErrors(value: Record<string, unknown>) {
  return validateSync(
    plainToClass(EnvironmentVariables, value, { enableImplicitConversion: true }),
    { skipMissingProperties: false },
  ).filter(error => error.property === 'APP_TRUST_PROXY_HOPS')
}

describe('env schema：APP_TRUST_PROXY_HOPS（F-11 trust proxy 跳数）', () => {
  it('不配置 → 零错误，且默认值为 1（单层 nginx）', () => {
    expect(trustProxyHopsErrors({})).toEqual([])
    const config = plainToClass(EnvironmentVariables, {}, { enableImplicitConversion: true })
    expect(config.APP_TRUST_PROXY_HOPS).toBe(1)
  })

  it('配置 "3" → 隐式转成数字 3（不是字符串，Express 会把字符串当 IP 网段）', () => {
    expect(trustProxyHopsErrors({ APP_TRUST_PROXY_HOPS: '3' })).toEqual([])
    const config = plainToClass(EnvironmentVariables, { APP_TRUST_PROXY_HOPS: '3' }, { enableImplicitConversion: true })
    expect(config.APP_TRUST_PROXY_HOPS).toBe(3)
    expect(typeof config.APP_TRUST_PROXY_HOPS).toBe('number')
  })

  it('配置 "2" 这类多层代理跳数同样通过（值域由部署形态决定，schema 只约束整数）', () => {
    expect(trustProxyHopsErrors({ APP_TRUST_PROXY_HOPS: '2' })).toEqual([])
  })

  it('小数 / 文字 → IsInt 报错（不许静默回落或当字符串传下去）', () => {
    const decimal = trustProxyHopsErrors({ APP_TRUST_PROXY_HOPS: '1.5' })
    expect(decimal).toHaveLength(1)
    expect(decimal[0]?.property).toBe('APP_TRUST_PROXY_HOPS')
    expect(decimal[0]?.constraints?.isInt).toBeDefined()

    const text = trustProxyHopsErrors({ APP_TRUST_PROXY_HOPS: 'abc' })
    expect(text).toHaveLength(1)
    expect(text[0]?.property).toBe('APP_TRUST_PROXY_HOPS')
    expect(text[0]?.constraints?.isInt).toBeDefined()
  })
})

/**
 * F-42：密钥类 env 的最小长度（@MinLength(32)）。
 *
 * 这 7 个值此前只有 @IsString() —— "1" 也能启动。下限口径与「为什么不会自伤」写在
 * validation.ts 顶部的 SECRET_MIN_LENGTH 注释里；本文件守三件事：
 * 1) 过短值必须被拒，且报错文案点名变量名（排障要知道改哪个 env）；
 * 2) 恰好 32 字符（下限）通过 —— 边界值是约定的一部分；
 * 3) 现网三份 env-local 的实际长度（44 / 38 / 128 / 171）全部通过（自伤回归守卫）。
 */
const SECRET_FIELDS = [
  'AUTH_OPAQUE_SECRET',
  'MFA_ENCRYPTION_KEY',
  'RT_ENCRYPTION_KEY',
  'DEVICE_ID_ENCRYPTION_KEY',
  'USER_ID_ENCRYPTION_KEY',
  'JWT_ACCESS_TOKEN_SECRET',
  'JWT_REFRESH_TOKEN_SECRET',
] as const

function secretErrors(value: Record<string, unknown>, field: string) {
  return validateSync(
    plainToClass(EnvironmentVariables, value, { enableImplicitConversion: true }),
    { skipMissingProperties: false },
  ).filter(error => error.property === field)
}

describe('env schema：密钥类 env 最小长度（F-42）', () => {
  it.each(SECRET_FIELDS)('%s：16 字符 → minLength 报错，且文案点名变量名', (field) => {
    const errors = secretErrors({ [field]: 'x'.repeat(16) }, field)

    expect(errors).toHaveLength(1)
    expect(errors[0]?.constraints?.minLength).toBeDefined()
    expect(errors[0]?.constraints?.minLength).toContain(field)
    expect(errors[0]?.constraints?.minLength).toContain('32')
  })

  it.each(SECRET_FIELDS)('%s：恰好 32 字符（下限边界）→ 零错误', (field) => {
    expect(secretErrors({ [field]: 'x'.repeat(32) }, field)).toEqual([])
  })

  it.each(SECRET_FIELDS)('%s：现网长度（38 / 44 / 128 / 171）→ 零错误（不自伤回归）', (field) => {
    for (const length of [38, 44, 128, 171]) {
      expect(secretErrors({ [field]: 'x'.repeat(length) }, field), `len=${length}`).toEqual([])
    }
  })

  it('七个字段同时缺失 → 每个字段一个 ValidationError，isString 必在其中（缺值仍然先被 IsString 判死）', () => {
    const errors = validateSync(
      plainToClass(EnvironmentVariables, {}, { enableImplicitConversion: true }),
      { skipMissingProperties: false },
    )

    for (const field of SECRET_FIELDS) {
      const target = errors.filter(error => error.property === field)
      expect(target, field).toHaveLength(1)

      // class-validator 对 undefined 也会跑 MinLength（同一属性的失败约束合并进一个错误），
      // 所以「没配置」会同时报 isString + minLength。这里把这条事实钉住：真正的判死
      // 依据始终有 isString —— 报错文案里同时出现「长度不足」不是漏配被当成配错，而是
      // 同一属性两条约束都失败。
      expect(Object.keys(target[0].constraints ?? {})).toContain('isString')
    }
  })
})
