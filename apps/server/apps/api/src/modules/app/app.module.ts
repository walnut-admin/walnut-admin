import { Module } from '@nestjs/common'
import { AppDemoModule } from './demo/demo.module'
import { AppErrorModule } from './error/error.module'
import { AppKeyModule } from './key/key.module'
import { AppLoggerModule } from './logger/logger.module'
import { AppMonitorModule } from './monitor/monitor.module'
import { AppSettingsModule } from './setting/setting.module'

@Module({
  imports: [
    AppDemoModule,
    AppErrorModule,
    AppMonitorModule,
    AppSettingsModule,
    AppKeyModule,
    AppLoggerModule,
  ],
})
export class AppAppModule {}
