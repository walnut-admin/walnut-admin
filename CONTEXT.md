# Walnut Admin — Domain Context

> 术语表。**只回答「这个词在本仓指什么」**；结构与命令见 [`AGENTS.md`](./AGENTS.md)，架构决策见
> [`apps/docs/src/zh-CN/content/`](./apps/docs/src/zh-CN/content/)。
> 2026-09-23 校正：本文件此前仍把已更名的 `@walnut/axios` 当作现存包，也没反映 platform 分组与
> tooling 拆分（归档评审判定为过期）。

## Packages

| Term | Definition |
|------|-----------|
| `@walnut/utils` | Pure, framework-agnostic utility functions (regex, queue, crypto primitives). Zero runtime dependencies except `js-base64`. Consumed by both frontend and backend. |
| `@walnut/contract` | Shared types and constants that form the API contract between frontend and backend. Response codes, enums, pagination types, HTTP headers, role/menu/locale constants. Single source of truth — no duplication. |
| `@walnut/client` | Browser-only code consumed by the admin SPA. Crypto wrappers (Web Crypto API), file utilities, window helpers, persistent storage, and Vue composables. Source-only (no build). |
| `@walnut/http` | HTTP client framework built on Axios. Interceptors, adapters (cache, retry, throttle), request/response pipeline. **Formerly `@walnut/axios`** (renamed 2026-07). |
| `@walnut/ui` | naive-ui based components (POC: 3 components). Source-only. |
| `@walnut/types` | Ambient type declarations, consumed as `@walnut/types/<name>`. |
| `@walnut-server/*` | Backend-internal NestJS libraries (config, const, context, db, decorators, exceptions, pipes, types, utils). CJS, SWC-compiled, NestJS-coupled. NOT workspace packages — resolved via tsconfig paths. |
| `@walnut/{tsconfig,eslint-config,commitlint-config,scripts,release}` | The 5 tooling packages (split out of the former `@walnut/tooling`, 2026-09). See `packages/tooling/`. |

## Rules

1. **No env-dependent defaults in `packages/`.** Utility functions accept parameters; callers decide dev/prod behavior.
2. **No `import.meta.env` or `process.env` in shared packages.** These belong in app-level code.
3. **Direct consumption of `@walnut/contract`.** No wrapper layers — import types and constants from the source.
4. **`private: true` packages are source-consumed by the monorepo only.** CJS build exists solely for backend consumption.
