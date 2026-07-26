import {
  Body,
  Controller,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { WalnutAdminDecoratorParamMongoId } from '@walnut-server/decorators/params'
import { ClientSession } from 'mongoose'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SysDictDataService } from './dictData.service'
import {
  SysDictDataDTOCreateRequest,
  SysDictDataDTOCreateResponse,
  SysDictDataDTODeleteResponse,
  SysDictDataDTOListRequest,
  SysDictDataDTOListResponse,
  SysDictDataDTOReadResponse,
  SysDictDataDTOSafe,
  SysDictDataDTOUpdateRequest,
  SysDictDataDTOUpdateResponse,
} from './dto/dictData.dto'

const Permissions = {
  CREATE: 'system:dict:data:create',
  READ: 'system:dict:data:read',
  UPDATE: 'system:dict:data:update',
  DELETE: 'system:dict:data:delete',
  DELETE_MANY: 'system:dict:data:deleteMany',
  LIST: 'system:dict:data:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.DICT_DATA,
  DTO: SysDictDataDTOSafe,
})

@Controller('system/dict/data')
@ApiTags('system/dict/data')
export class SysDictDataController {
  constructor(private readonly dictDataService: SysDictDataService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysDictDataDTOCreateRequest) {
    return new SysDictDataDTOCreateResponse(
      (await this.dictDataService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysDictDataDTOReadResponse(
      (await this.dictDataService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: SysDictDataDTOUpdateRequest,
  ) {
    return new SysDictDataDTOUpdateResponse(
      (await this.dictDataService.update(id, payload)).toObject(),
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
    return new SysDictDataDTODeleteResponse(
      (await this.dictDataService.delete(id, user.userId, session)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDictDataDTOListRequest) {
    return new SysDictDataDTOListResponse(
      await this.dictDataService.list(payload),
    )
  }
}
