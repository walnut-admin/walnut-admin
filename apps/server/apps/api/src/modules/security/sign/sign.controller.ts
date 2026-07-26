import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminDecoratorEncryptResponse } from '@/decorators/walnut/crypto.decorator'
import { WalnutAdminDecoratorDeviceId } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardIpFree } from '@/guard/ip.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import { SecuritySignHandShakeRequestDTO, SecuritySignSessionKeyResponseDTO } from './sign.dto'
import { SecuritySignService } from './sign.service'

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
  @WalnutAdminDecoratorEncryptResponse<SecuritySignSessionKeyResponseDTO>('aesKey')
  async getAesKey(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
  ) {
    const res = await this.securitySignService.getAesKey(deviceId)
    return new SecuritySignSessionKeyResponseDTO(res)
  }
}
