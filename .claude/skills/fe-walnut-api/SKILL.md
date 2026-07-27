---
name: API 层开发
description: Walnut Admin Client 前端 API 层开发模式。包含 BaseAPI 扩展、axios 适配器和拦截器体系。适用场景：创建或修改前端 API 模块、封装 HTTP 请求。
when_to_use: 新建 API、封装请求、axios 请求、接口封装、API 层、BaseAPI
paths:
  - apps/admin/**
---

# API 层开发

## 核心约束

1. CRUD 资源**必须**扩展 `BaseAPI<T>`，**禁止**裸写 axios 请求
2. 导出 API **必须**是单例实例（`export const xxxAPI = new XxxAPI()`）
3. 错误处理在**组件层**，**禁止**在 API 层吞异常或弹 toast
4. 请求/响应类型**必须**在 `api/models.d.ts` / `api/request.d.ts` / `api/response.d.ts` 中定义
5. 文件上传**必须**用 `FormData` + `multipart/form-data` header

## 关键约定

- `BaseAPI<T>` 内置标准 CRUD：`list` / `create` / `read` / `update` / `delete` / `deleteMany` / `clear`
- 自定义方法直接调 `AppAxios.post/get/put/delete`
- API 文件结构：
  ```
  api/
  ├── base.ts           # BaseAPI 基类
  ├── models.d.ts       # 模型类型（IModels 命名空间）
  ├── request.d.ts      # 请求类型（IRequestPayload 命名空间）
  ├── response.d.ts     # 响应类型（IResponse 命名空间）
  ├── auth/             # 认证相关
  ├── system/           # 系统管理相关
  └── app/              # 应用相关
  ```

## AppAxios 关键选项

| 选项 | 用途 |
|------|------|
| `auth: false` | 跳过认证 header |
| `loading: false` | 跳过全局 loading 指示器 |
| `cache: true` | 缓存响应 |
| `retry: 3` | 失败重试 |
| `cancel: true` | 自动取消重复请求 |
| `error: false` | 跳过全局错误处理 |

## 拦截器链

Request: catch → crypto（加密）
Response: catch → crypto（解密）→ capJSToken → refreshToken → rsaDecrypt → sign

## 适配器链

idAdapter（加请求 ID）→ cancelAdapter → cacheAdapter → throttleAdapter → retryAdapter → mergeAdapter

## 常见错误

- 不继承 BaseAPI 直接写 `AppAxios.post` → 失去了类型安全和标准 CRUD
- 在 API 层 try-catch 吞异常 → 组件层无法感知错误
- 忘记定义 Models 类型 → `BaseAPI<T>` 无法推导

## 文件下载

```typescript
import { downloadBlob } from '@/utils/file/download'
await downloadBlob(blob, 'filename.xlsx')
```
