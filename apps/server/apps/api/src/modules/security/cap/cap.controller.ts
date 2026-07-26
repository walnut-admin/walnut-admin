import { Solution } from '@cap.js/server'
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminDecoratorFreeResponse } from '@/decorators/walnut/response.decorator'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminDecoratorThrottle } from '@/guard/throttler.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import { SecurityCapService } from './cap.service'
import { SecurityCapSettingService } from './cap.setting.service'

@Controller('security/cap')
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
