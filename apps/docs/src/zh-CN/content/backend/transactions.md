# MongoDB 事务

后端的事务支持建立在 MongoDB 副本集之上 —— **没有副本集就没有事务**，先确认这一点再排查别处。

## 初始化副本集

单节点副本集就够本地开发用，在 mongo shell 里执行一次即可：

```bash
# 在 mongo shell 里
rs.initiate()
```

连接串要带 `replicaSet` 参数，`apps/server/env-encrypted/` 里的密文已经带上了（见
[环境配置](./configuration.md)）。

## 在控制器方法上加装饰器

```typescript
class UserController {
  @WalnutAdminDecoratorCreate({
    operateLog: { title: 'User' },
    swagger: { DTO: UserDTO },
  })
  @WalnutDBTransaction()
  async create(@Body() dto: UserCreateDTO) {
    return this.service.create(dto)
  }
}
```

- `@WalnutDBTransaction()` 来自 `@walnut-server/db`，它挂的是 `TransactionInterceptor`：请求进来
  `startSession()` + `startTransaction()`，正常返回则 `commitTransaction()`，抛错则 `abortTransaction()`。
- 装饰器顺序里它排在第 7 位（Guard Free 之后、Swagger 之前），完整顺序见 [DTO 与装饰器](./dto.md)。
- session 通过 `@WalnutDBSession()` 参数装饰器取出，它读的是 `request.mongooseSession`。

## 在 service 里用 session

session 由控制器取出来之后**显式传参**给 service：

```typescript
import type { ClientSession } from 'mongoose'
import { runAfterCommit } from '@walnut-server/db'

class SysUserService {
  async create(payload: SysUserDTOCreateRequest, dbSession: ClientSession) {
    const user = new this.userModel({ ...payload })
    await user.save({ session: dbSession })

    // 事务提交之后才执行的操作
    await runAfterCommit(async () => {
      await this.cacheService.invalidateUserCache(user._id)
    })

    return user
  }
}
```

两条要点：

- **所有写库操作都要带上 `session`**（`save({ session })`、`findOneAndUpdate(..., { session })` 等）。
  漏传的那个操作会跑在事务之外，回滚时不会跟着回滚 —— 这是这套机制最典型的坑。
  查一下 `*.basic.repository.ts` 的方法签名，`dbSession` 是统一的最后一个可选参数。
- **提交后才做的事（清缓存、发事件）放进 `runAfterCommit`**。它有两种形态：
  `runAfterCommit` 是宽松版（不在事务里就直接执行），`registerAfterCommitHook` 是严格版
  （不在事务上下文里直接抛错，用来把误用尽早暴露）。两者都在 `@walnut-server/db`。

> 📌 示例只演示 session 的用法。按 `apps/server/AGENTS.md` 的「三种 Repository 模式」，
> controller 级的 `*.service.ts` 应当把 session **透传给 repository**，而不是自己拿 Model 写库。

## 名字对照（旧写法已失效）

早期文档里出现过下面这些名字，**当前代码里一个都不存在**，遇到时按下表替换：

| 旧名字 | 现在用什么 |
|--------|-----------|
| `@WalnutAdminDecoratorMongoDBTransaction()` | `@WalnutDBTransaction()` |
| `@WalnutAdminDecoratorMongoDBSession()` | `@WalnutDBSession()` |
| `getWalnutAdminDBSession()` | 控制器 `@WalnutDBSession()` 取出来后作为参数传给 service |
| `runAfterTransaction()` | `runAfterCommit()` / `registerAfterCommitHook()` |
