# `@walnut/ui`

> 基于 Naive UI 的 Vue 组件包 —— 目前是 ADR 0017 Phase 3.1 的 POC（三个组件），承载「admin 内部 UI 组件逐步迁进 packages」的方向。

| | |
|---|---|
| 目录 | `packages/platform-web/ui` |
| 平台 / 运行时 | `platform: web` · `type: ui` · `runtime: dom` + `vue`（`package.json` 的 `walnut` 块） |
| 消费方式 | 纯源码直消费（JIT）：`exports` 指向 `src/index.ts`，**没有构建步骤**（`build` 只是一句 `echo`，turbo 任务显式声明空 `outputs`） |

## 它是什么

`src/` 现在只有三个组件目录，每个都是仓内约定的两件套（根 AGENTS 纪律 8）：`<ComponentName>/index.ts` 负责导出与 props 类型，`index.vue` 是实现（`defineOptions({ name: 'WCompUI*' })`）。

- `DynamicTags/` —— 包 `NDynamicTags`
- `Switch/` —— 包 `NSwitch`，并把 `checkedText` / `uncheckedText` 两个额外 prop 接到 `#checked` / `#unchecked` 插槽
- `TimePicker/` —— 包 `NTimePicker`

**边界**：本包只管组件实现本身 —— 不引 app store、不调 API、不装配应用级 provider。待办 A7 把「跨组件相对 import」与「app store 注入」列为批量迁移前必须先解决的两件事，这也是它至今停在 POC 的原因。`naive-ui` 与 `vue` 都是 peerDependency（ADR 0017 §6 的理由：不对 naive-ui 版本做假设），所以这里既没有 `dependencies`，也不会替宿主决定 provider 怎么装。

## 导出面

| 入口 | 指向 | 内容 |
|---|---|---|
| `.` | `src/index.ts` | 桶入口：三个组件（default 重命名为 `DynamicTags` / `Switch` / `TimePicker`）+ 三个 props 类型 |
| `./*` | `src/*/index.ts` | 组件子路径：`@walnut/ui/DynamicTags` → `./src/DynamicTags/index.ts`（admin 的自动注册 resolver 就按这个格式拼路径） |

`package.json` 另有 `module` / `types` 两个字段，也都指向 `src/index.ts`（非标准字段；Vite 与 TS 实际按 `exports` 解析）。

props 类型分别是 `ICompUIDynamicTagsProps` / `ICompUISwitchProps` / `ICompUITimePickerProps`，三者都写成 `extends /* @vue-ignore */ <Naive 的同名 Props>`，只有 `Switch` 额外补了 `checkedText` / `uncheckedText`。

命名上有一点错位：SFC 内部的 `name` 是 `WCompUI*`，而自动注册暴露的标签是 `W` + 目录名（`WDynamicTags`）。

## 怎么用

```vue
<!-- 1. 显式具名导入（packages 内的代码约定，见根 AGENTS 纪律 4） -->
<script lang="ts" setup>
import { ref } from 'vue'
import { DynamicTags } from '@walnut/ui'

const tags = ref<string[]>(['a', 'b'])
</script>

<template>
  <DynamicTags v-model:value="tags" />
</template>
```

```vue
<!-- 2. admin 现状：靠 resolver 自动注册，无需 import -->
<script lang="ts" setup>
import { reactive } from 'vue'

const state = reactive({ tags: ['1', '2', '3'] })
</script>

<template>
  <WDynamicTags v-model:value="state.tags" />
</template>
```

```ts
// 3. props 类型可以单独取用（例如给包装组件声明自己的 props）
import type { ICompUISwitchProps } from '@walnut/ui'

const props: Partial<ICompUISwitchProps> = {
  checkedText: 'ON',
  uncheckedText: 'OFF',
}
```

## 依赖与边界

- **零 `dependencies`**：`naive-ui` + `vue` 走 `peerDependencies`；devDependencies 里各装一份，供 `vue-tsc --noEmit` 做类型检查。
- **谁依赖它**：`@walnut/admin`（`workspace:*`）。消费有两条路 —— 显式 `import { DynamicTags } from '@walnut/ui'`，或让 `WalnutAdminComponentResolver` 扫成 `<W*>`：它先扫 admin 自己的 `src/components/**/**/index.ts`，再用相对路径 glob `../../packages/platform-web/ui/src/*/index.ts` 覆盖同名项，所以同名组件以包内为准（`apps/admin/build/vite/plugin/component.ts`）。
- **边界**：turbo 标签 `shared` + `platform-web`，`platform-any` / `backend` 都不能依赖它；后端另有 ESLint `no-restricted-imports` 兜底。迁进本包的代码**必须显式 import**（根 AGENTS 纪律 4：packages 不在 auto-import 的扫描范围里），naive-ui 挂在 `window` 上的 `$message` / `$dialog` / `$notification` 也要改成显式 import（待办 A11）。

## 已知限制与延后工作

- **只有三个 POC 组件（A7）**：admin 侧 UI 组件目录基本仍留在原处（A7 2026-09-23 的口径是 22 个对 3 个），跨组件相对 import 与 app store 注入两个前置问题都还没解；评审 D5 的倾向是先用「零 app 依赖 + 已被 ≥2 处复用」过滤，而不是照 ADR 0017 原计划一次迁完 —— 见 architecture-todo 的 A7 / D5。
- **`/* @vue-ignore */` 这个 hack 还在（TODO 000）**：三个组件的 props 接口都带 `// TODO 000`，指向根 `TODO.md` 的 000 条 —— 被 `@vue-ignore` 跳过的那部分**不会进运行时的 `props` 声明**，只能靠 `inheritAttrs` 默认 true 兜着，所以对 `inheritAttrs: false` 的组件会静默失效（`UI/Tree` 就是因此换成了「收一个 `treeProps`」的写法）；Vue 3.5.34 与 3.5.40 的编译器行为一致，没有版本级修复可等。
- **包内没有自注册**：组件要被 `<WDynamicTags>` 这样用，依赖的是 app 侧 resolver 里那条**相对路径** glob（`apps/admin/build/vite/plugin/component.ts`）—— 本包自己没有注册入口，ADR 0017 §6 把「或由 package 内部自注册」留作未决项。
- **零测试**：`package.json` 没有 `test` 脚本，包内也没有 `vitest.config.ts`，`turbo test` 会整包跳过它；ADR 0015 的覆盖率表里也没有 ui 这一档。
- **三个组件只有 `DynamicTags` 有真实消费者**：app 侧唯一的用法是 `apps/admin/src/views/demo/UI/DynamicTags.vue`（自动注册的 `<WDynamicTags v-model:value="…" />`，`apps/admin/types/generated/components.d.ts` 里也只登记了它），`Switch` / `TimePicker` 目前只有文档页示例。

## 相关

- [ADR 0006：按运行时 API 分层](../../../apps/docs/src/zh-CN/content/adr/0006-runtime-api-separation.md)
- [ADR 0013：桶导出策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md)
- [ADR 0017：Package 重组（§6 是本包，Phase 3.1）](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- [Monorepo 架构总览](../../../apps/docs/src/zh-CN/content/monorepo/index.md) ｜ [架构待办（A7 / A11 / D5）](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)
- [根 TODO.md（000 条：`/* @vue-ignore */`）](../../../TODO.md) ｜ [apps/admin 指引](../../../apps/admin/AGENTS.md)
