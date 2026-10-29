import { Controller, Get } from '@nestjs/common'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminGuardDeviceFree } from '../guard/device.guard'
import { WalnutAdminGuardJwtFree } from '../modules/auth/modules/jwt/jwt-access.guard'
import { AppBackendDepsResponseDTO } from './app.dto'
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
  @ApiWalnutOkResponse({
    description: 'get backend package.json dependencies',
    DTO: AppBackendDepsResponseDTO,
  })
  async getPkgDeps() {
    return this.appService.getPkgDeps()
  }
}
