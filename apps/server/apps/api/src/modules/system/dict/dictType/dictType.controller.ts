import { Body, Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { WalnutAdminDecoratorQueryArray } from '@walnut-server/decorators/query'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { plainToInstance } from 'class-transformer'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SysDictTypeService } from './dictType.service'
import {
  SysDictTypeDTOCreateRequest,
  SysDictTypeDTOCreateResponse,
  SysDictTypeDTODeleteResponse,
  SysDictTypeDTOListRequest,
  SysDictTypeDTOListResponse,
  SysDictTypeDTOReadResponse,
  SysDictTypeDTOSafe,
  SysDictTypeDTOUpdateRequest,
  SysDictTypeDTOUpdateResponse,
  SysDictTypeDTOWithDictDataResponse,
} from './dto/dictType.dto'

const Permissions = {
  CREATE: 'system:dict:type:create',
  READ: 'system:dict:type:read',
  UPDATE: 'system:dict:type:update',
  DELETE: 'system:dict:type:delete',
  LIST: 'system:dict:type:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.DICT_TYPE,
  DTO: SysDictTypeDTOSafe,
})

/**
 * B3 迁移模板（controller 层）：路由参数 ParamMongoId → uuid 参数装饰器；事务句柄
 * `ctx.dbSession` → `ctx.em`；`.toObject()` 移除（PG 实体即 POJO），统一
 * plainToInstance(DTO, entity)。
 */
@Controller('system/dict/type')
@ApiTags('system/dict/type')
export class SysDictTypeController {
  constructor(private readonly dictTypeService: SysDictTypeService) {}

  // need to put this in front
  @Get('s')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'types',
    type: String,
    required: true,
    description: `dict type, no need to validate`,
  })
  @ApiWalnutOkResponse({
    description: 'get dict data by dict type, support multiple fetch',
    DTO: SysDictTypeDTOWithDictDataResponse,
  })
  async getDictByType(
    @WalnutAdminDecoratorQueryArray({ fieldName: 'types' }) types: string[],
  ) {
    const dictData = await this.dictTypeService.getByTypeMany(types)

    return dictData.map(i => plainToInstance(SysDictTypeDTOWithDictDataResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysDictTypeDTOCreateRequest) {
    return plainToInstance(SysDictTypeDTOCreateResponse, await this.dictTypeService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysDictTypeDTOReadResponse, await this.dictTypeService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysDictTypeDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysDictTypeDTOUpdateResponse, await this.dictTypeService.update(id, payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutTx()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(
      SysDictTypeDTODeleteResponse,
      await this.dictTypeService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDictTypeDTOListRequest) {
    return plainToInstance(SysDictTypeDTOListResponse, await this.dictTypeService.list(payload))
  }
}
