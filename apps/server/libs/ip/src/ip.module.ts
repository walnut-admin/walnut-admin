import { HttpModule } from '@nestjs/axios'
import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IP_LOCATION_RESOLVER } from './ip.ports'
import { SharedIpService } from './ip.service'

@Global()
@Module({
  imports: [HttpModule],
  providers: [
    SharedIpService,
    // 批 4：操作日志拦截器（libs/crud）的 IP 定位端口绑定 —— lib 只认端口，
    // 实现由本服务提供（SharedIpService implements 该端口，编译期守护）
    {
      provide: WALNUT_ADMIN_IP_LOCATION_RESOLVER,
      useExisting: SharedIpService,
    },
  ],
  exports: [SharedIpService, WALNUT_ADMIN_IP_LOCATION_RESOLVER],
})
export class SharedIpModule {}
