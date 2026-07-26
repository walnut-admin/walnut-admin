# Lib Extraction Recommendations

## Overview

This report analyzes modules under `apps/api/src/modules/`, `apps/api/src/common/`, and `apps/api/src/decorators/` for potential extraction into reusable libraries under `libs/`. The analysis considers: business-logic coupling, dependency chains, module size, reusability, and extraction effort.

The project currently has 9 libs under `libs/` (config, const, context, db, decorators, exceptions, pipes, types, utils). All are integrated via TypeScript path aliases (`@walnut/<name>`) and compiled together by SWC — they are not published packages.

### How to Read This Report

Each candidate is assessed on:
- **App Coupling**: How many hard imports to `@/` (app-specific modules) exist
- **Dependencies to Resolve**: What would need refactoring before extraction
- **Effort**: Low (~15 min), Medium (~1-2 hrs), High (half-day+)

---

## Tier 1: Fully Generic (Zero App Coupling)

These 13 candidates have **zero hard imports to `@/` modules**. They can be extracted as-is or with minimal adapter work.

### 1. `modules/shared/als/` — ALS Request Context

- **Files**: `request/request.module.ts`, `request/request.service.ts`
- **Purpose**: AsyncLocalStorage-based per-request context service (snapshots for audit logging)
- **App Coupling**: None. Uses only `@nestjs/common` and `node:async_hooks`.
- **Dependencies to Resolve**: None
- **Effort**: **Low**
- **Notes**: Overlaps with existing `@walnut/context` (which only stores `requestId`). Could either merge into `@walnut/context` or become its own `@walnut/als` lib. The existing `@walnut/context` is purposely scoped to logging only — this module handles broader request state.

### 2. `modules/shared/mask/` — PII Data Masking

- **Files**: `mask.module.ts`, `mask.service.ts`
- **Purpose**: Sensitive data masking wrapper (emails, phones, identity cards, headers, JSON fields). Delegates to `@walnut/utils/mask` for core logic.
- **App Coupling**: None. Imports only `@walnut/utils/mask` and NestJS decorators.
- **Dependencies to Resolve**: None
- **Effort**: **Low**
- **Notes**: Thin NestJS DI wrapper around `@walnut/utils/mask`. The `@Global()` module makes it available app-wide. A good candidate for `@walnut/mask` — consolidates the DI-facing API with the already-extracted utility functions.

### 3. `modules/shared/delay/` — Debounced Scheduler

- **Files**: `delay.module.ts`, `delay.service.ts`
- **Purpose**: Map-based debounced task scheduling using `setTimeout`. ~35 lines of logic.
- **App Coupling**: None. Uses only `@nestjs/common` and `easy-fns-ts` (Fn type).
- **Dependencies to Resolve**: None
- **Effort**: **Very Low**
- **Notes**: Extremely simple, self-contained utility. Could become `@walnut/delay` or even a provider in an existing lib. Generic enough for any NestJS project needing debounced async task execution.

### 4. `modules/shared/BLPath/` — Blacklist Path Checker

- **Files**: `BLPath.module.ts`, `BLPath.service.ts`
- **Purpose**: Exact + suffix URL matching to skip middleware/guards for certain routes (favicon, health, state/heartbeat).
- **App Coupling**: None. Uses only `@nestjs/common`.
- **Dependencies to Resolve**: None
- **Effort**: **Very Low**
- **Notes**: Currently used by the exception filter (`@walnut/exceptions`) via hard import — if extracted as a lib, the exception filter's dependency would be resolved more cleanly. Could become `@walnut/blpath`.

### 5. `modules/shared/mailer/` — Queue-Based Email

- **Files**: `mailer.module.ts`, `mailer.config.service.ts`, `mailer.processor.ts`, `mailer.service.ts`
- **Purpose**: Complete email module using `@nestjs-modules/mailer` + Bull queue. Sends welcome and verification emails.
- **App Coupling**: Imports `WalnutAdminCommonBasicProcessor` from `@/common/processor/`. Queue name from `@walnut/const/app/queue`.
- **Dependencies to Resolve**: The base processor (`WalnutAdminCommonBasicProcessor`) would also need extraction (see Tier 2, candidate #5).
- **Effort**: **Medium** (if base processor extracted first)
- **Notes**: Well-structured module with config service, queue processor, and service layer. A strong candidate for `@walnut/mailer`.

### 6. `modules/shared/sms/` — Queue-Based SMS

- **Files**: `sms.module.ts`, `sms.service.ts`, `sms.processor.ts`, `aliyun/aliyun.sms.module.ts`, `aliyun/aliyun.sms.service.ts`, `tencent/tencent.sms.service.ts`
- **Purpose**: Queue-based SMS with Aliyun and Tencent provider implementations.
- **App Coupling**: Same base processor dependency as mailer. Queue name from `@walnut/const`.
- **Dependencies to Resolve**: Base processor extraction.
- **Effort**: **Medium**
- **Notes**: Same pattern as mailer. Could become `@walnut/sms`.

### 7. `modules/techniques/cache/` — Redis Cache

- **Files**: `cache.module.ts`, `cache.config.service.ts`, `cache.service.ts`, `redis/redis.module.ts`, `redis/redis.service.ts`, `service/cache.*.ts` (10 domain-specific cache services)
- **Purpose**: Redis-backed cache manager with typed wrappers. Base `AppTechCacheService` and `AppTechRedisService` are generic; 10 domain-specific cache services handle permission, RSA, lock, MFA, and other domain caching.
- **App Coupling**: Cache key templates from `@walnut/const/app/cache`. The domain-specific cache services have no `@/` imports — they just compose the base cache with domain-specific key logic.
- **Dependencies to Resolve**: The 10 domain cache services (`cache.permissions.ts`, `cache.rsa.ts`, etc.) would need to move with the lib (they ARE the lib's value-add). These use cache key constants from `@walnut/const`.
- **Effort**: **Medium** (volume of files, not complexity)
- **Notes**: A foundational candidate. If extracted as `@walnut/cache`, it would provide both low-level Redis access and high-level typed cache operations. The domain-specific cache services show the pattern for consumers.

### 8. `modules/techniques/crypto/` — AES-256-GCM + HMAC

- **Files**: `crypto.module.ts`, `crypto.service.ts`
- **Purpose**: AES-256-GCM encrypt/decrypt with AAD support + HMAC SHA-256 hashing. Reads encryption keys from `ConfigService`.
- **App Coupling**: None. Uses only `@nestjs/common`, `@nestjs/config`, `lodash`, and Node.js `crypto`.
- **Dependencies to Resolve**: None (ConfigService is an injected dependency, not a hard import)
- **Effort**: **Low**
- **Notes**: Pure Node.js crypto wrapper. 153 lines. A strong candidate for `@walnut/crypto`. Zero business logic.

### 9. `modules/techniques/lock/` — Distributed Mutex

- **Files**: `lock.module.ts`
- **Purpose**: Redis-based distributed mutex via MurLock.
- **App Coupling**: None. Imports only `murlock` and NestJS modules.
- **Dependencies to Resolve**: None
- **Effort**: **Very Low**
- **Notes**: Already nearly standalone — just a module definition. Could become `@walnut/lock`.

### 10. `modules/techniques/queue/` — Bull Queue Config

- **Files**: `queue.module.ts`, `queue.config.ts`, `queue.service.ts`
- **Purpose**: Bull queue configuration (Redis connection).
- **App Coupling**: None.
- **Dependencies to Resolve**: None
- **Effort**: **Low**
- **Notes**: Could become `@walnut/queue`. Would be consumed by mailer and SMS libs.

### 11. `modules/techniques/sse/` — Server-Sent Events

- **Files**: `sse.module.ts`, `sse.service.ts`, `types.d.ts`
- **Purpose**: Subject-based SSE client management (connect, disconnect, per-client send, broadcast).
- **App Coupling**: None. Uses `@nestjs/common` and `rxjs`.
- **Dependencies to Resolve**: None
- **Effort**: **Very Low**
- **Notes**: ~40 lines of service code. Pure RxJS pattern. Generic enough for any NestJS SSE use case.

### 12. `modules/techniques/throttle/` — Dynamic Rate Limiting

- **Files**: `throttler.module.ts`, `throttler.service.ts`
- **Purpose**: Dynamic rate limiter extending `@nestjs/throttler`'s `ThrottlerGuard` with per-route config providers. Supports customizable limit/TTL per endpoint.
- **App Coupling**: References `IWalnutAdminThrottleConfigProvider` type from `@walnut/types`. The guard's `getTracker` returns `req.realIp` which depends on Express request augmentation.
- **Dependencies to Resolve**: The `realIp` dependency is satisfied by `@walnut/types` (already a lib). No `@/` imports.
- **Effort**: **Low**
- **Notes**: Could become `@walnut/throttle`.

### 13. `modules/techniques/cookie/` — Environment-Aware Cookies

- **Files**: `cookie.module.ts`, `cookie.service.ts`, `types.d.ts`
- **Purpose**: Standardized cookie get/set/clear with env-aware options (`__Secure-`/`__Host-` prefixes in production).
- **App Coupling**: Imports `isDev`/`isProd` from `@walnut/config/utils/env` and `getPackageJsonData` from `@walnut/utils/pkg` — both are already libs.
- **Dependencies to Resolve**: None (internal dependencies are on existing libs)
- **Effort**: **Low**
- **Notes**: Could become `@walnut/cookie` to complement the existing `@walnut/config` lib.

---

## Tier 2: Minor Coupling (1-2 App References to Resolve)

These 7 candidates have **1-2 hard imports to `@/` modules** that would need refactoring before extraction.

### 1. `modules/shared/token/` — JWT Token Generation

- **Files**: `token.module.ts`, `token.service.ts`, `jwt.config.ts`
- **Purpose**: JWT access + refresh token generation with config-driven secrets/expiry.
- **App Coupling**: `getJwtAccessTokenPayload` method imports `ISysUserDocument` from `@/modules/system/user/schema/user.schema`.
- **Dependencies to Resolve**: Replace `ISysUserDocument` with a plain interface (`IWalnutAdminAccessTokenPayloadInput`) defined in `@walnut/types`. Only 5 fields are needed: userId, roleIds, roleNames, currentRole, roleMode, mfaSetup.
- **Effort**: **Medium** (type refactoring required)
- **Notes**: The rest of the service (generate JTI, sign tokens, decode) is fully generic. This is a strong candidate for `@walnut/token`.

### 2. `modules/shared/ip/` — IP Geolocation & Blacklist

- **Files**: `ip.module.ts`, `ip.service.ts`
- **Purpose**: IP normalization, Baidu geolocation lookup, permanent + temporary blacklist management.
- **App Coupling**: Injects `AppSettingRepositoryService` (for permanent blacklist via app settings) and `AppTechRedisService` (for temporary blacklist via Redis).
- **Dependencies to Resolve**:
  - Abstract `AppSettingRepositoryService` behind an `IBlacklistRepository` interface
  - Resolve `AppTechRedisService` dependency (would resolve automatically if `@walnut/cache` is extracted first)
- **Effort**: **High** (multiple injected service dependencies)
- **Notes**: Core IP logic (normalization, geo-lookup) is generic. Blacklist persistence is the coupling point.

### 3. `modules/shared/scopeResolver/` — Scope Resolution

- **Files**: `scope-resolver.module.ts`, `scope-resolver.service.ts`
- **Purpose**: Resolves setting values between global and entity-local scopes. ~23 lines.
- **App Coupling**: None. Depends only on `IWalnutAdminScopeResolverConfig` and `WalnutAdminConstAppSettingScopeType` from `@walnut/const`.
- **Dependencies to Resolve**: None — already uses only lib types.
- **Effort**: **Very Low**
- **Notes**: Borderline Tier 1. The service is fully generic. The only reason it's Tier 2 is the conceptual coupling to the app settings system. Could easily become `@walnut/scope-resolver`.

### 4. `modules/security/rsa/` — RSA Key Management

- **Files**: `rsa.module.ts`, `rsa.service.ts`, `rsa.controller.ts`
- **Purpose**: RSA key pair generation, encryption, decryption. Powers request/response encrypt/decrypt interceptors.
- **App Coupling**: Depends on `AppKeyModule` for key storage. Controller has HTTP endpoints for key operations.
- **Dependencies to Resolve**: Abstract key storage behind an `IKeyStore` interface. The controller endpoints could remain in the app while the core service moves to a lib.
- **Effort**: **Medium** (key storage abstraction + controller separation)
- **Notes**: The RSA crypto logic itself is pure Node.js `crypto` — the coupling is only in key storage. Could become `@walnut/rsa` with an injectable key store interface.

### 5. `common/repository/base.repository.ts` — CRUD Base Repository

- **Files**: `base.repository.ts`
- **Purpose**: Generic CRUD operations base class (create, readById, update, updateByField, soft-delete, real-delete, list with aggregation pipeline). Used by every entity repository.
- **App Coupling**: Injects `ALSRequestService` (from `modules/shared/als/`), `WalnutDBInjectConnection` (from `@walnut/db`), and `SysDeletedRepoService` (from `@/modules/system/deleted`).
- **Dependencies to Resolve**:
  - `ALSRequestService` → resolves if ALS is extracted (Tier 1 candidate)
  - `SysDeletedRepoService` → the hardest coupling. Could be made optional via a strategy pattern (inject an optional `ISoftDeleteStrategy`)
  - `WalnutDBInjectConnection` → already from `@walnut/db` lib
- **Effort**: **High** (strategy pattern refactoring for soft-delete)
- **Notes**: This is the most impactful extraction candidate — it would create `@walnut/repository` that provides turn-key CRUD for any NestJS + Mongoose project. The soft-delete coupling to `SysDeletedRepoService` is the main blocker.

### 6. `common/processor/base.processor.ts` — Bull Processor Base

- **Files**: `base.processor.ts`
- **Purpose**: Abstract Bull queue processor base class with lifecycle logging hooks (onActive, onComplete, onFailed).
- **App Coupling**: None. Uses only `@nestjs/bull`, `@nestjs/common`, `bull`.
- **Dependencies to Resolve**: None
- **Effort**: **Very Low**
- **Notes**: Borderline Tier 1. This is a pure abstract class with zero business logic. Current mailer/sms processors extend it. Could be included in `@walnut/queue`.

### 7. `common/dto/list.dto.ts` — List DTO Factories

- **Files**: `list.dto.ts`, `base.dto.ts`, `shared.dto.ts`
- **Purpose**: Generic list pagination/sorting/filtering DTO generators (`CreateWalnutAdminRequestListDTO`, `CreateWalnutAdminResponseListDTO`). Generates NestJS DTO classes with `@WalnutAdminDecoratorField*` decorators.
- **App Coupling**: Uses `@walnut/decorators/field` extensively. No `@/` imports.
- **Dependencies to Resolve**: None (depends only on `@walnut/decorators`)
- **Effort**: **Low**
- **Notes**: Borderline Tier 1. Could live in `@walnut/decorators` or as a new `@walnut/list`. The factory pattern (accept a DTO, return a new DTO class with list params) is highly reusable.

---

## Tier 3: Patterns & Structural Candidates

These are pattern-level candidates with deeper coupling to the app's architecture. Selective extraction is possible; full extraction is high-effort.

### 1. `decorators/crud/` — CRUD Endpoint Decorator Factory

- **Files**: `index.ts`, `create.ts`, `read.ts`, `update.ts`, `delete.ts`, `deleteMany.ts`, `list.ts`, `types.d.ts`
- **Purpose**: `WalnutCrudDecorators()` factory that composes Swagger + operate log + HTTP method + route into pre-built CRUD method decorators. Dramatically reduces controller boilerplate.
- **App Coupling**: Uses `@walnut/decorators/swagger`, `@walnut/const/decorator/logOperate` (already libs). `list.ts` uses `CreateWalnutAdminResponseListDTO` from `@/common/dto/list.dto`.
- **Dependencies to Resolve**: Would resolve if list DTO is extracted (Tier 2 candidate #7).
- **Effort**: **Medium** (requires list DTO extraction first)
- **Notes**: One of the most valuable patterns in the codebase. A `@walnut/crud` lib would let any NestJS project add full CRUD endpoints with a single factory call.

### 2. `decorators/` (root) — Walnut Decorators

- **Files**: `hasPermission.decorator.ts`, `hasRole.decorator.ts`, `cache.decorator.ts`, `crypto.decorator.ts`, `user.decorator.ts`, `response.decorator.ts`, `cookie.decorator.ts`, etc.
- **Purpose**: Composable method/param decorators for permission checks, caching, field-level encrypt/decrypt, user/JTI/device extraction.
- **App Coupling**: Most depend on guard/provider infrastructure in `apps/api/src/guard/`.
- **Dependencies to Resolve**: Guards would need extraction first, creating a cascade.
- **Effort**: **High**
- **Notes**: Selective extraction is viable. The `cache.decorator.ts` and `crypto.decorator.ts` have minimal coupling and could be extracted independently.

### 3. `interceptors/` — Request/Response Pipeline

- **Files**: `success.interceptor.ts`, `encrypt.interceptor.ts`, `decrypt.interceptor.ts`, `loose.interceptor.ts`, `als.interceptor.ts`
- **Purpose**: Standardizes responses, handles field-level RSA encrypt/decrypt, initializes ALS context.
- **App Coupling**: Varies. `success.interceptor.ts` and `als.interceptor.ts` have minimal coupling. `encrypt.interceptor.ts`/`decrypt.interceptor.ts` need the RSA service.
- **Dependencies to Resolve**: RSA service extraction (Tier 2) would unlock encrypt/decrypt interceptors.
- **Effort**: **Low-Medium** (selective)
- **Notes**: The success response wrapper is a pattern that could benefit any NestJS project. The encrypt/decrypt interceptors are domain-specific to this app's security model.

### 4. `guard/` — Guard Ecosystem (15 guards)

- **Files**: `auth.guard.ts`, `cap.guard.ts`, `device.guard.ts`, `env.guard.ts`, `functional.guard.ts`, `ip.guard.ts`, `lock.guard.ts`, `mfa.guard.ts`, `permission.guard.ts`, `risk.guard.ts`, `roles.guard.ts`, `security.guard.ts`, `sensitive.guard.ts`, `sign.guard.ts`, `throttler.guard.ts`
- **Purpose**: Authentication and authorization pipeline (11 guards execute in defined order per `app.module.ts`).
- **App Coupling**: Most inject role/user/permission services from `@/modules/system/`.
- **Dependencies to Resolve**: System-level services are deeply embedded in the app's business logic.
- **Effort**: **Very High** for full extraction
- **Notes**: Selective candidates:
  - `env.guard.ts` — environment-based access (very simple, could be Tier 1)
  - `functional.guard.ts` — feature toggle guard (minimal coupling)
  - `throttler.guard.ts` — already covered by Tier 1 throttle candidate
  - `sign.guard.ts` — request signature verification (could be Tier 2 with sign service extraction)

---

## Summary Table

| Candidate | Tier | App Coupling | Key Blocker | Effort |
|-----------|------|-------------|-------------|--------|
| als | 1 | None | — | Low |
| mask | 1 | None | — | Low |
| delay | 1 | None | — | Very Low |
| BLPath | 1 | None | — | Very Low |
| mailer | 1 | Base processor | Processor extraction | Medium |
| sms | 1 | Base processor | Processor extraction | Medium |
| cache | 1 | None (lib types only) | File volume | Medium |
| crypto | 1 | None | — | Low |
| lock | 1 | None | — | Very Low |
| queue | 1 | None | — | Low |
| sse | 1 | None | — | Very Low |
| throttle | 1 | None (lib types only) | — | Low |
| cookie | 1 | None (lib types only) | — | Low |
| token | 2 | ISysUserDocument type | Replace with plain interface | Medium |
| ip | 2 | Setting repo, Redis service | Abstract store interfaces | High |
| scopeResolver | 2 | None (lib types only) | — | Very Low |
| rsa | 2 | AppKeyModule | Abstract key store | Medium |
| base.repository | 2 | SysDeletedRepoService | Soft-delete strategy pattern | High |
| base.processor | 2 | None | — | Very Low |
| list DTO | 2 | None (lib types only) | — | Low |
| CRUD decorators | 3 | List DTO | List DTO extraction | Medium |
| Walnut decorators | 3 | Guards | Guard extraction cascade | High |
| Interceptors | 3 | RSA service (encrypt/decrypt) | RSA extraction | Low-Medium |
| Guards | 3 | System services | Selective extraction only | High |

## Recommended Extraction Order

If pursuing extraction, the recommended dependency order is:

1. **base.processor** → needed by mailer/sms
2. **lock, delay, sse** → trivial, no blockers
3. **cookie** → depends on existing libs only
4. **BLPath** → resolves exception filter circular dependency
5. **als** → needed by base.repository
6. **crypto** → pure utility
7. **queue** → needed by mailer/sms
8. **cache** → foundational; needed by many modules
9. **throttle** → guard extraction
10. **mailer, sms** → now unblocked
11. **token** → after ISysUserDocument refactor
12. **scopeResolver** → trivial
13. **list DTO** → needed by CRUD decorators
14. **CRUD decorators** → after list DTO
15. **base.repository** → after als + soft-delete refactor
16. **rsa** → after key store abstraction
17. **ip** → after cache + setting repo abstraction

## Cross-Cutting Dependency Notes

### Existing Issues to Address During Extraction

1. **`@walnut/exceptions` imports `@/modules/app/error/error.service` and `@/modules/shared/BLPath/BLPath.service`** — The global exception filter has hard imports from app modules. If `BLPath` is extracted as a lib, the `BLPathService` dependency becomes clean. The `AppErrorService` dependency would need to become injectable or abstracted.

2. **`@walnut/config/utils/env`** — The `isDev`/`isProd`/`isStage` helpers are used by `@walnut/utils` and `@walnut/exceptions` via sub-path imports. These should be promoted to first-class exports from `@walnut/config`.

3. **`@walnut/context` is not in `nest-cli.json`** — New libs should follow the standard registration pattern used by the other 8 libs.

4. **Base repository's `SysDeletedRepoService` coupling** — This is the single most impactful coupling in the extraction analysis. A strategy pattern (optional `ISoftDeleteStrategy` injection) would unlock `@walnut/repository` as a standalone lib.

### Lib-to-Lib Dependency Chain

```
@walnut/const (no deps)
  ↓
@walnut/config → @walnut/const
  ↓
@walnut/utils → @walnut/config, @walnut/const
  ↓
@walnut/exceptions → @walnut/const, @walnut/utils
@walnut/pipes → @walnut/const, @walnut/exceptions
@walnut/decorators → (none internal)
@walnut/types → @walnut/const
@walnut/context → (none internal)
@walnut/db → (self-contained)
```
