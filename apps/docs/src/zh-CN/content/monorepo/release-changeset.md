# Release & Changeset

## 概述

Walnut Admin 使用 **Changesets** 管理 monorepo 的多包版本号，配合 `git-cliff` 生成 CHANGELOG。版本策略是 **7 个共享包 fixed 组（同步版本） + 3 个 app 独立版本**。

## 我们做了什么

### 1. 一步式发布流程

发布编排在 `@walnut/release` 包（`packages/tooling/release/`），root 仅暴露两个脚本：

```
pnpm release     # 完整发布：auto-changeset → changeset version → git-cliff changelog → git tag → git push
pnpm changelog   # 仅用 git-cliff 生成 CHANGELOG.md（手动场景）
```

`pnpm release` 内部流程（仅 main 分支可执行）：

```
1. 无待消费 changeset？→ 自动从 git commit 生成（walnut-auto-changeset）
2. 交互式确认 bump 类型（自动检测 major/minor/patch，可覆盖）
3. changeset version → 消费 changeset，更新 package.json 版本号
4. git-cliff 生成 CHANGELOG.md（调用 pnpm changelog）
5. git tag + git push（含上次 push 失败的自动恢复）
```

开发者不需要手动运行 changeset 相关命令——只需保持 conventional commit 格式，release 一步到位。

### 2. Fixed Group（共享包同步版本）

[`.changeset/config.json`](https://github.com/walnut-admin/walnut-admin-client/blob/main/.changeset/config.json)：

```jsonc
{
  "fixed": [[
    "@walnut/utils",
    "@walnut/contract",
    "@walnut/types",
    "@walnut/client",
    "@walnut/http",
    "@walnut/ui",
    "@walnut/eslint-config"
  ]],
  "changelog": false,         // 不用 Changesets 自带的 changelog（用 git-cliff）
  "commit": false,            // 不让 CLI 自动 commit
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch"  // 依赖升级 → 消费者至少 patch bump
}
```

**7 个共享包永远同版本号**。为什么？
- `@walnut/contract` 的类型变更会影响所有消费者
- `@walnut/utils` 被前后端同时依赖
- 它们是紧密耦合的一组——"一荣俱荣，一损俱损"

**3 个 app 独立版本**。为什么？
- `apps/admin` UI 变更不关 `apps/server` 的事
- `apps/docs` 文档更新不影响 `apps/server`
- 各自有独立的 release cycle

### 3. 自动 changeset 生成

[`packages/tooling/release/src/auto-changeset.ts`](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/tooling/release/src/auto-changeset.ts) 从 conventional commits 自动生成 changeset 文件（扫描自上次 tag 以来的 commits，过滤噪声/非代码改动，按 bump 映射生成 `.changeset/auto-*.md`）：

```bash
pnpm exec walnut-auto-changeset   # 独立执行（release 内部已自动调用）
```

### 4. 脚本归属

| 脚本 | 位置 |
|------|------|
| `release` / `changelog` | root package.json（调 `@walnut/release` bin） |
| `auto-changeset` / `release` 编排 | `packages/tooling/release/src/`（tsx bin wrapper） |

## 没做什么 / 为什么

### 不用 Changesets 自带的 changelog

Changesets 的默认 changelog 格式较简单（仅显示 changeset 摘要 + commit hash）。`git-cliff` 可以按 conventional commit 类型分组、带 emoji、显示 scope 和 PR 链接——格式更丰富。两者各司其职：Changesets 管版本号，git-cliff 管 changelog 格式。

### 不用 semantic-release

semantic-release 从 commit message **自动推断** semver bump 类型（`fix:` → patch, `feat:` → minor）。Changesets 让开发者**手动确认** bump 类型——更可控，避免一条 commit message 的格式错误触发错误的版本号。

### 不发布到 npm

所有包 `private: true` 移除后设为 `"access": "public"`——但这代表代码公开可见（public repo），不代表实际发布到 npm。当前是内部 monorepo，通过 `workspace:*` 消费。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [.changeset/config.json](https://github.com/walnut-admin/walnut-admin-client/blob/main/.changeset/config.json) | Changeset 配置：fixed group、access、changelog |
| [packages/tooling/release/src/auto-changeset.ts](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/tooling/release/src/auto-changeset.ts) | 从 conventional commits 自动生成 changeset |
| [packages/tooling/release/src/release.ts](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/tooling/release/src/release.ts) | 发布流水线编排 |
| [packages/tooling/commitlint-config/index.mjs](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/tooling/commitlint-config/index.mjs) | commitlint 规则（type-enum），root config extends 消费 |

## 相关 ADR

- [ADR-0011: Dependency Governance & Release Pipeline](/content/adr/0011-dependency-governance-release.md)
- [ADR-0008: Unified Versioning, Separate Deploy](/content/adr/0008-unified-versioning-separate-deploy.md)
