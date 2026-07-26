import { Global, Module } from '@nestjs/common'
import { LoggerContextService } from './logger-context.service'

/**
 * Walnut Admin Context Module
 *
 * Provides global context services for async context management.
 *
 * Services:
 * - LoggerContextService: Manages requestId for logging/tracing
 *
 * Note: DBTransactionHooksStore remains in @walnut-server/db for transaction-specific usage
 */
@Global()
@Module({
  providers: [LoggerContextService],
  exports: [LoggerContextService],
})
export class WalnutContextModule {}
