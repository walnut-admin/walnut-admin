import type { SchemaObject } from '@nestjs/swagger'
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { ApiWalnutOkResponse, WalnutAdminSwaggerResponseSuccessSchemeData } from '@walnut-server/decorators/swagger'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorEncryptResponse, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SecuritySignHandShakeRequestDTO, SecuritySignService, SecuritySignSessionKeyResponseDTO } from '@walnut-server/security'
import { SecurityRoutes } from '@walnut/contract'

/**
 * F-18（DOC-07）：initial 的 200 只有一个 schema 能表达 —— 返回值是二态：
 * - 首次（或 force = true）：登记客户端 RSA 公钥后返回 true；
 * - 已登记且未 force：直接回吐缓存里的公钥串（PEM）。
 * 所以 data 声明为 oneOf(string, boolean)，而不是挑一种形态说谎。
 */
const SIGN_INITIAL_DATA_SCHEMA: SchemaObject = {
  oneOf: [
    {
      type: 'string',
      description: 'the RSA public key (PEM) already registered for this device',
    },
    {
      type: 'boolean',
      description: 'true when the submitted public key was (re)stored in this call',
    },
  ],
}

@Controller(SecurityRoutes.SIGN)
@ApiTags('security/sign')
@WalnutAdminGuardSignFree()
@WalnutAdminGuardCapFree()
@WalnutAdminGuardJwtFree()
@WalnutAdminGuardLockFree()
@WalnutAdminGuardDeviceFree()
// 批次 8 / B3（2026-11）：**撤掉类级 @WalnutAdminGuardIpFree()** —— IP 黑名单没有
// 中间件兜底，IpFree 就是端点上显式放弃 IP 维度风控的缺口。同族端点
// `device/initial`（同为 DeviceFree 的引导端点）一直没跳 IP 且工作正常 ⇒ 握手端点
// 不需要这个豁免。回归钉子见 api-spec 的 G14。
export class SecuritySignController {
  constructor(
    private readonly securitySignService: SecuritySignService,
  ) { }

  @Post('initial')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'register the client RSA public key for request signing (idempotent unless force)',
    schema: WalnutAdminSwaggerResponseSuccessSchemeData(SIGN_INITIAL_DATA_SCHEMA),
  })
  // 4A：13 个缺 summary 的 op 之一。
  @ApiOperation({
    summary: 'Register the client RSA public key for request signing',
  })
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
