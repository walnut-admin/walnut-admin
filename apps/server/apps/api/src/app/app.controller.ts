import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminGuardDeviceFree } from '@walnut-server/guards'
import { AppRoutes, AuthRoutes } from '@walnut/contract'
import { AppBackendDepsResponseDTO } from './app.dto'
import { AppService } from './app.service'

@Controller(AppRoutes.ROOT)
// F-48（DOC-12）：根 controller 三个端点（/、/auth、/deps）此前无标签，落在无标签组。
@ApiTags('app')
@WalnutAdminGuardDeviceFree()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get(AppRoutes.ROOT)
  @WalnutAdminGuardJwtFree()
  // F-18（DOC-07）：这两个演示端点此前 200 无任何 schema（handler 直接返回 i18n 译文串）。
  @ApiWalnutOkResponse({
    description: 'hello message of the API (i18n translated plain string)',
    primitive: 'string',
  })
  async getHello() {
    return this.appService.getHello()
  }

  @Get(AuthRoutes.BASE)
  @ApiWalnutOkResponse({
    description: 'hello message for authenticated users (i18n translated plain string)',
    primitive: 'string',
  })
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
