import { Module } from '@nestjs/common'
import { DataScopeModule } from './data-scope/data-scope.module'
import { SysDeletedModule } from './deleted/deleted.module'
import { SysDeptModule } from './dept/dept.module'
import { SysDeviceModule } from './device/device.module'
import { SysDictDataModule } from './dict/dictData/dictData.module'
import { SysDictTypeModule } from './dict/dictType/dictType.module'
import { SysEmployeeModule } from './employee/employee.module'
import { SysLangModule } from './lang/lang.module'
import { SysLocaleModule } from './locale/locale.module'
import { SysLogAuthModule } from './logs/auth/log.auth.module'
import { SysLogOperateModule } from './logs/operate/log.operate.module'
import { SysMenuModule } from './menu/menu.module'
import { SysPostModule } from './post/post.module'
import { SysRoleModule } from './role/role.module'

/**
 * system 域的聚合模块（libs 解耦批 7）。
 *
 * app 的 `modules/system/system.module.ts` 只 import 本聚合 + identity 聚合 + 两个
 * HTTP 组合根（identity / system 的 controller 都依赖 app 的 guard / decorator）。
 *
 * 子模块接入顺序与解耦前 `SystemModule` 完全一致（data-scope → deleted → device →
 * lang → locale → dictType → dictData → dept → post → employee → logAuth →
 * logOperate → menu → role）；controller 不在 lib 里，HTTP 路由由 app 的
 * `SysSystemHttpModule` 声明，Swagger 路径装配顺序不变。
 *
 * @Global 的 DataScopeModule / SysDeletedRepoModule / SysRoleRepoModule 等仍按原样
 * 导出（全局可见），app 的 role/dept/user 服务与基类仓库的端口绑定不受影响。
 */
@Module({
  imports: [
    // 数据权限一期（@Global）：ALS 拦截器 + role/user 写路径的失效腿都从这里取
    DataScopeModule,

    SysDeletedModule,
    SysDeviceModule,

    SysLangModule,
    SysLocaleModule,

    SysDictTypeModule,
    SysDictDataModule,

    // 组织基础表（部门 / 岗位 / 职工）—— 数据权限二期部门维度的地基
    SysDeptModule,
    SysPostModule,
    SysEmployeeModule,

    SysLogAuthModule,
    SysLogOperateModule,

    SysMenuModule,
    SysRoleModule,
  ],
  exports: [
    DataScopeModule,
    SysDeletedModule,
    SysDeviceModule,
    SysLangModule,
    SysLocaleModule,
    SysDictTypeModule,
    SysDictDataModule,
    SysDeptModule,
    SysPostModule,
    SysEmployeeModule,
    SysLogAuthModule,
    SysLogOperateModule,
    SysMenuModule,
    SysRoleModule,
  ],
})
export class SysSystemModule {}
