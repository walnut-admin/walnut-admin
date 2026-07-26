---
name: review-module
description: Audit a module directory against project conventions and report violations.
---

# Review Module

Audit a module for compliance with the Walnut Admin NestJS project conventions.

## Arguments

The user should provide:
- Module path (e.g., `system/role`, `app/demo`, or full path)

## Checklist

Read all files in the module directory and check each item:

### Architecture
- [ ] Service does NOT directly inject or use Mongoose Model (must go through repository/repo service/shared service)
- [ ] Controller only receives params, calls service, wraps response in DTO - no business logic
- [ ] Repo service (if exists) is `@Global()`, contains only simple CRUD, no business logic
- [ ] Shared service (if exists) is NOT `@Global()`, requires explicit module import

### Controller
- [ ] Permissions defined as local `const Permissions = { ... } as const` (not imported from `@/const/permissions/`)
- [ ] Decorator order follows ESLint rule (HTTP method > HttpCode > Permission > CRUD > Guard frees > Transaction > Swagger > Functional)
- [ ] Parameter decorator order correct (User > DeviceId > Session > ParamMongoId > Body > Ip)
- [ ] Response wrapped in DTO class (not raw service result)
- [ ] Delete operations use `@WalnutDBTransaction()`

### DTO
- [ ] Uses `RealPickType`/`RealPartialType` from `@walnut/utils/dto`, NOT native NestJS `PickType`/`PartialType`
- [ ] Field decorators from `@/decorators/field`, NOT raw class-validator
- [ ] NO `?` or `!` markers on DTO fields
- [ ] Every DTO has constructor with `Object.assign(this, partial)`
- [ ] List request DTO uses `CreateWalnutAdminRequestListDTO()`
- [ ] List response DTO uses `CreateWalnutAdminResponseListDTO()`

### Schema
- [ ] Model extends `WalnutAdminCommonBasicModel`
- [ ] Type exports: `ISysXxxDocument`, `ISysXxxModel`, `ISysXxxMethods`, `ISysXxxStatics`
- [ ] Uses `@Prop()` from mongoose with proper type definitions
- [ ] Enum fields use `Object.values()` in `@Prop({ enum: [...] })`

### Service
- [ ] NO explicit return types (let TypeScript infer)
- [ ] NO try-catch blocks (let exceptions bubble to global filter)
- [ ] Uses i18n keys for error messages, not hardcoded strings
- [ ] Uses `isNil` from lodash for null/undefined checks
- [ ] `dbSession` naming for MongoDB sessions (not `session`)

### Imports
- [ ] Uses `@/*` alias for cross-module imports (no relative `../../`)
- [ ] Top-level `import type` (no inline `import { type X }`)
- [ ] Uses `AppInjectModel` from `@/database/database.decorator` (not `@InjectModel`)
- [ ] Uses `WalnutDBModelName` constants (not `Model.name`)
- [ ] NO `index.ts` barrel files in the module

### General
- [ ] No unused imports or variables
- [ ] No `any` types
- [ ] No dedicated exception classes for single-use errors

## Output Format

Report as a checklist with pass/fail status and specific file:line references for violations. Group by category. Only show violations - skip passing checks unless the user asks for a full report.
