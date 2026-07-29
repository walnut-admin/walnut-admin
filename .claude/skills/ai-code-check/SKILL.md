---
name: ai-code-check
description: >
  在每轮对话中进行多步骤代码修改时，每个小步骤完成后自动运行 pnpm lint 和 pnpm types:check
  进行代码质量检查。所有步骤完成后再做一次最终检查。只要你在写代码、修改文件、重构、或者
  执行任何多步骤的开发任务，每完成一个子步骤都应该触发这个 skill。即使你没有明确说"检查一下"
  或"lint 一下"，只要任务包含多个步骤并且一个步骤刚完成，就应该自动执行检查。
---

# AI 代码检查

## 核心原则

写代码 → 检查 → 修问题 → 继续下一步。每一步都应该是干净的，而不是把问题留到最后。

## 检查时机

### 每个小步骤完成后

当你完成一个子任务（比如"添加一个函数"、"修改一个组件"、"重构一个模块"）后，立即执行：

1. **`pnpm lint`** — ESLint 检查
   - 利用 Turbo 缓存，只检查变更的文件，速度快
   - 不需要手动指定文件，直接跑全量命令即可

2. **`pnpm types:check`** — TypeScript 类型检查
   - 注意：命令是 `types:check`（冒号分隔），不是 `type-check`（连字符）
   - TypeScript 无法按文件增量检查，需要全量跑，但有 Turbo 缓存加速

### 所有步骤完成后（最终检查）

当整个 todo list 或所有步骤全部完成之后，再完整跑一遍：

1. `pnpm lint`
2. `pnpm types:check`

目的：确保所有变更合在一起也能通过检查，避免碎片化修改之间的冲突。

## Lint 报错处理

如果 `pnpm lint` 报错，按以下逻辑处理：

### 1. 可通过 --fix 自动修复的错误

这类错误包括：分号、缩进、引号风格、逗号、空格等格式化问题。

对于这些错误，直接对报错的文件执行 `eslint --fix`：

```bash
npx eslint <报错的文件路径> --fix
```

修复后不需要重新跑全量 `pnpm lint`，因为 Turbo 会因为文件变更自动让下次 lint 失效。

### 2. 无法通过 --fix 修复的错误

这类错误包括：`no-unused-vars`、`no-console`、类型相关的 lint 规则、逻辑问题等。

处理步骤：
1. 仔细阅读 ESLint 报错信息，理解具体违反了哪条规则
2. 手动修改源代码来修复
3. 修复后重新跑 `pnpm lint` 确认通过

## 重要注意事项

- **`pnpm lint`** vs **`pnpm lint:fix`**：
  - `pnpm lint` 是只读检查，Turbo 开启了缓存（`cache: true`），优先使用
  - `pnpm lint:fix` 会修改源文件，Turbo **没有**开启缓存（`cache: false`），因为源文件修改是副作用，Turbo 无法正确追踪。仅在确定需要自动修复时才调用
  - 所以流程是：先 `pnpm lint`（快），报错了再按需 `eslint --fix`（精确），而不是每次都跑 `pnpm lint:fix`

- **`pnpm types:check` 命令拼写**：是 `types:check`（带冒号），不要写成 `type-check` 或 `types-check`

- **检查速度**：两个命令都有 Turbo 缓存，日常使用中大部分时候是秒级完成的
