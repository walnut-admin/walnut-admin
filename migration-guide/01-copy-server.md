# Step 1: Copy Server (`walnut-admin-server`) into Monorepo

## Overview

Copy the NestJS backend from its standalone repository into `apps/server/` within the monorepo, then clean out build artifacts, git history, and other items that don't belong in the merged workspace.

## Source and Target

| Direction | Path |
|-----------|------|
| **Source** | `D:\walnut\walnut-admin-server\` |
| **Target** | `D:\walnut\walnut-admin\apps\server\` |

## What Happens to the Server's Internal Structure

The NestJS server already uses its own internal monorepo structure:

```
walnut-admin-server/
├── apps/
│   └── api/         — The NestJS API application
├── db/              — Database scripts
├── docker/          — Docker configuration
├── docs/            — Server-related documentation
├── ...              — Config files, tsconfig, etc.
```

This internal structure is preserved entirely under `apps/server/`. The server keeps its own `package.json`, `tsconfig.json`, and internal workspace configuration. The root monorepo only needs to know about `apps/server/` as a workspace member.

## Checklist

- [ ] 1. Navigate to target directory
- [ ] 2. Copy server repo into `apps/server/`
- [ ] 3. Delete `node_modules/` — prevents platform-specific binary issues
- [ ] 4. Delete `dist/` — stale build output, will be rebuilt
- [ ] 5. Delete `logs/` — runtime logs, not part of source
- [ ] 6. Delete `.git/` — old git history, will use monorepo's git
- [ ] 7. Delete `.github/` — old CI/CD workflows, will be unified
- [ ] 8. Delete `.claude/` — old Claude Code config, will be unified
- [ ] 9. Delete `pnpm-lock.yaml` — will be unified at root
- [ ] 10. Delete `.npmrc` — npm config will be unified at root
- [ ] 11. Delete `.gitignore` — gitignore will be unified at root
- [ ] 12. Verify the copy

---

## Step-by-Step Instructions

### Before You Start

Ensure you are in the monorepo root directory:

```bash
cd /d/walnut/walnut-admin
```

Also verify the source directory exists:

```bash
ls -la /d/walnut/walnut-admin-server/
```

**Expected output:** Directory listing showing the server repo contents.

---

### Step 1.1: Navigate to Target Directory

```bash
cd /d/walnut/walnut-admin
```

Ensure the `apps/` directory exists:

```bash
mkdir -p apps
```

---

### Step 1.2: Copy Server Repository

Use `cp -r` (recursive copy) to copy the entire server repo into `apps/server/`.

**Using `cp` (always available):**

```bash
cp -r /d/walnut/walnut-admin-server apps/server
```

If you'd like to monitor progress (the server repo can be large), add the `-v` (verbose) flag:

```bash
cp -rv /d/walnut/walnut-admin-server apps/server 2>&1 | tail -20
```

**Using `rsync` (faster, with progress bar — if installed):**

```bash
rsync -avh --progress /d/walnut/walnut-admin-server/ apps/server/
```

> **Note:** The trailing slash on the source (`/d/walnut/walnut-admin-server/`) is important — it means "copy the contents of the directory" rather than "copy the directory itself."

**Verify the copy was successful:**

```bash
ls -la apps/server/
```

**Expected output:** You should see all the top-level files and directories from the server repo: `package.json`, `apps/`, `tsconfig.json`, etc.

---

### Step 1.3: Delete `node_modules/`

```bash
rm -rf apps/server/node_modules
```

**What was deleted:** All installed npm dependencies for the NestJS server.

**Why delete:** These packages are platform-specific (compiled native binaries for your current OS) and will be re-installed from the monorepo root via `pnpm install`. Keeping them can cause:
- Conflicts with the workspace's dependency resolution
- Architecture-specific binary incompatibilities (e.g., x64 vs arm64)
- Unnecessary bloat — `node_modules` in a NestJS project can exceed 1 GB

---

### Step 1.4: Delete `dist/`

```bash
rm -rf apps/server/dist
```

**What was deleted:** Compiled JavaScript output from previous TypeScript builds.

**Why delete:** Build artifacts are generated from source; they don't belong in version control. The first `pnpm build` in the monorepo will regenerate them.

Check if there are other build output directories:

```bash
ls -la apps/server/ | grep -E '^(dist|build|output|release)'
```

If any exist, delete them too:

```bash
rm -rf apps/server/dist apps/server/build apps/server/output apps/server/release
```

---

### Step 1.5: Delete `logs/`

```bash
rm -rf apps/server/logs
```

**What was deleted:** Runtime server logs (error logs, access logs, etc.).

**Why delete:** Logs are runtime artifacts, not source code. They should never be committed to version control. If the server repo had a `.gitignore` that excluded `logs/`, the directory may already be gitignored, but we delete it anyway for completeness.

---

### Step 1.6: Delete `.git/`

```bash
rm -rf apps/server/.git
```

**What was deleted:** The entire git repository history for the server project (all commits, branches, tags, reflog).

**Why delete:** The monorepo will have its own git repository. Keeping nested `.git` directories causes:
- Git confusion — it's extremely error-prone to have a git repo inside another git repo
- Bloat — the server's git history can be hundreds of MB
- Submodule behavior — Git would treat it as a submodule, which is not the intention

> **Warning:** This is irreversible. The original server repo at `D:\walnut\walnut-admin-server\` still has its full git history as a backup.

---

### Step 1.7: Delete `.github/`

```bash
rm -rf apps/server/.github
```

**What was deleted:** GitHub workflows, issue templates, and other GitHub-specific configuration.

**Why delete:** CI/CD workflows will be unified at the monorepo root level. Keeping per-app GitHub directories would lead to:
- Duplicate or conflicting workflow runs
- Maintenance burden — changes would need to be made in multiple places
- Confusion about which workflows are active

---

### Step 1.8: Delete `.claude/`

```bash
rm -rf apps/server/.claude
```

**What was deleted:** Claude Code configuration, agent definitions, and skill overrides specific to the server project.

**Why delete:** Claude Code configuration will be unified at the monorepo root. Each app having its own `.claude` directory would cause conflicts — Claude reads the nearest `.claude` directory, which could lead to inconsistent behavior depending on where commands are run.

---

### Step 1.9: Delete `pnpm-lock.yaml`

```bash
rm -f apps/server/pnpm-lock.yaml
```

**What was deleted:** The lockfile for the server's standalone dependency tree.

**Why delete:** The monorepo will have a single root `pnpm-lock.yaml` that resolves all dependencies for all workspace packages. Keeping per-app lockfiles would cause:
- `pnpm install` at root to warn about mismatched lockfiles
- Potential dependency resolution conflicts
- Confusion about which lockfile is authoritative

---

### Step 1.10: Delete `.npmrc`

```bash
rm -f apps/server/.npmrc
```

**What was deleted:** npm/pnpm configuration specific to the server project (registry settings, hoisting rules, etc.).

**Why delete:** npm/pnpm configuration will be unified at the monorepo root. Per-app `.npmrc` files can override root settings in unexpected ways.

---

### Step 1.11: Delete `.gitignore`

```bash
rm -f apps/server/.gitignore
```

**What was deleted:** The server's gitignore rules.

**Why delete:** Gitignore will be managed at the monorepo root. If each app has its own `.gitignore`, patterns may conflict or miss files that cross app boundaries. The root `.gitignore` will cover all common patterns (node_modules, dist, logs, etc.) for all apps.

---

### Step 1.12: Verify the Copy

List the contents of `apps/server/` to confirm the structure looks correct:

```bash
echo "=== apps/server/ top-level ===" && \
ls -la apps/server/ && \
echo "" && \
echo "=== apps/server/apps/ ===" && \
ls -la apps/server/apps/ 2>/dev/null || echo "(no apps subdirectory)" && \
echo "" && \
echo "=== Confirming deletions ===" && \
test -d apps/server/node_modules && echo "WARNING: node_modules still exists!" || echo "node_modules: deleted" && \
test -d apps/server/dist && echo "WARNING: dist still exists!" || echo "dist: deleted" && \
test -d apps/server/logs && echo "WARNING: logs still exists!" || echo "logs: deleted" && \
test -d apps/server/.git && echo "WARNING: .git still exists!" || echo ".git: deleted" && \
test -d apps/server/.github && echo "WARNING: .github still exists!" || echo ".github: deleted" && \
test -f apps/server/pnpm-lock.yaml && echo "WARNING: pnpm-lock.yaml still exists!" || echo "pnpm-lock.yaml: deleted" && \
test -f apps/server/.npmrc && echo "WARNING: .npmrc still exists!" || echo ".npmrc: deleted" && \
test -f apps/server/.gitignore && echo "WARNING: .gitignore still exists!" || echo ".gitignore: deleted"
```

**Expected output:** A clean copy of the server repo with all build artifacts, git history, and config files removed. The directory listing should show source files only: `package.json`, `apps/`, `tsconfig.json`, `src/`, etc.

---

## Quick Cleanup Command

If you prefer to run the entire cleanup as a single command:

```bash
cd /d/walnut/walnut-admin && \
rm -rf apps/server/node_modules && \
rm -rf apps/server/dist && \
rm -rf apps/server/logs && \
rm -rf apps/server/.git && \
rm -rf apps/server/.github && \
rm -rf apps/server/.claude && \
rm -rf apps/server/.data && \
rm -f apps/server/pnpm-lock.yaml && \
rm -f apps/server/.npmrc && \
rm -f apps/server/.gitignore && \
echo "Cleanup complete."
```

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| **Large `node_modules`** — If not deleted, `node_modules/` can be 500MB–1.5GB and cause `cp` to be very slow | Always delete `node_modules` immediately after copy. Use `rsync --exclude=node_modules` or verify deletion. |
| **Old git history** — `.git/` can be 100MB+ and causes nested repo issues | Delete `.git/` immediately. The original repo at `D:\walnut\walnut-admin-server\` retains its history. |
| **Symlinks** — Some `node_modules` use symlinks; `cp -r` may fail on broken symlinks | Use `rsync` or `cp -rL` to dereference symlinks. |
| **Permission errors** — Some Git Bash commands may fail on Windows with permission errors on certain files | Use `rm -rf` (force, recursive) and run Git Bash as administrator if needed. |
| **Trailing slashes** — Missing trailing slash on rsync source path creates a nested directory | Double-check the trailing `/` on rsync source paths. |

---

## Verification Checklist (Final)

Run this final check to confirm everything is in order:

```bash
cd /d/walnut/walnut-admin && \
echo "=== apps/server/ contents ===" && \
ls apps/server/ && \
echo "" && \
echo "=== Key files present ===" && \
test -f apps/server/package.json && echo "package.json: OK" || echo "package.json: MISSING" && \
test -f apps/server/tsconfig.json && echo "tsconfig.json: OK" || echo "tsconfig.json: MISSING" && \
echo "" && \
echo "=== Artifacts removed ===" && \
test ! -d apps/server/node_modules && echo "node_modules: removed" || echo "node_modules: STILL EXISTS" && \
test ! -d apps/server/dist && echo "dist: removed" || echo "dist: STILL EXISTS" && \
test ! -d apps/server/.git && echo ".git: removed" || echo ".git: STILL EXISTS"
```

## Next Step

After the server has been successfully copied, proceed to [Step 2: Copy Docs](./02-copy-docs.md).
