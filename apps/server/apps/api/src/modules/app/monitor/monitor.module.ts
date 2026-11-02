import { Module } from '@nestjs/common'

import { AppMonitorCacheModule, AppMonitorServerModule } from '@walnut-server/app-domain'
import { AppMonitorUserHttpModule } from './user/user-http.module'

/**
 * monitor 子域组合根（libs 解耦批 9）。
 *
 * cache / server 的 controller 已随数据面进 lib（依赖全在 libs/guards）；
 * user 的 controller + wire DTO 留 app（virtual user 引 app 的 `SysUserDTOSafe`），
 * 由 `user-http.module.ts` 声明。三者接入顺序保持解耦前 cache → user → server，
 * Swagger 路径顺序不变。
 */
@Module({
  imports: [
    AppMonitorCacheModule,
    AppMonitorUserHttpModule,
    AppMonitorServerModule,
  ],
})
export class AppMonitorModule {}
