import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SecurityRsaService } from '@walnut-server/rsa'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'

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
