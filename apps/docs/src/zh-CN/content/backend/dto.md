# DTO 与装饰器

> 本文是后端常驻指引 `apps/server/AGENTS.md` 的**参考部分**：里面只留了「写 DTO 之前必须知道的两条」，
> 完整规则、全部示例与装饰器顺序在这里。

## CRUD 装饰器工厂

CRUD 装饰器由工厂函数生成，一个模块建一次：

```typescript
import { WalnutCrudDecorators } from '@/decorators/crud'

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: 'YourModule',
  DTO: YourDTOSafe,
})
```

工厂的 `title` 会写进操作日志，`DTO` 会写进 Swagger 响应声明 —— 两者都不是可选的装饰性参数。
工厂同时还接受 `extra.needOperateLog`（默认 `true`）来关掉某个模块的操作日志。

## DTO 设计规则

### 必须用 RealPickType / RealPartialType

**绝不**直接用 NestJS 原生的 `PickType` / `PartialType`，一律用项目包装 `@walnut-server/utils/dto` 里的版本：

```typescript
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'

// 基础 DTO —— 继承 Model
export class SysUserDTO extends SysUserModel {
  constructor(partial: Partial<SysUserDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// Create DTO —— 挑出必填字段
export class SysUserCreateDTO extends RealPickType(SysUserDTO, [
  'username',
  'email',
  'role',
] as const) {
  constructor(partial: Partial<SysUserCreateDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// Update DTO —— Create DTO 的可选版本
export class SysUserUpdateDTO extends RealPartialType(SysUserCreateDTO) {
  constructor(partial: Partial<SysUserUpdateDTO>) {
    super()
    Object.assign(this, partial)
  }
}
```

**原因**：全局 `ClassSerializerInterceptor` 开了 `excludeExtraneousValues: true`（`apps/server/apps/api/src/main.ts`），
它要求所有字段带 `@Expose()` 才会被序列化。原生 `PickType` / `PartialType` **不会**补 `@Expose()`，
字段会被静默地从响应里过滤掉 —— 表现为接口 200 但字段凭空消失，极难排查。
项目包装正是在这里补 `@Expose()`（`RealPartialType` 还会给每个键补 `@IsOptional({ always: true })`）。

### 用项目自己的字段装饰器

字段一律用 `@walnut-server/decorators/field` 的装饰器，不要裸写 class-validator：

```typescript
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

export class UserRequestDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'User email' },
  })
  email: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: { description: 'Is admin' },
  })
  isAdmin: boolean
}
```

**好处**：一个装饰器同时承担「校验 + 转换 + Swagger 文档」三件事，三者不会再互相漂移。
可用的装饰器还有 `WalnutAdminDecoratorFieldEnum`（枚举）、`FieldDate`、`FieldNumber`、`FieldMongoId`、
`FieldObject`（嵌套对象）。

### 字段声明不要 `?` 与 `!`

**绝不**在 DTO 字段上用 TypeScript 的可选（`?`）或明确赋值断言（`!`）标记：

```typescript
// ❌ 错
export class UserDTO {
  value!: string // 不要用 !
  isActive?: boolean // 不要用 ?
}

// ✅ 对 —— 默认值交给装饰器
export class UserDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'value' },
  })
  value: string // 不带标记

  @WalnutAdminDecoratorFieldBoolean({
    default: false, // 默认值写在装饰器里
    swaggerOptions: { description: 'is active' },
  })
  isActive: boolean // 不带标记，有默认值

  @WalnutAdminDecoratorFieldString({
    default: null, // 可选字段用 null 作默认值
    swaggerOptions: { description: 'optional code' },
  })
  code: string
}
```

理由是这两类标记会让「字段是否必填」出现**两个真源**：类型上的 `?` 与校验装饰器上的 `required`。
声明成不可选 + 装饰器给默认值，必填性就只有一个地方说了算。
（`apps/server/tsconfig.json` 开了 `strictPropertyInitialization: false`，所以不写 `!` 也能编译。）

## 装饰器顺序

顺序由 ESLint 硬性强制（`local/sort-nestjs-decorators`，见 `apps/server/eslint.config.ts` 引的
`@walnut/eslint-config/nest`），跑 `pnpm lint:fix` 可以自动修。下面三张清单就是规则里的顺序表，
**别凭记忆排**。

### 方法装饰器顺序

自上而下：

1. HTTP 方法（`@Get`、`@Post`、`@Put`、`@Patch`、`@Delete`）
2. 响应码（`@HttpCode`）
3. 权限 / 角色（`@WalnutAdminDecoratorHasPermission`、`@WalnutAdminDecoratorHasRole`）
4. 功能性 Guard（`@WalnutAdminDecoratorFunctionalGuard`）
5. CRUD 装饰器（`@WalnutAdminDecoratorList`、`@WalnutAdminDecoratorCreate`、`@WalnutAdminDecoratorRead`、`@WalnutAdminDecoratorUpdate`、`@WalnutAdminDecoratorDelete`、`@WalnutAdminDecoratorDeleteMany`）
6. Guard Free（`@WalnutAdminGuardJwtOptional`、`@WalnutAdminGuardLockFree`、`@WalnutAdminGuardSignFree`、`@WalnutAdminGuardMFAFree`、`@WalnutAdminGuardJwtFree`、`@WalnutAdminGuardCapFree`、`@WalnutAdminGuardDeviceFree`、`@WalnutAdminGuardIpFree`）
7. 事务（`@WalnutDBTransaction`，见 [MongoDB 事务](./transactions.md)）
8. Swagger（`@ApiExtraModels`、`@ApiParam`、`@ApiQuery`、`@ApiBody`、`@ApiWalnutOkResponse`、`@ApiOkResponse`）
9. 功能性（`@WalnutAdminDecoratorFreeResponse`、`@WalnutAdminDecoratorCache`、`@WalnutAdminDecoratorAuthLog`、`@WalnutAdminDecoratorOperateLog`、`@WalnutAdminDecoratorThrottle`、`@WalnutAdminDecoratorDevOnly`、`@Render`）
10. `@UseGuards`（**在最后**，不是「Guard 那一条」的位置）

> ⚠️ 最容易记错的是第 4 条与第 10 条：`@UseGuards` 排在最末，而不是紧跟权限装饰器。

### 参数装饰器顺序

1. 上下文（`@WalnutAdminDecoratorJti`、`@WalnutAdminDecoratorUser`）
2. 设备（`@WalnutAdminDecoratorDeviceId`）
3. 会话（`@WalnutDBSession`）
4. Cookie（`@WalnutAdminDecoratorCookie`）
5. 路径参数（`@WalnutAdminDecoratorParamMongoId`、`@WalnutAdminDecoratorParamMongoIds`）
6. 标准（`@Req`、`@Request`、`@Res`、`@Response`、`@Param`、`@Query`、`@Body`、`@Headers`）
7. 元信息（`@Ip`、`@I18n`）

### 类装饰器顺序

1. `@Controller`
2. `@ApiTags`
3. `@UseGuards`
