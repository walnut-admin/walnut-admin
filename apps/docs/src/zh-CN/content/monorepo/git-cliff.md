# Git-cliff

## 概述

Walnut Admin 使用 [git-cliff](https://git-cliff.org/) 从 conventional commits 生成 CHANGELOG。它与 Changesets 协作——Changesets 管理版本号，git-cliff 负责把 git history 渲染成人类可读的变更日志。

## 我们做了什么

### 1. Conventional Commits 分组

[`cliff.toml`](https://github.com/walnut-admin/walnut-admin-client/blob/main/cliff.toml) 按 commit type 自动分组：

| commit type | CHANGELOG 分组 |
|-------------|---------------|
| `feat:` | ✨ Features |
| `fix:` | 🐛 Bug Fixes |
| `perf:` | ⚡ Performance |
| `refactor:` | ♻️ Refactor |
| `docs:` | 📝 Documentation |
| `style:` | 🎨 Styling |
| `test:` | ✅ Testing |
| `build:` | 📦 Build |
| `ci:` | 🤖 CI |
| `chore:` | 🔧 Chores |

每条 changelog 条目自动带上 commit hash 链接：

```markdown
### ✨ Features

- **contract:** migrate token types to contract, add API route constants
  ([10e2a7a](https://github.com/Zhaocl1997/walnut-admin/commit/10e2a7a))
```

### 2. 命令

```bash
# 生成完整 CHANGELOG.md
pnpm changelog          # → git-cliff -o CHANGELOG.md

# 预览自上次 tag 以来的未发布变更
pnpm changelog:preview  # → git-cliff --unreleased
```

### 3. 发布流程中的位置

```
pnpm release
  ├── auto-changeset.ts     → 生成 .changeset/*.md
  ├── changeset version      → 更新 package.json 版本号
  ├── git-cliff changelog    → 生成 CHANGELOG.md  ← git-cliff
  ├── git tag                → 打 tag
  └── git push               → 推送
```

git-cliff 在 Changesets **版本号落地之后**、git tag **之前**运行——确保 CHANGELOG.md 中的版本号与 `package.json` 一致。

## 没做什么 / 为什么

### 不生成 per-package CHANGELOG

有些 monorepo 为每个 package 单独生成 `packages/xxx/CHANGELOG.md`。Walnut Admin 共享包使用 fixed group（同版本号），一份仓库级 CHANGELOG 已经够用。如果未来包各自独立发版，再考虑拆分。

### 不用 `--bump` 自动打版本号

git-cliff 的 `--bump` 功能可以自动实现 semver bump——但我们用 Changesets 做版本号管理（更精确的多包协调），git-cliff 只管 changelog 渲染。各司其职。

---

## 关键配置

完整配置见 [`cliff.toml`](https://github.com/walnut-admin/walnut-admin-client/blob/main/cliff.toml)。核心参数：

```toml
[git]
conventional_commits = true          # 按 conventional commits 解析
commit_url = "https://github.com/..." # commit hash 可点击

[changelog]
body = """
{% for group, commits in commits | group_by(attribute="group") %}
    ### {{ group }}
    {% for commit in commits %}
        - {{ commit.message }}\
          ([{{ commit.id | truncate(length=7) }}]({{ commit.commit_url }}))
    {% endfor %}
{% endfor %}
"""
```

## 相关 ADR

- [ADR-0011: Dependency Governance & Release Pipeline](/content/adr/0011-dependency-governance-release.md)
