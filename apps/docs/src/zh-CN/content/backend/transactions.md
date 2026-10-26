# PostgreSQL 事务

事务建立在 PostgreSQL 之上 —— **单节点即完整 ACID**，没有副本集前置条件，库起好就有事务
（ADR 0021 Decision 3：装饰器 API 不变，内部实现从 Mongo session 换成 PG 事务）。

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

- `@WalnutDBTransaction()` 来自 `@walnut-server/db`，它挂的是 `WalnutTxInterceptor`：请求进来
  `createQueryRunner()` + `startTransaction()`，正常返回则 `commitTransaction()`（随后
  `release()` 并统一执行 after-commit 钩子），抛错则 `rollbackTransaction()` + `release()`、
  原始错误透传。
- 拦截器内部走 **QueryRunner 方式**而不是 `DataSource.transaction()` 回调式 —— 后者把事务
  生命周期锁在回调作用域里，无法与拦截器的 commit / release 解耦，也无法把事务内的
  EntityManager 交出去给业务层。
- 装饰器顺序里它排在第 7 位（Guard Free 之后、Swagger 之前），完整顺序见 [DTO 与装饰器](./dto.md)。
- 事务上下文经 `@WalnutDBSession()` 参数装饰器取出，它读的是 `request.txContext`，
  形状是 `WalnutTxContext = { em: EntityManager }`。

## 在 service 里用 em

事务上下文由控制器取出来之后**显式传参**给 service：

```typescript
import type { EntityManager } from 'typeorm'
import { runAfterCommit } from '@walnut-server/db'

class SysUserService {
  async create(payload: SysUserDTOCreateRequest, em?: EntityManager) {
    // 所有数据路径都走 em：事务内是 QueryRunner.manager，缺省是连接级 manager（非事务路径）
    const user = await this.userRepository.create(payload, em)

    // 事务提交之后才执行的操作
    await runAfterCommit(async () => {
      await this.cacheService.invalidateUserCache(user.id)
    })

    return user
  }
}
```

三条要点：

- **所有写库操作都要带上 `em`**。漏传的那个操作会落到连接级 manager、跑在事务之外，回滚时不会
  跟着回滚 —— 这是这套机制最典型的坑。查一下 `*.basic.repository.ts` 与 repo / shared service 的
  方法签名，`em` 是统一的最后一个可选参数（缺省即非事务路径，语义同迁移前 Mongo 版的可选
  `dbSession`）。
- **提交后才做的事（清缓存、发事件）放进 `runAfterCommit`**。它有两种形态：
  `runAfterCommit` 是宽松版（不在事务里就直接执行），`registerAfterCommitHook` 是严格版
  （不在事务上下文里直接抛错，用来把误用尽早暴露）。两者都在 `@walnut-server/db`。
- **需要拦并发重放的读要显式持悲观锁**。PG 默认隔离级别 READ COMMITTED，两个并发事务读同一行
  不会像 Mongo 事务那样靠写冲突 abort 一方 —— 谁先 commit 谁生效，另一方照样读到旧值。所以
  这类读必须加悲观写锁（模板见 refresh 轮换按 jti 读旧令牌）：
  `findOne({ where: { jti }, lock: { mode: 'pessimistic_write' } })`，并且只在活跃事务里加锁
  （非事务上下文的连接级 manager 提供不了并发保护，退化为普通读）。

> 📌 示例只演示 em 的用法。按 `apps/server/AGENTS.md` 的「三种 Repository 模式」，
> controller 级的 `*.service.ts` 应当把 em **透传给 repository**，而不是自己拿 EntityManager 写库。

## 名字对照（旧写法已失效）

早期文档里出现过下面这些名字，**当前代码里一个都不存在**，遇到时按下表替换：

| 旧名字 | 现在用什么 |
|--------|-----------|
| `@WalnutAdminDecoratorMongoDBTransaction()` | `@WalnutDBTransaction()` |
| `@WalnutAdminDecoratorMongoDBSession()` | `@WalnutDBSession()`（返回 `WalnutTxContext`，事务句柄取 `.em`） |
| `getWalnutAdminDBSession()` | 控制器 `@WalnutDBSession()` 取出来后作为参数传给 service |
| `runAfterTransaction()` | `runAfterCommit()` / `registerAfterCommitHook()` |
| `dbSession: ClientSession`（mongoose 句柄） | `em?: EntityManager`（typeorm 句柄） |
| `request.mongooseSession` | `request.txContext` |
