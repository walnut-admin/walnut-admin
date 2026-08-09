import { CallHandler, ExecutionContext, Logger, NestInterceptor } from '@nestjs/common'
import { InjectConnection } from '@nestjs/mongoose'
import { WalnutDBConnectionName } from '@walnut-server/db'
import { ClientSession, Connection } from 'mongoose'

import { catchError, concatMap, Observable } from 'rxjs'
import { DBTransactionHooksStore } from './db.hook'

export class TransactionInterceptor implements NestInterceptor {
  protected readonly logger = new Logger(TransactionInterceptor.name)

  constructor(@InjectConnection(WalnutDBConnectionName) private readonly connection: Connection) { }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const className = context.getClass().name
    const handlerName = context.getHandler().name

    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const session: ClientSession = await this.connection.startSession()

    request.mongooseSession = session
    session.startTransaction()

    const hooks: (() => Promise<void>)[] = []
    let committed = false

    return DBTransactionHooksStore.run(hooks, () =>
      next.handle().pipe(
        concatMap(async (value: unknown) => {
          this.logger.log(`Transaction commit: ${className}.${handlerName}`)

          try {
            await session.commitTransaction()
            committed = true
          }
          finally {
            await session.endSession()
          }

          // ✅ execute post-commit hooks (sync)
          for (const hook of hooks) {
            try {
              await hook()
              this.logger.log('[POST-COMMIT] after commit')
            }
            catch (e) {
              this.logger.error(e)
            }
          }

          return value
        }),
        catchError(async (err) => {
          this.logger.log(`Transaction abort: ${className}.${handlerName}`)

          try {
            if (!committed)
              await session.abortTransaction()
          }
          finally {
            if (!committed)
              await session.endSession()
          }

          throw err
        }),
      ))
  }
}
