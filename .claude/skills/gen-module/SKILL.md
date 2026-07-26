---
name: gen-module
description: Generate a new NestJS CRUD module following all project conventions (schema, DTO, controller, service, repository).
---

# Generate Module

Generate a new module for the Walnut Admin NestJS Server (located at `apps/server/` in the monorepo).

## Arguments

The user should provide:
- `ModuleName` (PascalCase) - e.g., `ProductCategory`
- `apiPath` - e.g., `system/product-category`
- Optional: `--with-repo` (adds @Global repo service for cross-module access)
- Optional: `--with-shared` (adds shared service for complex business logic)

## Steps

### 1. Determine the target directory

Modules live under `apps/server/apps/api/src/modules/<apiPath>/`.

For example, `system/product-category` → `apps/server/apps/api/src/modules/system/product-category/`.

### 2. Create module files manually

Create the following file structure under the target directory:

```
<apiPath>/
├── <moduleName>.controller.ts    — Controller (endpoint handlers)
├── <moduleName>.service.ts       — Service (business logic)
├── <moduleName>.module.ts        — NestJS module definition
├── dto/
│   └── <moduleName>.dto.ts       — Request/response DTOs
└── schema/
    └── <moduleName>.schema.ts    — Mongoose schema + model + type exports
```

**If `--with-repo`:** Also create `<moduleName>.repo.ts` for @Global cross-module access.

**If `--with-shared`:** Also create `<moduleName>.shared.ts` for complex business logic.

Follow the conventions documented in `add-endpoint` and `add-field` skills for DTO/schema patterns.

### 3. Add DB model name constant

Add the model name constant in `apps/server/apps/api/src/const/app/config.ts` (or wherever `WalnutDBModelName` is defined). The constant key should be `SYS_<SCREAMING_SNAKE_CASE>` with value matching the collection name pattern.

### 4. Register the module

Register in its parent module's `imports` array. Determine the parent by the apiPath:
- `system/*` → look for a system parent module
- `app/*` → look for an app parent module
- If no parent module groups exist, register in `apps/server/apps/api/src/app.module.ts`

### 5. If `--with-repo`

Also register the repo module globally (usually in `apps/server/apps/api/src/app.module.ts` imports).

### 6. Verify

From the monorepo root:

```bash
pnpm lint:fix
pnpm types:check
```

### 7. Report

List created files and any remaining manual steps (e.g., "update schema fields", "add menu entry in database").

## Key Conventions

- NO `index.ts` files in module folders
- Use `@/*` alias for all cross-module imports
- DTOs must have constructor with `Object.assign(this, partial)`
- Use `RealPickType`/`RealPartialType` from `@walnut/utils/dto`, NOT native NestJS
- Use project field decorators from `@/decorators/field`, NOT raw class-validator
- Permissions as local `const Permissions = { ... } as const` in controller file
- Service must NOT directly inject Model; use repository/repo service/shared service
