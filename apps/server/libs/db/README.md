# @walnut/db

MongoDB/Mongoose database module for the application. Provides connection configuration with replica set support, a transaction interceptor with post-commit hooks, custom injection decorators, and constants for all 22 collection names, model names, and virtual populate names.

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `WalnutDBModule` | NestJS Module | Configures `MongooseModule.forRootAsync` with the primary connection |
| `WalnutDBConnectionName` | `string` | Primary connection name constant: `'WalnutPrimaryConnectionDatabase'` |
| `WalnutDBCollectionName` | `const` object | 22 MongoDB collection name constants (e.g., `SYS_USER: 'sys_user'`) |
| `WalnutDBModelName` | `const` object | 22 Mongoose model name constants (e.g., `SYS_USER: 'SysUserModel'`) |
| `WalnutDBVirtualName` | `const` object | 7 virtual populate name constants (e.g., `USER: 'populated_user'`) |
| `WalnutDBInjectModel(name)` | Decorator function | `InjectModel` bound to the primary connection |
| `WalnutDBInjectConnection()` | Decorator function | `InjectConnection` bound to the primary connection |
| `WalnutDBTransaction()` | Method decorator | Applies `TransactionInterceptor` to start/commit/abort a Mongoose session |
| `WalnutDBSession` | Param decorator | Extracts `request.mongooseSession` as controller method parameter |
| `registerAfterCommitHook(hook)` | Function | Registers a post-commit hook (strict — throws if no transaction context) |
| `runAfterCommit(hook)` | Function | Registers a post-commit hook (lenient — runs inline if no transaction) |

## Key Files

| File | Purpose |
|------|---------|
| `src/db.module.ts` | Module definition — imports `MongooseModule.forRootAsync` using `WalnutDBConfigService` |
| `src/db.service.ts` | `WalnutDBConfigService` implementing `MongooseOptionsFactory`. Builds the MongoDB URI from config (`user:pass@primary,secondary,arbiter`), sets `dbName`, `authSource`, `replicaSet`, and registers `logExecutionTime` plugin on every connection. |
| `src/db.const.ts` | All constant definitions: connection name, 22 collection names, 22 model names, 7 virtual populate names |
| `src/db.decorator.ts` | Custom decorators: `InjectModel`/`InjectConnection` wrappers bound to the primary connection, `@WalnutDBTransaction()` composite decorator, `@WalnutDBSession()` param decorator |
| `src/transaction.interceptor.ts` | `TransactionInterceptor` — starts a Mongoose `ClientSession`, runs the handler, commits on success or aborts on error. Executes post-commit hooks from `DBTransactionHooksStore`. |
| `src/db.hook.ts` | `DBTransactionHooksStore` (AsyncLocalStorage). `registerAfterCommitHook()` for strict usage (must have a transaction), `runAfterCommit()` for lenient usage (runs inline if no transaction context). |

### Collection & Model Constants

The module defines 22 collections across these domains:

| Domain | Collections |
|--------|-------------|
| System | `sys_role`, `sys_user`, `sys_user_oauth`, `sys_user_preference`, `sys_user_lock`, `sys_user_device`, `sys_user_mfa`, `sys_user_identity`, `sys_menu`, `sys_lang`, `sys_locale`, `sys_deleted`, `sys_device` |
| Logs | `sys_log_operate`, `sys_log_auth` |
| Dictionary | `sys_dict_type`, `sys_dict_data` |
| Shared | `shared_area` |
| App | `app_setting`, `app_demo`, `app_monitor_user`, `app_error`, `app_key` |
| Auth | `auth_refresh_token` |

## Usage

```typescript
// 1. Import in root AppModule
import { WalnutDBModule } from '@walnut/db'

@Module({
  imports: [WalnutDBModule],
})
export class AppModule {}

// 2. Inject models using the wrapper decorator
import { WalnutDBInjectModel } from '@walnut/db'
import { WalnutAdminConstDBModelName } from '@walnut/const' // or use WalnutDBModelName directly

@Injectable()
export class UserBasicRepository {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER)
    readonly dbModel: IUserModel,
  ) {}
}

// 3. Use transaction decorator on controller methods
import { WalnutDBTransaction, WalnutDBSession } from '@walnut/db'

@Post()
@WalnutDBTransaction()
async create(@Body() dto: CreateDTO, @WalnutDBSession() session: ClientSession) {
  return this.service.create(dto, session)
}

// 4. Post-commit hooks in service layer
import { runAfterCommit } from '@walnut/db'

async create(dto: CreateDTO) {
  const user = new this.userModel(dto)
  await user.save({ session: dbSession })

  await runAfterCommit(async () => {
    await this.cacheService.invalidateUserCache(user._id)
  })

  return user
}
```

## Dependencies

- **Internal**: None (self-contained, uses self-imports for constants and decorators)
- **External**: `@nestjs/mongoose`, `@nestjs/config`, `mongoose` (including `mongoose-execution-time` plugin)

## Notes

- MongoDB **must** run in replica set mode for transactions to work
- The connection URI is built from `database.user`, `database.pass`, `database.primary`, `database.secondary`, and `database.arbiter` config values
- `WalnutDBConfigService` depends on `ConfigService` from `@nestjs/config` being available (satisfied by importing `@walnut/config`'s global `WalnutConfigModule`)
- Model injection should use `WalnutDBInjectModel` (from this lib) rather than raw `@InjectModel` — this ensures the correct connection name is used
- `runAfterCommit()` is the recommended function for most use cases — it safely degrades to inline execution when no transaction context exists
