import { Body, Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'

import { WalnutAdminDecoratorParamMongoId } from '@walnut-server/decorators/params'
import { WalnutAdminDecoratorQueryArray } from '@walnut-server/decorators/query'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'

import { WalnutCrudDecorators } from '@/decorators/crud'

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

    return dictData.map(i => new SysDictTypeDTOWithDictDataResponse(i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysDictTypeDTOCreateRequest) {
    return new SysDictTypeDTOCreateResponse(
      (await this.dictTypeService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysDictTypeDTOReadResponse(
      (await this.dictTypeService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: SysDictTypeDTOUpdateRequest,
  ) {
    return new SysDictTypeDTOUpdateResponse(
      (await this.dictTypeService.update(id, payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoId() id: string,
  ) {
    return new SysDictTypeDTODeleteResponse(
      (await this.dictTypeService.delete(id, user.userId, session)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDictTypeDTOListRequest) {
    return new SysDictTypeDTOListResponse(
      await this.dictTypeService.list(payload),
    )
  }
}
