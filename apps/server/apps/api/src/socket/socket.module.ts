import { Global, Module } from '@nestjs/common'
import { AppMonitorUserHttpModule } from '@/modules/app/monitor/user/user-http.module'
import { SocketGateway } from './socket.gateway'
import { SocketAuthMiddleware } from './socket.middleware'
import { SocketService } from './socket.service'

/**
 * 批 9：AppMonitorUserModule 的数据面已下沉 `@walnut-server/app-domain`，
 * controller + wire DTO 留在 app 的 `AppMonitorUserHttpModule`。本模块改 import
 * app 的 HTTP 组合根（其 exports 再导出 lib 模块），`/app/monitor/user/*` 的
 * 路由仍然在这里（SocketModule 在根模块中先于 AppAppModule）注册 —— 顺序不变。
 */
@Global()
@Module({
  imports: [AppMonitorUserHttpModule],
  providers: [SocketGateway, SocketService, SocketAuthMiddleware],
  exports: [SocketService, SocketAuthMiddleware],
})
export class SocketModule {}
