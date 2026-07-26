# @walnut/types

Global ambient TypeScript type declarations (`.d.ts` files). Extends Express `Request`/`Response` objects with app-specific fields, defines token payload interfaces, response type structures, process environment types, i18n generated types, and decorator option interfaces. Zero runtime code — all types are declared via `declare global` and `declare module` blocks.

## Exports

No runtime exports (`index.ts` does `export {}`). All types are globally available via `declare global` blocks:

- `IWalnutAdminExpressRequest` — extended Express request object (~30 fields)
- `IWalnutAdminExpressResponse` — extended Express response object
- `IWalnutAdminAccessTokenPayload` — JWT access token claims
- `IWalnutAdminRefreshTokenPayload` — JWT refresh token claims
- `IWalnutAdminResponseBase<T>` — standardized API response shape
- `IWalnutAdminResponseExceptionBase` — error response shape
- `IWalnutAdminExceptionConstructor` — exception constructor options
- `IWalnutAdminThrottleConfigProvider` — throttle config interface
- Various decorator option interfaces (`IWalnutAdminDecoratorFieldStringOptions`, etc.)

Also augments `NodeJS.ProcessEnv` with ~55 typed environment variables and extends `Express.User`.

## Key Files

| File | Purpose |
|------|---------|
| `src/walnut-admin/express.d.ts` | Augments `Express.Request` with 30+ fields: `id`, `realIp`, `fingerprint`, `timezone`, `language`, `version`, `mongooseSession`, `user`, `decryptedBody`, `signedCookies`, `refreshTokenPayload`, parsed user-agent, bot/suspicious flags, risk context, and more. Also defines `IWalnutAdminExpressResponse` and `IWalnutadminCookie`. |
| `src/walnut-admin/token.d.ts` | `IWalnutAdminAccessTokenPayload` (sid, userName, userId, roleIds, roleNames, currentRole, roleMode, mfaSetup/Verified, iat/exp) and `IWalnutAdminRefreshTokenPayload` (sid, jti) |
| `src/walnut-admin/response.d.ts` | `IWalnutAdminResponseBase<T>` (data, code, msg, requestId, meta, _devMsg) and `IWalnutAdminResponseExceptionBase` |
| `src/walnut-admin/utils.d.ts` | `AnyFn` type alias |
| `src/walnut-admin/decorators/*.d.ts` | Option interfaces for each field decorator type (boolean, date, enum, mongoId, number, object, string) |
| `src/process.d.ts` | Augments `NodeJS.ProcessEnv` with all typed environment variables |
| `src/i18n.generated.d.ts` | Auto-generated i18n type definitions covering `business`, `email`, `index`, and `response` translation key paths |

## Usage

```typescript
// Types are globally available — no import needed in most cases
const request: IWalnutAdminExpressRequest = ctx.switchToHttp().getRequest()
const requestId = request.id

// For token payloads
function decode(token: string): IWalnutAdminAccessTokenPayload { ... }

// For response building
function success<T>(data: T): IWalnutAdminResponseBase<T> { ... }

// Exception constructor options
throw new WalnutAdminExceptionBadRequest({
  errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS,
  errMsg: 'business.auth.userExists',
  _devMsg: 'Duplicate email',
})
```

## Dependencies

- **Internal**: `@walnut/const` (for response code types in `token.d.ts` and `response.d.ts`)
- **External**: `express`, `mongoose`

## Notes

- This library is unique — it is a collection of `.d.ts` files rather than a standard NestJS library
- Types are applied globally through `declare global` blocks, meaning they don't need explicit imports
- The `IWalnutAdminExpressRequest` interface is the most widely used type — it carries request state through the entire middleware/interceptor/guard pipeline
- Decorator option interfaces are co-located with their respective decorator modules (e.g., `src/walnut-admin/decorators/string.d.ts` defines options for `WalnutAdminDecoratorFieldString`)
