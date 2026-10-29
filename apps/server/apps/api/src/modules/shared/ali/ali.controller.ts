import { Controller, Get } from '@nestjs/common'

import { ApiTags } from '@nestjs/swagger'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorEncryptResponse } from '@/decorators/walnut/crypto.decorator'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SharedAliOSSDTO } from './ali.dto'
import { SharedAliService } from './ali.service'

const Permissions = {
  ALI_OSS_STS: 'app:shared:ali:sts',
} as const

@Controller('shared/ali')
@ApiTags('shared/ali')
export class SharedAliController {
  constructor(private readonly sharedAliService: SharedAliService) {}

  @Get('/sts')
  @WalnutAdminDecoratorHasPermission(Permissions.ALI_OSS_STS)
  @ApiWalnutOkResponse({
    description: 'get Ali OSS STS token (accessKeyId/accessKeySecret/stsToken are RSA envelope payload strings)',
    DTO: SharedAliOSSDTO,
  })
  @WalnutAdminDecoratorEncryptResponse<SharedAliOSSDTO>(['accessKeyId', 'accessKeySecret', 'stsToken'])
  async getSTSToken(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload) {
    return new SharedAliOSSDTO(await this.sharedAliService.getSTSToken(user))
  }
}
