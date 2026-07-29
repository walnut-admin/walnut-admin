# 版本管理与发布日志

> 大型 monorepo 的版本管理是一个**精确的协调问题**：多个包独立迭代但互有依赖，changelog 不能靠人工手写，发布流程不能靠记忆操作。本文档覆盖 **Changesets** 驱动的版本管理与发布体系——这是 2024-2026 年 TypeScript monorepo 的事实标准。

---

## 1. Changesets 概述

### 1.1 为什么是 Changesets

[Changesets](https://github.com/changesets/changesets) 由 Atlassian 创建，被 **Astro、SvelteKit、Emotion、Apollo Client、tRPC** 等大型项目采用。

核心哲学：**版本声明是显式的、贡献者驱动的 artifact**（`.changeset/*.md` 文件），不依赖 commit message 自动推断。

相比 `semantic-release`：
- semantic-release 从 commit message 推断 semver bump —— 依赖 commit 规范完美执行
- Changesets 让开发者手动选择 bump 类型 —— 更可控、更准确

### 1.2 三段式工作流

```
开发者创建 changeset → CI 收集 changesets → CI 版本化 + 发布
    (手动)              (Version Packages PR)     (自动，merge PR 后触发)
```

```
# Phase 1: 开发时——创建 changeset
pnpm changeset
# → 选择受影响的包（空格选中）
# → 选择 bump 类型（major / minor / patch）
# → 写一句人类可读的 changelog 摘要

# Phase 2: CI 自动——收集 changeset 并创建 PR
# 当包含 .changeset/*.md 的 PR merge 到 main 时，
# changesets/action 自动创建 "Version Packages" PR

# Phase 3: Review & Merge——发布
# Review the "Version Packages" PR → merge it
# CI 自动发布到 npm + 创建 git tags
```

---

## 2. 安装与配置

### 2.1 安装

```bash
pnpm add -D @changesets/cli
pnpm changeset init
```

这会创建 `.changeset/` 目录：

```
.changeset/
├── config.json        ← 配置文件
├── README.md          ← 给团队看的 changeset 指南
└── *.md               ← 每次 pnpm changeset 产生的文件（临时）
```

### 2.2 配置文件

```jsonc
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@3/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,                  // 不让 CLI 自动 commit（CI 负责）
  "fixed": [],                      // 不锁定版本关联
  "linked": [],                     // 不关联版本
  "access": "restricted",           // 私有包用 restricted，公开包用 public
  "baseBranch": "main",
  "updateInternalDependencies": "patch",  // 依赖升级 → 至少一个 patch bump
  "ignore": [
    "@walnut/docs"                  // 不需要版本管理的包
  ]
}
```

---

## 3. 版本策略决策：Fixed vs Independent vs Linked

### 3.1 三种模式

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| **Fixed** | 组内包永远同版本号 | 像 Babel 那样的 tightly coupled SDK |
| **Independent** | 每个包自己管自己 | 大多数 monorepo（**推荐**） |
| **Linked** | 有变更时组内包同版本号 | 部分关联但非强制同版 |

### 3.2 决策树

```
这些包总是同时 release 吗（一荣俱荣、一损俱损）？
├── 是 → Fixed
└── 否 → 它们之间有明确的 semver 独立演进需求吗？
          ├── 是 → Independent
          └── 否 → Linked
```

### 3.3 Walnut Admin 的实际情况

Walnut Admin 的内部 package **不发布到 npm**（`"private": true`）。它们只在 monorepo 内部消费。因此：

- **不需要 npm publishing**（`access: "restricted"` 即可）
- **但需要版本号**——用于 CHANGELOG 和 git tag
- **策略**：Independent 模式，每个 package 独立版本号
- **app 是否需要版本号**：需要——用于部署追踪。每次部署一个 app 时，该 app 的版本号 bump，CHANGELOG 记录此版本的变更

```jsonc
{
  "fixed": [],
  "linked": [],
  // ^ 两者都留空 = Independent
  "ignore": [
    "@walnut/docs"     // 文档站不需要版本追踪
  ]
}
```

---

## 4. Changelog 生成

### 4.1 默认 changelog 格式

默认的 `@changesets/cli/changelog` 生成如下格式：

```markdown
# @walnut/utils

## 1.2.0

### Minor Changes

- a1b2c3d: Added `deepMerge` utility for recursive object merging
- e4f5g6h: Added `Queue` class with configurable capacity
```

### 4.2 自定义 changelog（配合 git-cliff）

[git-cliff](https://git-cliff.org/) 是一个高度可定制的 changelog 生成器，可以从 conventional commits 生成更丰富的 changelog（包含作者、PR 链接、分类等）。

**Walnut Admin 的 ADR-0011 采用的方案**是 Changesets（版本号管理）+ git-cliff（changelog 格式化）：

```bash
pnpm add -D git-cliff
```

```toml
# cliff.toml
[changelog]
header = "# Changelog\n\n"
body = """
## {{ version }}

{% for group, commits in commits | group_by(attribute="group") %}
### {{ group | upper_first }}
{% for commit in commits %}
- {{ commit.message | split(pat="\n") | first }} ({{ commit.id | truncate(length=7) }})
{%- endfor %}
{% endfor %}
"""
footer = ""
trim = true

[git]
conventional_commits = true
filter_unconventional = false
commit_parsers = [
  { message = "^feat", group = "Features" },
  { message = "^fix", group = "Bug Fixes" },
  { message = "^docs", group = "Documentation" },
  { message = "^refactor", group = "Refactoring" },
  { message = "^perf", group = "Performance" },
  { message = "^test", group = "Testing" },
  { message = "^chore", group = "Miscellaneous" },
  { message = "^ci", group = "CI/CD" },
  { message = "^build", group = "Build System" },
]
```

```bash
# 生成 changelog
pnpm git-cliff --output CHANGELOG.md
```

### 4.3 Changeset 摘要该怎么写

```
✅ Good（用户视角）:
Added `useFetch` hook for data fetching with automatic retry, loading
states, and error handling.

✅ Good（开发者视角但有上下文）:
Fixed memory leak in `Queue` when calling `dequeue` on an empty queue
with observers attached.

❌ Bad:
updated code

❌ Bad:
fixed bug
```

**原则**：读者（其他开发者、reviewer）能从这一句话理解变更的本质，不需要翻 commit history。

---

## 5. CI 自动化发布

### 5.1 GitHub Actions 完整 Workflow

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      contents: write           # 创建 tag + commit
      pull-requests: write      # 创建 Version Packages PR
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Create Release PR or Publish
        id: changesets
        uses: changesets/action@v1
        with:
          version: pnpm changeset version
          publish: pnpm changeset publish
          commit: "chore: version packages"
          title: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

      # 可选：发布后生成 changelog
      - name: Generate Changelog
        if: steps.changesets.outputs.published == 'true'
        run: pnpm git-cliff --output CHANGELOG.md

      # 可选：创建 GitHub Release
      - name: Create GitHub Release
        if: steps.changesets.outputs.published == 'true'
        uses: softprops/action-gh-release@v2
        with:
          body_path: CHANGELOG.md
          tag_name: v${{ steps.changesets.outputs.publishedPackages[0].version }}
```

### 5.2 工作流时序

```
Day 1: Developer creates feature PR
  ├── Feature code changes
  ├── pnpm changeset → creates .changeset/silly-cats-fly.md
  └── Push to PR branch

Day 2: PR is reviewed and merged to main
  ├── CI (release.yml) detects .changeset/silly-cats-fly.md
  ├── Bot opens "Version Packages" PR
  │   ├── @walnut/utils: 1.1.0 → 1.2.0
  │   └── CHANGELOG updated
  └── Team reviews this PR

Day 3: "Version Packages" PR is merged
  ├── CI publishes @walnut/utils@1.2.0
  ├── git tag @walnut/utils@1.2.0 is created
  └── CHANGELOG.md is committed
```

### 5.3 什么时候创建 changeset

| 创建 changeset | 不创建 changeset |
|---------------|-----------------|
| 新功能 / API | 纯文档修改 |
| Bug fix | 测试增删 |
| Breaking change | 构建配置调整 |
| 行为变化（即使 API 没变） | devDependencies 更新 |
| | 内部注释、typo fix |

---

## 6. 处理内部依赖升级

### 6.1 自动级联 bump

当 `@walnut/utils` 从 `1.1.0` bump 到 `1.2.0` 时，依赖它的 `@walnut/client` 应该至少得到 patch bump（因为它的依赖变了）。

```jsonc
// .changeset/config.json
{
  "updateInternalDependencies": "patch"   // 依赖升级 → 至少一个 patch
}
```

Changesets 会自动处理：
1. 开发者只为 `@walnut/utils` 创建 changeset
2. `changeset version` 执行时自动给 `@walnut/client` 加一个 patch bump
3. `@walnut/client` 的 CHANGELOG 会自动加入 "Updated dependencies" 条目

### 6.2 workspace 协议

```jsonc
// @walnut/client 的 package.json
{
  "dependencies": {
    "@walnut/utils": "workspace:*"   // 开发时 symlink
  }
}
```

发布时 `workspace:*` 自动替换为实际版本号。如果 `@walnut/utils` 发布为 `1.2.0`，那么发布的 `@walnut/client` 中 `@walnut/utils` 的版本写为 `^1.2.0`。

---

## 7. Pre-release 管理

### 7.1 进入 pre-release 模式

```bash
# 进入 pre-release 模式
pnpm changeset pre enter beta

# 正常创建 changesets
pnpm changeset

# 版本化（会生成 1.2.0-beta.0）
pnpm changeset version

# 发布到 beta dist-tag
pnpm changeset publish --tag beta

# 退出 pre-release 模式
pnpm changeset pre exit
```

### 7.2 注意事项

- Pre-release 版本**不会**被 `npm install` 默认安装（除非用户指定 `@walnut/utils@beta`）
- 退出 pre-release 模式后，下次正常 release 会从进入前的版本号继续
- **谨慎操作**：pre-release 的退出逻辑有已知边缘情况。建议在正式使用前先在测试仓库演练

### 7.3 Canary / Snapshot 版本

```jsonc
// .changeset/config.json
{
  "snapshot": {
    "useCalculatedVersion": true,
    "prereleaseTemplate": "{tag}-{commit}"
  }
}
```

```bash
# 从 feature branch 发布 canary 版本
pnpm changeset version --snapshot canary
pnpm changeset publish --tag canary --no-git-tag
```

结果：`0.3.5-canary-a1b2c3d` —— 用于在 merge 之前在 staging 环境测试。

---

## 8. Changeset Bot

安装 [Changeset Bot GitHub App](https://github.com/apps/changeset-bot)：

- 当 PR 中没有 changeset 文件时，bot 自动评论提醒
- 当 PR 中有 changeset 文件时，bot 评论显示版本变更预览
- 轻量级强制：不 block merge，只是提醒

这解决了"开发者忘记创建 changeset → release 时版本号没跟进"的问题。

---

## 9. 版本号规范（SemVer）

### 9.1 标准规则

| Bump | 何时使用 | 示例 |
|------|---------|------|
| **major** | Breaking change | 删公开 API、改函数签名、改返回值类型 |
| **minor** | 新功能，向后兼容 | 新增 `Queue.clear()` 方法 |
| **patch** | Bug fix，30 | 修复 `Queue.dequeue()` 空队列未 throw |

### 9.2 初始版本

```bash
# 从 0.x 开始（pre-1.0）
版本: 0.1.0 → 0.2.0 → ... → 0.9.0 → 1.0.0

# 1.0.0 的语义：API 稳定，准备用于生产
```

内部 package（不发布 npm）可以更灵活。但遵循 SemVer 仍然有价值——团队成员看到 `2.0.0` 就知道有 breaking change。

---

## 10. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 差距 |
|---------|-------------------|------|
| Changesets 版本管理 | ✅ ADR-0011 已决定 | 已配置 |
| git-cliff changelog | ✅ ADR-0011 已决定 | 已配置 |
| Independent 版本模式 | ✅ 无 fixed/linked 声明 | 符合 |
| CI 自动化 release workflow | ❌ release.yml 尚未实现 | 待实现 |
| Changeset Bot | ❌ 未安装 | 推荐安装 |
| `updateInternalDependencies: "patch"` | ❓ 待确认 config 细节 | 检查 `.changeset/config.json` |
| 初始版本策略 | ✅ 当前 `0.0.0` | 符合 pre-1.0 阶段 |

---

## 11. 检清单：新仓库接入 Changesets

```bash
# 1. 安装
pnpm add -D @changesets/cli
pnpm changeset init

# 2. 配置 .changeset/config.json
#    设置 baseBranch、access、updateInternalDependencies

# 3. 创建初始 changeset
pnpm changeset
#    选择所有需要初始版本的包
#    major bump → 设为 1.0.0（或 0.1.0）

# 4. 执行一次版本化
pnpm changeset version

# 5. 提交生成的 CHANGELOG 和版本号

# 6. 配置 CI（release.yml）

# 7. 安装 Changeset Bot（可选但推荐）
```
