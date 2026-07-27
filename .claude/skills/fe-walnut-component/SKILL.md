---
name: 组件开发
description: Walnut Admin Client Vue 组件开发模式。包含标准组件结构（index.ts + index.vue）、register + methods 通信模式、context injection 模式。
when_to_use: 新建组件、Vue 组件、封装组件、WComp、index.ts index.vue
paths:
  - apps/admin/**
---

# 组件开发

## 核心约束

1. **必须**是 `index.ts` + `index.vue` 双文件结构，**禁止**单文件组件放在 `components/` 下
2. **必须**用 `defineOptions({ name: 'WComp{Category}{Name}' })` 声明组件名
3. 父子通信**必须**用 `register + methods` 模式（`emit('hook', methods)` + `defineExpose(methods)`）
4. 动态 prop 更新用 `useProps` hook（`@/hooks/core/useProps`）
5. 样式**优先** UnoCSS，仅复杂/私有样式用 `<style scoped>`

## 组件分类

| 分类 | 路径 | 示例 |
|------|------|------|
| Advanced | `Advanced/` | CRUD, ApiSelect |
| App | `App/` | Lock, Search, Settings |
| Business | `Business/` | Dict, AreaCascader |
| Extra | `Extra/` | Copy, QRCode, Password |
| Global | `Global/` | Cap, DevSettings |
| HOC | `HOC/` | 高阶组件 |
| UI | `UI/` | Form, Table, Modal |
| Vendor | `Vendor/` | CodeMirror, ECharts |

## register + methods 模式

- 子组件 `defineExpose(methods)` + `emit('hook', { ...methods })`
- 父组件 `const [register, { validate, reset }] = useXxx(props)` + `@hook="register"`

## Context Injection 模式

- `InjectionKey<Context>` + `provide` / `inject`
- 仅在跨层级传递时使用，不滥用

## 常见错误

- 忘记 `defineOptions` → 组件名在 DevTools 中不可辨识
- 不用 `index.ts` 包装 → 消费者 import 路径不一致
- 组件名不用 `WComp` 前缀 → 与第三方组件冲突
- 裸用 UnoCSS 写复杂动画 → 应用 scoped CSS

## Async Component（代码分割）

```typescript
import { createAsyncComponent } from '@/utils/factory/asyncComponent'
const HeavyComponent = createAsyncComponent(() => import('./HeavyComponent'))
```
