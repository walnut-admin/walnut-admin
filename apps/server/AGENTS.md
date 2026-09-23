# Walnut Admin NestJS Server - Agent Guide

> 本包（`apps/server/`）的 **agent 入口**，也是本目录的**唯一真源**。按
> [AGENTS.md 约定](https://agents.md/)，agent 读的是**离被改文件最近**的那份指引 ——
> 改后端代码时，这份就是权威来源。
>
> [`CLAUDE.md`](./CLAUDE.md) 只有一行 `@AGENTS.md` 导入，**别往它里面写内容**（Claude Code 在
> 两者并存时默认只读 `CLAUDE.md`，那行导入是它拿到本文件的唯一路径）。

## 先看哪份

| 想看什么 | 去哪 |
|----------|------|
| **后端全部规矩**（模块结构、三种 Repository 模式、DTO/装饰器规则、Guard 顺序、环境变量） | **本文件下半部分的「后端开发规矩」** —— 改代码前先读它 |
| 全仓结构、命令、提交纪律 | 仓库根 [`AGENTS.md`](../../AGENTS.md) |
| 架构决策（为什么后端 lib 不提升为 workspace 包、为什么工具链与前端分叉） | [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md) · [ADR 0012](../docs/src/zh-CN/content/adr/0012-toolchain-divergence.md) |
| 可复用的后端开发技能 | [`.claude/skills/`](../../.claude/skills/) 下 `be-*` 前缀（建模块 / 加字段 / 加接口 / 自查 / 评审） |

> ⚠️ **历史说明**：本文件此前是一份 **14 行的文档索引**，指向 `./.agents/docs/01_PROJECT_OVERVIEW.md`
> 等 14 个文件 —— 而那个目录**从未进过仓库**，14 条链接**全部失效**（2026-09-23 由
> `pnpm lint:docs-refs` 一次性抓出）。内容职责已由本文件与文档站承担，故改为上面这张导航表。

## 这个包是什么

NestJS 11 + SWC + Mongoose（**内部 Nest CLI monorepo**，不是 pnpm workspace 包）：

- `apps/api/src/` —— 应用入口与源码（`modules/` `guard/` `decorators/` `common/` `config/` `const/` …）
- `libs/*/src` —— 9 个内部库，经 tsconfig `paths` 以 `@walnut-server/*` 解析，与 app 一起由 SWC 编译
- 为什么这样：见 [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md)
  （CJS + NestJS 耦合 + SWC 编译，不适合当 ESM workspace 包）

**源码不在** `src/walnut/admin/com/app/`（那是三仓合并前的路径，已废弃）。

## 命令（注意 cwd）

```bash
# 从**仓库根**运行
pnpm setup-env      # 解密 env-encrypted/ → env-local/（需根 .env.keys）
pnpm dev:server     # 起后端（= turbo dev --filter=@walnut/server）
pnpm test           # 全仓测试；只跑后端：pnpm --filter=@walnut/server test

# 从 **apps/server/** 运行（ConfigModule 用 process.cwd() 定位 env，必须在这个目录）
pnpm dev            # nest start --watch
pnpm build          # 生产构建
pnpm types:check    # tsc --noEmit --pretty
```

⚠️ 后端的 `pnpm dev` **不能**在仓库根跑 —— 根 `dev` 只起前端（`turbo dev --filter=@walnut/admin`）。

## 跑起来需要什么

- **MongoDB 副本集**（事务必需；单节点副本集也行：`rs.initiate()`）
- **Redis 7+**
- 环境文件：`pnpm setup-env` 解密后落在 `apps/server/env-local/`（gitignored）

Swagger UI：<http://localhost:3000/api>

---

## 后端开发规矩（原 `apps/server/CLAUDE.md` 全文）

> 下面这 473 行原在 `apps/server/CLAUDE.md` —— 2026-09-23 迁到这里，
> 因为 CLAUDE.md 只有 Claude Code 读，而 `AGENTS.md` 是跨工具格式（Codex / Cursor 等也读）。
> 文件确实偏长（官方建议单个指引 ≤200 行）：**改动时请优先往「先看哪份」那张表里加指针，
> 而不是继续往正文堆**；真要拆，就按模块拆成 `libs/<x>/AGENTS.md`。
>
> 以下小节标题保留了原文的层级（未降级嵌套），以免打断正文里的锚点引用。

## Project Overview

Walnut Admin NestJS Server - A full-featured admin backend template built with NestJS 11.x, TypeScript 6.0.3, MongoDB (Mongoose), Redis, and Bull queue system.

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
pnpm lint              # ESLint check (fix: pnpm lint:fix)
pnpm types:check       # TypeScript type check (strict mode)
pnpm typecheck:watch   # Type check in watch mode

# Testing
pnpm test              # Run tests with Vitest
pnpm test:watch        # Watch mode
pnpm test:cov          # Coverage report

# Production start
pnpm start:prod        # Direct Node execution
pnpm start:stage       # Staging direct Node execution
```

## System Requirements

- Node.js >= 24.13.0
- pnpm >= 12.0.0 (enforced via the `packageManager` field + corepack + `engineStrict`; the old `preinstall` hook was removed in the 2026-09-21 pnpm 12 migration)
- MongoDB replica set (required for transactions)
- Redis 7.x+

## Architecture

### Directory Structure

```
apps/api/src/
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
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
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
  value!: string // Don't use !
  isActive?: boolean // Don't use ?
}

// ✅ Correct - use decorator defaults
export class UserDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'value' },
  })
  value: string // No marker

  @WalnutAdminDecoratorFieldBoolean({
    default: false, // Set default in decorator
    swaggerOptions: { description: 'is active' },
  })
  isActive: boolean // No marker, has default

  @WalnutAdminDecoratorFieldString({
    default: null, // Optional field uses null default
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

Always use `@/*` alias from `apps/api/src/`:

```typescript
import { WalnutAdminDecoratorList } from '@/decorators/crud'
// ✅ Correct
import { Something } from '@/modules/some/module'

// ❌ Wrong - don't use relative paths for cross-module imports
import { Something } from '../../../some/module'
```

### Type Imports

Use top-level type imports, not inline type modifiers:

```typescript
// ✅ Correct - top-level type import
import type { IUserType } from './schema'

import type { IUserType } from './schema'
// ❌ Wrong - inline type modifier
import { UserModel } from './schema'
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
import type { IUserModel } from './schema/user.schema'
import { WalnutAdminConstDBModelName } from '@/const'
import { AppInjectModel } from '@/database/database.decorator'

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

ESLint enforces strict decorator order. Run `pnpm lint:fix` to auto-fix.

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

Environment files use **dotenvx** encryption (AES-256). See [环境变量加密管理](https://walnut-admin-doc.netlify.app/content/monorepo/env-management) for full documentation.

Quick reference:
- `pnpm setup-env` — decrypt `env-encrypted/` → `env-local/`（新成员初始化）
- `pnpm encrypt-env` — encrypt `env-local/` → `env-encrypted/`（更新密钥后）

Environment files loaded:
- `.env.development` - Development config
- `.env.production` - Production config
- `.env.stage` - Staging config

**CRITICAL**: Never change these keys after deployment (will break existing data):
- `AUTH_OPAQUE_SECRET` - OPAQUE protocol key
- `MFA_ENCRYPTION_KEY` - MFA data encryption
- `RT_ENCRYPTION_KEY` - Refresh token encryption
- `DEVICE_ID_ENCRYPTION_KEY` - Device ID encryption
- `USER_ID_ENCRYPTION_KEY` - User identity encryption

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
