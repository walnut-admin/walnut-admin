import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_DATA_SCOPE_POLICY } from '@walnut-server/repository'
import { WalnutAdminDataScopePolicyService } from './data-scope.policy'

/**
 * 数据权限策略端口的 app 绑定（libs 解耦批 7）。
 *
 * `WALNUT_ADMIN_DATA_SCOPE_POLICY` 的实现在 app（`data-scope.policy.ts` 委托 app 侧
 * 实体注册表 + libs/system 的谓词纯函数）—— 它不能进 lib（注册表横跨 app / auth /
 * shared 实体）。批 7 前该绑定在 system 的 `DataScopeModule`（@Global，随模块进 lib）；
 * 现在模块在 lib、实现仍在 app，绑定移到本 @Global 模块，由 app 的 `SystemModule` 引入。
 *
 * 缺绑定 = 启动期 DI 报错（基类仓库在 libs/repository 只认端口，不会 fail-open）。
 */
@Global()
@Module({
  providers: [
    WalnutAdminDataScopePolicyService,
    {
      provide: WALNUT_ADMIN_DATA_SCOPE_POLICY,
      useExisting: WalnutAdminDataScopePolicyService,
    },
  ],
  exports: [WALNUT_ADMIN_DATA_SCOPE_POLICY],
})
export class WalnutAdminDataScopePolicyModule {}
