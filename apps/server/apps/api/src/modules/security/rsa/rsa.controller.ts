import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminGuardCapFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SecurityRsaService } from '@walnut-server/rsa'

@Controller('security/rsa')
@ApiTags('security/rsa')
export class SecurityRsaController {
  constructor(private readonly securityRsaService: SecurityRsaService) {}

  @Get('public-key')
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  async getPublicKey() {
    return this.securityRsaService.getCurrentRsaPublicKey()
  }
}
