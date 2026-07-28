# ADR-0010: No TypeScript Project References

**Date:** 2026-07-28
**Status:** Accepted

## Context

TypeScript Project References (`composite: true` + `references` in tsconfig) allow one project to depend on another's build output, enabling incremental builds across packages. Many monorepo tools (Nx, Lerna) recommend or require them.

The question: should Walnut Admin adopt Project References for its packages?

## Decision

**No.** The monorepo does not use TypeScript Project References.

**Six reasons:**

1. **Heterogeneous toolchain**: Frontend uses `moduleResolution: bundler` (Vite). Backend uses `moduleResolution: node10` (NestJS + SWC). Project References require a unified module resolution strategy.

2. **Source-consumed pattern conflict**: `@walnut/client` and `@walnut/axios` export raw `.ts` source. Project References expect compiled `.js` + `.d.ts` output. These patterns are incompatible.

3. **Vite/VitePress don't read references**: The frontend build tools resolve packages via pnpm workspace symlinks + `exports`, not via tsconfig references.

4. **Backend doesn't participate**: The server has its own `tsconfig.json` with `paths` for `@walnut-server/*` libs. It doesn't extend the root tsconfig and wouldn't benefit from cross-package references.

5. **Maintenance overhead**: Three small source-consumed packages don't justify `tsbuildinfo` coordination.

6. **Risk to existing resolution**: 49 subpath imports across the frontend work via `exports`. Introducing references could break this resolution.

## Consequences

- Package dependency ordering is handled by Turborepo (`dependsOn: ["^build"]`), not by TypeScript
- Type checking across packages relies on `exports` + pnpm workspace symlinks — the same mechanism used at runtime
- If in the future the number of packages exceeds ~15 and incremental builds become a bottleneck, revisit this decision
