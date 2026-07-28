# Walnut Admin — Domain Context

## Packages

| Term | Definition |
|------|-----------|
| `@walnut/utils` | Pure, framework-agnostic utility functions (regex, queue, crypto primitives). Zero runtime dependencies except `js-base64`. Consumed by both frontend and backend. |
| `@walnut/contract` | Shared types and constants that form the API contract between frontend and backend. Response codes, enums, pagination types, HTTP headers, role/menu/locale constants. Single source of truth — no duplication. |
| `@walnut/client` | Browser-only code consumed by the admin SPA. Crypto wrappers (Web Crypto API), file utilities, window helpers, persistent storage, and Vue composables. Source-only (no build). |
| `@walnut/axios` | HTTP client framework built on Axios. Interceptors, adapters (cache, retry, throttle), request/response pipeline. |
| `@walnut-server/*` | Backend-internal NestJS libraries (config, const, context, db, decorators, exceptions, pipes, types, utils). CJS, SWC-compiled, NestJS-coupled. NOT workspace packages — resolved via tsconfig paths. |

## Rules

1. **No env-dependent defaults in `packages/`.** Utility functions accept parameters; callers decide dev/prod behavior.
2. **No `import.meta.env` or `process.env` in shared packages.** These belong in app-level code.
3. **Direct consumption of `@walnut/contract`.** No wrapper layers — import types and constants from the source.
4. **`private: true` packages are source-consumed by the monorepo only.** CJS build exists solely for backend consumption.
