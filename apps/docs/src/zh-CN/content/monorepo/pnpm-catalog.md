# pnpm Catalog

## 概述

Walnut Admin 使用 **pnpm catalog + `catalogMode: strict`** 集中管理所有外部依赖版本。260+ 个依赖包的版本号在 `pnpm-workspace.yaml` 的 `catalog:` 段落中统一定义，所有 `package.json` 只能写 `"catalog:"` 引用，不允许直接写版本号。

## 我们做了什么

### 1. 启用 `catalogMode: strict`

```yaml
# pnpm-workspace.yaml
catalogMode: strict
```

这是 pnpm 10.12+ 的原生强制机制。如果任何 `package.json` 中写了直接版本号（如 `"vue": "^3.5.34"`）而非 `"catalog:"`，`pnpm install` 会直接报错失败。

**收益**：
- **版本漂移零容忍** —— 不允许 `pnpm add` 不带 `--save-catalog` 引入新依赖
- **运行时强制** —— 比 ESLint 规则更强，不依赖开发者记得这条规范
- **一行配置** —— 零维护成本

### 2. 版本锁死为精确版本

```yaml
catalog:
  vue: 3.5.34          # ✅ 精确，没有 ^ 或 ~
  typescript: 6.0.3    # ✅ 精确
```

**不允许**使用 semver range（`^`、`~`、`>=`）。所有依赖版本精确锁死，确保所有环境（开发机、CI、部署）安装到完全相同的版本。

### 3. 内部包使用 `workspace:*` 协议

```jsonc
// apps/admin/package.json
{
  "dependencies": {
    "@walnut/contract": "workspace:*",  // pnpm workspace 内部包
    "@walnut/utils": "workspace:*",
    "vue": "catalog:"                   // 外部包走 catalog
  }
}
```

`workspace:*` 在开发时通过 pnpm symlink 指向本地包，发布时自动替换为实际版本号。`catalog:` 用于外部 npm 包。

### 4. 与 Dependabot/Renovate 配合

将 `pnpm-workspace.yaml` 加入 Dependabot 的监控范围后，catalog 依赖更新可以**一键提 PR**——改一行 catalog，所有包同步到位。不再需要跑 N 个 package.json 逐个改版本号。

## 没做什么 / 为什么

### 不把所有依赖都塞进 catalog

只把**多个 package 共用的依赖**放入 catalog。单个 app 独有的依赖（如 `app/sever` 专用的某个 NestJS module）直接声明在对应 `package.json` 中即可。catalog 的本质是**共享版本的集中治理**，过度集中化反而增加维护噪音。

### 不用 Named Catalogs

pnpm 的 named catalogs（`catalogs:` 而非 `catalog:`）支持分组管理——比如 `catalogs.legacy` 和 `catalogs.modern` 各自锁定不同版本。Walnut Admin 不需要——所有包的依赖版本完全统一，没有"部分包用旧版"的场景。

---

## 关键配置

```yaml
# pnpm-workspace.yaml（精简示例）
packages:
  - 'apps/*'
  - 'packages/*'

catalogMode: strict

catalog:
  vue: 3.5.34
  typescript: 6.0.3
  eslint: 10.3.0
  turbo: 2.9.14
  # ... 260+ 条目
```

## 添加新依赖的流程

```bash
# 1. 查最新精确版本
npm view <包名> version

# 2. 编辑 pnpm-workspace.yaml，在 catalog 段按字母序插入
#    '新包名': 1.2.3

# 3. 在目标 package.json 中引用
#    "新包名": "catalog:"

# 4. 安装
pnpm install
```

---

## 相关 ADR

- [ADR-0011: Dependency Governance & Release Pipeline](/content/adr/0011-dependency-governance-release.md)
- [ADR-0012: Frontend-Backend Toolchain Divergence](/content/adr/0012-toolchain-divergence.md)（Decision 5: Strict Hoisting）
