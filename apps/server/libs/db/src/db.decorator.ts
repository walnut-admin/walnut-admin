import type { ExecutionContext } from '@nestjs/common'
import type { IWalnutTxEngineType, WalnutTxContext } from './tx-context'
import { applyDecorators, createParamDecorator, SetMetadata, UseInterceptors } from '@nestjs/common'
import { InjectConnection, InjectModel } from '@nestjs/mongoose'
import { WalnutDBConnectionName } from '@walnut-server/db'
import { WalnutTxEngine, WalnutTxEngineMetadataKey } from './tx-context'
import { WalnutTxInterceptor } from './tx.interceptor'

export function WalnutDBInjectModel(name: string) {
  return InjectModel(name, WalnutDBConnectionName)
}

export function WalnutDBInjectConnection() {
  return InjectConnection(WalnutDBConnectionName)
}

/**
 * 事务端点标记。发起双引擎事务（PG QueryRunner + Mongo session，engine 可选收窄，
 * 见 tx.interceptor.ts），`@WalnutDBSession()` 在同端点取 `WalnutTxContext`。
 */
export function WalnutDBTransaction(options: { engine?: IWalnutTxEngineType } = {}) {
  return applyDecorators(
    UseInterceptors(WalnutTxInterceptor),
    SetMetadata(WalnutTxEngineMetadataKey, options.engine ?? WalnutTxEngine.BOTH),
  )
}

export const WalnutDBSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WalnutTxContext => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return request.txContext!
  },
)
