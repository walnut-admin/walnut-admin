# @walnut/decorators

Composite property-level decorators that combine class-validator, class-transformer, and Swagger `@ApiProperty` into single, reusable decorators. Used across all DTO classes in the application. Organized into 6 sub-modules: field decorators (the primary API), validators, transformers, param decorators, query decorators, and Swagger response decorators.

## Exports

All exports via barrel files from 6 sub-modules:

| Sub-module | Path | Contents |
|------------|------|----------|
| `field/` | `@walnut/decorators/field` | 7 composite decorators — the primary public API |
| `validator/` | `@walnut/decorators/validator` | Individual class-validator constraint decorators |
| `transformer/` | `@walnut/decorators/transformer` | Individual class-transformer `@Transform()` decorators |
| `params/` | `@walnut/decorators/params` | Param decorators (array, mongoId) |
| `query/` | `@walnut/decorators/query` | Query param decorators (array, delete) |
| `swagger/` | `@walnut/decorators/swagger` | `@ApiWalnutOkResponse` — standardized Swagger success response |

### Field Decorators (Primary API)

| Decorator | Applies | Description |
|-----------|---------|-------------|
| `WalnutAdminDecoratorFieldBoolean(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | Boolean field with default value support |
| `WalnutAdminDecoratorFieldDate(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | Date field with range validation |
| `WalnutAdminDecoratorFieldEnum(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | Enum field restricted to allowed values |
| `WalnutAdminDecoratorFieldMongoId(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | MongoDB ObjectId field |
| `WalnutAdminDecoratorFieldNumber(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | Number field with min/max validation |
| `WalnutAdminDecoratorFieldObject(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | Nested object field with class validation |
| `WalnutAdminDecoratorFieldString(options)` | `@Expose()` + validator + transformer + `@ApiProperty` | String field with length/enum validation |

Each field decorator accepts options for:
- `validateOptions` — class-validator constraints (min/max, length, enum, etc.)
- `transformOptions` — class-transformer options (trim, lowercase, default)
- `swaggerOptions` — Swagger `@ApiProperty` metadata (description, minLength, maxLength, etc.)
- `default` — default value
- `isArray` — whether to validate/transform as an array
- `arrayOptions` — min/max array size constraints

### Swagger Decorator

| Decorator | Description |
|-----------|-------------|
| `ApiWalnutOkResponse(options)` | Method decorator that generates OpenAPI success response schema wrapping `{ data, code, msg }`. Accepts `DTO` (for object responses), `primitive` (for scalar types), `isArray` flag, and `description`. |

## Key Files

| File | Purpose |
|------|---------|
| `src/field/boolean.decorator.ts` | Composite boolean field decorator |
| `src/field/date.decorator.ts` | Composite date field decorator |
| `src/field/enum.decorator.ts` | Composite enum field decorator |
| `src/field/mongoId.decorator.ts` | Composite MongoId field decorator |
| `src/field/number.decorator.ts` | Composite number field decorator |
| `src/field/object.decorator.ts` | Composite nested object field decorator |
| `src/field/string.decorator.ts` | Composite string field decorator |
| `src/swagger/response.decorator.ts` | `ApiWalnutOkResponse` — builds OpenAPI schema for the standardized `{ data, code, msg }` response wrapper |
| `src/swagger/ok.response.ts` | `WalnutAdminSwaggerResponseSuccessSchemeData()` — helper to construct the response schema shape |
| `src/validator/base/*.validator.ts` | 7 individual class-validator decorator functions (one per field type) |
| `src/transformer/base/*.transformer.ts` | 7 individual class-transformer `@Transform()` functions (one per field type) |
| `src/transformer/common/*.transformer.ts` | 3 common transformers: default value, sensitive data masking, shared utilities |
| `src/params/array.decorator.ts` | Bulk param array handling |
| `src/params/mongoId.ts` | Single MongoId param decorator |
| `src/query/array.decorator.ts` | Array query param decorator |
| `src/query/delete.decorator.ts` | Delete query param decorator |

## Usage

```typescript
import {
  WalnutAdminDecoratorFieldString,
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldObject,
} from '@walnut/decorators/field'

import { ApiWalnutOkResponse } from '@walnut/decorators/swagger'

// Field decorators on DTO properties
export class UserDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'User email' },
  })
  email: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: { description: 'Is admin' },
  })
  isAdmin: boolean

  @WalnutAdminDecoratorFieldNumber({
    validateOptions: { min: 0, max: 150 },
    default: 0,
    swaggerOptions: { description: 'Age' },
  })
  age: number

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { description: 'Role ID' },
  })
  roleId: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { maxLength: 500 },
    swaggerOptions: { description: 'Optional bio' },
  })
  bio: string
}

// Swagger response decorator on controller methods
@Get()
@ApiWalnutOkResponse({
  description: 'Get user list',
  DTO: UserDTO,
  isArray: true,
})
async list(@Query() dto: ListDTO) {
  return this.service.list(dto)
}

@Get(':id')
@ApiWalnutOkResponse({
  description: 'Get user by ID',
  DTO: UserDTO,
})
async findOne(@Param('id') id: string) {
  return this.service.findById(id)
}
```

## Dependencies

- **Internal**: None (standalone decorator library)
- **External**: `class-validator`, `class-transformer`, `@nestjs/swagger`, `@nestjs/common`, `lodash`, `mongoose`

## Notes

- This is one of the most widely used libs — every DTO across the application uses these decorators
- Each field decorator applies **three things** at once: a validator (runtime validation), a transformer (data coercion), and `@ApiProperty` (Swagger documentation) — plus `@Expose()` for the global `ClassSerializerInterceptor`
- The architecture separates concerns: field decorators compose validator + transformer decorators, which are themselves standalone and usable independently
- The `@ApiWalnutOkResponse` decorator is the standard Swagger response wrapper — it generates the correct `{ data, code, msg }` OpenAPI schema for all endpoints
- DTO field declaration convention: **never** use TypeScript `?` or `!` markers on DTO fields; use `default: null` in the decorator options for optional fields instead
