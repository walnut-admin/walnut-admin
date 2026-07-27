---
name: 添加数据字段
description: 在已有 NestJS 模块的 Schema + DTO 中同步添加新字段。适用场景：给数据表加字段、扩展模型属性。
when_to_use: 添加字段、新增列、扩展 Schema、加属性、DTO 加字段
paths:
  - apps/server/**
---

# 添加数据字段

## 核心约束

### 1. 字段声明禁止 `?` 和 `!`

```typescript
// ❌ 错误
value!: string
isActive?: boolean

// ✅ 正确 — 用装饰器 default 替代
@WalnutAdminDecoratorFieldBoolean({ default: false, swaggerOptions: { description: '是否启用' } })
isActive: boolean

@WalnutAdminDecoratorFieldString({ default: null, swaggerOptions: { description: '可选字段' } })
code: string
```

### 2. 字段装饰器映射（来自 `@/decorators/field`）

| 类型 | 装饰器 |
|------|--------|
| `string` | `WalnutAdminDecoratorFieldString` |
| `number` | `WalnutAdminDecoratorFieldNumber` |
| `boolean` | `WalnutAdminDecoratorFieldBoolean` |
| `Date` | `WalnutAdminDecoratorFieldDate` |
| `enum` | `WalnutAdminDecoratorFieldEnum` |
| `MongoId` | `WalnutAdminDecoratorFieldMongoId` |
| `object` | `WalnutAdminDecoratorFieldObject` |

**禁止**使用原生 class-validator 装饰器。

### 3. Enum 字段特殊规则

定义 const enum，`@Prop` 中用 `Object.values()`：

```typescript
const StatusEnum = { ACTIVE: 'active', INACTIVE: 'inactive' } as const

@WalnutAdminDecoratorFieldEnum({ ... })
@Prop({ type: String, enum: [...Object.values(StatusEnum)], default: null })
status: string
```

## 关键约定

- Schema Model 必须 `extends WalnutAdminCommonBasicModel`
- `@Prop()` 来自 mongoose，需要同时写字段装饰器 + `@Prop`
- 可选字段用 `default: null`
- 敏感字段加 `select: false` 在 `@Prop()` 中，并从 Safe DTO 中排除
- 同步更新 Create DTO / Update DTO / Response DTO 中对应的 `RealPickType` 数组

## 常见错误

- 用 `?` 标记可选字段 → 用 `default: null` 替代
- 只改 Schema 忘改 DTO → API 响应缺少该字段
- Enum 用 `@Prop({ enum: StatusEnum })` 而非 `Object.values(StatusEnum)` → 校验可能失败
- 忘记在 DTO 构造函数中保留 `Object.assign(this, partial)`

## 验证

```bash
pnpm lint:fix && pnpm types:check
```
