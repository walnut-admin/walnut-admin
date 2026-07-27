---
name: 添加 API 端点
description: 在已有 NestJS Controller 中添加新的 API 端点（权限 + DTO + Service 方法 + 装饰器顺序）。适用场景：给现有模块新增接口。
when_to_use: 添加端点、新增接口、新增 API、添加路由、给模块加方法
paths:
  - apps/server/**
---

# 添加 API 端点

## 核心约束

### 1. 装饰器顺序（严格，ESLint 强制）

方法装饰器从上到下：
1. HTTP 方法（`@Get` / `@Post` / `@Put` / `@Patch` / `@Delete`）
2. `@HttpCode(HttpStatus.OK)`
3. `@WalnutAdminDecoratorHasPermission(Permissions.XXX)`
4. `@WalnutAdminDecoratorHasRole(...)`（可选）
5. `@UseGuards(...)`（可选）
6. CRUD 装饰器（如有）
7. Guard 豁免（`@WalnutAdminGuardJwtFree` 等）
8. `@WalnutDBTransaction()`（如涉及事务）
9. Swagger（`@ApiParam` / `@ApiQuery` / `@ApiWalnutOkResponse`）
10. 功能装饰器（`@WalnutAdminDecoratorOperateLog` 等）

参数装饰器从左到右：
1. `@WalnutAdminDecoratorUser()`
2. `@WalnutAdminDecoratorDeviceId()`
3. `@WalnutDBSession()`
4. `@WalnutAdminDecoratorParamMongoId()`
5. `@Req` / `@Param` / `@Query` / `@Body`
6. `@Ip` / `@I18n`

### 2. Controller 职责边界

Controller **只做三件事**：接收参数 → 调用 service → 包装响应

```typescript
const result = await this.service.xxxMethod(params)
return new XxxResponseDTO(result)
```

原始类型返回用 `@ApiWalnutOkResponse({ primitive: 'boolean' })` 配合 `return true`。

### 3. Delete 操作必须加 `@WalnutDBTransaction()`

### 4. Service 方法规则

- **不写**显式返回类型（让 TypeScript 推断）
- **禁止** try-catch（异常冒泡到全局 filter）
- **禁止**直接使用 Model → 走 repo/shared 层
- 如需事务：最后一个参数为 `dbSession?: ClientSession`
- 错误信息用 i18n key，**禁止**硬编码字符串

## 常见错误

- 装饰器顺序不对 → ESLint 报错，运行 `pnpm lint:fix` 可自动修复
- 忘记包装响应 DTO → 响应体为空或缺少字段
- Service 写了 `try { ... } catch (e) { ... }` → 全局异常 filter 被绕过
- Service 写了显式返回类型如 `: Promise<IUserDocument>` → 违反约定
- 权限字符串忘了在 controller 顶部 `Permissions` 对象里注册

## 验证

```bash
pnpm lint:fix && pnpm types:check
```
