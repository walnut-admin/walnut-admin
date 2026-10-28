# @walnut-server/db

PostgreSQL (TypeORM) database module for the application. Provides the PG connection module, a request-scoped transaction interceptor with post-commit hooks, transaction decorators, and the model / virtual-populate name constants consumed across the API (soft-delete snapshot routing and recover registry included).

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `WalnutModule` | NestJS Module | DB assembly module (imports `WalnutPGModule`; Phase 5a 起 PG 单引擎) |
| `WalnutPGModule` | NestJS Module | Configures TypeORM for the PG datasource (`autoLoadEntities`) |
| `WalnutPGConnectionName` | `string` | PG connection name constant: `'WalnutPGConnection'` |
| `WalnutModelName` | `const` object | 24 model name constants used as the soft-delete snapshot `modelName` routing key (e.g., `SYS_USER: 'SysUser'`) |
| `WalnutVirtualName` | `const` object | 6 virtual populate wire-key constants (e.g., `USER: 'user'`, `ROLES_LIST: 'roles_list'`) |
| `WalnutTx()` | Method decorator | Applies `WalnutTxInterceptor` — starts the PG transaction (QueryRunner) and commits/rolls it back around the handler |
| `WalnutTxSession` | Param decorator | Extracts `request.txContext` (`WalnutTxContext`) as a controller method parameter |
| `WalnutTxContext` | Interface | `{ em: EntityManager }` — the in-transaction EntityManager all data paths must use |
| `WalnutTxInterceptor` | Interceptor | Starts a PG transaction via `createQueryRunner()`, commits on success, rolls back on error, then runs post-commit hooks from `DBTransactionHooksStore` |
| `registerAfterCommitHook(hook)` | Function | Registers a post-commit hook (strict — throws if no transaction context) |
| `runAfterCommit(hook)` | Function | Registers a post-commit hook (lenient — runs inline if no transaction) |

## Key Files

| File | Purpose |
|------|---------|
| `src/db.module.ts` | `WalnutModule` — DB assembly (only `WalnutPGModule` since Phase 5a) |
| `src/pg.module.ts` | `WalnutPGModule` — TypeORM root datasource configuration via `WalnutPGConfigService` |
| `src/pg.service.ts` | `WalnutPGConfigService` implementing `TypeOrmOptionsFactory` (reads the `DATABASE_PG_*` env group) |
| `src/pg.const.ts` | `WalnutPGConnectionName` |
| `src/db.const.ts` | `WalnutModelName` (24 model names) and `WalnutVirtualName` (6 virtual populate keys) |
| `src/db.decorator.ts` | `@WalnutTx()` composite method decorator and `@WalnutTxSession()` param decorator |
| `src/tx.interceptor.ts` | `WalnutTxInterceptor` — QueryRunner-based PG transaction, commit/rollback + post-commit hooks |
| `src/tx-context.ts` | `WalnutTxContext` (`{ em }`), mounted on `request.txContext` |
| `src/db.hook.ts` | `DBTransactionHooksStore` (AsyncLocalStorage). `registerAfterCommitHook()` for strict usage (must have a transaction), `runAfterCommit()` for lenient usage (runs inline if no transaction context). |

## Usage

```typescript
// 1. Import in root AppModule
import { WalnutModule } from '@walnut-server/db'

@Module({
  imports: [WalnutModule],
})
export class AppModule {}

// 2. PG repositories take the EntityTarget + model name and the PG datasource
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

@Injectable()
export class SysUserBasicRepository extends WalnutAdminCommonPgBaseRepository<SysUserEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysUserEntity, WalnutModelName.SYS_USER, dataSource)
  }
}

// 3. Use the transaction decorator on controller methods
import { WalnutTx, WalnutTxSession } from '@walnut-server/db'

@Post()
@WalnutTx()
async create(@Body() dto: CreateDTO, @WalnutTxSession() ctx: WalnutTxContext) {
  return this.service.create(dto, ctx.em)
}

// 4. Post-commit hooks in service layer
import { runAfterCommit } from '@walnut-server/db'

async create(dto: CreateDTO, em: EntityManager) {
  const user = await this.repository.create(dto, em)

  await runAfterCommit(async () => {
    await this.cacheService.invalidateUserCache(user.id)
  })

  return user
}
```

## Dependencies

- **Internal**: None (self-contained, uses self-imports for constants and decorators)
- **External**: `@nestjs/typeorm`, `typeorm`

## Notes

- All writes inside a transaction must go through `ctx.em`（`WalnutTxContext.em`）— the interceptor commits/rolls back that single EntityManager
- `deleteSoftById` writes the soft-delete snapshot into `sys_deleted` with `modelName` from `WalnutModelName`（回收站恢复按它路由回目标实体）
- `runAfterCommit()` is the recommended function for most use cases — it safely degrades to inline execution when no transaction context exists
