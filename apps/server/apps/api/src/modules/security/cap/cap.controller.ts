import { Solution } from '@cap.js/server'
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminDecoratorFreeResponse, WalnutAdminDecoratorThrottle, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SecurityCapService, SecurityCapSettingService } from '@walnut-server/security'
import { SecurityRoutes } from '@walnut/contract'

@Controller(SecurityRoutes.CAP)
@ApiTags('security/cap')
@WalnutAdminGuardCapFree()
@WalnutAdminGuardJwtFree()
@WalnutAdminGuardDeviceFree()
@WalnutAdminGuardLockFree()
@WalnutAdminDecoratorThrottle(SecurityCapSettingService)
export class SecurityCapController {
  constructor(
    private readonly capService: SecurityCapService,
  ) { }

  @Post('/challenge')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @WalnutAdminDecoratorFreeResponse()
  async getChallenge() {
    return this.capService.challenge()
  }

  @Post('/redeem')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @WalnutAdminDecoratorFreeResponse()
  async getRedeem(@Req() req: IWalnutAdminExpressRequest, @Body() body: Solution) {
    return this.capService.redeem(body, req)
  }
}
