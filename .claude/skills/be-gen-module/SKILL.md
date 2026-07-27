---
name: 生成 CRUD 模块
description: 在 Walnut Admin NestJS Server 中生成新的 CRUD 模块（Schema + DTO + Controller + Service + Module）。适用场景：新建数据表对应的 API 模块。
when_to_use: 新建模块、创建 API、生成 CRUD、添加数据表对应的接口、新建一张表
paths:
  - apps/server/**
---

# 生成 CRUD 模块

## 核心约束

1. **禁止**创建 `index.ts` 文件
2. Service **禁止**直接注入 Model → 必须走 BasicRepository / RepoService / SharedService 三层
3. DTO **必须**使用 `RealPickType` / `RealPartialType`（`@walnut/utils/dto`），**禁止** NestJS 原生 `PickType` / `PartialType`
4. DTO 字段**禁止** `?` 和 `!` 标记 → 用装饰器 `default` 选项替代
5. 字段装饰器**必须**来自 `@/decorators/field`，**禁止**原生 class-validator
6. 权限定义为 controller 文件内局部 `const Permissions`，**禁止**从 `@/const/permissions` 导入
7. 跨模块 import **必须**用 `@/*` alias，**禁止**相对路径 `../../`

## 关键约定

- 模块路径：`apps/server/apps/api/src/modules/<apiPath>/`
- Schema Model 必须 `extends WalnutAdminCommonBasicModel`
- Type 导出三件套：`ISysXxxDocument`、`ISysXxxModel`、`ISysXxxMethods`
- DB Model 名称常量在 `apps/server/apps/api/src/const/app/config.ts` 中定义（key 用 `SYS_XXX`）
- 模块注册：`system/*` → system 父模块；`app/*` → app 父模块
- Model 注入用 `AppInjectModel(WalnutDBModelName.XXX)`，**禁止** `@InjectModel` 和 `Model.name`
- DTO 必须包含构造函数：`constructor(partial: Partial<XxxDTO>) { super(); Object.assign(this, partial) }`

## 三层数据访问

| 层 | 位置 | @Global | 用途 |
|----|------|---------|------|
| BasicRepository | `*.basic.repository.ts` | 否 | Controller 内简单 CRUD |
| RepoService | `repo/*.repo.service.ts` | **是** | 跨模块数据访问，仅简单 CRUD |
| SharedService | `shared/*.shared.service.ts` | 否 | 复杂业务逻辑、缓存 |

`--with-repo`：额外创建 `repo/` 子目录并全局注册。`--with-shared`：额外创建 `shared/` 子目录。

## 常见错误

- 用 `@InjectModel` 替代 `AppInjectModel` — 序列化拦截器会失效
- 用 `Model.name` 替代 `WalnutDBModelName` 常量
- DTO 缺构造函数 → `ClassSerializerInterceptor` 过滤掉所有字段
- Service 直接 import Model → 必须通过 repo/shared 层

## 文件结构

```
<moduleName>.controller.ts    — 路由处理
<moduleName>.service.ts       — 业务逻辑（1:1 对应 controller）
<moduleName>.module.ts        — NestJS 模块定义
dto/<moduleName>.dto.ts       — 请求/响应 DTO
schema/<moduleName>.schema.ts — Mongoose Schema + Model + Type 导出
```

## 验证

```bash
pnpm lint:fix && pnpm types:check
```
