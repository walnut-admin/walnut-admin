import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SysUserMfaRepositoryService } from '@/modules/system/user_mfa/repo/user_mfa.repo.service'
import { SysUserMfaTotpService } from '@/modules/system/user_mfa/totp/totp.service'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'

/**
 * B7b user_mfa 用例（phase2 4.12 / phase3-plan §1 B7b，on real PG）：
 * - uq_user_mfa_credential partial unique：同凭据 id 二插 23505；NULL 凭据 id 不进
 *   唯一索引（partial WHERE NOT NULL）；device_id 松引用（Q5：不建 FK，未知设备键可插）；
 * - 密文列 select:false：默认查询不出，WithSecret / WithBackupCodes 专用通道取回
 *   （对齐 identity 的处理口径）；
 * - **备用码并入 totp 行**（phase2 4.12 定案）：verifyBackupCode 按 totp 行读写
 *   backup_codes_ciphertext，用尽即禁用；
 * - webauthn_counter bigint 列 number transformer（int8 驱动返 string）；
 * - aggregateMfaStats 的 GROUP BY（cron 数据源：type ∈ {totp, webauthn} 且 status）；
 * - 随 user 删除 CASCADE。
 */
describe('B7b user_mfa (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource

  let mfaRepo: SysUserMfaRepositoryService
  let totpService: SysUserMfaTotpService
  let cryptoService: AppTechCryptoService

  const seed = randomUUID()

  async function seedUser(): Promise<string> {
    const rows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`b7-mfa-user-${randomUUID()}`],
    )
    return rows[0].id
  }

  async function countMfa(userId: string): Promise<number> {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_mfa WHERE user_id = $1',
      [userId],
    )
    return rows[0].c
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)

    mfaRepo = app.get(SysUserMfaRepositoryService)
    totpService = app.get(SysUserMfaTotpService)
    cryptoService = app.get(AppTechCryptoService)
  })

  afterAll(async () => {
    // mfa 行随 user CASCADE
    await pgDataSource.query('DELETE FROM sys_user WHERE user_name LIKE $1', ['b7-mfa-user-%'])
    await app.close()
  })

  it('uq_user_mfa_credential：同凭据 id 23505；NULL 凭据 id 不进唯一索引；device_id 松引用', async () => {
    const userId = await seedUser()
    const credentialId = `cred-${seed}`

    await mfaRepo.createMfa({
      userId,
      type: 'webauthn',
      deviceId: 'device-not-in-sys_device',
      name: 'yubikey-a',
      webauthnCredentialId: credentialId,
      webauthnCounter: 1,
      status: true,
    })

    await expect(mfaRepo.createMfa({
      userId,
      type: 'webauthn',
      deviceId: 'device-other',
      name: 'yubikey-b',
      webauthnCredentialId: credentialId,
      webauthnCounter: 0,
      status: true,
    })).rejects.toMatchObject({ code: '23505' })

    // NULL 凭据 id（totp 行）不进 partial unique，多行并存
    await mfaRepo.createMfa({ userId, type: 'totp', deviceId: 'd1', name: 'totp', status: true })
    await mfaRepo.createMfa({ userId, type: 'totp', deviceId: 'd2', name: 'totp-2', status: true })
    expect(await countMfa(userId)).toBe(3)
  })

  it('密文列 select:false：默认查询不出，WithSecret / WithBackupCodes 专用通道取回', async () => {
    const userId = await seedUser()

    await mfaRepo.createMfa({
      userId,
      type: 'totp',
      deviceId: 'd-secret',
      name: 'totp',
      totpSecretCiphertext: 'enc-secret',
      backupCodesCiphertext: ['hash-a', 'hash-b'],
      status: true,
    })

    const plain = await mfaRepo.findTotpByUserId(userId)
    expect(plain).not.toBeNull()
    expect(plain!.totpSecretCiphertext).toBeUndefined()
    expect(plain!.backupCodesCiphertext).toBeUndefined()

    const withSecret = await mfaRepo.findTotpWithSecretByUserId(userId)
    expect(withSecret!.totpSecretCiphertext).toBe('enc-secret')

    const withCodes = await mfaRepo.findTotpWithBackupCodesByUserId(userId)
    expect(withCodes!.backupCodesCiphertext).toEqual(['hash-a', 'hash-b'])
  })

  it('webauthn_counter bigint → number transformer；transports 数组往返', async () => {
    const userId = await seedUser()
    const bigCounter = 2 ** 40

    await mfaRepo.createMfa({
      userId,
      type: 'webauthn',
      deviceId: 'd-counter',
      name: 'key',
      webauthnCredentialId: `cred-counter-${seed}`,
      webauthnCounter: bigCounter,
      webauthnTransports: ['usb', 'nfc'],
      status: true,
    })

    const row = await mfaRepo.findWebauthnByUserId(userId)
    expect(row).not.toBeNull()
    expect(typeof row!.webauthnCounter).toBe('number')
    expect(row!.webauthnCounter).toBe(bigCounter)
    expect(row!.webauthnTransports).toEqual(['usb', 'nfc'])

    // 防重放更新（counter + lastUsedAt）
    await mfaRepo.updateWebauthnCounterAndLastUsedAt(row!.id, bigCounter + 7, new Date())
    const updated = await mfaRepo.findWebauthnByUserId(userId)
    expect(updated!.webauthnCounter).toBe(bigCounter + 7)
    expect(updated!.lastUsedAt).not.toBeNull()
  })

  it('verifyBackupCode：hash 带随机盐（上游现状）→ 查找必 miss 抛 Unauthorized；消耗/禁用机制由写路径承接', async () => {
    const userId = await seedUser()

    const storedCodes = [cryptoService.hash('ABCD-EFGH-JKLM'), cryptoService.hash('NPQR-STUV-WXYZ')]
    await mfaRepo.createMfa({
      userId,
      type: 'totp',
      deviceId: 'd-backup',
      name: 'totp',
      backupCodesCiphertext: storedCodes,
      status: true,
    })

    // 上游 bindTotp 用 cryptoService.hash（无 salt → 每次随机盐）存备用码，
    // verifyBackupCode 用新盐 hash 用户输入后 indexOf —— 恒 miss（Mongo 版同款行为，
    // TODO: use backup code to recover 未实现）。本用例钉住该现状不退化。
    await expect(totpService.verifyBackupCode(userId, 'ABCD-EFGH-JKLM')).rejects.toThrow('备用码错误或已使用')

    // 格式不合法 → BadRequest（进不了查找）
    await expect(totpService.verifyBackupCode(userId, 'ZZ')).rejects.toThrow('备用码格式错误')

    // 消耗 + 用尽禁用的写路径（verifyBackupCode 命中后的机制，repo + 实体直改承接）：
    const row = await mfaRepo.findTotpWithBackupCodesByUserId(userId)
    row!.backupCodesCiphertext.splice(0, 1)
    await mfaRepo.saveMfa(row!)

    const afterOne = await mfaRepo.findTotpWithBackupCodesByUserId(userId)
    expect(afterOne!.backupCodesCiphertext).toHaveLength(1)
    expect(afterOne!.status).toBe(true)

    // 用尽即禁用（WithBackupCodes 通道筛 status=true，禁用后改走普通通道断言）
    afterOne!.backupCodesCiphertext.splice(0, 1)
    afterOne!.status = false
    await mfaRepo.saveMfa(afterOne!)

    expect(await mfaRepo.findTotpWithBackupCodesByUserId(userId)).toBeNull()
    const disabled = await mfaRepo.findTotpByUserId(userId)
    expect(disabled!.status).toBe(false)
  })

  it('unbindTotp / updateStatus：totp 行级语义（备用码同行同生灭）', async () => {
    const userId = await seedUser()

    await mfaRepo.createMfa({ userId, type: 'totp', deviceId: 'd-status', name: 'totp', status: true })

    await totpService.updateStatus(userId, false)
    expect(await mfaRepo.findActiveTotpByUserId(userId)).toBeNull()
    expect(await mfaRepo.findTotpByUserId(userId)).not.toBeNull()

    expect(await totpService.unbindTotp(userId)).toBe(true)
    expect(await countMfa(userId)).toBe(0)
    await expect(totpService.unbindTotp(userId)).rejects.toThrow()
  })

  it('aggregateMfaStats：GROUP BY 只统计 status=true 的 totp/webauthn 行', async () => {
    const userA = await seedUser()
    await seedUser() // userB：无 mfa 行，不进聚合

    await mfaRepo.createMfa({ userId: userA, type: 'totp', deviceId: 's1', name: 't', status: true })
    await mfaRepo.createMfa({ userId: userA, type: 'webauthn', deviceId: 's2', name: 'w', status: true })
    // 排除项：禁用行不参与计数
    await mfaRepo.createMfa({ userId: userA, type: 'totp', deviceId: 's3', name: 't-off', status: false })

    const stats = await mfaRepo.aggregateMfaStats()
    const statA = stats.find(s => s.userId === userA)
    expect(statA).toBeDefined()
    expect(typeof statA!.deviceCount).toBe('number')
    expect(statA!.deviceCount).toBe(2)
  })

  it('随 user 删除 CASCADE（fk_user_mfa_user）', async () => {
    const userId = await seedUser()
    await mfaRepo.createMfa({ userId, type: 'totp', deviceId: 'd-cascade', name: 't', status: true })
    expect(await countMfa(userId)).toBe(1)

    await pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [userId])
    expect(await countMfa(userId)).toBe(0)
  })
})
