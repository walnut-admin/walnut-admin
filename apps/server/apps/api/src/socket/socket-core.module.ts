import { Global, Module } from '@nestjs/common'

import { SocketService } from './socket.service'

/**
 * socket 的**只有服务**的一半（worker 用）；gateway 那一半留在 SocketModule（api）。
 *
 * 判据是 R1 §3.2/§3.3 的两条事实：
 * - gateway / SocketAuthMiddleware / socket.io 适配器只在 NestApplication.init() 里装配
 *   （nest-application.js:104-113），createApplicationContext 下根本不会被初始化 ——
 *   所以 worker 加载 SocketGateway 是纯浪费，且没有意义；
 * - 但 SocketService **不能**跟着搬走：SysDeviceKickService（device.kick.service.ts:25-28）
 *   与 AppMonitorUserSharedService（user.shared.service.ts:25）都注入它，两者都是 @Global
 *   端口的实现，缺了 = worker 启动期 DI 报错。
 *
 * 必须是 @Global：那两处注入是跨模块的（今天靠 SocketModule 的 @Global 解析），
 * 改成显式 import 会动到 libs 的模块图。
 */
@Global()
@Module({
  providers: [SocketService],
  exports: [SocketService],
})
export class SocketCoreModule {}
