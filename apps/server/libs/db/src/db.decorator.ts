import type { ExecutionContext } from '@nestjs/common'
import type { ClientSession } from 'mongoose'
import { applyDecorators, createParamDecorator, UseInterceptors } from '@nestjs/common'
import { InjectConnection, InjectModel } from '@nestjs/mongoose'
import { WalnutDBConnectionName } from '@walnut/db'
import { TransactionInterceptor } from './transaction.interceptor'

export function WalnutDBInjectModel(name: string) {
  return InjectModel(name, WalnutDBConnectionName)
}

export function WalnutDBInjectConnection() {
  return InjectConnection(WalnutDBConnectionName)
}

export function WalnutDBTransaction() {
  return applyDecorators(
    UseInterceptors(TransactionInterceptor),
  )
}

export const WalnutDBSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientSession => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return request.mongooseSession!
  },
)
