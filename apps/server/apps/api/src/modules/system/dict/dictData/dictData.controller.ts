import {
  Body,
  Controller,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid, WalnutAdminDecoratorParamUuids } from '@walnut-server/decorators/params'
import { plainToInstance } from 'class-transformer'

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
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.DICT_DATA,
  DTO: SysDictDataDTOSafe,
})

/**
 * B3 迁移模板（controller 层）：路由参数 ParamMongoId → uuid 参数装饰器；事务句柄
 * `ctx.dbSession` → `ctx.em`（dict data 与级联删的 locale 都在 PG 侧，同一事务）；
 * `.toObject()` 移除，统一 plainToInstance(DTO, entity)。
 */
@Controller('system/dict/data')
@ApiTags('system/dict/data')
export class SysDictDataController {
  constructor(private readonly dictDataService: SysDictDataService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysDictDataDTOCreateRequest) {
    return plainToInstance(SysDictDataDTOCreateResponse, await this.dictDataService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysDictDataDTOReadResponse, await this.dictDataService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysDictDataDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysDictDataDTOUpdateResponse, await this.dictDataService.update(id, payload))
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
      SysDictDataDTODeleteResponse,
      await this.dictDataService.delete(id, user.userId, ctx.em),
    )
  }

  // P1-12 修复（2026-10-28）：Permissions.DELETE_MANY 常量原已存在但装饰器未接线，
  // 路由 40400；补挂 deleteMany（逐行软删 + locale 级联软删，与单删同语义）。
  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorDeleteMany()
  @WalnutTx()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuids() ids: string[],
  ) {
    const deleted = await this.dictDataService.deleteMany(ids, user.userId, ctx.em)

    return deleted.map(i => plainToInstance(SysDictDataDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDictDataDTOListRequest) {
    return plainToInstance(SysDictDataDTOListResponse, await this.dictDataService.list(payload))
  }
}
