# Vue3 + NestJS 全栈 Monorepo 架构

> 前端 Vue3 + 后端 NestJS 的 monorepo 是 TypeScript 全栈项目的一种经典组合。本文档覆盖**共享类型/契约层、API 通信模式、验证策略、以及前后端协作**的业界最佳实践。

---

## 1. 核心架构理念：以契约为中心

### 1.1 70% 的复用价值来自数据模型统一

在前后端共享代码的众多可能性中（UI 组件、工具函数、验证逻辑...），**最大的价值是统一数据模型**。这是几乎所有成功全栈 monorepo 的共识。

```
不是共享一切，而是只共享"真相"（truth）：
  ✅ 共享：类型定义、DTO 结构、枚举常量、验证 schema
  ❌ 不共享：框架代码（Vue composables / NestJS modules）、业务逻辑
```

### 1.2 标准架构图

```
┌──────────────────────────────────────────────────┐
│                    Monorepo                        │
│                                                    │
│  ┌──────────────┐  ┌──────────────┐               │
│  │ apps/admin   │  │ apps/server  │               │
│  │ (Vue3+Vite)  │  │ (NestJS+SWC) │               │
│  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                        │
│         └────────┬────────┘                        │
│                  │                                  │
│         ┌────────▼────────┐                        │
│         │ @walnut/contract │  ← 共享类型 + 常量    │
│         └─────────────────┘                        │
│                  │                                  │
│         ┌────────▼────────┐                        │
│         │  @walnut/utils   │  ← 纯函数工具（可选） │
│         └─────────────────┘                        │
│                                                    │
│  ┌──────────────┐   ┌──────────────┐              │
│  │@walnut/client│   │@walnut/axios │              │
│  │(browser+Vue) │   │(HTTP client) │              │
│  └──────────────┘   └──────────────┘              │
└──────────────────────────────────────────────────┘
```

**依赖方向**：
```
contract ← utils ← client ← axios ← admin
contract ← utils ← server
```

`contract` 在最底层，**不依赖任何其他包**。这是最重要的约束——一旦 contract 依赖了 Vue 或 NestJS，整个依赖图就崩了。

---

## 2. 共享类型包设计（`@walnut/contract`）

### 2.1 内容边界

| ✅ 应该放 | ❌ 不应该放 |
|----------|-----------|
| Domain 接口（User、Product、Order） | Vue composables |
| DTO（CreateUserInput、UpdateUserInput） | NestJS modules / decorators |
| 枚举（UserRole、OrderStatus） | 框架特有的类型（Ref、Inject） |
| API 响应格式（ApiResponse\<T\>、ApiError） | 第三方库的内部类型 |
| 分页参数（PaginationQuery、PaginatedResult） | 环境变量 / 配置值 |
| 业务常量（MAX_PASSWORD_LENGTH） | 运行时依赖的 node_modules |
| Zod/Valibot schema（可选） | class-validator 装饰器 |

### 2.2 目录结构

```
packages/contract/src/
├── index.ts                ← barrel export（受控的公开 API）
├── types/
│   ├── api.ts              ← ApiResponse<T>, ApiError, PaginatedResult<T>
│   ├── user.ts             ← User, CreateUserInput, UpdateUserInput
│   ├── auth.ts             ← LoginRequest, LoginResponse, TokenPayload
│   └── ...
├── enums/
│   ├── user-role.ts        ← enum UserRole { ADMIN, MEMBER, VIEWER }
│   └── order-status.ts
├── constants/
│   ├── pagination.ts       ← DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
│   └── validation.ts       ← PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH
└── schemas/                ← （可选）Zod schemas
    └── user.schema.ts
```

### 2.3 `package.json` exports 配置

```jsonc
// packages/contract/package.json
{
  "name": "@walnut/contract",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"   // 后端可能需要 CJS
    },
    "./enums": {
      "types": "./dist/enums/index.d.ts",
      "import": "./dist/enums/index.js",
      "require": "./dist/enums/index.cjs"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

> `exports` 字段是**硬边界**——未列出的路径无法被 import，防止深层依赖。

---

## 3. 验证策略：Zod vs class-validator

### 3.1 问题陈述

全栈 monorepo 中验证需要同时满足两个场景：

| 场景 | 需求 |
|------|------|
| **后端运行时验证** | 请求体到达时，验证 DTO 字段 |
| **前端表单验证** | 用户输入时，实时验证表单 |

如果分别写两套验证逻辑，它们迟早会漂移（drift）。**业界共识是用单一验证 schema 服务于两端**。

### 3.2 两种方案

| | Zod | class-validator (NestJS 默认) |
|------|-----|------------------------------|
| 类型推断 | ✅ `z.infer<typeof schema>` | ❌ 需要手动声明 interface |
| 前端能用 | ✅ 零依赖，轻量 | ❌ 依赖 `reflect-metadata` + decorators |
| NestJS 集成 | 需要自定义 Pipe | ✅ `ValidationPipe` 原生支持 |
| 学习成本 | 中 | 低（NestJS 开发者熟悉） |
| 运行时性能 | 一般 | 一般 |

### 3.3 推荐：Zod 统一验证

```ts
// packages/contract/src/schemas/user.schema.ts
import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email("Invalid email format"),
  name: z.string().min(1, "Name is required").max(100),
  role: z.enum(["admin", "member", "viewer"]),
});

// 自动推导 TypeScript 类型——不需要手写 interface！
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
```

**后端使用**（自定义 ZodValidationPipe）：

```ts
// apps/server/libs/pipes/src/zod-validation.pipe.ts
import { PipeTransform, BadRequestException } from "@nestjs/common";
import { ZodSchema } from "zod";

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data; // ← 类型安全的返回值
  }
}
```

```ts
// apps/server/apps/api/src/modules/user/user.controller.ts
import { CreateUserSchema, CreateUserInput } from "@walnut/contract";
import { ZodValidationPipe } from "@walnut-server/pipes";
//                          ↑ 注意：@walnut-server/* 是后端 internal lib

@Post()
async create(
  @Body(new ZodValidationPipe(CreateUserSchema)) input: CreateUserInput
) {
  // input 的类型是 CreateUserInput，完全类型安全
  return this.userService.create(input);
}
```

**前端使用**（VeeValidate + Zod）：

```ts
// apps/admin/src/views/user/CreateUser.vue
import { useForm } from "vee-validate";
import { toTypedSchema } from "@vee-validate/zod";
import { CreateUserSchema } from "@walnut/contract";

const { errors, handleSubmit } = useForm({
  validationSchema: toTypedSchema(CreateUserSchema),
});
```

**关键收益**：改一个字段的验证规则 → 前后端同时生效。不会出现"后端改了 email 长度限制但前端表单还是旧的"。

### 3.4 为什么不选 class-validator

对于**新项目**或**愿意重构的项目**，Zod 统一方案优于 class-validator：
- 同一份 schema 前后端通用
- 更少的样板代码（不用手写 interface + class 两份）
- 更好的 TypeScript 类型推断
- NestJS 社区已有成熟的 Zod Pipe 实现

对于**已有大量 class-validator DTO 的项目**，渐进迁移：新模块用 Zod，旧模块保持 class-validator。

---

## 4. API 通信层

### 4.1 请求/响应类型规范化

所有 API 遵守统一的响应格式：

```ts
// packages/contract/src/types/api.ts
export interface ApiResponse<T> {
  code: number;          // 业务状态码
  data: T;
  message: string;
}

export interface ApiError {
  code: number;
  data: null;
  message: string;
  errors?: Record<string, string[]>;  // 字段级错误
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
```

### 4.2 前端 API 客户端

```
packages/axios/src/
├── instance.ts          ← Axios 实例（baseURL、interceptors）
├── adapters/
│   └── auth.ts          ← 认证 adapter（自动刷新 token）
└── index.ts
```

```ts
// @walnut/axios — HTTP 客户端框架
import axios from "axios";
import type { ApiResponse, ApiError } from "@walnut/contract";

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 15000,
});

// Request interceptor — 自动附加 JWT
http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — 统一错误处理
http.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期 → 尝试刷新
      return refreshToken().then(() => http(error.config));
    }
    return Promise.reject(error.response?.data as ApiError);
  },
);
```

### 4.3 API 调用示例

```ts
// apps/admin/src/api/user.api.ts
import { http } from "@walnut/axios";
import type { ApiResponse, PaginatedResult, CreateUserInput, User } from "@walnut/contract";

export const userApi = {
  list: (params: { page: number; pageSize: number }) =>
    http.get<ApiResponse<PaginatedResult<User>>>("/users", { params }),

  create: (input: CreateUserInput) =>
    http.post<ApiResponse<User>>("/users", input),

  delete: (id: string) =>
    http.delete<ApiResponse<null>>(`/users/${id}`),
};
```

**类型安全从前端到后端**：
```
CreateUserInput (contract) → userApi.create(input) → POST /users → ZodValidationPipe → UserService.create(input)
```

全程同一个类型 `CreateUserInput`，编译器会捕获任何不匹配。

---

## 5. 前端架构要点

### 5.1 依赖分层

```
apps/admin/src/
├── api/             ← 调用 @walnut/axios，返回 @walnut/contract 类型
├── stores/          ← Pinia，调用 api/
├── composables/     ← 跨组件复用的逻辑（调用 stores 或 api/）
├── components/      ← UI 组件（调用 composables 或 stores）
├── views/           ← 页面（组合 components）
└── router/          ← 路由守卫（检查 stores 的 auth 状态）
```

依赖方向：`views → components/composables → stores → api → @walnut/axios → @walnut/contract`

### 5.2 路径别名

```jsonc
// apps/admin/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "~/*": ["./types/*"]
    }
  }
}
```

```ts
// vite.config.ts
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~": fileURLToPath(new URL("./types", import.meta.url)),
    },
  },
});
```

---

## 6. 后端架构要点

### 6.1 NestJS 模块化结构

```
apps/server/apps/api/src/
├── main.ts               ← bootstrap
├── app.module.ts          ← root module
├── common/                ← 跨领域 concern
│   ├── guards/            ← JWT/IP/Role guards
│   ├── interceptors/      ← 响应格式化
│   ├── filters/           ← 全局异常处理
│   └── pipes/             ← 验证 pipes（含 ZodValidationPipe）
└── modules/
    ├── auth/
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   └── auth.module.ts
    ├── user/
    │   ├── user.controller.ts
    │   ├── user.service.ts
    │   ├── user.schema.ts     ← Mongoose schema
    │   └── user.module.ts
    └── ...
```

### 6.2 后端 internal libs 与 contract 的关系

```
@walnut/contract (packages/contract)
  ← 前后端共享：类型、枚举、常量、schema
  ← import by apps/admin AND apps/server

@walnut-server/* (apps/server/libs/*)
  ← 后端专用：NestJS 耦合的代码（guards、pipes、decorators）
  ← import only by apps/server
```

---

## 7. CORS 与安全

### 7.1 NestJS CORS 配置

```ts
// apps/server/apps/api/src/main.ts
app.enableCors({
  origin: process.env.ADMIN_ORIGIN || "http://localhost:3100",
  credentials: true,                // 允许携带 cookie
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
```

### 7.2 Vite 开发代理

```ts
// apps/admin/vite.config.ts
export default defineConfig({
  server: {
    port: 3100,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/w/v1"),
      },
    },
  },
});
```

---

## 8. 不要做的事情

| 反模式 | 为什么是坑 | 正确做法 |
|--------|-----------|---------|
| 在 contract 中 import Vue/NestJS | contract 失去框架无关性 | 严格零框架依赖 |
| 前端直连 MongoDB | 安全灾难 | 通过后端 API |
| 前后端各自定义 `User` 接口 | 迟早不同步 | 统一在 contract |
| 在 shared 包里放 Vue composables 并在 server 中 import | 运行时崩溃 | 按运行环境分层 |
| 在 NestJS controller 中直接写业务逻辑 | controller 成了 God class | 逻辑放 service，controller 只做路由 |
| `synchronize: true` 在生产环境 | TypeORM 自动改表结构 | 用 migration |

---

## 9. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 对齐程度 |
|---------|-------------------|---------|
| `@walnut/contract` 共享类型 | ✅ 已有 | 完全对齐 |
| contract 零框架依赖 | ✅ 纯类型 + 常量 | 完全对齐 |
| Zod 统一验证 | ❌ 目前后端用 class-validator | 可选迁移——收益大但工程量大 |
| uniform API response format | ✅ 有 `ApiResponse<T>` | 完全对齐 |
| `@walnut/axios` 作为 HTTP 客户端 | ✅ 已有 | 完全对齐 |
| CORS + Vite proxy 基础配置 | ✅ 已有 | 完全对齐 |
| 前端分层（api → stores → components → views） | ✅ 已有 | 完全对齐 |
| 后端 internal libs 与 contract 职责分离 | ✅ ADR-0007 已决定 | 完全对齐 |
