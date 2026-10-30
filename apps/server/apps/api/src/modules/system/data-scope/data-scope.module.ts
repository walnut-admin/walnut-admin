import { Global, Module } from '@nestjs/common'
import { SharedScopeResolverModule } from '@/modules/shared/scopeResolver/scope-resolver.module'
import { SysDeptRepoModule } from '../dept/dept.repo.module'
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
 */
@Global()
@Module({
  imports: [SharedScopeResolverModule, SysDeptRepoModule],
  providers: [DataScopeService],
  exports: [DataScopeService],
})
export class DataScopeModule {}
