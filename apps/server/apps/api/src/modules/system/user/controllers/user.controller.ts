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
import {
  SysUserDTOCreateRequest,
  SysUserDTOCreateResponse,
  SysUserDTODeleteResponse,
  SysUserDTOListRequest,
  SysUserDTOListResponse,
  SysUserDTOReadResponse,
  SysUserDTOSafe,
  SysUserDTOUpdateRequest,
  SysUserDTOUpdateResponse,
} from '../dto/user.dto'
import { SysUserCrudService } from '../services/user.crud.service'

const Permissions = {
  CREATE: 'system:user:create',
  READ: 'system:user:read',
  UPDATE: 'system:user:update',
  DELETE: 'system:user:delete',
  DELETE_MANY: 'system:user:deleteMany',
  LIST: 'system:user:list',
  PASSWORD_UPDATE: 'system:user:pass:update',
  PASSWORD_RESET: 'system:user:pass:reset',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.USER,
  DTO: SysUserDTOSafe,
})

@Controller('system/user')
@ApiTags('system/user')
export class SysUserController {
  constructor(
    private readonly userCrudService: SysUserCrudService,
  ) { }

  @WalnutAdminDecoratorHasPermission(
    Permissions.CREATE,
  )
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysUserDTOCreateRequest) {
    return new SysUserDTOCreateResponse(
      (await this.userCrudService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysUserDTOReadResponse(
      (await this.userCrudService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(
    Permissions.UPDATE,
  )
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: SysUserDTOUpdateRequest,
  ) {
    return new SysUserDTOUpdateResponse(
      (await this.userCrudService.update(id, payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(
    Permissions.DELETE,
  )
  @WalnutAdminDecoratorDelete()
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoId() id: string,
  ) {
    return new SysUserDTODeleteResponse(
      (await this.userCrudService.delete(id, user.userId, session)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysUserDTOListRequest) {
    return new SysUserDTOListResponse(await this.userCrudService.list(payload))
  }
}
