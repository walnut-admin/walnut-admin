# Step 5: Adapt `apps/docs/` After Copy

This step covers the changes needed after copying the `walnut-admin-doc` repository contents into `apps/docs/`.

**Assumption:** The docs source has been copied from `D:/walnut/walnut-admin-doc/` into `D:/walnut/walnut-admin/apps/docs/`. All original files are preserved at the time of copy.

---

## 5a: Update `apps/docs/package.json`

**File:** `D:/walnut/walnut-admin/apps/docs/package.json`

### Before (original from walnut-admin-doc)

```json
{
  "name": "walnut-admin-doc",
  "type": "module",
  "version": "1.0.0",
  "description": "Walnut Admin Documentation",
  "author": {
    "name": "zhaocl1997",
    "url": "https://github.com/Zhaocl1997",
    "email": "zhaocl97@foxmail.com"
  },
  "license": "ISC",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/walnut-admin/walnut-admin-doc.git"
  },
  "main": "index.js",
  "scripts": {
    "prepare": "npx simple-git-hooks",
    "preinstall": "npx only-allow pnpm",
    "dev": "vitepress",
    "build": "vitepress build",
    "preview": "vitepress preview",
    "lint": "eslint .",
    "format": "eslint . --fix",
    "taze": "npx taze -i -w"
  },
  "dependencies": {
    "dayjs": "^1.11.19",
    "vitepress": "1.6.3",
    "vitepress-mermaid-renderer": "1.1.5",
    "vue": "3.5.25"
  },
  "devDependencies": {
    "@antfu/eslint-config": "4.16.2",
    "@mermaid-js/mermaid-mindmap": "9.3.0",
    "@types/node": "22.16.0",
    "eslint": "9.30.1",
    "lint-staged": "15.5.2",
    "mermaid": "11.8.0",
    "pagefind": "1.3.0",
    "segment": "0.1.3",
    "simple-git-hooks": "2.13.0",
    "taze": "19.1.0",
    "typescript": "5.8.3",
    "vite": "5.4.19",
    "vitepress-plugin-pagefind": "0.4.14",
    "vitepress-plugin-tabs": "^0.7.3"
  },
  "simple-git-hooks": {
    "pre-commit": "npx lint-staged"
  },
  "lint-staged": {
    "*": "eslint --fix"
  }
}
```

### After (adapted for monorepo)

```json
{
  "name": "@walnut/docs",
  "type": "module",
  "version": "1.0.0",
  "private": true,
  "description": "Walnut Admin Documentation",
  "license": "ISC",
  "scripts": {
    "dev": "vitepress",
    "build": "vitepress build",
    "preview": "vitepress preview",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "types:check": "echo skipped"
  },
  "dependencies": {
    "dayjs": "^1.11.19",
    "vitepress": "1.6.3",
    "vitepress-mermaid-renderer": "1.1.5",
    "vue": "3.5.25"
  },
  "devDependencies": {
    "@antfu/eslint-config": "4.16.2",
    "@mermaid-js/mermaid-mindmap": "9.3.0",
    "@types/node": "22.16.0",
    "eslint": "9.30.1",
    "lint-staged": "15.5.2",
    "mermaid": "11.8.0",
    "pagefind": "1.3.0",
    "segment": "0.1.3",
    "typescript": "5.8.3",
    "vite": "5.4.19",
    "vitepress-plugin-pagefind": "0.4.14",
    "vitepress-plugin-tabs": "^0.7.3"
  },
  "engines": {
    "node": ">=24.13.0"
  }
}
```

### Detailed diffs

**1. Name change (required for workspace resolution and turbo filtering):**
```diff
- "name": "walnut-admin-doc",
+ "name": "@walnut/docs",
```
**Why:** Consistent with `@walnut/admin` and `@walnut/server` naming in the monorepo. Also enables `turbo --filter=@walnut/docs`.

**2. Add `"private": true`:**
```diff
+ "private": true,
```
**Why:** The docs package should not be published to npm. All monorepo workspace packages should be marked private unless they are intended for external distribution.

**3. Remove repository/author metadata:**
```diff
- "author": { ... },
- "repository": { ... },
- "main": "index.js",
```
**Why:** The monorepo root is the single source of truth. `"main": "index.js"` was never used (vitepress doesn't use it).

**4. Remove preinstall/prepare/git hooks scripts:**
```diff
- "prepare": "npx simple-git-hooks",
- "preinstall": "npx only-allow pnpm",
```
**Why:** The monorepo root manages git hooks and pnpm enforcement. Individual packages should not run these scripts.

**5. Remove `simple-git-hooks` and `lint-staged` blocks:**
```diff
- "simple-git-hooks": { ... },
- "lint-staged": { ... },
```
**Why:** These are root-level configurations in the monorepo. The root `package.json` handles them.

**6. Remove `taze` script:**
```diff
- "taze": "npx taze -i -w",
```
**Why:** The root already has `check:deps:update` for this purpose. The docs package doesn't need its own taze script.

**7. Add `"lint:fix"` script:**
```diff
+ "lint:fix": "eslint . --fix",
```
**Why:** Turbo's pipeline may define a `lint:fix` task. The original script was called `format` which doesn't match turbo task naming. Adding `lint:fix` ensures turbo can run lint-fix across all packages.

**8. Add `"types:check"` script:**
```diff
+ "types:check": "echo skipped",
```
**Why:** Turbo's `turbo.json` defines a `types:check` pipeline task. If a package doesn't have a `types:check` script, turbo will error. The docs package doesn't need strict TypeScript checking (vitepress does its own type handling), so we provide a no-op that always succeeds.

**9. Add `"engines"` block:**
```diff
+ "engines": {
+   "node": ">=24.13.0"
+ }
```
**Why:** Consistent with the monorepo's minimum Node version requirement. While vitepress 1.x works on older Node, aligning ensures developers use a single Node version for all packages.

**10. Remove unused devDependencies:**
```diff
- "simple-git-hooks": "2.13.0",
- "taze": "19.1.0",
```
**Why:** These are only needed for lifecycle hooks and dep checking, which are managed at the root level.

### Checklist

- [x] Name changed from `"walnut-admin-doc"` to `"@walnut/docs"`
- [x] `"private": true` added
- [x] Repository/author metadata removed (root handles this)
- [x] `"prepare"` and `"preinstall"` scripts removed
- [x] `"lint:fix"` script added (mapped from old `format`)
- [x] `"types:check": "echo skipped"` added for turbo compatibility
- [x] `"engines": { "node": ">=24.13.0" }` added
- [x] Unused devDependencies removed (simple-git-hooks, taze)
- [x] `simple-git-hooks` and `lint-staged` blocks removed

---

## 5b: Verify Vitepress Configuration

**Files:**
- `apps/docs/.vitepress/config/index.ts`
- `apps/docs/.vitepress/config/shared.ts`

### No changes needed

The vitepress configuration uses relative paths for everything:

- `base: '/'` — The base URL for the deployed site. This is correct for both standalone deployment and monorepo development. No change needed.
- `srcDir: 'src'` — Relative to the vitepress config file location. Correct.
- All component imports use relative paths within `.vitepress/`.
- All markdown content references are relative to `src/`.

**Why it works as-is:** Vitepress always operates relative to its own configuration directory (`.vitepress/`). It does not depend on or reference the monorepo structure. The `apps/docs/` directory structure is self-contained.

### Quick verification

```bash
# From the docs directory
cd apps/docs
pnpm dev

# This should start vitepress dev server on port 8886 (configured in config/index.ts)
# Visit http://localhost:8886 to verify
```

```bash
# From the monorepo root via turbo
pnpm dev:docs

# Same result, turbo delegates to apps/docs/ and vitepress runs from there
```

### Expected behavior

Navigating to `http://localhost:8886/` should show the Walnut Admin documentation site with:
- All pages rendering correctly
- Mermaid diagrams working (if any)
- Search (Pagefind) operational
- No broken asset paths

### Checklist

- [ ] Verified `apps/docs/.vitepress/config/index.ts` has no monorepo-specific path issues
- [ ] Confirmed `base: '/'` is correct
- [ ] Tested `pnpm dev:docs` from root (starts without errors)
- [ ] Tested `pnpm build:docs` from root (builds without errors)
