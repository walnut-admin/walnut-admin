import type { AppTechCacheMfaService } from '@walnut-server/cache'
import type { AppTechCryptoService } from '@walnut-server/crypto'
import type { SysUserDeviceSharedService, SysUserRepositoryService, SysUserSharedService } from '@walnut-server/identity'
import type { AppTokenService } from '@walnut-server/token'
import type { EntityManager } from 'typeorm'
import type { AuthSessionService } from '../../../session/session.service'
import type { AuthRefreshTokenEntity } from '../../entity/refresh-token.entity'
import { WalnutAdminExceptionDuplicateSignIn, WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { QueryFailedError } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'
import { AuthRefreshSharedService } from '../refresh.shared.service'

/**
 * F-26（CQ-010）：登录链 duplicate-signin 判定是 check-then-act ——
 * 「查现役行（无锁）→ 插/复活行」，并发两路各自读到 null 后各插一行，把
 * 「未撤销行恒恰一行」变成两行（后续 duplicate 判定 / 全量撤销 / 轮换都建立在
 * 恰一行上）。
 *
 * 修复是两道闸，本用例各钉一遍：
 * 1. 读腿在事务内持悲观锁（repo 收到 `{ lock: true }`）；
 * 2. DB 部分唯一索引 uq_rt_active_device_user 兜住「该维度还没有任何行」的并发首插，
 *    23505 翻译成受控 40109（DuplicateSignIn）—— 且**只认这个索引名**：
 *    uq_jti 冲突是真 bug，不能被改写成「重复登录」。
 */

const EM = { marker: 'entity-manager' } as unknown as EntityManager
const USER_ID = '11111111-1111-4111-8111-111111111111'
const DEVICE_ID = 'device-1'
const SESSION_ID = 'session-1'

function activeToken(patch: Partial<AuthRefreshTokenEntity> = {}): AuthRefreshTokenEntity {
  return {
    id: 'rt-1',
    jti: 'jti-old',
    userId: USER_ID,
    deviceId: DEVICE_ID,
    encryptedToken: 'encrypted',
    expiredAt: new Date(Date.now() + 60_000),
    revoked: false,
    revokeReason: null,
    createdAt: new Date(),
    ...patch,
  }
}

function pgUniqueViolation(constraint: string): QueryFailedError {
  const driverError = Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint, detail: 'Key already exists.' },
  )

  return new QueryFailedError('INSERT INTO auth_refresh_token ...', [], driverError)
}

/** 记录调用的假仓储（风格对照 employee.service.spec 的 Fake*Repo） */
class FakeRefreshRepo {
  readonly calls: Array<{ method: string, args: unknown[] }> = []

  active: AuthRefreshTokenEntity | null = null
  latest: AuthRefreshTokenEntity | null = null
  createError: unknown = undefined
  saveError: unknown = undefined

  argsOf(method: string): unknown[] | undefined {
    return this.calls.find(call => call.method === method)?.args
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }

  async findActiveByDeviceIdAndUserId(deviceId: string, userId: string, em?: EntityManager, options?: unknown) {
    this.record('findActiveByDeviceIdAndUserId', [deviceId, userId, em, options])
    return this.active
  }

  async findByDeviceIdAndUserId(deviceId: string, userId: string, em?: EntityManager) {
    this.record('findByDeviceIdAndUserId', [deviceId, userId, em])
    return this.latest
  }

  async findByJti(jti: string) {
    this.record('findByJti', [jti])
    return null
  }

  async saveRefreshTokenDoc(document: AuthRefreshTokenEntity, data: object, em?: EntityManager) {
    this.record('saveRefreshTokenDoc', [document, data, em])
    if (this.saveError !== undefined) {
      throw this.saveError
    }
    return Object.assign(document, data)
  }

  async create(data: object, em?: EntityManager) {
    this.record('create', [data, em])
    if (this.createError !== undefined) {
      throw this.createError
    }
    return { ...activeToken(), ...(data) }
  }
}

function createService() {
  const repo = new FakeRefreshRepo()

  const generateJTI = vi.fn(async () => 'jti-new')
  const generateJwtRefreshToken = vi.fn(async (jti: string) => `rt:${jti}`)
  const getRefreshTokenExpireSeconds = vi.fn(() => 3600)

  const tokenService = {
    generateJTI,
    generateJwtRefreshToken,
    getRefreshTokenExpireSeconds,
  } as unknown as AppTokenService

  const encrypt = vi.fn((value: string) => `enc(${value})`)
  const cryptoService = {
    encrypt,
    decrypt: vi.fn((value: string) => value),
  } as unknown as AppTechCryptoService

  const service = new AuthRefreshSharedService(
    repo as never,
    {} as AppTechCacheMfaService,
    {} as SysUserDeviceSharedService,
    tokenService,
    {} as SysUserRepositoryService,
    {} as SysUserSharedService,
    cryptoService,
    {} as AuthSessionService,
    // 拍板-4：refresh 的设备状态闸门（本文件的用例都走 generateRefreshToken 路径，
    // 不触达 getNewAccessToken，故这里用最小空实现即可）
    {} as never,
    {} as never,
  )

  return { service, repo, generateJTI, generateJwtRefreshToken }
}

describe('refresh generateRefreshToken：duplicate-signin 竞态（F-26）', () => {
  it('读腿持锁：findActiveByDeviceIdAndUserId 收到 { lock: true } 与事务 em', async () => {
    const { service, repo } = createService()
    repo.active = activeToken()

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionDuplicateSignIn)

    expect(repo.argsOf('findActiveByDeviceIdAndUserId')).toEqual([DEVICE_ID, USER_ID, EM, { lock: true }])
  })

  it('并发首插撞部分唯一索引 → 受控 40109（不是裸露的驱动错误 / 笼统 40000）', async () => {
    const { service, repo } = createService()
    repo.createError = pgUniqueViolation('uq_rt_active_device_user')

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionDuplicateSignIn)
  })

  it('复活旧行（revoke-and-insert 的补充分支）撞同一索引 → 同样 40109', async () => {
    const { service, repo } = createService()
    repo.latest = activeToken({ revoked: true })
    repo.saveError = pgUniqueViolation('uq_rt_active_device_user')

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionDuplicateSignIn)
  })

  it('uq_jti 的 23505 不被翻译（jti 重复是真 bug，必须原样暴露）', async () => {
    const error = pgUniqueViolation('uq_jti')
    const { service, repo } = createService()
    repo.createError = error

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM)).rejects.toBe(error)
  })

  it('非 23505 的写腿失败原样抛出（不吞、不改写语义）', async () => {
    const error = new Error('connect ECONNREFUSED')
    const { service, repo } = createService()
    repo.createError = error

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM)).rejects.toBe(error)
  })

  it('正常新建分支：写腿带事务 em，返回新 jti；读腿（含「取最新行」）同样带 em', async () => {
    const { service, repo, generateJwtRefreshToken } = createService()

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM)).resolves.toBe('jti-new')

    expect(repo.argsOf('findByDeviceIdAndUserId')).toEqual([DEVICE_ID, USER_ID, EM])
    expect(repo.argsOf('create')?.[0]).toMatchObject({
      jti: 'jti-new',
      userId: USER_ID,
      deviceId: DEVICE_ID,
    })
    expect(repo.argsOf('create')?.[1]).toBe(EM)
    expect(generateJwtRefreshToken).toHaveBeenCalledWith('jti-new', SESSION_ID)
  })

  it('复用分支（已有历史行且未撤销现役行缺失）：返回旧 jti 并保持 revoked=false', async () => {
    const { service, repo } = createService()
    const latest = activeToken({ revoked: true, jti: 'jti-revive' })
    repo.latest = latest

    await expect(service.generateRefreshToken(USER_ID, DEVICE_ID, SESSION_ID, EM)).resolves.toBe('jti-revive')

    expect(repo.argsOf('saveRefreshTokenDoc')?.[0]).toBe(latest)
    expect(repo.argsOf('saveRefreshTokenDoc')?.[1]).toMatchObject({ revoked: false })
    expect(repo.argsOf('saveRefreshTokenDoc')?.[2]).toBe(EM)
  })

  it('回归：40102（RefreshTokenExpired）不受影响（本文件未改轮换腿）', async () => {
    const { service } = createService()

    await expect(service.getTokenByJti('missing')).rejects.toBeInstanceOf(WalnutAdminExceptionRefreshTokenExpired)
  })
})
