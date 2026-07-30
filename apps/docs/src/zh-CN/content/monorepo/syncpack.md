# Syncpack 依赖版本一致性

> 基于 [syncpack](https://github.com/JamieMason/syncpack) v15.3.2，确保 monorepo 所有 workspace 中同类依赖版本一致。

## 背景

虽然 `pnpm catalog` + `catalogMode: strict` 从声明层面统一了依赖版本，但仍有 corner case：

- **漏网之鱼**：某个 package 可能绕过 catalog 直接声明了版本号（虽被 strict mode 拦截，但历史遗留或手动误操作可能已写入 lockfile）
- **多版本幽灵**：多个 package 声明 `"catalog:"`，但若 lockfile 意外包含了多个版本，catalog 本身无法检测
- **semver range 漂移**：catalog 的精确版本约束之外，无法批量检测 semver range 是否统一

syncpack 填补了这些 gap。它和 pnpm catalog 是**互补关系**：

| 能力 | pnpm catalog | syncpack |
|------|:---:|:---:|
| 统一声明版本 | ✅ | ❌ |
| 强制版本一致性 | ✅ (strict mode) | ✅ (lint) |
| 检测版本漂移 | ❌ | ✅ |
| 批量更新版本 | ❌ | ✅ |
| 统一 semver range 格式 | ❌ | ✅ |
| 格式化 `package.json` 字段排序 | ❌ | ✅ |
| 迁移依赖到 catalog | ❌ | ✅ |

## 配置

配置文件位于仓库根目录：[`.syncpackrc.json`](https://github.com/walnut-admin/walnut-admin/blob/main/.syncpackrc.json)。

```json
{
  "versionGroups": [
    {
      "label": "Local workspace packages use workspace:* protocol",
      "dependencies": ["$LOCAL"],
      "dependencyTypes": ["!local"],
      "pinVersion": "workspace:*"
    }
  ],
  "semverGroups": [
    {
      "label": "Use exact version numbers in catalog",
      "dependencyTypes": ["pnpmCatalog"],
      "range": ""
    }
  ]
}
```

### 说明

- **`versionGroups`** — 第一条规则处理本地 `workspace:*` 协议：对所有非 local 类型的依赖（即 `dev`、`prod`、`peer` 等），如果是 `$LOCAL` 的包，不检查其版本号（因为 workspace 协议由 pnpm 管理）。
- **`semverGroups`** — 对 catalog 中的条目，要求使用精确版本号（无 `^`、`~` 等 range 前缀）。

### CLI 过滤

`pnpm-workspace.yaml` 的 `overrides` 条目由 pnpm 管理，不应纳入 syncpack 检查。脚本中通过 `--dependency-types dev,prod` 过滤：

```json
// package.json
"syncpack:lint": "syncpack lint --dependency-types dev,prod",
"syncpack:fix": "syncpack fix",
"syncpack:update": "syncpack update --dependency-types pnpmCatalog --interactive"
```

## 使用

```bash
# 检查依赖版本一致性（CI 用）
pnpm syncpack:lint

# 自动修复版本不一致
pnpm syncpack:fix

# 交互式更新 catalog 版本（上下键选包，空格选中，回车确认）
pnpm syncpack:update
```

## 与 taze 的关系

项目中同时保留了 [taze](https://github.com/antfu/taze)（`pnpm check:deps:update`）。

| | taze | syncpack |
|---|------|------|
| 核心功能 | 发现过期依赖、可视化 diff | 强制版本一致性、同步 catalog |
| 更新方式 | 交互式 visual diff，按包浏览 | 交互式/批量，按 catalog 分组 |
| pnpm catalog | 不支持 | v15 原生支持 |
| 当前用法 | `npx taze major -l` 快速扫描 | `syncpack lint` CI 门禁 + `syncpack update` 精确更新 |

两者互补：taze 是"浏览器"，快速扫描整个仓库；syncpack 是"执行器"，精确管理 catalog 并确保一致。

## 版本信息

- **最新版本**：15.3.2（2026-06-15）
- **月下载量**：~360 万
- **使用者**：AWS、Cloudflare、DataDog、Microsoft、Vercel、WordPress Gutenberg 等

## 相关文档

- [pnpm Catalog](./pnpm-catalog.md) — 集中版本管理
- [ADR 0011 - 依赖治理与发布](../adr/0011-dependency-governance-release.md) — catalog + changesets + git-cliff
