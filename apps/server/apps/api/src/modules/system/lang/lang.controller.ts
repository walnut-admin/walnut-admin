import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutAdminDecoratorParamMongoId } from '@walnut-server/decorators/params'

import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorCache } from '@/decorators/walnut/cache.decorator'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'

import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import {
  SysLangDTO,
  SysLangDTOCreateRequest,
  SysLangDTOCreateResponse,
  SysLangDTOListRequest,
  SysLangDTOListResponse,
  SysLangDTOReadResponse,
  SysLangDTOUpdateRequest,
  SysLangDTOUpdateResponse,
} from './dto/lang.dto'
import { SysLangService } from './lang.service'

const Permissions = {
  CREATE: 'system:lang:create',
  READ: 'system:lang:read',
  UPDATE: 'system:lang:update',
  DELETE: 'system:lang:delete',
  LIST: 'system:lang:list',
} as const

const { WalnutAdminDecoratorCreate, WalnutAdminDecoratorRead, WalnutAdminDecoratorUpdate, WalnutAdminDecoratorList }
  = WalnutCrudDecorators({
    title: WalnutAdminConstDecoratorLogOperateTitle.LANG,
    DTO: SysLangDTO,
  })

@Controller('system/lang')
@ApiTags('system/lang')
export class SysLangController {
  constructor(private readonly langService: SysLangService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysLangDTOCreateRequest) {
    return new SysLangDTOCreateResponse(
      (await this.langService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysLangDTOReadResponse(await this.langService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: SysLangDTOUpdateRequest,
  ) {
    return new SysLangDTOUpdateResponse(
      (await this.langService.update(id, payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysLangDTOListRequest) {
    return new SysLangDTOListResponse(await this.langService.list(payload))
  }

  @Get('list/public')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutAdminDecoratorCache({ key: WalnutAdminConstAppCacheKeys.SYS_LANG_LIST_PUBLIC })
  async listPublic() {
    return this.langService.listPublic()
  }
}
