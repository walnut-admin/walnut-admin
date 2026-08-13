# 发布 & 发版指南

## 一句话版本

**按 `type(包名): message` 提交 conventional commits，发版一条命令：`pnpm release`。**

| 环节 | 谁负责 |
|------|--------|
| 版本号怎么定 | **Changesets** 根据 changeset 文件（自动生成或手写）计算 |
| CHANGELOG 怎么出 | **Changesets 自带插件**（`@changesets/changelog-github`），为每个被 bump 的包写入独立的 `CHANGELOG.md`（含 PR 链接 + 贡献者） |
| 发了什么 | 各包版本号更新 + 各包 CHANGELOG.md + git tag `vX.Y.Z` + push（分支 + tag） |

## 版本策略

monorepo 划分为 **2 个 fixed 组**，每组内部**永远同版本号**（见 [.changeset/config.json](../../../../../.changeset/config.json)）：

### Apps 组：3 个 app 同步一个版本号

| 包 | 目录 |
|----|------|
| `@walnut/admin` | apps/admin |
| `@walnut/server` | apps/server |
| `@walnut/docs` | apps/docs |

前端、后端、文档一荣俱荣——发布 tag `vX.Y.Z` 取组内版本（admin 为基准）。

### Packages 组：9 个共享包同步一个版本号

| 包 | 目录 |
|----|------|
| `@walnut/utils` | packages/platform-any/utils-core |
| `@walnut/contract` | packages/platform-any/contract |
| `@walnut/types` | packages/platform-any/types |
| `@walnut/client` | packages/platform-web/client |
| `@walnut/http` | packages/platform-web/http |
| `@walnut/ui` | packages/platform-web/ui |
| `@walnut/eslint-config` | packages/tooling/eslint-config |
| `@walnut/release` | packages/tooling/release |
| `@walnut/commitlint-config` | packages/tooling/commitlint-config |

> 2026-08-08 起 `@walnut/release`、`@walnut/commitlint-config` 也并入本组——全部 12 个 workspace 包都在两个 fixed 组内，无不参与包（消除"tooling 包独立版本"的不对称）。

### fixed 组工作原理

Changesets 的 fixed 组**只在组内包被 changeset 提及时**整组同步。auto-changeset 按 commit 的 scope 提及对应包，同组其余包自动跟随。

## 提交纪律（发版的前提）

commitlint 已强制以下格式（见 `packages/tooling/commitlint-config/`）：

**`type(包名): message`** —— scope 必填，且必须是 workspace 包名：

```
feat(admin): 添加登录页
fix(server): 修复事务回滚
feat(utils)!: 破坏性 API 变更   ← breaking 用括号后感叹号
chore(release): 更新发布脚本
revert: xxx                     ← git revert 生成，豁免 scope
```

允许的 scope（12 个 workspace 包）：

| 层 | scope |
|----|-------|
| apps | `admin` `server` `docs` |
| platform-any | `utils` `contract` `types` |
| platform-web | `client` `http` `ui` |
| tooling | `eslint-config` `commitlint-config` `release` |

scope 决定发版归属：commit 被 auto-changeset 归因到对应包 → fixed 组联动。

### bump 映射

| 前缀 | bump | 是否触发发版 |
|------|------|-------------|
| `feat` | minor | ✅ |
| `fix` / `perf` / `refactor` / `revert` | patch | ✅ |
| 破坏性变更（`type(包名)!:`） | major | ✅ |
| `docs` / `chore` / `style` / `test` / `build` / `ci` | skip | ❌ |

被过滤的噪声：`wip:`、`fixup!`、`squash!`、`tmp`、`draft`、纯数字，以及只改动非代码目录（`docs/`、`.github/`、`.vscode/`、`.changeset/`）的 commit。

**兜底**：无 scope / 未知 scope 的 commit（如 commitlint 强制前的历史提交）→ 归因到两个组代表（admin + utils），保证变更不丢失。

> 依赖升级（`chore(deps)`）默认不触发发版——刻意设计；想记录就写手动 changeset，见"场景 4"。

## 发版一次的全过程

在 main 分支、拉取最新代码后执行：

```bash
pnpm release
```

内部实际执行（`@walnut/release` 包编排，实现见 `packages/tooling/release/src/`）：

```
1. 无待消费 changeset → auto-changeset 扫描自上次 tag 以来的 commit，按 scope 归因生成 .changeset/auto-*.md（幂等，文件名 = commit hash）
2. 汇总待发布清单，展示自动检测的 bump 类型（major / minor / patch），可交互覆盖
3. pnpm changeset version → 更新各包版本号（fixed 组自动同步）+ 写入各包 CHANGELOG.md（changelog-github 渲染，含 PR 链接与贡献者）
4. git 提交 + 打 tag v{Apps 组新版本} + push 分支与 tag
```

常见退出路径（不是错误）：

| 输出 | 含义 |
|------|------|
| `没有新 commit，跳过` | 上次 tag 以来没有任何提交 |
| `没有可生成的变更记录，跳过发版` | 有提交但全部是噪声/非代码改动 |
| `版本号未变更，跳过发版` | 没有任何包被 changeset 提及 |

## 实操场景

### 场景 1：发版前端 / 场景 2：发版后端

**同一条路，都是 `pnpm release`。** scope 决定归因，fixed 组自动联动：

```bash
# 日常提交
git commit -m "feat(admin): 支持记住登录状态"    # → Apps 组
git commit -m "fix(server): 修复事务回滚"         # → Apps 组（server 被提及，admin/docs 同步）

# 发版（main 分支）：
git checkout main && git pull
pnpm release
```

结果：`@walnut/server` 的 CHANGELOG.md 记录本次 fix，admin / docs 的 CHANGELOG.md 同版本同步；纯 server 改动**不会** bump Packages 组。

### 场景 3：packages 共享包改动

```bash
git commit -m "feat(utils): 新增 xx 工具函数"     # → Packages 组 7 包同步
pnpm release
```

改动共享包时，同组 7 包同步 bump；消费方（apps）由 `updateInternalDependencies: patch` 联动。

### 场景 4：依赖相关

| 情况 | 行为 |
|------|------|
| 升级已有依赖（`chore(admin): upgrade vue`） | skip —— 不触发发版 |
| 新增依赖（`feat(admin): 引入 xxx`） | 按前缀正常触发 |
| 依赖升级想写进 CHANGELOG | 手动 `pnpm changeset add` 提及对应包 |
| 共享包升级 → 消费者联动 | `updateInternalDependencies: patch` 自动处理 |

手动 changeset 示例（`.changeset/xxx.md`，支持同时提及多个包）：

```markdown
---
"@walnut/server": patch
---

修复数据库事务回滚
```

## 关键配置

### .changeset/config.json

```jsonc
{
  "fixed": [
    [ "@walnut/utils", "@walnut/contract", "@walnut/types", "@walnut/client",
      "@walnut/commitlint-config", "@walnut/http", "@walnut/ui",
      "@walnut/release", "@walnut/eslint-config" ],  // Packages 组（9 包）
    [ "@walnut/admin", "@walnut/server", "@walnut/docs" ]  // Apps 组（3 包）
  ],
  "changelog": "@changesets/changelog-github",  // per-package CHANGELOG：PR 链接 + 贡献者
  "commit": false,            // 不让 CLI 自动 commit（release 编排统一处理）
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch"  // 依赖升级 → 消费者至少 patch bump
}
```

### changelog-github 插件

- 每个被 bump 的包写入自己的 `CHANGELOG.md`（`apps/admin/CHANGELOG.md`、`packages/platform-any/utils-core/CHANGELOG.md`…）
- 条目带 **PR 链接与贡献者**（通过 GitHub API 关联 commit → PR）
- 前提：各包 `package.json` 的 `repository` 字段指向本仓库（已统一为 `github.com/walnut-admin/walnut-admin`）
- 建议：本地发版时配置 `GITHUB_TOKEN`（避免 GitHub API 限流导致 PR 信息缺失）

## 没做什么 / 为什么

### 不用 git-cliff（已移除）

早期方案用 git-cliff 从 git history 渲染**单份根级 CHANGELOG.md**。现改为 Changesets 原生 per-package CHANGELOG——每个包独立记录自己的变更历史，这是 JS/TS monorepo 的主流做法（Changesets 的标准设计）。根级 CHANGELOG 不再生成；2026 年的新趋势是在 per-package 之上**可选**叠加根级聚合总览，当前不需要，后续要时可再引入。

### 不用 semantic-release

semantic-release 从 commit message **自动推断** semver bump 类型。Changesets 让开发者**确认** bump 类型——更可控，避免一条 commit message 的格式错误触发错误的版本号。

### 不发布到 npm

`"access": "public"` 代表代码公开可见（public repo），不代表实际发布。当前是内部 monorepo，通过 `workspace:*` 消费。未来若发布 npm，per-package CHANGELOG 即是最佳实践（包页面可直接展示）。

## 常见问题

| 问题 | 处理 |
|------|------|
| 不在 main 分支跑 release | 直接拒绝：`❌ 只能在 main 分支执行发版` |
| 上次 push 失败 | 重跑 `pnpm release` 即可，自动检测"本地有 tag、远端没有、无待消费 changeset"并恢复推送 |
| 想确认哪些 commit 会被发版 | 看 `.changeset/` 下生成的 `auto-*.md` 文件 |
| commit 被 commitlint 拒绝 | 检查格式 `type(包名): message`，scope 必须是 12 个包名之一 |
| 想手动创建 changeset | `pnpm changeset add` 或手写 `.changeset/xxx.md` |

## 相关 ADR

- [ADR-0011: Dependency Governance & Release Pipeline](/content/adr/0011-dependency-governance-release.md)
- [ADR-0008: Unified Versioning, Separate Deploy](/content/adr/0008-unified-versioning-separate-deploy.md)
