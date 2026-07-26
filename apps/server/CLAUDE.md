# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Walnut Admin NestJS Server - A full-featured admin backend template built with NestJS 11.x, TypeScript 5.9+, MongoDB (Mongoose), Redis, and Bull queue system.

**Key Features**: Multi-auth (JWT, OAuth, WebAuthn, Opaque), RBAC, MFA, real-time (WebSocket/SSE), i18n, comprehensive security (IP/device guards, CAPTCHA, risk assessment, XSS protection).

## Development Commands

```bash
# Install dependencies (enforces pnpm)
pnpm install

# Development mode (Nest + assets hot reload)
pnpm dev

# Build for production/staging
pnpm build
pnpm build:stage

# Code quality
pnpm lint              # ESLint check and auto-fix
pnpm typecheck         # TypeScript type check
pnpm typecheck:watch   # Type check in watch mode

# Testing
pnpm test              # Run tests with Vitest
pnpm test:watch        # Watch mode
pnpm test:cov          # Coverage report

# Production start
pnpm start:prod        # Direct Node execution
pnpm pm2:prod          # PM2 production
pnpm pm2:stage         # PM2 staging
```

## System Requirements

- Node.js >= 24.13.0
- npm >= 11.6.2
- pnpm (enforced via package.json)
- MongoDB replica set (required for transactions)
- Redis 7.x+

## Architecture

### Directory Structure

```
src/walnut/admin/com/app/
├── modules/              # Feature modules
│   ├── app/             # Application modules (demo, monitor, setting)
│   ├── auth/            # Authentication (JWT, OAuth, MFA, OTP)
│   ├── security/        # Security (CAPTCHA, RSA, Sign, Risk)
│   ├── shared/          # Shared services (email, SMS, token)
│   ├── system/          # System management (user, role, menu, device, logs, dict)
│   └── techniques/      # Infrastructure (cache, queue, logger, SSE, socket)
├── decorators/          # Custom decorators (CRUD, field, validation, Swagger)
├── guard/               # Auth/authz guards (IP, Device, Risk, CAP, JWT, MFA, Sign, Lock)
├── common/              # Shared DTOs, models, repositories
├── config/              # Environment configuration
├── const/               # Constants (permissions, DB names)
├── database/            # Database module
├── exceptions/          # Custom exceptions
├── i18n/                # Internationalization (zh_CN, en_US)
├── interceptors/        # Request/response interceptors
└── utils/               # Utility functions
```

### Module Structure Pattern

```
module-name/
├── module-name.module.ts              # Module definition
├── module-name.controller.ts          # HTTP routes
├── module-name.service.ts             # Business logic (1:1 with controller)
├── module-name.basic.repository.ts    # Basic CRUD (extends base class)
├── dto/module-name.dto.ts             # Data transfer objects
├── schema/module-name.schema.ts       # Mongoose schema
├── repo/                              # Cross-module data access (optional, @Global)
│   ├── module-name.repo.module.ts
│   └── module-name.repo.service.ts
└── shared/                            # Cross-module business logic (optional, non-@Global)
    ├── module-name.shared.module.ts
    └── module-name.shared.service.ts
```

## Three Repository Patterns

| Pattern | File | @Global | Business Logic | dbSession | Use Case |
|---------|------|---------|----------------|-----------|----------|
| **Basic Repository** | `*.basic.repository.ts` | No | No (CRUD only) | Via decorator | Controller CRUD |
| **Repo Service** | `repo/*.repo.service.ts` | **Yes** | **No** (simple CRUD) | Optional last param | Cross-module data access |
| **Shared Service** | `shared/*.shared.service.ts` | **No** | **Yes** (cache, logic) | Optional last param | Complex business logic |

### Service Layer Hierarchy

```
Controller
    ↓
Service (1:1 with Controller, NEVER directly uses Model)
    ↓
├── Basic Repository (simple CRUD)
├── Repo Service (cross-module data access)
└── Shared Service (complex business logic)
    ↓
Model (Mongoose)
```

**Critical Rule**: Controller-level `*.service.ts` files MUST NOT directly inject or use Models. All data access must go through Repository/Repo Service/Shared Service layers.

## CRUD Decorators

Use factory function to import CRUD decorators:

```typescript
import { WalnutCrudDecorators } from '@/decorators/crud'

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: 'YourModule',
  DTO: YourDTOSafe,
})
```

## DTO Design Rules

### CRITICAL: Use RealPickType / RealPartialType

**NEVER** use NestJS native `PickType`/`PartialType` directly. Always use project wrappers from `@/utils/dto`:

```typescript
import { RealPartialType, RealPickType } from '@/utils/dto'

// Base DTO - extends Model
export class SysUserDTO extends SysUserModel {
  constructor(partial: Partial<SysUserDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// Create DTO - pick required fields
export class SysUserCreateDTO extends RealPickType(SysUserDTO, [
  'username',
  'email',
  'role',
] as const) {
  constructor(partial: Partial<SysUserCreateDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// Update DTO - partial of Create DTO
export class SysUserUpdateDTO extends RealPartialType(SysUserCreateDTO) {
  constructor(partial: Partial<SysUserUpdateDTO>) {
    super()
    Object.assign(this, partial)
  }
}
```

**Reason**: Global `ClassSerializerInterceptor` has `excludeExtraneousValues: true`, which requires `@Expose()` on all fields. Native `PickType`/`PartialType` don't add `@Expose()`, causing fields to be silently filtered from API responses.

### Use Project Field Decorators

Use decorators from `@/decorators/field` instead of raw class-validator:

```typescript
import {
  WalnutAdminDecoratorFieldString,
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldMongoId,
} from '@/decorators/field'

export class UserRequestDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'User email' },
  })
  email: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: { description: 'Is admin' },
  })
  isAdmin: boolean
}
```

**Benefits**: Combines validation + transformation + Swagger docs in one decorator.

### DTO Field Declaration

**NEVER** use TypeScript optional (`?`) or definite assignment (`!`) markers on DTO fields:

```typescript
// ❌ Wrong
export class UserDTO {
  value!: string           // Don't use !
  isActive?: boolean       // Don't use ?
}

// ✅ Correct - use decorator defaults
export class UserDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'value' },
  })
  value: string           // No marker

  @WalnutAdminDecoratorFieldBoolean({
    default: false,       // Set default in decorator
    swaggerOptions: { description: 'is active' },
  })
  isActive: boolean       // No marker, has default

  @WalnutAdminDecoratorFieldString({
    default: null,        // Optional field uses null default
    swaggerOptions: { description: 'optional code' },
  })
  code: string
}
```

## MongoDB Transactions

MongoDB MUST run in replica set mode for transaction support.

### Initialize Replica Set

```bash
# In mongo shell
rs.initiate()
```

### Using Transactions

Add decorator to controller method:

```typescript
@WalnutAdminDecoratorCreate({
  operateLog: { title: 'User' },
  swagger: { DTO: UserDTO },
})
@WalnutAdminDecoratorMongoDBTransaction()
async create(@Body() dto: UserCreateDTO) {
  return this.service.create(dto)
}
```

In service, get session and use it:

```typescript
import { getWalnutAdminDBSession, runAfterTransaction } from '@/context/transaction'

async create(dto: UserCreateDTO) {
  const dbSession = getWalnutAdminDBSession()
  
  const user = new this.userModel({ ...dto })
  await user.save({ session: dbSession })
  
  // Post-transaction operations
  await runAfterTransaction(async () => {
    await this.cacheService.invalidateUserCache(user._id)
  })
  
  return user
}
```

## Security Guards Execution Order

Guards execute in this order (defined in `app.module.ts`):

1. **IP Guard** - IP blacklist check
2. **Security Guard** - UserAgent, blacklist paths, bot check
3. **Device Guard** - Device verification (from Cookie)
4. **Risk Guard (Pre-Auth)** - Pre-authentication risk assessment
5. **CAP Guard** - CAPTCHA verification (pre-auth)
6. **JWT Guard** - Authentication
7. **Risk Guard (Post-Auth)** - Post-authentication risk assessment
8. **CAP Guard** - CAPTCHA verification (post-auth)
9. **MFA Guard** - Multi-factor authentication
10. **Sign Guard** - Request signature verification
11. **Lock Guard** - User lock status check

## Code Style

### Path Aliases

Always use `@/*` alias from `src/walnut/admin/com/app/`:

```typescript
// ✅ Correct
import { Something } from '@/modules/some/module'
import { WalnutAdminDecoratorList } from '@/decorators/crud'

// ❌ Wrong - don't use relative paths for cross-module imports
import { Something } from '../../../some/module'
```

### Type Imports

Use top-level type imports, not inline type modifiers:

```typescript
// ❌ Wrong - inline type modifier
import { type IUserType, UserModel } from './schema'

// ✅ Correct - top-level type import
import type { IUserType } from './schema'
import { UserModel } from './schema'
```

### Return Type Inference

Service methods should NOT declare explicit return types - let TypeScript infer:

```typescript
// ❌ Wrong - explicit return type
async findById(id: string): Promise<IUserDocument | null> {
  return this.userModel.findById(id).exec()
}

// ✅ Correct - inferred return type
async findById(id: string) {
  return this.userModel.findById(id).exec()
}
```

### No Try-Catch in Services

**NEVER** use try-catch in service methods. Let exceptions bubble to global exception filter:

```typescript
// ❌ Wrong - unnecessary try-catch
async check(dto: CheckDTO) {
  try {
    await this.sendCode(dto)
    return { success: true }
  }
  catch (error) {
    return { success: false, message: error.message }
  }
}

// ✅ Correct - let exceptions bubble
async check(dto: CheckDTO) {
  await this.sendCode(dto)
  // Success: return void or value
  // Error: throw exception, handled by global filter
}
```

### Exception Classes

**NEVER** create dedicated exception classes for single-use errors:

```typescript
// ❌ Wrong - dedicated class for single use
export class WalnutAdminExceptionUnbindDenied extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST,
      errMsg: 'business.auth.unbindAtLeastOneLoginMethodRequired',
    })
  }
}

// ✅ Correct - use inline exception with i18n key
throw new WalnutAdminExceptionBadRequest({
  errMsg: 'business.auth.unbindAtLeastOneLoginMethodRequired',
})
```

**Rule**: Create exception class only if used 3+ times or is core domain logic.

## Model Injection

Always use `AppInjectModel` from `@/database/database.decorator` with constants from `@/const`:

```typescript
import { AppInjectModel } from '@/database/database.decorator'
import { WalnutAdminConstDBModelName } from '@/const'
import type { IUserModel } from './schema/user.schema'

@Injectable()
export class UserBasicRepository extends WalnutAdminCommonBasicRepository<IUserDocument> {
  constructor(
    @AppInjectModel(WalnutAdminConstDBModelName.SYS_USER)
    readonly dbModel: IUserModel,
  ) {
    super(dbModel)
  }
}
```

**NEVER** use `@InjectModel` or `Model.name` directly.

## Decorator Order

ESLint enforces strict decorator order. Run `pnpm lint` to auto-fix.

### Method Decorators Order

1. HTTP Methods (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`)
2. Response Code (`@HttpCode`)
3. Permission/Role (`@WalnutAdminDecoratorHasPermission`, `@WalnutAdminDecoratorHasRole`)
4. Guards (`@UseGuards`)
5. CRUD Decorators (`@WalnutAdminDecoratorList`, `@WalnutAdminDecoratorCreate`, etc.)
6. Guard Frees (`@WalnutAdminGuardJwtFree`, `@WalnutAdminGuardCapFree`, etc.)
7. Swagger (`@ApiParam`, `@ApiQuery`, `@ApiBody`, `@ApiWalnutOkResponse`)
8. Functional (`@WalnutAdminDecoratorCache`, `@WalnutAdminDecoratorOperateLog`)

### Parameter Decorators Order

1. Context (`@WalnutAdminDecoratorJti`, `@WalnutAdminDecoratorUser`)
2. Device (`@WalnutAdminDecoratorDeviceId`)
3. Session (`@WalnutAdminDecoratorMongoDBSession`)
4. Cookie (`@WalnutAdminDecoratorCookie`)
5. Params (`@WalnutAdminDecoratorParamMongoId`)
6. Standard (`@Req`, `@Res`, `@Param`, `@Query`, `@Body`)
7. Meta (`@Ip`, `@I18n`)

## Environment Configuration

Environment files are in `env/` directory:
- `.env.development` - Development config
- `.env.production` - Production config
- `.env.stage` - Staging config

**CRITICAL**: Never change these keys after deployment (will break existing data):
- `AUTH_OPAQUE_SECRET` - OPAQUE protocol key
- `MFA_ENCRYPTION_KEY` - MFA data encryption
- `RT_ENCRYPTION_KEY` - Refresh token encryption
- `DEVICE_ID_ENCRYPTION_KEY` - Device ID encryption

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:cov

# E2E tests
pnpm test:e2e
```

## API Documentation

Swagger UI available at `http://localhost:3000/api` when running in development mode.
