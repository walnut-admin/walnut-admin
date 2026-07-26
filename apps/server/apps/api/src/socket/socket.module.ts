import { Global, Module } from '@nestjs/common'
import { AppMonitorUserModule } from '@/modules/app/monitor/user/user.module'
import { SocketGateway } from './socket.gateway'
import { SocketAuthMiddleware } from './socket.middleware'
import { SocketService } from './socket.service'

@Global()
@Module({
  imports: [AppMonitorUserModule],
  providers: [SocketGateway, SocketService, SocketAuthMiddleware],
  exports: [SocketService, SocketAuthMiddleware],
})
export class SocketModule {}
