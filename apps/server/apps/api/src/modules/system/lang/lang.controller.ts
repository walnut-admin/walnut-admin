import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'

import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'

import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorCache, WalnutAdminDecoratorHasPermission, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'

import {
  SysLangDTO,
  SysLangDTOCreateRequest,
  SysLangDTOCreateResponse,
  SysLangDTOListPublicResponse,
  SysLangDTOListRequest,
  SysLangDTOListResponse,
  SysLangDTOReadResponse,
  SysLangDTOUpdateRequest,
  SysLangDTOUpdateResponse,
  SysLangService,
} from '@walnut-server/system'
import { SystemRoutes } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'

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
    // list 行是 RealPartialType(SysLangDTOSafe)：字段集与 SysLangDTO 一致，但全部可选
    // （P2-6 收尾）。把真实响应类交给 list 装饰器，行 schema 不再把字段标成 required。
    listResponseDTO: SysLangDTOListResponse,
  })

/**
 * B2 迁移模板（controller 层）：路由参数 ParamMongoId → uuid 参数装饰器；
 * `.toObject()` 移除（PG 实体即 POJO），统一 plainToInstance(DTO, entity)。
 */
@Controller(SystemRoutes.LANG)
@ApiTags('system/lang')
export class SysLangController {
  constructor(private readonly langService: SysLangService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysLangDTOCreateRequest) {
    return plainToInstance(SysLangDTOCreateResponse, await this.langService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysLangDTOReadResponse, await this.langService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysLangDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysLangDTOUpdateResponse, await this.langService.update(id, payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysLangDTOListRequest) {
    return plainToInstance(SysLangDTOListResponse, await this.langService.list(payload))
  }

  @Get('list/public')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @ApiWalnutOkResponse({
    description: 'get public language list',
    DTO: SysLangDTOListPublicResponse,
    isArray: true,
  })
  @WalnutAdminDecoratorCache({ key: WalnutAdminConstAppCacheKeys.SYS_LANG_LIST_PUBLIC })
  async listPublic() {
    return this.langService.listPublic()
  }
}
