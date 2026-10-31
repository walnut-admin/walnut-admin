import { Module } from '@nestjs/common'
import { AppMonitorUserModule } from '@walnut-server/app-domain'
import { AppMonitorUserController } from './user.controller'

/**
 * 在线监控用户的 HTTP 组合根（libs 解耦批 9）。
 *
 * 数据面（service / repository / entity / recoverable）在 `libs/app-domain`；
 * controller 留 app —— 它的响应 DTO 组合了 `WalnutAdminVirtualUserDTO`（引 app 的
 * `SysUserDTOSafe`），放进 lib 会立刻形成 lib → app 反向依赖。类名沿用
 * `AppMonitorUserHttpModule`，避免与 lib 的 `AppMonitorUserModule` 重名。
 *
 * 路由顺序：本模块由 `SocketModule` 首个 import（解耦前即如此），
 * `/app/monitor/user/*` 的路径在 openapi 里排在 `/app/demo` 之前 —— 顺序不能动。
 */
@Module({
  imports: [AppMonitorUserModule],
  controllers: [AppMonitorUserController],
  exports: [AppMonitorUserModule],
})
export class AppMonitorUserHttpModule {}
