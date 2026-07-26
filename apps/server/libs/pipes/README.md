# @walnut/pipes

Validation pipes for controller parameters. Four `PipeTransform` implementations for validating MongoDB ObjectIds, enum values, and required parameters. Used directly in controller method signatures without a NestJS module — each pipe is instantiated inline.

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `WalnutAdminPipeMongoId` | `@Injectable()` Pipe | Validates a single MongoDB ObjectId from params — throws `WalnutAdminExceptionInvalidID` if nil or invalid |
| `WalnutAdminPipeMongoIds` | `@Injectable()` Pipe | Validates comma-separated MongoDB ObjectIds from params — splits by the configured ID separator, validates each |
| `WalnutAdminPipeParamEnum` | `@Injectable()` Pipe | Validates a param value against an allowed enum map, with optional `required` flag (defaults to `true`) |
| `WalnutAdminPipeRequired` | `@Injectable()` Pipe | Generic required-value pipe — throws `WalnutAdminExceptionRequestDataError` if the value is nil |

## Key Files

| File | Purpose |
|------|---------|
| `src/base/mongoId.pipe.ts` | Two pipes: `WalnutAdminPipeMongoId` (single ObjectId validation using `Types.ObjectId.isValid()`) and `WalnutAdminPipeMongoIds` (splits by `WalnutAdminConstAppConfig.idSeparator` and validates each) |
| `src/base/params.pipe.ts` | `WalnutAdminPipeParamEnum` — constructor takes an enum values object and optional `{ required: boolean }` options; validates the value is in the allowed set |
| `src/base/required.pipe.ts` | `WalnutAdminPipeRequired` — generic required-value validation with descriptive error messages including `metadata.type` and `metadata.data` |

## Usage

```typescript
import {
  WalnutAdminPipeMongoId,
  WalnutAdminPipeMongoIds,
  WalnutAdminPipeParamEnum,
  WalnutAdminPipeRequired,
} from '@walnut/pipes'

@Controller('users')
export class UserController {
  // Validate a single MongoId param
  @Get(':id')
  findOne(@Param('id', WalnutAdminPipeMongoId) id: string) {
    return this.service.findById(id)
  }

  // Validate comma-separated MongoIds
  @Delete()
  deleteMany(@Query('ids', WalnutAdminPipeMongoIds) ids: string[]) {
    return this.service.deleteMany(ids)
  }

  // Validate enum param
  @Get()
  list(@Query('status', new WalnutAdminPipeParamEnum({ active: 'active', inactive: 'inactive' }, { required: false })) status?: string) {
    return this.service.list({ status })
  }

  // Validate required value
  @Post()
  create(@Body('name', WalnutAdminPipeRequired) name: string) {
    return this.service.create({ name })
  }
}
```

## Dependencies

- **Internal**: `@walnut/const/app/config` (for `idSeparator`), `@walnut/exceptions/base/400` (for `WalnutAdminExceptionInvalidID`, `WalnutAdminExceptionRequestDataError`)
- **External**: `@nestjs/common`, `lodash`, `mongoose`

## Notes

- No NestJS module — pipes are instantiated directly in controller method decorators
- `WalnutAdminPipeParamEnum` accepts a constructor parameter for the allowed values, making it reusable across different enum sets
- All pipes use `WalnutAdminException*` from `@walnut/exceptions` for consistent error responses with proper error codes
- The ID separator for `WalnutAdminPipeMongoIds` is configured via `WalnutAdminConstAppConfig.idSeparator` (default: `,`)
