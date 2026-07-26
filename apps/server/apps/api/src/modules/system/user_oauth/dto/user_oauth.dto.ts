import { SysUserOAuthModel } from '../schema/user_oauth.schema'

export class SysUserOauthDto extends SysUserOAuthModel {
  constructor(partial: Partial<SysUserOauthDto>) {
    super()
    Object.assign(this, partial)
  }
}
