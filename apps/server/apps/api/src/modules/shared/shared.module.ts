import { Module } from '@nestjs/common'
import { AppALSRequestModule } from '@walnut-server/als'
import { SharedAliModule, SharedAreaModule, SharedMaskModule } from '@walnut-server/app-domain'
import { SharedBLPathModule } from '@walnut-server/blpath'
import { SharedDelayModule } from '@walnut-server/delay'
import { SharedIpModule } from '@walnut-server/ip'
import { AppTokenModule } from '@walnut-server/token'

/**
 * shared 能力组合根（libs 解耦批 9）。
 *
 * 批 9 把 shared 目录的最后三件下沉 `@walnut-server/app-domain/shared`：
 * area（geo 业务表）、ali（阿里云 STS 封装）、mask（DI 壳，唯一调用方是
 * app-domain 的 `AppErrorService`）。本文件只做聚合，保持原来的模块接入顺序
 * （token → ali → area → ALS → delay → BLPath → ip → mask），路由顺序不变。
 */
@Module({
  imports: [AppTokenModule, SharedAliModule, SharedAreaModule, AppALSRequestModule, SharedDelayModule, SharedBLPathModule, SharedIpModule, SharedMaskModule],
})
export class SharedModule {}
