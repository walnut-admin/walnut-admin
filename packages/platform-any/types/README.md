# `@walnut/types`

> 环境无关的**纯类型声明**包 —— 不依赖 Vue、DOM、Node，也不产出任何运行时值。

| | |
|---|---|
| 目录 | `packages/platform-any/types` |
| 平台 / 运行时 | `platform: any` ｜ `type: contract` ｜ `runtime: none`（`package.json` 的 `walnut` 块） |
| 消费方式 | **纯类型**：`exports` 直接指向 `src/*.d.ts`，无构建产物、无 `require` / `import` 条件 |

## 它是什么

本包是 [ADR 0017](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md) 拆分 `@walnut/utils` 的产物：当时 `@walnut/utils` 的 `deep-ref.d.ts` / `object-key.d.ts` 用了 Vue 的 `Ref` / `UnwrapRef` 却没在 `package.json` 声明 vue，`storage.d.ts` 又依赖 DOM 的 `Storage` —— 「零依赖」只在运行时成立。于是把**既不纯、也不属于 contract** 的类型集中到这里，重写成无框架版本。

边界：

- **零依赖**：没有 `dependencies`，只有 devDependencies（`@walnut/tsconfig` 的 `ts.json` 预设、`typescript`、`rimraf`、`@walnut/eslint-config`）。
- 依赖 Vue 的那部分类型（`SafeDeepMaybeRef` / `IDeepMaybeRef` / `DeepKeyOf`）**不在这里** —— 它们只在 Vue 组件代码里有意义，留在 `@walnut/client`（例如 `DeepKeyOf` 在 `packages/platform-web/client/src/types/vue-object-key.d.ts`）。
- 前后端共享的常量与契约类型去 `@walnut/contract`；有运行时实现的工具去 `@walnut/utils`。

## 导出面

`exports` 是两条**裸字符串**映射（没有 `source` / `import` / `require` 条件，因为没有任何运行时代码）：

| 入口 | 内容 |
|------|------|
| `.` | 四个模块 15 个类型名的**具名** re-export（无 `export *`，ADR 0013） |
| `./deep-ref` | `IsPrimitive` / `IsFunction` / `NoDistribute` / `RecursionLimit` / `NextDepth` |
| `./object-key` | `UnionToIntersection` / `RecordToUnion` / `ShortEmits` |
| `./storage` | `IStorageSync` / `IStorageAsync` / `IStorageOptions<T>` / `IStorageData<T>` |
| `./universal` | `Fn<T, R>` / `PromiseFn<T>` / `IActionType`（`'create' ｜ 'update' ｜ 'detail'`） |

`src/index.d.ts` 的维护约定写在文件头：**新增模块时要在这里补一段具名 re-export**。

## 怎么用

```ts
// ① 子路径导入 —— 仓内**全部**现存用法都是这一种（apps/admin 组件与 composable）
import type { Fn } from '@walnut/types/universal'

export interface ButtonProps {
  onConfirm: Fn<string, Promise<void>>
}
```

```ts
// ② storage 接口：与 @walnut/utils 的透明加解密装饰器配套
import type { IStorageSync } from '@walnut/types/storage'

export function readRaw(storage: IStorageSync, key: string): string | null {
  return storage.getItem(key)
}
```

```ts
// ③ 根 barrel（2026-09-23 补的入口，等价于上面两种写法的合集）
import type { Fn, IStorageSync } from '@walnut/types'
```

## 依赖与边界

- **依赖**：无（零 `dependencies`）。`tsconfig.json` 继承 `@walnut/tsconfig/ts.json`，`include` 只覆盖 `src/**/*.d.ts`。
- **消费者**：`@walnut/admin`、`@walnut/client`、`@walnut/utils`（各自 `package.json` 里声明 `"@walnut/types": "workspace:*"`）。
- **边界由 turbo tags 强制**：workspace 级 `turbo.json` 声明 `shared` / `pure` / `platform-any`，根 `turbo.json` 的 `boundaries.tags` 禁止 `shared` 依赖 app、禁止 `platform-any` 依赖 `platform-web` / `platform-node`（`pure` 是描述性标签，无对应规则）。由 `pnpm boundaries` 拦。
- **无构建步骤**：`build` 是 `echo 'types: pure source, no build needed'`，配套 `turbo.json` 声明 `build.outputs: []`，以免 turbo 刷「no output files found」警告。

## 已知限制与延后工作

- **根 barrel 目前 0 处消费**：全仓对 `@walnut/types` 的导入都写成子路径（`@walnut/types/universal` 等），2026-09-23 补的 `src/index.d.ts` 只是策略一致性收口；该文件注释也明写子路径「继续可用、而且更精确」—— 证据：`packages/platform-any/types/src/index.d.ts` 与 `apps/docs/src/zh-CN/content/monorepo/architecture-todo.md` 的 R8 核实记录。
- **「新模块忘了补 re-export」没有门禁**：`src/index.d.ts` 的文件头注释自陈 —— 反向的错（引用了已删除的模块）由 `pnpm types:check` 拦，**正向的漏只靠这段注释**。证据：`packages/platform-any/types/src/index.d.ts`。
- **没有 `test` 脚本、没有 `vitest.config.ts`**：`package.json` 的 scripts 只有 `build` / `lint` / `types:check` / `clean`；四个类型体操模块零用例，唯一保障是 `tsc --noEmit`（`pnpm test` 的覆盖包清单里也没有本包）。
- **跨端业务类型镜像尚未迁入**：ADR 0017 把 `IModels` / `IRequestPayload` / `IResponseData` 记为「最大的跨端类型共享机会」，`src/` 目前仍只有 `deep-ref` / `object-key` / `storage` / `universal` 四个模块 —— 证据：`apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md`。
- **`exports` 无条件分支**：`"."` 与 `"./*"` 都直接指向 `.d.ts`，所以任何**运行时** import 都会解析到声明文件（该包零运行时导出，属于「本就不该这么用」，但错误的用法不会被 exports 拦下）。
- **`@walnut/eslint-config` 声明了却在本地用不上**：目录里没有 `eslint.config.ts`，`pnpm lint` 实际由 ESLint 向上查找命中根配置（架构待办第 1 批 R3 记录：除包级那几份配置外，其余包都走根配置）—— 证据：`packages/platform-any/types/package.json` 与 `apps/docs/src/zh-CN/content/monorepo/architecture-todo.md`。

## 相关

- [架构地图 · 共享包体系](../../../apps/docs/src/zh-CN/content/monorepo/architecture.md)（依赖图 / 各包职责）
- [架构待办事项](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)（R8 根导出收口）
- ADR：[0006 运行时 API 分层](../../../apps/docs/src/zh-CN/content/adr/0006-runtime-api-separation.md) ｜ [0013 Barrel 策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md) ｜ [0017 包重组](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- 相关包：[`@walnut/utils`](../utils-core/README.md) ｜ [`@walnut/contract`](../contract/README.md) ｜ [`@walnut/tsconfig` 预设判据](../../tooling/tsconfig/README.md)
