import { Controller, Get } from '@nestjs/common'
import { WalnutAdminGuardDeviceFree } from '../guard/device.guard'
import { WalnutAdminGuardJwtFree } from '../modules/auth/modules/jwt/jwt-access.guard'
import { AppService } from './app.service'

@Controller()
@WalnutAdminGuardDeviceFree()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @WalnutAdminGuardJwtFree()
  async getHello() {
    return this.appService.getHello()
  }

  @Get('auth')
  async getHelloWithAuth() {
    return this.appService.getHelloAuth()
  }

  @Get('deps')
  async getPkgDeps() {
    return this.appService.getPkgDeps()
  }
}
