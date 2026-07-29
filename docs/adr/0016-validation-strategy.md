# ADR-0016: Validation Strategy — class-validator

**Date:** 2026-07-29
**Status:** Accepted

## Context

The NestJS backend uses `class-validator` + `class-transformer` for request validation, integrated via a custom decorator system (`WalnutAdminDecoratorField*`). The frontend has no runtime schema validation layer.

Industry consensus (see `docs/reference/07-fullstack-architecture.md`) favors **Zod** for fullstack monorepos: a single schema serves both backend validation and frontend form validation, with automatic TypeScript type inference (`z.infer<typeof schema>`).

Two paths exist:
1. **Migrate to Zod** — replace `class-validator` DTOs with Zod schemas, add `ZodValidationPipe` in NestJS
2. **Stay with class-validator** — keep existing decorator system, acknowledge the trade-off

## Decision

**Chosen:** Stay with `class-validator` + custom decorator system. Do not introduce Zod at this time.

## Rationale

1. **The existing decorator system already provides "single declaration" semantics.**
   `WalnutAdminDecoratorField*` decorators combine validation (`class-validator`) + transformation (`class-transformer`) + Swagger documentation into one decorator. This achieves a similar DX to Zod schemas (one declaration = validation + types + docs).

2. **Migration cost is disproportionate to current benefit.**
   The validation system is deeply embedded across the codebase:
   - 16 guard classes depend on the DTO/validation pipeline
   - Middleware and interceptor layers expect `class-validator` error formats
   - `libs/decorators/` contains 6 sub-systems (field/params/query/transformer/validator/swagger) with ~30 decorator files
   - All existing DTOs (~100+ classes) would need rewriting

3. **Frontend form validation reuse is not yet a pain point.**
   The primary benefit of Zod (same schema on frontend and backend) requires frontend form libraries (VeeValidate + Zod). Without this integration, Zod on the backend alone adds dependency overhead without the "DRY validation" payoff.

4. **Zod introduces a second validation paradigm.**
   Even a gradual migration means maintaining two validation systems side-by-side — `class-validator` for existing modules, Zod for new ones. This bifurcation increases cognitive load for contributors.

## Trigger Conditions for Re-evaluation

Revisit this decision when any of these conditions are met:

| Trigger | Why it changes the calculus |
|---------|---------------------------|
| Frontend adopts VeeValidate + Zod for form validation | DRY validation across frontend and backend becomes achievable |
| A new greenfield NestJS module is created from scratch | Opportunity to try Zod without migration cost |
| `class-validator` becomes unmaintained or incompatible with a NestJS major version | Forced migration |
| The project grows to 3+ frontend apps sharing validation with the same backend | Shared schema ROI increases |

## Consequences

- Validation logic remains backend-only (no frontend schema reuse)
- DTO files continue using `class-validator` decorators + `RealPickType` / `RealPartialType` helpers
- New NestJS modules follow the existing `WalnutAdminDecoratorField*` pattern
- All existing `libs/decorators/` infrastructure is preserved
- If a trigger condition is met, start with a single module as proof-of-concept before committing to full migration

## Related

- `docs/decisions/zod-evaluation.md` — detailed Zod vs class-validator comparison
- `docs/reference/07-fullstack-architecture.md` — industry recommendation for Zod in fullstack monorepos
- `apps/server/libs/decorators/` — current class-validator decorator system
- `apps/server/CLAUDE.md` — DTO design rules (RealPickType, field decorator usage)
