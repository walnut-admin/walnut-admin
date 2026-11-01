import { Controller, Get } from '@nestjs/common'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminGuardDeviceFree } from '@walnut-server/guards'
import { AppRoutes, AuthRoutes } from '@walnut/contract'
import { AppBackendDepsResponseDTO } from './app.dto'
import { AppService } from './app.service'

@Controller(AppRoutes.ROOT)
@WalnutAdminGuardDeviceFree()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get(AppRoutes.ROOT)
  @WalnutAdminGuardJwtFree()
  async getHello() {
    return this.appService.getHello()
  }

  @Get(AuthRoutes.BASE)
  async getHelloWithAuth() {
    return this.appService.getHelloAuth()
  }

  @Get(AppRoutes.DEPS)
  @ApiWalnutOkResponse({
    description: 'get backend package.json dependencies',
    DTO: AppBackendDepsResponseDTO,
  })
  async getPkgDeps() {
    return this.appService.getPkgDeps()
  }
}
