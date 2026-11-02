import type { ExecutionContext } from '@nestjs/common'
import type { WalnutTxContext } from './tx-context'
import { applyDecorators, createParamDecorator, UseInterceptors } from '@nestjs/common'
import { WalnutTxInterceptor } from './tx.interceptor'

/**
 * 事务端点标记。发起 PG 事务（QueryRunner，见 tx.interceptor.ts），
 * `@WalnutTxSession()` 在同端点取 `WalnutTxContext`。
 */
export function WalnutTx() {
  return applyDecorators(
    UseInterceptors(WalnutTxInterceptor),
  )
}

export const WalnutTxSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WalnutTxContext => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return request.txContext!
  },
)
