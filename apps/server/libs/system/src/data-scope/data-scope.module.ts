import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR } from '@walnut-server/identity'
import { SharedScopeResolverModule } from '@walnut-server/scope-resolver'
import { SysDeptRepoModule } from '../dept/dept.repo.module'
import { DataScopeService } from './data-scope.service'

/**
 * 数据权限模块（一期解析 + 二期部门维度；批 7 随 system 域下沉 libs/system）。
 *
 * @Global：解析服务被三处横切消费 —— ALSRequestInterceptor（每请求种描述符）、
 * role.service（角色 dataScope/status 变更失效）、user/dept 服务（角色绑定 / 部门变更失效）。
 * 依赖的 SysRoleRepoModule / SysUserRepositoryModule / AppTechCacheModule /
 * AppTokenModule 都是 @Global；非 global 的 SharedScopeResolverModule 与 SysDeptRepoModule
 * 在此显式 import（后者提供 DEPT_AND_CHILD 的递归子树入口，且不含 controller ——
 * 不改变 Swagger 的模块装载顺序）。
 *
 * 批 7：`WALNUT_ADMIN_DATA_SCOPE_POLICY` 端口实现（`apps/api/src/common/repository/
 * data-scope.policy.ts`）**仍在 app** —— 它依赖 app 侧的实体注册表（清单横跨
 * app / auth / shared / identity），不能进 lib。绑定改由 app 的
 * `WalnutAdminDataScopePolicyModule`（@Global）承担；本模块只保留 DataScopeService 与
 * 身份内核失效端口。缺绑定 = 启动期 DI 报错（绝无「空注册表 = 全部豁免」的 fail-open）。
 */
@Global()
@Module({
  imports: [SharedScopeResolverModule, SysDeptRepoModule],
  providers: [
    DataScopeService, // 批 6：身份内核的 user 写路径只认此端口（libs/identity 不 import 本服务）
    {
      provide: WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR,
      useExisting: DataScopeService,
    },
  ],
  exports: [DataScopeService, WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR],
})
export class DataScopeModule {}
