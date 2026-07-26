# @walnut/utils

Shared utility functions used across the application. Provides DTO manipulation helpers, MongoDB aggregation pipeline builders, standardized response formatters, data masking, HTTP header utilities, dayjs configuration, and more. No NestJS module — purely functional utilities imported as needed.

## Exports

10 modules re-exported via barrel from `src/index.ts`:

| Module | Export Path | Key Exports |
|--------|-------------|-------------|
| dayjs | `@walnut/utils/dayjs` | `AppDayjs` — dayjs instance configured with UTC and timezone plugins |
| dto | `@walnut/utils/dto` | `RealPickType()`, `RealPartialType()`, `RealOmitType()` — DTO helpers that fix `@Expose()` issues with NestJS `PickType`/`PartialType` |
| general | `@walnut/utils/general` | `generateVerifyCode(length)`, `sleep(ms)`, `objectToPaths(obj)` |
| headers | `@walnut/utils/headers` | `setCustomHeaders(context)` — sets X-Request-ID, X-Request-IP, timezone, language, version headers on response |
| listAggregate | `@walnut/utils/listAggregate` | `buildListPipelineFromRequest<T>(params, extra?, sortAfter?, extraMatch?)` — converts list request params to MongoDB `$facet` aggregation pipeline |
| mask | `@walnut/utils/mask` | `maskEmail()`, `maskPhone()`, `maskSensitiveFields(obj)` — PII data masking |
| pkg | `@walnut/utils/pkg` | `getPackageJsonData()` — reads and parses `package.json` from CWD |
| regex | `@walnut/utils/regex` | `regexMap` — uuidv4, email, phone number regex patterns |
| response | `@walnut/utils/response` | `WalnutAdminResponseSuccess<T>(data, requestId)`, `WalnutAdminResponseException(payload)`, `getAllConstraints(errors)` — standardized API response builders |

## Key Files

| File | Purpose |
|------|---------|
| `src/dto.ts` | Workarounds for NestJS/Swagger `PickType`/`PartialType` issues with `ClassSerializerInterceptor` (`excludeExtraneousValues: true`). Ensures `@Expose()` and `@IsOptional()` are applied when picking/partialing DTO classes. Used by every CRUD module. |
| `src/listAggregate.ts` | MongoDB aggregation pipeline builder. `buildListPipelineFromRequest()` parses query filters (regex for strings, boolean, ObjectId, date ranges, `$in` for arrays), sort options (with priority), and pagination into a `$facet` pipeline with `data` + `total`. Used by every basic repository. |
| `src/response.ts` | Core API response structure: `{ data, code, msg, requestId, meta, _devMsg }`. The `_devMsg` field is only included when `isDev` is true. Used by exception filter and all controllers. |
| `src/mask.ts` | Data masking utilities: `maskEmail()` shows first 2 chars, `maskPhone()` shows first 3 + last 4 digits. `maskSensitiveFields()` recursively walks objects masking known sensitive fields (password, token, secret, email, phone, identity, etc.) with typed handling for ObjectId, Date, Map, Set. |
| `src/headers.ts` | Sets custom response headers (ID, IP, timezone, language, version, repo-version), skipping SSE endpoints. |
| `src/dayjs.ts` | Configures dayjs with UTC and timezone plugins, exported as `AppDayjs`. |
| `src/general.ts` | Simple utilities: random numeric verification code generator, async sleep, dot-notation path extractor for nested objects. |
| `src/pkg.ts` | Reads `package.json` from `process.cwd()`, parsing name and version. |
| `src/regex.ts` | Common regex patterns: uuid v4, email (sensitive-off variant), phone number (sensitive variant). |

## Usage

```typescript
// DTO helpers — used in every CRUD module
import { RealPickType, RealPartialType } from '@walnut/utils/dto'

export class SysUserCreateDTO extends RealPickType(SysUserDTO, ['username', 'email'] as const) {}

// List aggregation — used in every basic repository
import { buildListPipelineFromRequest } from '@walnut/utils/listAggregate'

const pipeline = buildListPipelineFromRequest(params, lookupStages)

// Response builders
import { WalnutAdminResponseSuccess } from '@walnut/utils/response'

return WalnutAdminResponseSuccess(user, requestId)

// Data masking
import { maskEmail, maskSensitiveFields } from '@walnut/utils/mask'

const masked = maskEmail('user@example.com') // 'us***@example.com'

// Dayjs
import { AppDayjs } from '@walnut/utils/dayjs'
const now = AppDayjs().tz('Asia/Shanghai')
```

## Dependencies

- **Internal**: `@walnut/config/utils/env` (for `isDev` in response builder)
- **External**: `dayjs`, `class-transformer`, `@nestjs/swagger` (DTO helpers use `PickType`/`PartialType` from swagger), `lodash`, `mongoose`

## Notes

- `RealPickType`/`RealPartialType`/`RealOmitType` exist because NestJS's native `PickType`/`PartialType` don't apply `@Expose()` to picked fields, causing them to be silently excluded by the global `ClassSerializerInterceptor` with `excludeExtraneousValues: true`
- The `buildListPipelineFromRequest()` function is the single source of truth for all list API endpoints — it handles string regex matching, boolean matching, ObjectId conversion, date range detection, and `$in` array queries
- `WalnutAdminResponseBase()` conditionally includes `_devMsg` only in development — this is the only cross-cutting dependency from utils to config
