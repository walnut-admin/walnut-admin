# 代码风格

> 本文是后端常驻指引 `apps/server/AGENTS.md` 的**参考部分**。这里的每一条都对应一次真实踩坑，
> 不是审美偏好 —— 写后端代码前请通读一遍。

## 路径别名

`apps/server/tsconfig.json` 定义了两组别名，跨模块导入一律走别名：

```typescript
// ✅ 对 —— @/* 指 apps/api/src/*，@walnut-server/* 指 libs/*/src
import { WalnutAdminDecoratorList } from '@/decorators/crud'
import { RealPickType } from '@walnut-server/utils/dto'
import { Something } from '@/modules/some/module'

// ❌ 错 —— 跨模块不要用相对路径
import { Something } from '../../../some/module'
```

相对路径只在**同一模块内部**使用（比如 controller 引同目录的 service、schema）。
跨模块的相对路径会让「这个符号属于哪一层」彻底看不出来，也会在后端内部目录调整时集体断链。

## 类型导入

用顶层 `import type`，不要用内联 `type` 修饰符：

```typescript
// ✅ 对 —— 顶层 type 导入
import type { IUserType } from './schema'

// ❌ 错 —— 内联 type 修饰符
import { type IUserType } from './schema'
```

由 ESLint 的 `ts/consistent-type-imports` 强制（`prefer: 'type-imports'` +
`fixStyle: 'separate-type-imports'`），跑 `pnpm lint:fix` 可自动修。

## 返回类型交给 TS 推断

service / repository 的方法**不要**写显式返回类型：

```typescript
// ❌ 错 —— 手写显式返回类型
class UserRepository {
  async findById(id: string): Promise<IUserDocument | null> {
    return this.userModel.findById(id).exec()
  }
}
```

```typescript
// ✅ 对 —— 让 TS 推断
class UserRepository {
  async findById(id: string) {
    return this.userModel.findById(id).exec()
  }
}
```

显式返回类型在改实现时会**说谎**：实现已经不返回那个类型了，签名还写着。
推断出来的类型永远和实现对得上。

## service 里不要 try-catch

**不要**在 service 方法里用 try-catch，让异常冒到全局异常过滤器：

```typescript
// ❌ 错 —— 没必要的 try-catch，把异常吞成了普通返回值
class VerificationService {
  async check(dto: CheckDTO) {
    try {
      await this.sendCode(dto)
      return { success: true }
    }
    catch (error) {
      return { success: false, message: error.message }
    }
  }
}
```

```typescript
// ✅ 对 —— 让异常冒泡
class VerificationService {
  async check(dto: CheckDTO) {
    await this.sendCode(dto)
    // 成功：返回 void 或数据
    // 失败：抛异常，由全局过滤器统一处理
  }
}
```

把异常吞成 `{ success: false }` 会让 HTTP 状态码恒为 200，前端拿不到错误码，日志里也没有栈。

> ⚠️ 这条**不是零例外**，但例外的判据很清晰：**翻译外部错误**。第三方 SDK、协议边界
> （`security/opaque`、`shared/sms` 之类）抛出来的错误形态不受项目控制，那里需要 try-catch
> 把它转成项目自己的异常类型。判据是「这个 catch 是不是在翻译外部错误」——
> 如果只是「怕它炸」，那就是反例。

## 异常类

**不要**为一次性的错误单独建异常类：

```typescript
// ❌ 错 —— 只为一处调用建了一个类
export class WalnutAdminExceptionUnbindDenied extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST,
      errMsg: 'business.auth.unbindAtLeastOneLoginMethodRequired',
    })
  }
}

// ✅ 对 —— 内联异常 + i18n key
throw new WalnutAdminExceptionBadRequest({
  errMsg: 'business.auth.unbindAtLeastOneLoginMethodRequired',
})
```

**规则**：只有被 3 处以上复用、或属于核心领域逻辑时才建异常类。
异常类都住在 `libs/exceptions/src/`：基础类在 `base.exception.ts`，按 HTTP 码归类的在 `base/`，
业务异常按领域归在 `business/`（`auth.ts`、`rsa.ts` …），导入路径形如
`@walnut-server/exceptions/base.exception`。

配套的是 **i18n key 而不是硬编码文案**：`errMsg` 写 key（`business.auth.*` 这种），
真实文案在 `apps/api/src/i18n/` 的语言文件里，这样前后端和邮件/短信模板能共用同一套词条。
