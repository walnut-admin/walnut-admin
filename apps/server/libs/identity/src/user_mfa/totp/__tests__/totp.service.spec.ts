import type { EntityManager } from 'typeorm'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { describe, expect, it, vi } from 'vitest'
import { SysUserMfaTotpService } from '../totp.service'

/**
 * ②（2026-11）：TOTP unbind 同步回落 `sys_user.mfa_setup`。
 *
 * 判据两条：
 * 1) 删行成功 ⇒ 同一个 em 上再写一次 `mfaSetup: false`（账号级标志不留给 cron）；
 * 2) 没有 totp 行 ⇒ 仍 40401，且**不碰**账号级标志（避免「没解绑成功却把 MFA 标记清掉」）。
 */

const USER_ID = '11111111-1111-4111-8111-111111111111'
const EM = { marker: 'entity-manager' } as unknown as EntityManager

function createService(deleteCount: number) {
  const deleteByUserIdAndType = vi.fn(async () => deleteCount)
  const findUserByIdAndUpdate = vi.fn(async () => ({ id: USER_ID }))

  const service = new SysUserMfaTotpService(
    { deleteByUserIdAndType } as never,
    { get: () => 'spec-app' } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findUserByIdAndUpdate } as never,
  )

  return { service, deleteByUserIdAndType, findUserByIdAndUpdate }
}

describe('unbindTotp：同步 mfa_setup（②）', () => {
  it('删行成功 ⇒ 同事务把 mfa_setup 置 false', async () => {
    const { service, deleteByUserIdAndType, findUserByIdAndUpdate } = createService(1)

    await expect(service.unbindTotp(USER_ID, EM)).resolves.toBe(true)

    expect(deleteByUserIdAndType).toHaveBeenCalledExactlyOnceWith(USER_ID, 'totp', EM)
    expect(findUserByIdAndUpdate).toHaveBeenCalledExactlyOnceWith(USER_ID, { mfaSetup: false }, EM)
  })

  it('没有 totp 行 ⇒ 40401，且不写账号级标志', async () => {
    const { service, findUserByIdAndUpdate } = createService(0)

    await expect(service.unbindTotp(USER_ID, EM)).rejects.toBeInstanceOf(WalnutAdminExceptionDataNotFound)
    expect(findUserByIdAndUpdate).not.toHaveBeenCalled()
  })
})
