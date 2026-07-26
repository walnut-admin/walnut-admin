import { Module } from '@nestjs/common'

import { SysDeletedModule } from './deleted/deleted.module'
import { SysDeviceModule } from './device/device.module'
import { SysDictDataModule } from './dict/dictData/dictData.module'
import { SysDictTypeModule } from './dict/dictType/dictType.module'
import { SysLangModule } from './lang/lang.module'
import { SysLocaleModule } from './locale/locale.module'
import { SysLogAuthModule } from './logs/auth/log.auth.module'
import { SysLogOperateModule } from './logs/operate/log.operate.module'
import { SysMenuModule } from './menu/menu.module'
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
    SysDeletedModule,
    SysDeviceModule,

    SysLangModule,
    SysLocaleModule,

    SysDictTypeModule,
    SysDictDataModule,

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
