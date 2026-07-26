# Step 0: Prerequisites

Before beginning the migration, verify that your environment meets all requirements and the repository is in a clean state.

## Prerequisites Checklist

- [ ] 1. Node.js version >= 24.13.0
- [ ] 2. pnpm version >= 11.0.0 (11.13.0 recommended)
- [ ] 3. Current repo (`walnut-admin-client`) is on `main` branch
- [ ] 4. Current repo has a clean working tree (no uncommitted changes)
- [ ] 5. Source server repo exists at `D:\walnut\walnut-admin-server\`
- [ ] 6. Source docs repo exists at `D:\walnut\walnut-admin-doc\`
- [ ] 7. Target directory `D:\walnut\walnut-admin\` exists and is accessible
- [ ] 8. At least 2 GB free disk space
- [ ] 9. Git Bash or WSL available for bash commands
- [ ] 10. `cp` and `rsync` commands available (for file copy operations)

---

## 1. Check Node.js Version

Node.js >= 24.13.0 is required. Run:

```bash
node -v
```

**Expected output:** `v24.13.0` or higher.

If your version is lower, upgrade Node.js from [nodejs.org](https://nodejs.org/) or use a version manager like `nvm`:

```bash
# Using nvm (if installed)
nvm install 24.13.0
nvm use 24.13.0
```

> **Why this version?** TypeScript 6.0.3 and the project's toolchain require modern Node.js features. The monorepo setup with pnpm 11 and Turbo 2 also benefits from the latest Node.js performance improvements.

---

## 2. Check pnpm Version

pnpm >= 11.0.0 is required (11.13.0 is the target). Run:

```bash
pnpm -v
```

**Expected output:** `11.13.0` or higher (but at least `11.0.0`).

If your version is lower, install or update pnpm:

```bash
# Install latest pnpm
npm install -g pnpm@latest

# Or install a specific version
npm install -g pnpm@11.13.0
```

After updating, verify again:

```bash
pnpm -v
```

> **Why pnpm 11?** pnpm 11 introduces improved workspace protocol support and performance enhancements that Turbo 2.4.0 relies on. The project's `pnpm-lock.yaml` format also requires pnpm 11.

---

## 3. Verify Current Branch

You must be on the `main` branch of `walnut-admin-client` before starting:

```bash
cd /d/walnut/walnut-admin-client
git branch --show-current
```

**Expected output:** `main`

If you are not on `main`:

```bash
git checkout main
```

> **Why main?** The monorepo migration starts from a stable, known-good state. Feature branches may have incomplete or experimental changes that would complicate the migration.

---

## 4. Verify Clean Working Tree

There must be no uncommitted changes in `walnut-admin-client`:

```bash
cd /d/walnut/walnut-admin-client
git status --porcelain
```

**Expected output:** (empty — no output)

If there are uncommitted changes:

```bash
# Option A: Commit the changes
git add -A
git commit -m "chore: save work before monorepo migration"

# Option B: Stash the changes
git stash push -m "work before monorepo migration"

# Option C: Discard the changes (careful — irreversible)
git reset --hard HEAD
git clean -fd
```

> **Why a clean tree?** The copy operation in subsequent steps reads from the current working tree. Uncommitted changes could be lost if not properly tracked, or could introduce inconsistencies.

---

## 5. Verify Server Repository Exists

The NestJS backend source must be present at `D:\walnut\walnut-admin-server\`:

```bash
ls -la /d/walnut/walnut-admin-server/
```

**Expected output:** Directory listing showing the server repo contents (package.json, apps/, src/, etc.)

If the directory does not exist or is empty, clone the server repository:

```bash
git clone https://github.com/walnut-admin/walnut-admin-server.git /d/walnut/walnut-admin-server
```

Or check that the path is correct — it may be at a different location.

> **Why verify this?** Step 1 (`01-copy-server.md`) copies from this directory. If it doesn't exist or is incomplete, the copy will fail or produce a broken result.

---

## 6. Verify Docs Repository Exists

The Vitepress docs source must be present at `D:\walnut\walnut-admin-doc\`:

```bash
ls -la /d/walnut/walnut-admin-doc/
```

**Expected output:** Directory listing showing the docs repo contents (package.json, src/, .vitepress/, etc.)

If the directory does not exist:

```bash
git clone https://github.com/walnut-admin/walnut-admin-doc.git /d/walnut/walnut-admin-doc
```

> **Why verify this?** Step 2 (`02-copy-docs.md`) copies from this directory.

---

## 7. Verify Target Directory Exists

The target monorepo directory must exist and be accessible:

```bash
ls -la /d/walnut/walnut-admin/
```

**Expected output:** Directory listing (may be empty or contain the `migration-guide/` directory).

If the directory does not exist, create it:

```bash
mkdir -p /d/walnut/walnut-admin
```

> **Why check this?** All migration steps write into this directory. If it doesn't exist, file copy commands will fail.

---

## 8. Check Disk Space

Ensure at least 2 GB of free disk space:

```bash
df -h /d/walnut/ | tail -1
```

On Windows/Git Bash, check using:

```bash
df -h /d/ | tail -1
```

**Expected output:** Available space > 2 GB.

Each repository has significant `node_modules` and build artifacts. The migration copies all three repos, though we will delete most heavy artifacts (`node_modules`, `dist`, `logs`) immediately after copying.

> **Why 2 GB?** The server repo's `node_modules` can exceed 1 GB alone. The docs repo adds another 200+ MB. With source files and overhead, 2 GB provides a comfortable buffer.

---

## 9. Verify Bash Tools

The copy steps use `cp` and `rsync` via Git Bash. Verify they are available:

```bash
which cp
which rsync 2>/dev/null || echo "rsync not found, will use cp -r instead"
```

**Expected output:** Paths to `cp` and optionally `rsync`.

If `rsync` is not available, the guides fall back to `cp -r`. Both approaches work; `rsync` is faster for large directories and allows progress monitoring.

---

## 10. Verify Git User Configuration

Ensure git user is configured (needed for any commits in the monorepo):

```bash
git config --global user.name
git config --global user.email
```

**Expected output:** Your name and email. If not set:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## One-Time Setup (Optional)

If you plan to initialize a new git repository for the monorepo (recommended), ensure `gh` (GitHub CLI) is available:

```bash
gh --version
```

---

## Summary Verification Command

Run all checks at once with this script:

```bash
echo "=== Node $(node -v) ===" && \
echo "=== pnpm $(pnpm -v) ===" && \
echo "=== Git user: $(git config --global user.name) <$(git config --global user.email)> ===" && \
echo "=== Branch: $(cd /d/walnut/walnut-admin-client && git branch --show-current) ===" && \
echo "=== Clean: $(cd /d/walnut/walnut-admin-client && git status --porcelain | wc -l) uncommitted files ===" && \
echo "=== Server repo: $(test -d /d/walnut/walnut-admin-server && echo 'EXISTS' || echo 'MISSING') ===" && \
echo "=== Docs repo: $(test -d /d/walnut/walnut-admin-doc && echo 'EXISTS' || echo 'MISSING') ===" && \
echo "=== Target dir: $(test -d /d/walnut/walnut-admin && echo 'EXISTS' || echo 'MISSING') ==="
```

## Next Step

Once all prerequisites are satisfied, proceed to [Step 1: Copy Server](./01-copy-server.md).
