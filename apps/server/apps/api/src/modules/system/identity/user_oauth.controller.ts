import { Controller } from '@nestjs/common'
import { SystemRoutes } from '@walnut/contract'

/**
 * F-48 / 裁决 Q7a：空壳 controller（无任何方法）—— 保留 class 与路由前缀注册，
 * **不挂 @ApiTags**：一个没有任何 op 的 tag 只会在 openapi.json 的 tags 面里制造空组。
 */
@Controller(SystemRoutes.USER_OAUTH)
export class SysUserOauthController {}
