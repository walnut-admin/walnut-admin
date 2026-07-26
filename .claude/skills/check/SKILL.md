---
name: check
description: Run TypeScript type check and ESLint, report results concisely.
---

# Check

Run the project's type checker and linter, then report results.

## Steps

1. Run TypeScript type check (monorepo root):

```bash
pnpm types:check
```

To check only the server package during server development:

```bash
pnpm --filter @walnut/server types:check
```

2. Run ESLint with auto-fix (monorepo root):

```bash
pnpm lint:fix
```

3. Report results concisely:
   - If both pass: "typecheck and lint passed"
   - If errors found: list only the errors, grouped by file, with line numbers
   - Do NOT repeat the full command output if it's clean
