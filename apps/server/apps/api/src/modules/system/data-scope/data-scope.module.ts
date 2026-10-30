import { Global, Module } from '@nestjs/common'
import { SharedScopeResolverModule } from '@/modules/shared/scopeResolver/scope-resolver.module'
import { DataScopeService } from './data-scope.service'

/**
 * 数据权限模块（一期）。
 *
 * @Global：解析服务被三处横切消费 —— ALSRequestInterceptor（每请求种描述符）、
 * role.service（角色 dataScope/status 变更失效）、user 服务（角色绑定/切换失效）。
 * 依赖的 SysRoleRepoModule / SysUserRepositoryModule / AppTechCacheModule /
 * AppTokenModule 都是 @Global；非 global 的 SharedScopeResolverModule 在此显式 import。
 */
@Global()
@Module({
  imports: [SharedScopeResolverModule],
  providers: [DataScopeService],
  exports: [DataScopeService],
})
export class DataScopeModule {}
