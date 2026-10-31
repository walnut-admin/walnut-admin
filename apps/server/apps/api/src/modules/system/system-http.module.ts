import { Module } from '@nestjs/common'
import { SysSystemModule } from '@walnut-server/system'
import { SysDeptController } from './dept/dept.controller'
import { SysDeviceController } from './device/device.controller'
import { SysDictDataController } from './dict/dictData/dictData.controller'
import { SysDictTypeController } from './dict/dictType/dictType.controller'
import { SysEmployeeController } from './employee/employee.controller'
import { SysLangController } from './lang/lang.controller'
import { SysLocaleController } from './locale/locale.controller'
import { SysLogAuthController } from './logs/auth/log.auth.controller'
import { SysLogOperateController } from './logs/operate/log.operate.controller'
import { SysMenuController } from './menu/menu.controller'
import { SysPostController } from './post/post.controller'
import { SysRoleController } from './role/role.controller'

/**
 * system 域的 HTTP 组合根（libs 解耦批 7）。
 *
 * controller 之所以不在 libs/system：它们依赖 app 的 guard / param decorator
 * （HasPermission / DecoratorUser / Throttle / JWT guard）与 user 的 wire DTO
 * （`SysUserDTOSafe`，swagger schema 注册顺序留 app）—— 放进 lib 会立刻形成
 * lib → app 反向依赖。与批 5 的 rsa、批 6 的 identity http 同款处置：数据面/服务
 * 下沉 lib，controller 留在 app 声明。路由前缀随文件原样保留，openapi 零 diff。
 *
 * controller 顺序与解耦前 `SystemModule` 的子模块装载顺序一致
 * （device → lang → locale → dictType → dictData → dept → post → employee →
 * logAuth → logOperate → menu → role）。deleted 的 controller 单独放在
 * `deleted-http.module.ts` —— 解耦前它由 AppDemoModule import 的 SysDeletedModule 声明，
 * 路径排在 app/demo 之后，顺序不能丢。
 * 依赖的服务经 `SysSystemModule` 的 exports 可见（dept/post 的 service 已补导出）。
 */
@Module({
  imports: [SysSystemModule],
  controllers: [
    SysDeviceController,
    SysLangController,
    SysLocaleController,
    SysDictTypeController,
    SysDictDataController,
    SysDeptController,
    SysPostController,
    SysEmployeeController,
    SysLogAuthController,
    SysLogOperateController,
    SysMenuController,
    SysRoleController,
  ],
})
export class SysSystemHttpModule {}
