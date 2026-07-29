---
name: dependency-management
description: >
  本项目通过 pnpm catalog + catalogMode strict 统一管理所有依赖版本。当你需要安装、
  升级、或添加任何 npm 依赖时，必须遵循 catalog 两步流程，且版本号必须精确锁死。
  只要你提到"安装"、"添加依赖"、"升级"、"加个包"、"install"、"add dep"、或者
  在代码中 import 了一个项目里还没有的包，都应该触发这个 skill。
---

# 依赖管理

## 核心约束

本项目使用 **pnpm catalog + `catalogMode: strict`** 管理所有依赖。有两个硬性规则：

1. **所有版本必须精确锁死** — 不允许 `^`、`~`、`>=`、`*` 等任何范围符号，只能写精确版本号如 `1.2.3`
2. **所有依赖必须走 catalog** — `package.json` 里只能写 `"catalog:"`，不能直接写版本号

违反任何一条，`pnpm install` 都会失败。

## 添加依赖的流程

### 第 1 步：查最新版本

```bash
npm view <包名> version
# 或
pnpm view <包名> version
```

拿到精确版本号，比如 `3.5.34`。

### 第 2 步：添加到 catalog

编辑 `pnpm-workspace.yaml`，在 `catalog:` 段落里按字母顺序插入：

```yaml
catalog:
  # ... 已有的包 ...
  '新包名': 3.5.34    # ← 精确版本，没有 ^ 或 ~
```

注意：
- 包名加引号 — `'@scope/name': 1.0.0`
- 版本号不加引号 — `vue: 3.5.34`
- 按字母顺序插入，保持文件整洁

### 第 3 步：添加到目标 package.json

确定要加到哪个 `package.json`：

| 场景 | 目标文件 |
|------|----------|
| 工具链相关（eslint、typescript、turbo 等） | 根 `package.json` → `devDependencies` |
| 某个 app 自己的依赖 | `apps/<app>/package.json` |
| 某个 shared package 的依赖 | `packages/<pkg>/package.json` |
| 多个 app/package 共用 | 放到各自使用的 package 的 `package.json` 里 |

在对应文件中写 `"catalog:"`：

```json
{
  "dependencies": {
    "新包名": "catalog:"
  }
}
```

**不要**写 `"新包名": "^3.5.34"` — strict mode 会直接拒绝。

### 第 4 步：安装

```bash
pnpm install
```

## 判断依赖类型

- `dependencies` — 运行时需要的包（vue、axios、mongoose 等）
- `devDependencies` — 仅开发时需要（eslint、typescript、vite 插件等）
- 不确定时，看已有的同类包放在哪里，保持一致

## 升级依赖

```bash
# 1. 查最新版本
npm view <包名> version

# 2. 修改 pnpm-workspace.yaml 中对应版本号（仍然是精确的，锁死的）

# 3. 重新安装
pnpm install
```

## 重要提醒

- **为什么版本必须锁死？** 避免不同环境、不同时间安装到不同版本，导致"我机器上是好的"类问题。pnpm catalog 本身就是单一版本来源，如果再放 `^` 进去就自废武功了。
- **catalog 版本号已存在的包不要重复添加** — 先检查 `pnpm-workspace.yaml` 的 `catalog:` 段是否已有该包。
- **某个包从依赖中移除时**，如果 catalog 中其他 package 也不再使用，从 catalog 中一并清理。
