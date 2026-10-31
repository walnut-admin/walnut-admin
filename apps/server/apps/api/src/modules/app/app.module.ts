import { Module } from '@nestjs/common'
import { AppDemoModule, AppErrorModule, AppKeyModule, AppLoggerModule, AppSettingsModule } from '@walnut-server/app-domain'
import { SysDeletedHttpModule } from '../system/deleted/deleted-http.module'
import { AppMonitorModule } from './monitor/monitor.module'

/**
 * app 域组合根（libs 解耦批 9：域内容全部下沉 `@walnut-server/app-domain`）。
 *
 * 本文件仍是 app 组合件，因为它要**与 app 的 HTTP 组合根交错**：
 * `SysDeletedHttpModule`（批 7 留 app 的回收站 controller）必须紧随
 * `AppDemoModule` 注册，`/app/demo` → `/system/deleted` → `/app/error` 的 Swagger
 * 路径顺序才与解耦前逐字节一致；`AppMonitorModule` 又夹着 app 的 user HTTP 组合。
 * 因此 lib 不提供顶层聚合 module（批次 6-8 的聚合件在这里会让这两个交错点丢序）。
 *
 * 子模块接入顺序与解耦前 `AppAppModule` 完全一致
 * （demo → [deleted-http] → error → monitor → settings → key → logger）。
 */
@Module({
  imports: [
    AppDemoModule,

    // 批 7：回收站 controller 留 app；位置钉死 demo 之后、error 之前
    SysDeletedHttpModule,

    AppErrorModule,
    AppMonitorModule,
    AppSettingsModule,
    AppKeyModule,
    AppLoggerModule,
  ],
})
export class AppAppModule {}
