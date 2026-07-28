# ADR-0002: Dual-Mode Package Consumption

**Date:** 2026-07-28
**Status:** Accepted

## Context

The monorepo has two consumers with incompatible module systems:

| Consumer | Module System | Build Tool |
|----------|--------------|------------|
| `apps/admin` (Vue SPA) | ESM, `moduleResolution: bundler` | Vite |
| `apps/server` (NestJS) | CJS, `moduleResolution: node10` | SWC |

Packages consumed by both (`@walnut/contract`, `@walnut/utils`) need to work in both worlds.

**Alternatives considered:**

| Approach | Frontend | Backend | Verdict |
|----------|----------|---------|---------|
| Source-only (JIT) | ✅ Instant HMR | ❌ Can't resolve ESM source | Rejected |
| CJS-only build | ❌ No HMR, build latency | ✅ Native `require()` | Rejected |
| Dual build (ESM + CJS) | ✅ `import` reads ESM | ✅ `require` reads CJS | ✅ Accepted |
| tsconfig paths only | ✅ Works | ✅ Works but 4 files to maintain | Rejected — doesn't scale |

## Decision

Use `package.json` `exports` with a custom `"source"` condition:

```json
{
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs",
      "default": "./dist/index.cjs"
    }
  }
}
```

- **Frontend dev**: Vite resolves `"source"` → raw `.ts` → instant HMR
- **Frontend prod**: Vite bundles workspace source directly (no separate ESM build needed)
- **Backend**: SWC resolves `"require"` → built CJS
- **IDE**: TypeScript resolves `"types"` → source `.ts`

**`"source"` not `"development"`**: Webpack's `NODE_ENV=development` also matches the `"development"` export condition. A scope-qualified name avoids this collision. (Vite RFC, Nx, and Turborepo docs all recommend this pattern.)

## Consequences

- Only CJS is built (Vite `formats: ['cjs']`). No ESM build artifact needed — the frontend reads source.
- Backend packages (`@walnut/contract`, `@walnut/utils`) need `@types/node` for build-time type checking.
- Adding a new shared package requires: `vite.config.ts` (CJS build) + `tsconfig.json` + `package.json` exports.
- SWC configs still need path aliases for dev-time source resolution (NestJS CLI uses SWC, not pnpm workspace resolution).
