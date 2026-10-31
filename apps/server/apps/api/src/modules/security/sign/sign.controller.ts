import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorEncryptResponse, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardIpFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SecuritySignHandShakeRequestDTO, SecuritySignService, SecuritySignSessionKeyResponseDTO } from '@walnut-server/security'

@Controller('security/sign')
@ApiTags('security/sign')
@WalnutAdminGuardSignFree()
@WalnutAdminGuardCapFree()
@WalnutAdminGuardJwtFree()
@WalnutAdminGuardLockFree()
@WalnutAdminGuardDeviceFree()
@WalnutAdminGuardIpFree()
export class SecuritySignController {
  constructor(
    private readonly securitySignService: SecuritySignService,
  ) { }

  @Post('initial')
  @HttpCode(HttpStatus.OK)
  async initial(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @Body() payload: SecuritySignHandShakeRequestDTO,
  ) {
    return this.securitySignService.initial(deviceId, payload)
  }

  @Post('aes-key')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'get security sign session AES key (aesKey is an RSA envelope payload string)',
    DTO: SecuritySignSessionKeyResponseDTO,
  })
  @WalnutAdminDecoratorEncryptResponse<SecuritySignSessionKeyResponseDTO>('aesKey')
  async getAesKey(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
  ) {
    const res = await this.securitySignService.getAesKey(deviceId)
    return new SecuritySignSessionKeyResponseDTO(res)
  }
}
