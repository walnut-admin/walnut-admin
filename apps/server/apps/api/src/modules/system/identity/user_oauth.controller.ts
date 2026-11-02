import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SystemRoutes } from '@walnut/contract'

@Controller(SystemRoutes.USER_OAUTH)
@ApiTags('system/user/oauth')
export class SysUserOauthController {}
