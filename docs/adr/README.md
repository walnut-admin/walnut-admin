# Architecture Decision Records

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-package-naming.md) | Honest package names — no "shared", "core", or misleading names | ✅ Implemented |
| [0002](0002-dual-mode-consumption.md) | `"source"` condition for Vite, CJS build for backend | ✅ Implemented |
| [0003](0003-no-env-defaults.md) | No `import.meta.env` / `process.env` defaults in shared code | ✅ Implemented |
| [0004](0004-direct-contract-consumption.md) | Direct import from `@walnut/contract`, no wrapper layers | ✅ Implemented |
| [0005](0005-jit-vs-build.md) | Frontend-only packages JIT (source), shared packages build CJS | ✅ Implemented |
| [0006](0006-runtime-api-separation.md) | Organize code by API dependency: pure → `utils`, browser → `client/browser`, Vue → `client/hooks` | ✅ Implemented |
| [0007](0007-backend-libs-not-workspace.md) | Backend NestJS libraries stay as internal monorepo | ✅ Existing (pre-grilling) |
| [0008](0008-unified-versioning-separate-deploy.md) | Single tag, separate deploy, backend-first | ⚠️ ADR written, deploy.yml not yet updated |
| [0009](0009-ci-quality-gates.md) | Three-tier quality: commit (lint) → push (types) → CI (test) | ⚠️ ADR written, tests not yet added, CI workflow not updated |
| [0010](0010-no-ts-project-references.md) | No TypeScript Project References | ✅ Existing (pre-grilling) |

## Implementation Gaps

These are architectural decisions that are **documented but not yet implemented**:

| Gap | ADR | What needs to happen |
|-----|-----|---------------------|
| No tests for shared packages | 0009 | Add vitest tests for `@walnut/utils` (queue, regex, crypto), `@walnut/contract` (snapshot) |
| CI test workflow | 0009 | Add `pnpm test` to GitHub Actions, run on push to main |
| deploy.yml monorepo adaptation | 0008 | Replace manual SCP with `pnpm deploy --filter`, add path-based filtering, add frontend deploy job |
| Frontend build failing | — | `apps/admin` build blocked by env validation plugin (pre-existing, not caused by refactor) |
