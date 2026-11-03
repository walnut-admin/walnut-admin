import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SysLogAuthRepoModule } from '../repo/log.auth.repo.module'
import { SysLogAuthSharedService } from './log.auth.shared.service'

/**
 * SysLogAuthSharedModule
 *
 * 认证日志共享服务：`recordAuth` 拼 i18n 文案 → IP 定位 → 落 auth 日志 → 失败时触发风控收集。
 *
 * 为什么**不是** @Global（批 12 撤除，判据见 apps/server/AGENTS.md
 * 「Repository 与 Shared Service（两种形态，一个判据）」）：
 * @Global 只有一个判据 —— **消费方模块数 ≥ 2**（数「声明了注入本模块 provider 的类」的模块，
 * 含 `controllers[]` 与属性级 `@Inject`）。本模块的 3 个注入点：
 *   1. `WalnutAdminInterceptorRequestAuthLog`（libs/guards/src/decorators/log.auth.decorator.ts，
 *      构造器注入，由 `@WalnutAdminDecoratorAuthLog` 自动挂进宿主 controller）；
 *   2. `WalnutAdminGuardAuth` mixin 里的**属性级** `@Inject(SysLogAuthSharedService)`
 *      （libs/guards/src/guards/auth.guard.ts，各子类被声明为某个模块的 provider）；
 *   3. `AuthOpaqueUserController`（构造器注入）。
 * 三者的宿主**全是同一个模块** `AuthHttpModule`（apps/api/src/modules/auth/auth-http.module.ts：
 * 9 个 controller + 5 个 mixin guard 都登记在那里）⇒ 消费方模块数 = 1 < 2 ⇒ 不许 @Global，
 * 改由拥有者模块显式 import。
 *
 * import 必须落在 `AuthHttpModule`（controller 宿主），不能落父模块 `auth.module.ts`：
 * Nest 的 imports 不向下继承，interceptor / guard 注入的是**宿主 controller 所在模块**的注入器；
 * 写错位置时编译期 / lint / 单测全绿，只在启动期炸 DI —— 这就是
 * `pnpm openapi:export`（真 bootstrap AppModule）必须进验收的原因。
 */
@Module({
  imports: [SysLogAuthRepoModule],
  providers: [SysLogAuthSharedService, Reflector],
  exports: [SysLogAuthSharedService],
})
export class SysLogAuthSharedModule {}
