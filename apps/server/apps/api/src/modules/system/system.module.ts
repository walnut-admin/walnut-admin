import { Module } from '@nestjs/common'
import { SysIdentityModule } from '@walnut-server/identity'
import { SysSystemModule } from '@walnut-server/system'
import { WalnutAdminDataScopePolicyModule } from '@/common/repository/data-scope.policy.module'
import { SysIdentityHttpModule } from './identity/identity-http.module'
import { SysSystemHttpModule } from './system-http.module'

/**
 * system 域组合根（libs 解耦批 7）。
 *
 * - 数据面在 libs：`SysSystemModule`（role/menu/dept/post/employee/dict/lang/locale/
 *   logs/device/deleted/data-scope）+ `SysIdentityModule`（批 6 的七个身份栈子模块）。
 * - HTTP 组合根留 app：controller 依赖 app 的 guard / param decorator / user wire DTO，
 *   放进 lib 会立刻形成 lib → app。`SysSystemHttpModule` 声明 13 个 system controller，
 *   `SysIdentityHttpModule` 声明 9 个身份栈 controller —— 两者顺序与解耦前模块的装载
 *   顺序一致（system 各子模块 → identity），Swagger 路径顺序不变。
 * - 数据权限策略端口的实现依赖 app 侧实体注册表，绑定由
 *   `WalnutAdminDataScopePolicyModule`（@Global）承担。
 *
 * exports 保持 `SysIdentityModule`（APP_GUARD `WalnutAdminGuardLock` 从 AppModule 注入
 * `SysUserLockService` 的可见面）。
 */
@Module({
  imports: [
    WalnutAdminDataScopePolicyModule,

    SysSystemModule,
    SysSystemHttpModule,

    SysIdentityModule,
    SysIdentityHttpModule,
  ],
  exports: [SysIdentityModule],
})
export class SystemModule {}
