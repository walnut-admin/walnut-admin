---
name: 审计模块
description: 审计 NestJS 模块是否符合 Walnut Admin 项目约定。适用场景：代码审查、检查模块规范合规性。
when_to_use: 审计模块、审查代码、检查规范、review 模块、模块合不合规
paths:
  - apps/server/**
---

# 审计模块

逐项检查模块是否符合 Walnut Admin NestJS 项目约定。只报告违规项，不列通过的项（除非明确要求完整报告）。

## 架构

- [ ] Service **没有**直接注入或使用 Mongoose Model（必须走 BasicRepository / RepoService / SharedService）
- [ ] Controller **只有**接收参数 + 调用 service + 包装响应，无业务逻辑
- [ ] RepoService（如有）标注了 `@Global()`，仅含简单 CRUD
- [ ] SharedService（如有）**未**标注 `@Global()`，需要显式 import

## Controller

- [ ] 权限是局部 `const Permissions`，**未**从 `@/const/permissions` 导入
- [ ] 装饰器顺序正确（HTTP → HttpCode → Permission → CRUD → GuardFree → Transaction → Swagger → Functional）
- [ ] 参数装饰器顺序正确（User → DeviceId → Session → ParamMongoId → Body → Ip）
- [ ] 响应包装在 DTO 中，未返回原始 service 结果
- [ ] Delete 操作标注了 `@WalnutDBTransaction()`

## DTO

- [ ] 使用 `RealPickType` / `RealPartialType`（`@walnut/utils/dto`），**未**用 NestJS 原生版本
- [ ] 字段装饰器来自 `@/decorators/field`，**未**用原生 class-validator
- [ ] 字段**没有** `?` 或 `!` 标记
- [ ] 每个 DTO 有 `constructor(partial) { super(); Object.assign(this, partial) }`
- [ ] List Request 用 `CreateWalnutAdminRequestListDTO()`
- [ ] List Response 用 `CreateWalnutAdminResponseListDTO()`

## Schema

- [ ] Model `extends WalnutAdminCommonBasicModel`
- [ ] 有完整的 Type 导出（`ISysXxxDocument` / `ISysXxxModel` / `ISysXxxMethods`）
- [ ] `@Prop()` 有正确的 type 定义
- [ ] Enum 字段用 `Object.values()` 在 `@Prop({ enum: [...] })` 中

## Service

- [ ] **没有**显式返回类型（TypeScript 推断）
- [ ] **没有** try-catch 块
- [ ] 错误信息用 i18n key
- [ ] null/undefined 检查用 `isNil`（lodash）
- [ ] MongoDB session 参数命名为 `dbSession`（非 `session`）

## Import

- [ ] 跨模块引用用 `@/*` alias（无 `../../`）
- [ ] 顶层 `import type`（非内联 `import { type X }`）
- [ ] Model 注入用 `AppInjectModel`（非 `@InjectModel`）
- [ ] 用 `WalnutDBModelName` 常量（非 `Model.name`）
- [ ] **没有** `index.ts` 桶文件

## 通用

- [ ] 无未使用的 import 或变量
- [ ] 无 `any` 类型
- [ ] 无单次使用的专用异常类（用内联异常替代）
