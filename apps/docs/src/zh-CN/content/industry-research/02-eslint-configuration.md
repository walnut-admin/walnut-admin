# ESLint 与代码质量体系

> 大型 monorepo 的 lint 策略远不止"装个 ESLint"——它涉及**共享配置包、Flat config 迁移、pre-commit 门禁、以及速度工具（oxlint/biome）的引入决策**。本文档覆盖完整的代码质量体系。

---

## 1. 业界共识：共享 ESLint Config 包

### 1.1 核心架构

大型 monorepo 将 ESLint 配置作为**独立的 workspace 包**发布，所有其他包通过 `extends` 消费：

```
packages/config/eslint/
├── package.json           ← "name": "@repo/eslint-config"
├── base.mjs               ← 全仓库基础规则
├── vue.mjs                ← Vue 专用（extends base）
├── nest.mjs               ← NestJS 专用（extends base）
├── library.mjs            ← 库专用（extends base）
└── prettier.mjs           ← Prettier 冲突规则屏蔽
```

**核心理念**：
- ESLint 插件放在 config 包的 `dependencies`（不是 `peerDependencies`）
- `eslint` 本身是 `peerDependency`（避免多版本共存）
- 消费者只需 `extends` 即可，零配置

### 1.2 消费者视角

```js
// apps/admin/eslint.config.mjs
import vueConfig from "@repo/eslint-config/vue";

export default [
  ...vueConfig,
  // 项目特有的规则覆盖
  {
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
];
```

```js
// apps/server/eslint.config.mjs
import nestConfig from "@repo/eslint-config/nest";

export default [
  ...nestConfig,
  {
    rules: {
      "@typescript-eslint/no-extraneous-class": "off", // NestJS DI 需要 class
    },
  },
];
```

> **Walnut Admin 的现状差异**：当前使用的是 root `eslint.config.mjs` 统一配置，不是共享 config 包。对于当前规模（4 packages + 2 apps），root 统一配置完全够用。提取成 config 包的主要收益在于**版本控制**和**外部消费**，暂无必要。

---

## 2. Flat Config 迁移（ESLint v9+）

### 2.1 为什么必须迁移

- ESLint v9 **默认只支持 flat config**
- 旧的 `.eslintrc.*` 通过 `ESLINT_USE_FLAT_CONFIG=false` 兼容，但 v10 将彻底移除
- Flat config 支持 ESM（`.mjs`），编写体验更好
- 共享 config 包在 flat config 下更简洁——直接 export 数组

### 2.2 迁移对照

```js
// 旧 (.eslintrc.cjs) — 不再推荐
module.exports = {
  root: true,
  extends: ["@vue/typescript/recommended", "prettier"],
  rules: { "no-console": "warn" },
};
```

```js
// 新 (eslint.config.mjs) — 推荐
import vueTsConfig from "@vue/eslint-config-typescript";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    // global ignores（替代 .eslintignore）
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
  ...vueTsConfig(),
  prettierConfig, // 必须放最后，覆盖格式规则
  {
    rules: {
      "no-console": "warn",
    },
  },
];
```

### 2.3 Flat Config 的核心概念

| 旧概念 | 新概念 | 说明 |
|--------|--------|------|
| `.eslintrc.*` | `eslint.config.mjs` | 唯一入口 |
| `.eslintignore` | `ignores` key in config | 全局忽略放第一个 config object |
| `extends` | spread `...` | 直接展开共享 config 数组 |
| `parserOptions` | `languageOptions.parser` | 换层级了 |
| `env` | `globals` from npm | `import { browser } from "globals"` |
| `plugins` | 直接 import 再放进 `plugins` | 不再需要字符串引用 |

### 2.4 渐进迁移策略

1. **Phase 1**：创建 root `eslint.config.mjs`，用 `@eslint/eslintrc` 的 `FlatCompat` 桥接旧的 extends
2. **Phase 2**：逐个包把 extends 改成 flat config 的 spread 写法
3. **Phase 3**：删除 `FlatCompat` 桥接，全量 native flat config
4. **Phase 4**：提取共享 config 包（如需要）

---

## 3. 速度工具：oxlint / biome

### 3.1 为什么 ESLint 慢

大型 monorepo 中 `eslint .` 跑完全仓库可能需要 30-60 秒。瓶颈在于：
- 插件多（TypeScript parser、Vue parser、import rules 等）
- 规则多（几百条规则逐一检查）
- 文件多

### 3.2 oxlint：Rust 写的极速 linter

[oxlint](https://oxc.rs/docs/guide/usage/linter.html) 由 Vercel/ByteDance 团队主导开发，是 oxc 工具链的一部分：

```bash
# 安装
pnpm add -D oxlint

# 运行（比 ESLint 快 50-100x）
pnpm oxlint --fix
```

**优势**：
- 速度：50-100 倍于 ESLint
- 零配置开箱即用：默认规则集覆盖大多数字段
- 与 ESLint 互补：oxlint 扫常见错误（快），ESLint 扫类型感知规则（慢但深）

**局限性**（2025-2026）：
- 不支持 Vue SFC（`.vue` 文件）——这对 Walnut Admin 是 blocker
- 不支持自定义插件
- 规则集不完整（但快速增长中）

### 3.3 biome：all-in-one 工具链

[biome](https://biomejs.dev/) 同时替代 ESLint + Prettier：

| 功能 | biome | ESLint + Prettier |
|------|-------|-------------------|
| Lint | ✅ ~200 条规则 | ✅ 300+ 条 + 插件生态 |
| Format | ✅ 97% Prettier 兼容 | ✅ Prettier |
| 速度 | 极快（Rust） | 慢（JS） |
| Vue SFC 支持 | ❌ 不支持 | ✅ 支持 |
| 自定义规则 | ❌ 不支持 | ✅ 支持 |

### 3.4 决策框架

```
                       需要 Vue SFC 支持？
                      /                \
                    是                  否
                    |                   |
             继续用 ESLint       需要自定义规则/插件？
             可以加 oxlint          /          \
             做第一层快速扫描      是           否
                                 |            |
                          继续用 ESLint   迁移到 biome
```

> **Walnut Admin 的路径**：因为 frontend 是 Vue3，Vue SFC 支持是刚需 → 继续 ESLint。将来如果 oxlint 支持 Vue SFC，可以加在 ESLint 之前作为第一道快速扫描。

---

## 4. Prettier：放在根目录统一管理

### 4.1 标准做法

```jsonc
// root package.json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "prettier": "catalog:"
  }
}
```

```jsonc
// .prettierrc
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

```gitignore
# .prettierignore
dist/
node_modules/
.turbo/
pnpm-lock.yaml
```

**关键决策**：Prettier 放根目录，一个 `.prettierrc` 管全部。不在每个包里装 Prettier。

### 4.2 ESLint + Prettier 共存

```js
// eslint.config.mjs
import prettierConfig from "eslint-config-prettier";

export default [
  // ... 所有其他 config
  prettierConfig, // ← 必须放最后，覆盖所有格式相关规则
];
```

**为什么放最后？** — flat config 中后面的规则覆盖前面的。`eslint-config-prettier` 的作用是把所有与 Prettier 冲突的 ESLint 规则关掉。

---

## 5. Pre-commit 门禁：Husky + lint-staged

### 5.1 业界标准配置

```bash
# 安装
pnpm add -D husky lint-staged
pnpm exec husky init   # 创建 .husky/ 目录
```

```bash
# .husky/pre-commit
pnpm lint-staged
```

```jsonc
// root package.json
{
  "lint-staged": {
    "*.{ts,vue,js,mjs,cjs}": [
      "prettier --write",
      "eslint --fix --no-warn-ignored"
    ],
    "*.{json,md,yaml,css}": [
      "prettier --write"
    ]
  }
}
```

### 5.2 pre-commit vs pre-push

| 钩子 | 应该做什么 | 不应该做什么 |
|------|-----------|-------------|
| `pre-commit` | prettier + eslint on staged files (秒级) | `tsc --noEmit`（太慢） |
| `pre-push` | `tsc --noEmit` on changed packages（十秒级） | 完整 test suite（分钟级） |
| CI | 完整 test suite + build | — |

### 5.3 Commitlint：规范 commit message

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional
```

```bash
# .husky/commit-msg
pnpm commitlint --edit $1
```

```js
// commitlint.config.mjs
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",     // 新功能
        "fix",      // 修 bug
        "docs",     // 文档
        "style",    // 格式
        "refactor", // 重构
        "perf",     // 性能
        "test",     // 测试
        "chore",    // 杂项
        "ci",       // CI/CD
        "build",    // 构建系统
      ],
    ],
    "subject-case": [2, "always", "lower-case"],
    "header-max-length": [2, "always", 100],
  },
};
```

**为什么重要**：Conventional Commits 是 Changesets 自动生成 changelog 的基础——commit message 规范了，changelog 才能不靠人工手写。

---

## 6. 依赖版本一致性：syncpack

### 6.1 问题

即使有 pnpm catalog，devDependencies（如 `eslint`、`prettier`、`typescript`）仍然可能因为历史原因在不同包的 `package.json` 中有不同的版本号。

### 6.2 syncpack

[syncpack](https://jamiemason.github.io/syncpack/) 强制所有 workspace 包使用统一版本的依赖：

```bash
pnpm add -D syncpack
```

```js
// .syncpackrc.js
export default {
  dev: true,               // 只检查 devDependencies
  filter: ".",              // 所有 workspace 包
  indent: "  ",
  peer: false,              // 不检查 peerDependencies
  prod: true,               // 也检查 dependencies
  semverRange: "^",         // 统一 semver range
  sortAz: [                 // 按字母序排列
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ],
  source: ["package.json", "packages/*/package.json", "apps/*/package.json"],
};
```

```jsonc
// 加到 CI
{
  "scripts": {
    "syncpack:check": "syncpack list-mismatches",
    "syncpack:fix": "syncpack fix-mismatches"
  }
}
```

> **Walnut Admin 现状**：ADM-0011 采用的 `catalogMode: strict` 已经解决了大部分问题——任何不在 catalog 中的依赖版本都会被拒绝。syncpack 可以作为额外的防御层，但目前没必要。

---

## 7. 死代码检测：Knip

[Knip](https://knip.dev/) 检测未使用的文件、未使用的 `package.json` exports、以及未使用的依赖：

```bash
pnpm add -D knip
```

```jsonc
// knip.json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "workspaces": {
    "packages/*": {},
    "apps/*": {
      "entry": ["src/main.ts", "src/main.tsx", "src/App.vue"],
      "project": ["**/*.{ts,vue,js}"]
    }
  },
  "ignoreDependencies": [
    // 一些构建工具虽然没有直接 import，但确实是需要的
    "@walnut/eslint-config"
  ]
}
```

```jsonc
{
  "scripts": {
    "knip": "knip",
    "knip:fix": "knip --fix"
  }
}
```

---

## 8. 完整代码质量流水线

### 8.1 分层防线

```
Layer 1: IDE 实时反馈
  ├── VS Code ESLint 插件 → 保存时自动 fix
  └── VS Code Prettier 插件 → 保存时自动格式化

Layer 2: pre-commit 秒级拦截
  ├── lint-staged → prettier + eslint on staged files
  └── commitlint → 规范 commit message

Layer 3: pre-push / CI 分钟级检查
  ├── turbo lint → 全仓库 ESLint
  ├── turbo typecheck → 全仓库类型检查
  └── turbo test → 全仓库测试

Layer 4: CI 门禁（PR → main）
  ├── syncpack:check → 依赖版本一致性
  ├── format:check → 格式检查
  └── knip → 死代码检查
```

### 8.2 root package.json 完整 scripts

```json
{
  "scripts": {
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "syncpack:check": "syncpack list-mismatches",
    "knip": "knip",
    "prepare": "husky"
  }
}
```

### 8.3 CI 门禁顺序

```yaml
# GitHub Actions 关键步骤（详见 03-ci-cd-pipeline.md）
- run: pnpm format:check           # 30s — 最快，先抓
- run: pnpm lint                    # 60s — 第二快
- run: pnpm typecheck               # 90s — 中等
- run: pnpm test                    # 120s — 最慢
- run: pnpm syncpack:check          # 10s — 轻量检查
```

---

## 9. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 差距 |
|---------|-------------------|------|
| Flat config | ✅ `eslint.config.mjs` | 已迁移 |
| 共享 config 包 | ❌ root 统一配置，未提取包 | 当前规模够用，暂不需要 |
| Prettier 根目录统一 | ✅ root .prettierrc | 已做 |
| Husky + lint-staged | ❓ 待确认 | 检查 `.husky/` 目录 |
| commitlint | ❓ 待确认 | 配合 Changesets 推荐加上 |
| oxlint / biome | ❌ 未使用 | Vue SFC 是 blocker — oxlint 不支持 |
| syncpack | ❌ 未使用 | catalog strict 已覆盖大部分场景 |
| Knip | ❌ 未使用 | 可在重构完成后跑一次做存量清理 |
