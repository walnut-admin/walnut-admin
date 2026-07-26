# @walnut/exceptions

Exception classes and global exception filter for standardized error handling. Provides 8 base HTTP exception classes, 30+ specialized business exception subclasses, a global `@Catch()` exception filter, and an error classification handler that translates raw errors into standardized API responses with business error codes.

## Exports

### Base Exception Classes (`src/base.exception.ts`)

| Export | HTTP Status | Description |
|--------|-------------|-------------|
| `WalnutAdminExceptionBadRequest` | 400 | Generic bad request. Accepts optional `errCode`, `errMsg`, `_devMsg`. |
| `WalnutAdminExceptionUnauthorized` | 401 | Unauthorized. Also accepts `meta` field for additional context. |
| `WalnutAdminExceptionForbidden` | 403 | Forbidden access. |
| `WalnutAdminExceptionNotFound` | 404 | Resource not found. |
| `WalnutAdminExceptionRequestTimeout` | 408 | Request timeout. |
| `WalnutAdminExceptionInternalServerError` | 500 | Internal server error. |
| `WalnutAdminExceptionGatewayTimeout` | 504 | Gateway timeout. |
| `WalnutAdminExceptionHttpVersionNotSupported` | 505 | HTTP version not supported. |

### Specialized Exception Subclasses

**400 Range** (`src/base/400.ts`):

| Export | Description |
|--------|-------------|
| `WalnutAdminExceptionDataExists` | Duplicate data detected |
| `WalnutAdminExceptionInvalidID` | Invalid MongoDB ObjectId |
| `WalnutAdminExceptionRequestDataError` | Invalid request data (accepts optional debug message) |

**404 Range** (`src/base/404.ts`):

| Export | Description |
|--------|-------------|
| `WalnutAdminExceptionDataNotFound` | Data not found |
| `WalnutAdminExceptionRouteNotFound` | Route not found |

**406 Range** (`src/base/406.ts`) — 11 classes:

| Export | Description |
|--------|-------------|
| `WalnutAdminExceptionNotAcceptable` | Base not-acceptable exception |
| `WalnutAdminExceptionUserAgentOSNotAcceptable` | OS not in whitelist |
| `WalnutAdminExceptionUserAgentBrowserNotAcceptable` | Browser not in whitelist |
| `WalnutAdminExceptionIPNotAcceptable` | IP is blacklisted |
| `WalnutAdminExceptionUserAgentNotAcceptable` | User agent not supported |
| `WalnutAdminExceptionDeviceNotAcceptable` | Device not supported |
| `WalnutAdminExceptionDeviceLocked` | Device is locked |
| `WalnutAdminExceptionDeviceBanned` | Device is banned |
| `WalnutAdminExceptionBotDetected` | Bot/crawler detected |
| `WalnutAdminExceptionSuspiciousRequest` | Suspicious request pattern |
| `WalnutAdminExceptionBlackListPathDetected` | Blacklisted path accessed |
| `WalnutAdminExceptionRiskTooHigh` | Risk score exceeds threshold |

**503 Range** (`src/base/503.ts`):

| Export | Description |
|--------|-------------|
| `WalnutAdminExceptionServiceUnavailable` | Service unavailable |
| `WalnutAdminExceptionServiceUnavailableDependencyDown` | Dependency service down |

**Auth Exceptions** (`src/business/auth.ts`) — 18 classes, all extending `WalnutAdminExceptionUnauthorized`:

| Export | Description |
|--------|-------------|
| `WalnutAdminExceptionAccessTokenExpired` | JWT access token expired |
| `WalnutAdminExceptionRefreshTokenExpired` | JWT refresh token expired |
| `WalnutAdminExceptionInvalidCredential` | Invalid login credentials |
| `WalnutAdminExceptionUserBannedToSignin` | Account banned from signing in |
| `WalnutAdminExceptionNoAccessPermission` | No access permission |
| `WalnutAdminExceptionNoAccessRolePermission` | No role-based permission |
| `WalnutAdminExceptionOAuthFailed` | OAuth authentication failed |
| `WalnutAdminExceptionSignupBanned` | Registration is disabled |
| `WalnutAdminExceptionDuplicateSignIn` | Duplicate sign-in detected |
| `WalnutAdminExceptionSignoutFailed` | Signout operation failed |
| `WalnutAdminExceptionYouAreBot` | Bot verification failed |
| `WalnutAdminExceptionCapInteractionRequired` | CAPTCHA interaction required |
| `WalnutAdminExceptionCapRefreshRequired` | CAPTCHA refresh required |
| `WalnutAdminExceptionInvalidSignature` | Request signature invalid |
| `WalnutAdminExceptionExpiredSignature` | Request signature expired |
| `WalnutAdminExceptionMfaRequired` | MFA challenge required |
| `WalnutAdminExceptionMfaVerifyFailed` | MFA verification failed |
| `WalnutAdminExceptionUserLocked` | Account is locked |
| `WalnutAdminExceptionSensitiveVerificationFailed` | Sensitive operation verification failed (accepts `meta`) |

**Other Business Exceptions:**

| Export | File | Description |
|--------|------|-------------|
| `WalnutAdminExceptionEndPointUnavailable` | `src/business/app.ts` | Endpoint is disabled |
| `WalnutAdminExceptionRsaDecryptFailed` | `src/business/rsa.ts` | RSA decryption failed |
| `WalnutAdminExceptionRsaPubKeyNotFound` | `src/business/rsa.ts` | RSA public key not found |

### Filter & Handler

| Export | Type | Description |
|--------|------|-------------|
| `WalnutAdminFilterExceptionAll` | `@Catch()` ExceptionFilter | Global catch-all filter. Logs errors, inserts into error DB, translates i18n messages, sets custom headers, returns standardized JSON response (always HTTP 200 with business error code). |
| `WalnutAdminExceptionHandler` | Function | Error classification: maps 5 tiers of errors (MongoError → MongooseError → HttpException → TypeError → fallback) to proper response codes and messages. |

## Key Files

| File | Purpose |
|------|---------|
| `src/base.exception.ts` | 8 base HTTP exception classes, each wrapping NestJS built-in exceptions with the standardized `{ errType, errCode, errMsg, meta, _devMsg }` payload |
| `src/base/400.ts` | 3 BadRequest subclasses: duplicate data, invalid ID, request data error |
| `src/base/404.ts` | 2 NotFound subclasses: data not found, route not found |
| `src/base/406.ts` | 11 NotAcceptable subclasses covering security rejection scenarios (OS, browser, IP, UA, device, bot, blacklist, risk) |
| `src/base/503.ts` | 2 ServiceUnavailable subclasses |
| `src/business/auth.ts` | 18 auth-specific exceptions covering the complete auth lifecycle |
| `src/business/app.ts` | Endpoint-unavailable exception |
| `src/business/rsa.ts` | RSA encryption-related exceptions |
| `src/exception.filter.ts` | Global `@Catch()` filter — catches all exceptions, translates error messages via i18n, logs to error service, sets custom response headers |
| `src/handler.ts` | `WalnutAdminExceptionHandler()` — 5-tier error classification with detailed handling for MongoDB duplicate keys (code 11000), Mongoose CastError/ValidationError, NestJS HttpException with custom errCode mapping, TypeError, and fallback |

## Usage

```typescript
// 1. Import the global filter in root AppModule
import { WalnutAdminFilterExceptionAll } from '@walnut/exceptions'

@Module({
  providers: [
    { provide: APP_FILTER, useClass: WalnutAdminFilterExceptionAll },
  ],
})

// 2. Throw exceptions in services
import { WalnutAdminExceptionBadRequest } from '@walnut/exceptions'
import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'

async check(dto: CheckDTO) {
  if (exists) {
    throw new WalnutAdminExceptionBadRequest({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS,
      errMsg: 'business.auth.userExists',
    })
  }
}

// 3. Use specialized exceptions
import { WalnutAdminExceptionInvalidID, WalnutAdminExceptionDataExists } from '@walnut/exceptions'

// For simple cases (i18n key as error message)
throw new WalnutAdminExceptionDataExists()

// With debug message
throw new WalnutAdminExceptionRequestDataError('Expected string, got number')

// With metadata (useful for frontend)
throw new WalnutAdminExceptionSensitiveVerificationFailed({ meta: { reason: 'password_change' } })
```

## Dependencies

- **Internal**: `@walnut/const/app/responseCode` (for error codes), `@walnut/utils/response` (for response builder), `@walnut/utils/headers` (for custom headers)
- **External**: `@nestjs/common`, `mongoose`
- **App-level** (in the filter): `@/modules/app/error/error.service` (AppErrorService), `@/modules/shared/BLPath/BLPath.service` (SharedBLPathService), `nestjs-i18n` (I18nContext)

## Notes

- The global filter (`WalnutAdminFilterExceptionAll`) has **hard imports to app-level services** (`AppErrorService`, `SharedBLPathService`) — this creates a dependency from the lib back to the app, which would need to be resolved (via DI or interface abstraction) if this lib were ever published standalone
- All exceptions follow the pattern: extend a NestJS HTTP exception, pass a payload with `errCode` from `WalnutAdminConstAppResponseCode`
- The response always uses HTTP 200 for client consumption — actual error status is communicated via the `errCode` field in the response body
- Per CLAUDE.md conventions: avoid creating single-use dedicated exception classes in business code; use the generic base classes with inline `errMsg` instead
