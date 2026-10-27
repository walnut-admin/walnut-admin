import type { I18nContext } from 'nestjs-i18n'
import { WalnutAdminExceptionHandler } from '@walnut-server/exceptions'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { QueryFailedError } from 'typeorm'
import { describe, expect, it } from 'vitest'

// 瑕疵修复（2026-10-27）配套单测：全局异常处理器把 PG 23514 check_violation 收敛为
// 受控 40000（对照 P1-7 的 23505/23503 修法形态 —— 那两个码仍未映射，属钉现状对照面）。

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

  it('23505/23503 仍走兜底 50000（P1-7 钉现状，不在本批范围）', () => {
    for (const code of ['23505', '23503']) {
      const response = WalnutAdminExceptionHandler(pgError(code, 'uq_user_name'), 'req-1', i18nStub) as unknown as { code: number }
      expect(response.code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
    }
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
