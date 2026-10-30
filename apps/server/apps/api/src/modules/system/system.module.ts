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
import { SysUserModule } from './user/user.module'
import { SysUserDeviceModule } from './user_device/user_device.module'
import { SysUserIdentityModule } from './user_identity/user_identity.module'
import { SysUserLockModule } from './user_lock/user_lock.module'
import { SysUserMfaModule } from './user_mfa/user_mfa.module'
import { SysUserOauthModule } from './user_oauth/user_oauth.module'
import { SysUserPreferenceModule } from './user_preference/user_preference.module'

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
    SysUserModule,
    SysUserDeviceModule,
    SysUserIdentityModule,
    SysUserLockModule,
    SysUserMfaModule,
    SysUserOauthModule,
    SysUserPreferenceModule,
  ],
  exports: [SysUserLockModule],
})
export class SystemModule {}
