---
name: Store 开发
description: Walnut Admin Client Pinia Store 开发模式。包含 store 命名规范、持久化策略（localStorage/加密/IndexedDB）、跨 store 通信。
when_to_use: 新建 store、Pinia store、状态管理、持久化存储、跨组件状态
paths:
  - apps/admin/**
---

# Store 开发

## 核心约束

1. **必须**使用 `defineStore` 定义，store key 在 `src/store/constant.ts` 中注册
2. 文件命名：`{domain}-{feature}.ts`
3. 函数命名：`useAppStore{Domain}{Feature}`
4. **必须**实现 `$reset` 方法用于登出时清理
5. 导出函数**必须**自动检测组件上下文（`getCurrentInstance()`）

## Domain 前缀

| 前缀 | 用途 | 示例 |
|------|------|------|
| `app-*` | 应用级状态 | `app-menu.ts`, `app-tab.ts` |
| `user-*` | 用户状态 | `user-auth.ts`, `user-profile.ts` |
| `comp-*` | 组件状态 | `comp-capjs.ts` |
| `setting-*` | 设置状态 | `setting-dev.ts` |

## Store Key 注册

```typescript
// src/store/constant.ts
export enum StoreKeys {
  YOUR_FEATURE = 'your-feature',
}
```

## 持久化策略

| 策略 | 适用场景 |
|------|----------|
| `useAppStorage` (localStorage) | 普通配置、UI 偏好 |
| `enhancedAesGcmLocalStorage` | 敏感数据（token、用户信息） |
| `indexedDB` | 大体积数据、离线缓存 |
| `useAppStorageAsync` | 异步读写（加密/IndexedDB） |

## 跨 Store 通信

- 在 action 中直接调用其他 store：`const userStore = useAppStoreUserAuth()`
- 登出时**必须** reset 所有相关 store

## 常见错误

- 忘记在 constant.ts 注册 store key → 其他模块无法引用
- 忘记 `$reset` → 登出后残留数据
- 导出函数不检测 `getCurrentInstance()` → 在 setup 外使用时报错
- 敏感数据用普通 localStorage → 使用加密持久化
