import { Module } from '@nestjs/common'
import { SysDeletedModule } from '@walnut-server/system'
import { SysDeletedController } from './deleted.controller'

/**
 * 回收站 HTTP 组合根（libs 解耦批 7）。
 *
 * 为什么不并进 `system-http.module`：解耦前 `AppDemoModule` 就 import 了
 * `SysDeletedModule`（软删通道），Nest 的模块图深度遍历会把 `SysDeletedController`
 * 的路由排在 `AppDemoModule` 之后、`AppErrorModule` 之前 —— openapi.json 的路径顺序
 * 依赖这一点。controller 留 app 后，把「controller 组合」拆成独立模块并仍由
 * `AppDemoModule` 引入，路径顺序才能逐字节不变（`system-http.module` 只声明其余 12 个
 * controller）。
 */
@Module({
  imports: [SysDeletedModule],
  controllers: [SysDeletedController],
})
export class SysDeletedHttpModule {}
