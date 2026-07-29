import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { Role } from '@walnut/contract'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { WalnutAdminDecoratorParamMongoId, WalnutAdminDecoratorParamMongoIds } from '@walnut-server/decorators/params'
import { ClientSession } from 'mongoose'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'

import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SysDeletedService } from './deleted.service'
import { SysDeletedDTORecoverRequest, SysDeletedDTOSafe, SystemDeletedDTODeleteResponse, SystemDeletedDTOListRequest, SystemDeletedDTOListResponse, SystemDeletedDTOReadResponse } from './dto/deleted.dto'

const Permissions = {
  READ: 'system:deleted:read',
  LIST: 'system:deleted:list',
  DELETE_MANY: 'system:deleted:deleteMany',
  RECOVER: 'system:deleted:recover',
  RECOVER_MINE: 'system:deleted:recover:mine',
} as const

const {
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.DELETED,
  DTO: SysDeletedDTOSafe,
  extra: {
    needOperateLog: false,
  },
})

@Controller('system/deleted')
@ApiTags('system/deleted')
export class SysDeletedController {
  constructor(private readonly deletedService: SysDeletedService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SystemDeletedDTOReadResponse(
      (await this.deletedService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER, Role.ADMIN], WalnutAdminConstDecoratorRoleMode.OR)
  @WalnutAdminDecoratorDeleteMany()
  async deleteMany(@WalnutAdminDecoratorParamMongoIds() ids: string[]) {
    const deleted = await this.deletedService.deleteRealMany(ids)
    return deleted.map(i => new SystemDeletedDTODeleteResponse(i.toObject()))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SystemDeletedDTOListRequest) {
    return new SystemDeletedDTOListResponse(await this.deletedService.list(payload))
  }

  @Post('me/recover')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.RECOVER)
  @WalnutDBTransaction()
  async recoverMine(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @Body() payload: SysDeletedDTORecoverRequest,
  ) {
    return this.deletedService.recoverMine(payload, user.userId, session)
  }

  @Post('recover')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.RECOVER)
  @WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER, Role.ADMIN], WalnutAdminConstDecoratorRoleMode.OR)
  @WalnutDBTransaction()
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.DELETED,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.DELETED_RECOVER,
  })
  async recover(
    @WalnutDBSession() session: ClientSession,
    @Body() payload: SysDeletedDTORecoverRequest,
  ) {
    return this.deletedService.recover(payload, session)
  }
}
