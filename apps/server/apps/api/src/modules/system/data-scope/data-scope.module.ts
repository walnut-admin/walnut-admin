import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR } from '@walnut-server/identity'
import { WALNUT_ADMIN_DATA_SCOPE_POLICY } from '@walnut-server/repository'
import { SharedScopeResolverModule } from '@walnut-server/scope-resolver'
import { SysDeptRepoModule } from '../dept/dept.repo.module'
import { WalnutAdminDataScopePolicyService } from './data-scope.policy'
import { DataScopeService } from './data-scope.service'

/**
 * 数据权限模块（一期解析 + 二期部门维度）。
 *
 * @Global：解析服务被三处横切消费 —— ALSRequestInterceptor（每请求种描述符）、
 * role.service（角色 dataScope/status 变更失效）、user/dept 服务（角色绑定 / 部门变更失效）。
 * 依赖的 SysRoleRepoModule / SysUserRepositoryModule / AppTechCacheModule /
 * AppTokenModule 都是 @Global；非 global 的 SharedScopeResolverModule 与 SysDeptRepoModule
 * 在此显式 import（后者提供 DEPT_AND_CHILD 的递归子树入口，且不含 controller ——
 * 不改变 Swagger 的模块装载顺序）。
 *
 * 批 5：`WALNUT_ADMIN_DATA_SCOPE_POLICY` 绑定到本模块的策略服务（基类仓库在
 * libs/repository 里只认端口）；实体注册表与谓词纯函数仍在本目录/`common/repository`，
 * 一行未搬。绑定在本 @Global 模块，全局可见；缺绑定 = 启动期 DI 报错（绝无
 * 「空注册表 = 全部豁免」的 fail-open）。
 */
@Global()
@Module({
  imports: [SharedScopeResolverModule, SysDeptRepoModule],
  providers: [
    DataScopeService,
    WalnutAdminDataScopePolicyService,
    {
      provide: WALNUT_ADMIN_DATA_SCOPE_POLICY,
      useExisting: WalnutAdminDataScopePolicyService,
    },
    // 批 6：身份内核的 user 写路径只认此端口（libs/identity 不 import 本服务）
    {
      provide: WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR,
      useExisting: DataScopeService,
    },
  ],
  exports: [DataScopeService, WALNUT_ADMIN_DATA_SCOPE_POLICY, WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR],
})
export class DataScopeModule {}
