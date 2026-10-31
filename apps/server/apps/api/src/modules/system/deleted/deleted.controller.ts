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
import { WalnutCrudDecorators } from '@walnut-server/crud'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid, WalnutAdminDecoratorParamUuids } from '@walnut-server/decorators/params'
import { SysDeletedService } from '@walnut-server/system'

import { Role } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
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
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SystemDeletedDTOReadResponse, await this.deletedService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER, Role.ADMIN], WalnutAdminConstDecoratorRoleMode.OR)
  @WalnutAdminDecoratorDeleteMany()
  async deleteMany(@WalnutAdminDecoratorParamUuids() ids: string[]) {
    const deleted = await this.deletedService.deleteRealMany(ids)
    return deleted.map(i => plainToInstance(SystemDeletedDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SystemDeletedDTOListRequest) {
    return plainToInstance(SystemDeletedDTOListResponse, await this.deletedService.list(payload))
  }

  @Post('me/recover')
  @HttpCode(HttpStatus.OK)
  // P3-21：接线独立权限点（与管理端 recover 解耦）—— 授予该权限点的角色只能恢复
  // 自己删的行（属主校验在 service），不再复用管理端 `system:deleted:recover`。
  // root 仍按 permission.guard 的短路放行；菜单 seed 里 `system:deleted:recover:mine`
  // element 行本就存在，按角色在管理台勾选即可授权。
  @WalnutAdminDecoratorHasPermission(Permissions.RECOVER_MINE)
  @WalnutTx()
  async recoverMine(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysDeletedDTORecoverRequest,
  ) {
    return this.deletedService.recoverMine(payload, user.userId, ctx.em)
  }

  @Post('recover')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.RECOVER)
  @WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER, Role.ADMIN], WalnutAdminConstDecoratorRoleMode.OR)
  @WalnutTx()
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.DELETED,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.DELETED_RECOVER,
  })
  async recover(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysDeletedDTORecoverRequest,
  ) {
    return this.deletedService.recover(payload, ctx.em)
  }
}
