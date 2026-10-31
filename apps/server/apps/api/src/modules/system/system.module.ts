import { Module } from '@nestjs/common'
import { SysIdentityModule } from '@walnut-server/identity'

import { DataScopeModule } from './data-scope/data-scope.module'
import { SysDeletedModule } from './deleted/deleted.module'
import { SysDeptModule } from './dept/dept.module'
import { SysDeviceModule } from './device/device.module'
import { SysDictDataModule } from './dict/dictData/dictData.module'
import { SysDictTypeModule } from './dict/dictType/dictType.module'
import { SysEmployeeModule } from './employee/employee.module'
import { SysIdentityHttpModule } from './identity/identity-http.module'
import { SysLangModule } from './lang/lang.module'
import { SysLocaleModule } from './locale/locale.module'
import { SysLogAuthModule } from './logs/auth/log.auth.module'
import { SysLogOperateModule } from './logs/operate/log.operate.module'
import { SysMenuModule } from './menu/menu.module'
import { SysPostModule } from './post/post.module'
import { SysRoleModule } from './role/role.module'

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

    // 身份内核（libs/identity 聚合）+ HTTP 组合根（controller 依赖 app guard/decorator，
    // 留 app 声明；库内只做服务/数据面）。批 6。
    SysIdentityModule,
    SysIdentityHttpModule,
  ],
  // APP_GUARD（WalnutAdminGuardLock）从 AppModule 注入 SysUserLockService —— 保持
  // 解耦前 SystemModule 对 lock 服务的可见面（聚合模块的 exports 全量透出）。
  exports: [SysIdentityModule],
})
export class SystemModule {}
