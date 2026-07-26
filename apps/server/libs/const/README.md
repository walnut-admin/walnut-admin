# @walnut-server/const

Application-wide constant definitions. Zero runtime exports — all values are compile-time constants consumed via sub-path imports. Organized into three sub-modules covering app configuration, decorator metadata keys, and role definitions.

## Exports

This library has no runtime exports (`index.ts` does `export {}`). All constants are imported directly from sub-paths:

```
@walnut-server/const/app/cache          @walnut-server/const/app/config
@walnut-server/const/app/cookie         @walnut-server/const/app/env
@walnut-server/const/app/event          @walnut-server/const/app/header
@walnut-server/const/app/lang           @walnut-server/const/app/methods
@walnut-server/const/app/permission     @walnut-server/const/app/process
@walnut-server/const/app/queue          @walnut-server/const/app/responseCode
@walnut-server/const/app/setting        @walnut-server/const/app/strategy
@walnut-server/const/app/task           @walnut-server/const/app/token
@walnut-server/const/decorator/encrypt  @walnut-server/const/decorator/functional
@walnut-server/const/decorator/logAuth  @walnut-server/const/decorator/logOperate
@walnut-server/const/decorator/permissions
@walnut-server/const/decorator/response @walnut-server/const/decorator/role
@walnut-server/const/role/index
```

## Key Files

### `src/app/` — Application Constants (17 files)

| File | Purpose |
|------|---------|
| `responseCode.ts` | Central business error code enum (`WalnutAdminConstAppResponseCode`) with ~70 codes from `20000` (Success) to `50501` (HTTP Version Not Supported), following HTTP-status semantics |
| `cache.ts` | Redis cache key templates, cache type categories (built-in, auth, controller, shared, system), and system setting key constants for IP blacklist, OS/browser whitelist, CAPJS, force-quit, crypto HKDF, MFA, OAuth providers, functional roles |
| `setting.ts` | Setting scope types (global/local), setting categories (auth/global/functional), force-quit strategies, and interface/config types for CryptoHKDF, MFA, CAPJS, email/SMS auth, OAuth, opaque auth, and scope-resolver configs |
| `queue.ts` | Bull queue names: email, phone, error |
| `process.ts` | Bull queue processor names: email-welcome, email-verify, phone-welcome, phone-verify, app-error |
| `token.ts` | Token type keys: ACCESS, REFRESH |
| `strategy.ts` | Passport strategy names for JWT (local email/phone, access/refresh tokens), opaque auth, and OAuth (GitHub/Gitee/Google FedCM) |
| `task.ts` | Cron task names: init settings, rotate keys, auth state, MFA setup, delete refresh tokens, init locale/devices, update device status |
| `config.ts` | Configuration constants: ID separator (`,`), delete field names |
| `cookie.ts` | Cookie names for DEVICE_ID, CAPJS_TOKEN, RT_JTI, SIGN_TICKET, with environment-aware `__Secure-`/`__Host-` prefix logic |
| `header.ts` | Custom HTTP header names: X-Request-ID, X-Request-IP, X-Language, X-Timezone, X-Version, X-Repo-Version, X-Fingerprint, X-Sign, X-Serial, X-Timestamp, X-Nonce |
| `lang.ts` | Supported languages: zh_CN, en_US |
| `env.ts` | Environment enum: DEV, STAGE, PROD |
| `event.ts` | Event names: log-operate delete and deleteMany |
| `methods.ts` | HTTP method enum |
| `permission.ts` | Permission types: strings, routes, menus, all |
| `setting.ts` | Setting scope types, categories, force-quit strategies, and app setting key constants |

### `src/decorator/` — Decorator Metadata Keys (7 files)

| File | Purpose |
|------|---------|
| `encrypt.ts` | Metadata keys for response-encrypt and request-decrypt decorators |
| `functional.ts` | Metadata keys for main/detail functional decorators |
| `logAuth.ts` | Log auth type constants: opaque, QR, OTP email/phone, GitHub/Gitee/Google OAuth |
| `logOperate.ts` | Log operate action types (CREATE/UPDATE/DELETE/IMPORT/EXPORT), operation types (deleted.recover, forceQuit, password updates, device lock/unlock), and Chinese title labels for UI modules |
| `permissions.ts` | Permission metadata keys and AND/OR mode enum |
| `response.ts` | Free-response metadata key |
| `role.ts` | Role metadata keys and AND/OR mode enum |

### `src/role/` — Role Definitions (1 file)

| File | Purpose |
|------|---------|
| `index.ts` | Role names (root/developer/admin/visitor), role modes (switchable/combinable), hardcoded root/developer role IDs and safe user IDs |

## Usage

```typescript
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
// Import specific constants from sub-paths
import { WalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'
import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut-server/const/decorator/logOperate'

// Use in exceptions
throw new WalnutAdminExceptionBadRequest({
  errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS,
})

// Use in cache services
const key = WalnutAdminConstAppCacheKeys.USER_ROLES(userId)
```

## Dependencies

- **Internal**: None
- **External**: `easy-fns-ts` (for `IWalnutAdminConstAppResponseCode` type from `valueOf`)

## Notes

- This library has **zero runtime exports** — the `index.ts` does `export {}` to make it a TypeScript module
- All values are pure constants (strings, numbers, objects with `as const`) — no functions or classes
- The `src/app/setting.ts` file is a load-bearing dependency used across the app for settings configuration and scope resolution
- The `responseCode.ts` file defines a hierarchical error code system: `20000` = success, `400xx` = BadRequest variants, `401xx` = Unauthorized, `403xx` = Forbidden, `404xx` = NotFound, `406xx` = NotAcceptable, `408xx`/`429xx`, `500xx` = InternalServerError, `503xx` = ServiceUnavailable, `504xx`/`505xx`
