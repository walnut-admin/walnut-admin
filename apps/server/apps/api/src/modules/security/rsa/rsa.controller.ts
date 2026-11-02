import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminGuardCapFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SecurityRsaService } from '@walnut-server/rsa'
import { SecurityRoutes } from '@walnut/contract'

@Controller(SecurityRoutes.RSA)
@ApiTags('security/rsa')
export class SecurityRsaController {
  constructor(private readonly securityRsaService: SecurityRsaService) {}

  @Get('public-key')
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  // F-18（DOC-07）：此前 200 无 schema（handler 返回 PEM 串，不是对象）。
  @ApiWalnutOkResponse({
    description: 'get the current RSA public key (PEM) used by clients to encrypt request payloads',
    primitive: 'string',
  })
  async getPublicKey() {
    return this.securityRsaService.getCurrentRsaPublicKey()
  }
}
