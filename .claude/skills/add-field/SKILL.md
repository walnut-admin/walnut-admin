---
name: add-field
description: Add a new field to an existing module across schema, DTO, and related files in one operation.
---

# Add Field

Add a new field to an existing module, updating all necessary files (schema, DTO, etc.) in one operation.

## Arguments

The user should provide:
- Which module to add the field to
- Field name (camelCase)
- Field type (string, number, boolean, Date, enum, MongoId, object)
- Whether it's required or optional (default value)
- Description for Swagger docs
- Any validation constraints

## Steps

### 1. Read the existing module files

Read schema, DTO, and any related files.

### 2. Add to Schema

In `schema/<moduleName>.schema.ts`, add the field with both a field decorator and `@Prop`:

```typescript
@WalnutAdminDecoratorFieldString({
  swaggerOptions: { description: 'field description' },
})
@Prop({
  type: String,
  default: null,
})
fieldName: string
```

**Field decorator mapping:**
| Type | Decorator |
|------|-----------|
| string | `WalnutAdminDecoratorFieldString` |
| number | `WalnutAdminDecoratorFieldNumber` |
| boolean | `WalnutAdminDecoratorFieldBoolean` |
| Date | `WalnutAdminDecoratorFieldDate` |
| enum | `WalnutAdminDecoratorFieldEnum` |
| MongoId | `WalnutAdminDecoratorFieldMongoId` |
| object | `WalnutAdminDecoratorFieldObject` |

All field decorators are imported from `@/decorators/field`.

**Rules for fields:**
- NO `?` or `!` markers on the field declaration
- Optional fields use `default: null` in the decorator
- Required fields omit the `default` option
- For enum fields, define the enum constant as `{ KEY: 'value' } as const` and use `Object.values()` in `@Prop({ enum: [...Object.values(EnumConst)] })`

### 3. Update DTOs

Determine which DTOs need the new field:

- **Create DTO**: Add field to `RealPickType` array if needed for creation
- **Update DTO**: Usually auto-included via `RealPartialType(CreateDTO)`
- **Safe/Response DTO**: Add to `RealPickType`/`RealOmitType` if it should appear in responses
- **List Request DTO**: Add if the field should be filterable

If the field contains sensitive data, add `select: false` in `@Prop()` and omit from Safe DTO.

### 4. Update service/repository if needed

If the field requires special handling (e.g., unique validation, computed values), add logic to the service layer.

### 5. Verify

```bash
pnpm lint:fix
pnpm types:check
```

## Key Conventions

- Field decorators from `@/decorators/field` combine validation + transformation + Swagger
- Schema model class extends `WalnutAdminCommonBasicModel`
- Type exports follow: `type ISysXxxDocument = HydratedDocument<SysXxxModel & ISysXxxMethods>`
- Virtual fields use `@Virtual()` decorator for computed/populated fields
