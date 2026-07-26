# @walnut/context

AsyncLocalStorage-based request tracing context for logging purposes. Provides a `@Global()` NestJS module (`WalnutContextModule`) for DI-based usage, plus a raw `AsyncLocalStorage` instance for non-DI contexts like Winston log formatters.

**Note:** This library is NOT registered as a NestJS project in `nest-cli.json`. It exists as a source-level library accessed via TypeScript path aliases.

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `WalnutContextModule` | NestJS `@Global()` Module | Provides and exports `LoggerContextService` |
| `LoggerContextService` | `@Injectable()` Service | DI-friendly wrapper around `loggerContextALS` — `run(store, callback)`, `getRequestId()`, `getStore()` |
| `ILoggerContextStore` | TypeScript interface | `{ requestId: string }` — the context data shape |
| `loggerContextALS` | `AsyncLocalStorage<ILoggerContextStore>` | Raw ALS instance for non-DI usage |

## Key Files

| File | Purpose |
|------|---------|
| `src/context.module.ts` | `@Global()` module providing `LoggerContextService` |
| `src/logger-context.service.ts` | NestJS service wrapping the ALS. Methods: `run()` (enter context), `getRequestId()` (read current request ID), `getStore()` (read full store). Includes debug logging on context creation. |
| `src/logger-context.als.ts` | Creates and exports the `AsyncLocalStorage` instance and the `ILoggerContextStore` interface |

## Usage

```typescript
// 1. Import in root AppModule
import { WalnutContextModule } from '@walnut/context'

@Module({
  imports: [WalnutContextModule],
})
export class AppModule {}

// 2. DI usage in middleware/interceptors
import { LoggerContextService } from '@walnut/context'

@Injectable()
export class RequestIdInterceptor {
  constructor(private readonly loggerContext: LoggerContextService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const requestId = crypto.randomUUID()

    return this.loggerContext.run({ requestId }, () => {
      return next.handle()
    })
  }
}

// 3. Read context anywhere in the request chain
const requestId = this.loggerContext.getRequestId()

// 4. Non-DI usage (e.g., Winston formatters)
import { loggerContextALS } from '@walnut/context'

const store = loggerContextALS.getStore()
if (store) {
  logEntry.requestId = store.requestId
}
```

## Dependencies

- **Internal**: None
- **External**: `@nestjs/common` (Module, Global, Injectable, Logger), `node:async_hooks`

## Notes

- **Not registered in `nest-cli.json`** — this library is manually created and accessed via the `@walnut/context` path alias in `tsconfig.json`. It has its own `tsconfig.lib.json` for compilation.
- The `LoggerContextService` is a thin wrapper around `loggerContextALS` — the raw ALS instance is exported for cases where DI is unavailable (e.g., Winston formats, which run outside NestJS's DI container)
- Each request gets a unique `requestId` stored in the ALS context, allowing all logs within a request to be correlated
- Unlike `@walnut/db`'s `DBTransactionHooksStore`, this context is specifically for logging/tracing, not transaction lifecycle management
