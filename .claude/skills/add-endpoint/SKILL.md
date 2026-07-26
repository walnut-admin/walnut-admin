---
name: add-endpoint
description: Add a new endpoint to an existing controller with permission, DTO, service method, and proper decorator order.
---

# Add Endpoint

Add a new API endpoint to an existing module's controller, following all project conventions.

## Arguments

The user should provide:
- Which controller/module to add the endpoint to
- HTTP method and route path
- What the endpoint does (business logic description)
- Request/response shape (optional, Claude can suggest)

## Steps

### 1. Read the existing module files

Read the target module's controller, service, DTO, and schema files to understand context.

### 2. Add permission string

Add the new permission key to the controller's local `const Permissions` object:

```typescript
const Permissions = {
  // ... existing
  NEW_ACTION: '<module>:<entity>:<action>',
} as const
```

### 3. Create request/response DTOs

In the module's `dto/*.dto.ts` file, add DTOs following conventions:

- Use project field decorators (`WalnutAdminDecoratorFieldString`, etc.) from `@/decorators/field`
- NO `?` or `!` markers on fields - use decorator `default` option instead
- Every DTO class must have `constructor(partial: Partial<ClassName>) { super(); Object.assign(this, partial) }`
- Use `RealPickType`/`RealPartialType` from `@walnut/utils/dto` when deriving from existing DTOs

### 4. Add service method

In the module's service file:
- NO explicit return types (let TypeScript infer)
- NO try-catch (let exceptions bubble to global filter)
- Call repository/repo service/shared service, NEVER directly use Model
- Optional `dbSession?: ClientSession` as last param if transactional

### 5. Add controller method

Apply decorators in this strict order:

```
1. HTTP method (@Get, @Post, @Put, @Patch, @Delete)
2. @HttpCode(HttpStatus.OK)
3. @WalnutAdminDecoratorHasPermission(Permissions.NEW_ACTION)
4. @WalnutAdminDecoratorHasRole (if needed)
5. @UseGuards (if needed)
6. CRUD decorator (if applicable)
7. Guard frees (@WalnutAdminGuardJwtFree, etc.)
8. @WalnutDBTransaction() (if transactional)
9. Swagger (@ApiParam, @ApiQuery, @ApiWalnutOkResponse)
10. Functional (@WalnutAdminDecoratorOperateLog, etc.)
```

Parameter decorator order:

```
1. @WalnutAdminDecoratorUser()
2. @WalnutAdminDecoratorDeviceId()
3. @WalnutDBSession()
4. @WalnutAdminDecoratorParamMongoId()
5. @Req, @Param, @Query, @Body
6. @Ip, @I18n
```

### 6. Wrap response in DTO

Controller must wrap service result in response DTO:

```typescript
const result = await this.service.newAction(params)
return new NewActionResponseDTO(result)
```

For primitives: `return true` with `@ApiWalnutOkResponse({ primitive: 'boolean' })`

### 7. Verify

```bash
pnpm lint:fix
pnpm types:check
```

## Key Rules

- Controller only does: receive params, call service, wrap response
- NO business logic in controller
- Use `@walnut/db` decorators: `@WalnutDBTransaction()`, `@WalnutDBSession()`
- For delete operations, always use `@WalnutDBTransaction()`
- Use `isNil` from lodash for null/undefined checks in service
- Error messages use i18n keys, not hardcoded strings
