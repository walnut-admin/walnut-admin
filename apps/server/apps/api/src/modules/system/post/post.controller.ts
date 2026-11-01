import { Body, Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'

import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser } from '@walnut-server/guards'
import {
  SysPostDTOCreateRequest,
  SysPostDTOCreateResponse,
  SysPostDTODeleteResponse,
  SysPostDTOListRequest,
  SysPostDTOListResponse,
  SysPostDTOReadResponse,
  SysPostDTOSafe,
  SysPostDTOUpdateRequest,
  SysPostDTOUpdateResponse,
  SysPostService,
} from '@walnut-server/system'
import { SystemRoutes } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'

const Permissions = {
  CREATE: 'system:post:create',
  READ: 'system:post:read',
  UPDATE: 'system:post:update',
  DELETE: 'system:post:delete',
  LIST: 'system:post:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.POST,
  DTO: SysPostDTOSafe,
})

/** 岗位 controller —— 平表标准 CRUD（无树端点） */
@Controller(SystemRoutes.POST)
@ApiTags('system/post')
export class SysPostController {
  constructor(private readonly postService: SysPostService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysPostDTOCreateRequest) {
    return plainToInstance(SysPostDTOCreateResponse, await this.postService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysPostDTOReadResponse, await this.postService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysPostDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysPostDTOUpdateResponse, await this.postService.update(id, payload))
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
      SysPostDTODeleteResponse,
      await this.postService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysPostDTOListRequest) {
    return plainToInstance(SysPostDTOListResponse, await this.postService.list(payload))
  }
}
