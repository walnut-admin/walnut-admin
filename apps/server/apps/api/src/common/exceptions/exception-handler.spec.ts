import type { I18nContext } from 'nestjs-i18n'
import { WalnutAdminExceptionHandler } from '@walnut-server/exceptions'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { QueryFailedError } from 'typeorm'
import { describe, expect, it } from 'vitest'

// 配套单测：全局异常处理器把 PG 约束类错误收敛为受控 40000 ——
// 23514 check_violation（2026-10-27）+ 23505 unique_violation / 23503 foreign_key_violation
// （P1-7，2026-10-28 修复；修复前兜底 50000），约束名进 _devMsg。

const i18nStub = { t: (message: string) => message } as unknown as I18nContext

function pgError(code: string, constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error(`new row for relation violates check constraint "${constraint}"`), {
    code,
    constraint,
    detail: `Failing row contains (...).`,
  })
  return new QueryFailedError('INSERT INTO ...', [], driverError)
}

describe('exception handler：WalnutAdminExceptionHandler 的 PG 错误码映射', () => {
  it('23514 check_violation → 受控 40000（修复前兜底 50000）', () => {
    const error = pgError('23514', 'ck_menu_cache_key_strategy')

    const response = WalnutAdminExceptionHandler(error, 'req-1', i18nStub) as unknown as { code: number, msg?: string }

    expect(response.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  // 注：_devMsg 仅在 dev 环境（isDev）落响应壳，单测的 NODE_ENV=test 下不可见 ——
  // 约束名断言落在 HTTP 级 spec（user.api-spec 的 uq_user_name）
  it('23505 unique_violation → 受控 40000（P1-7：修复前兜底 50000）', () => {
    const response = WalnutAdminExceptionHandler(pgError('23505', 'uq_user_name'), 'req-1', i18nStub) as unknown as { code: number }

    expect(response.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('23503 foreign_key_violation → 受控 40000（P1-7：修复前兜底 50000）', () => {
    const response = WalnutAdminExceptionHandler(pgError('23503', 'fk_role_menu_menu'), 'req-1', i18nStub) as unknown as { code: number }

    expect(response.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('无 driverError / 非 23514 的 QueryFailedError 仍兜底 50000', () => {
    const bare = new QueryFailedError('SELECT 1', [], new Error('connection refused'))
    const response = WalnutAdminExceptionHandler(bare, 'req-1', i18nStub) as unknown as { code: number }
    expect(response.code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
  })

  it('运行时 TypeError 兜底 50000（既有分支回归面）', () => {
    const response = WalnutAdminExceptionHandler(new TypeError('Cannot read properties of undefined'), 'req-1', i18nStub) as unknown as { code: number }
    expect(response.code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
  })
})
