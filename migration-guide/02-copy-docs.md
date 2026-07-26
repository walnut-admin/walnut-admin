# Step 2: Copy Docs (`walnut-admin-doc`) into Monorepo

## Overview

Copy the Vitepress documentation site from its standalone repository into `apps/docs/` within the monorepo, then clean out build artifacts, git history, and other items that don't belong in the merged workspace.

## Source and Target

| Direction | Path |
|-----------|------|
| **Source** | `D:\walnut\walnut-admin-doc\` |
| **Target** | `D:\walnut\walnut-admin\apps\docs\` |

## What Gets Copied

The docs repo is relatively simple — a Vitepress static site with the following structure:

```
walnut-admin-doc/
├── .vitepress/       — Vitepress configuration (theme, nav, sidebar)
├── src/              — Documentation markdown source files
├── scripts/          — Utility scripts
├── nginx/            — Nginx deployment configuration
├── node_modules/     — (will be deleted)
├── package.json
├── pnpm-lock.yaml    — (will be deleted)
├── eslint.config.mjs
├── version.json
├── .git/             — (will be deleted)
├── .npmrc            — (will be deleted)
└── .gitignore        — (will be deleted)
```

After cleanup, the `apps/docs/` directory will contain only source files and Vitepress configuration.

## Checklist

- [ ] 1. Navigate to target directory
- [ ] 2. Copy docs repo into `apps/docs/`
- [ ] 3. Delete `node_modules/` — prevents platform-specific issues
- [ ] 4. Delete `.git/` — old git history, will use monorepo's git
- [ ] 5. Delete `.claude/` — old Claude Code config, will be unified
- [ ] 6. Delete `pnpm-lock.yaml` — will be unified at root
- [ ] 7. Delete `.npmrc` — npm config will be unified at root
- [ ] 8. Delete `.gitignore` — gitignore will be unified at root
- [ ] 9. Keep `nginx/` — deployment config is app-specific and useful
- [ ] 10. Verify the copy

---

## Step-by-Step Instructions

### Before You Start

Ensure you are in the monorepo root directory:

```bash
cd /d/walnut/walnut-admin
```

Verify the source directory exists:

```bash
ls -la /d/walnut/walnut-admin-doc/
```

**Expected output:** Directory listing showing the docs repo contents: `package.json`, `src/`, `.vitepress/`, `node_modules/`, `pnpm-lock.yaml`, etc.

---

### Step 2.1: Navigate to Target Directory

```bash
cd /d/walnut/walnut-admin
```

The `apps/` directory should already exist from Step 1, but if it doesn't:

```bash
mkdir -p apps
```

---

### Step 2.2: Copy Docs Repository

Copy the entire docs repo into `apps/docs/`.

**Using `cp` (always available):**

```bash
cp -r /d/walnut/walnut-admin-doc apps/docs
```

With verbose output:

```bash
cp -rv /d/walnut/walnut-admin-doc apps/docs 2>&1 | tail -10
```

**Using `rsync` (faster, with progress — if installed):**

```bash
rsync -avh --progress /d/walnut/walnut-admin-doc/ apps/docs/
```

> **Note:** The trailing slash on the source is important — it means "copy the contents of the directory" rather than "copy the directory itself."

**Verify the copy was successful:**

```bash
ls -la apps/docs/
```

**Expected output:** You should see all the top-level files and directories from the docs repo: `package.json`, `src/`, `.vitepress/`, `scripts/`, etc.

---

### Step 2.3: Delete `node_modules/`

```bash
rm -rf apps/docs/node_modules
```

**What was deleted:** All installed npm dependencies for the Vitepress documentation site.

**Why delete:** These packages are platform-specific and will be re-installed from the monorepo root via `pnpm install`. The docs repo's `node_modules` is relatively small (~200 MB) compared to the server, but it still doesn't belong in the monorepo. Keeping it could cause:

- Dependency version conflicts with other workspace packages
- Unnecessary bloat in the monorepo
- Issues with pnpm workspace hoisting

---

### Step 2.4: Delete `.git/`

```bash
rm -rf apps/docs/.git
```

**What was deleted:** The entire git repository history for the docs project (all commits, branches, tags, reflog).

**Why delete:** Same reasoning as the server step — nested `.git` directories cause:
- Git confusion and potential data corruption
- Bloat (the docs repo's git history is smaller than the server's, but still unnecessary)
- Accidental submodule behavior

> **Warning:** This is irreversible. The original docs repo at `D:\walnut\walnut-admin-doc\` retains its full git history as a backup.

---

### Step 2.5: Delete `.claude/`

```bash
rm -rf apps/docs/.claude
```

**What was deleted:** Claude Code configuration and agent definitions specific to the docs project.

**Why delete:** Claude configuration will be unified at the monorepo root. Per-app `.claude` directories cause inconsistent Claude behavior depending on where commands are run.

---

### Step 2.6: Delete `pnpm-lock.yaml`

```bash
rm -f apps/docs/pnpm-lock.yaml
```

**What was deleted:** The lockfile for the docs site's standalone dependency tree.

**Why delete:** The monorepo will have a single root `pnpm-lock.yaml`. Keeping per-app lockfiles causes:
- `pnpm install` warnings about mismatched lockfiles
- Potential dependency resolution conflicts
- Confusion about which lockfile is authoritative

---

### Step 2.7: Delete `.npmrc`

```bash
rm -f apps/docs/.npmrc
```

**What was deleted:** npm/pnpm configuration specific to the docs project. In this case, the file is empty (0 bytes), having been created as a placeholder.

**Why delete:** npm/pnpm configuration will be managed at the monorepo root. Even an empty `.npmrc` file could interfere with root-level configuration parsing.

---

### Step 2.8: Delete `.gitignore`

```bash
rm -f apps/docs/.gitignore
```

**What was deleted:** The docs project's gitignore rules (56 bytes).

**Why delete:** Gitignore will be managed at the monorepo root level. Each app having its own `.gitignore` can lead to inconsistent behavior. The root `.gitignore` will cover all common patterns.

---

### Step 2.9: Keep `nginx/`

The `nginx/` directory contains Nginx deployment configuration specific to the docs site. This is **not** deleted because:

- It's configuration for deploying the docs app, tightly coupled to it
- It's not a build artifact or version control system file
- Different apps may have different deployment needs
- Keeping it with the app avoids cluttering the root with per-app deployment configs

```bash
# Verify nginx config is still there:
ls -la apps/docs/nginx/
```

**Expected output:** Nginx configuration files.

---

### Step 2.10: Verify the Copy

Run a comprehensive verification:

```bash
cd /d/walnut/walnut-admin && \
echo "=== apps/docs/ top-level ===" && \
ls -la apps/docs/ && \
echo "" && \
echo "=== Confirming deletions ===" && \
test -d apps/docs/node_modules && echo "WARNING: node_modules still exists!" || echo "node_modules: deleted" && \
test -d apps/docs/.git && echo "WARNING: .git still exists!" || echo ".git: deleted" && \
test -d apps/docs/.claude && echo "WARNING: .claude still exists!" || echo ".claude: deleted" && \
test -f apps/docs/pnpm-lock.yaml && echo "WARNING: pnpm-lock.yaml still exists!" || echo "pnpm-lock.yaml: deleted" && \
test -f apps/docs/.npmrc && echo "WARNING: .npmrc still exists!" || echo ".npmrc: deleted" && \
test -f apps/docs/.gitignore && echo "WARNING: .gitignore still exists!" || echo ".gitignore: deleted" && \
echo "" && \
echo "=== Key files present ===" && \
test -f apps/docs/package.json && echo "package.json: OK" || echo "package.json: MISSING" && \
test -f apps/docs/eslint.config.mjs && echo "eslint.config.mjs: OK" || echo "eslint.config.mjs: MISSING" && \
test -d apps/docs/.vitepress && echo ".vitepress/: OK" || echo ".vitepress/: MISSING" && \
test -d apps/docs/src && echo "src/: OK" || echo "src/: MISSING" && \
test -d apps/docs/nginx && echo "nginx/: OK (kept intentionally)" || echo "nginx/: MISSING"
```

---

## Quick Cleanup Command

Run the entire cleanup as a single command:

```bash
cd /d/walnut/walnut-admin && \
rm -rf apps/docs/node_modules && \
rm -rf apps/docs/.git && \
rm -rf apps/docs/.claude && \
rm -f apps/docs/pnpm-lock.yaml && \
rm -f apps/docs/.npmrc && \
rm -f apps/docs/.gitignore && \
echo "Docs cleanup complete."
```

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| **Empty `.npmrc`** — The file exists but is 0 bytes; `rm -f` handles it cleanly | No special action needed; standard deletion works. |
| **Small repo, easy copy** — The docs repo is small, so the copy is fast and low-risk | Proceed. |
| **`nginx/` config** — Might be mistaken for a build artifact | Keep it — it's app-specific deployment config, documented in Step 2.9. |

---

## What About `eslint.config.mjs`?

The docs repo has its own ESLint flat config (`eslint.config.mjs`). This file is **kept** for now — in later phases, linting configuration may be unified at the root, but during the structural merge phase we preserve each app's existing setup.

---

## Post-Copy Quick Check

After completing Steps 1 and 2, your `apps/` directory should look like this:

```
D:\walnut\walnut-admin\apps\
├── admin\       (already exists from walnut-admin-client — the Vue 3 SPA)
├── mfa-demo\    (already exists from walnut-admin-client — demo package)
├── server\      (just copied — NestJS API)
└── docs\        (just copied — Vitepress docs)
```

Verify with:

```bash
ls -la /d/walnut/walnut-admin/apps/
```

**Expected output:**

```
drwxr-xr-x  admin/
drwxr-xr-x  docs/
drwxr-xr-x  mfa-demo/
drwxr-xr-x  server/
```

---

## Next Step

Both the server and docs have now been copied into the monorepo. Proceed to **Step 3: Configure Root Workspace** (documentation forthcoming).
