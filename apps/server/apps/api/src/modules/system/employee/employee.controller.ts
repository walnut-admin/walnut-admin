import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser } from '@walnut-server/guards'
import {
  SysEmployeeDTOBindUserRequest,
  SysEmployeeDTOCreateRequest,
  SysEmployeeDTOCreateResponse,
  SysEmployeeDTODeleteResponse,
  SysEmployeeDTOListRequest,
  SysEmployeeDTOListResponse,
  SysEmployeeDTOReadResponse,
  SysEmployeeDTOSafe,
  SysEmployeeDTOUpdateRequest,
  SysEmployeeDTOUpdateResponse,
  SysEmployeeService,
} from '@walnut-server/system'
import { plainToInstance } from 'class-transformer'

const Permissions = {
  CREATE: 'system:employee:create',
  READ: 'system:employee:read',
  UPDATE: 'system:employee:update',
  DELETE: 'system:employee:delete',
  LIST: 'system:employee:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.EMPLOYEE,
  DTO: SysEmployeeDTOSafe,
})

/**
 * 职工 controller —— 标准 CRUD + 账号绑定/解绑两个动作端点。
 *
 * 绑定/解绑挂 `system:employee:update` 权限点（不新增独立的权限串 —— 人事维护是一组
 * 写操作，拆细会逼角色配置多一个维度；如需审计可后续补自定义 operateLog 类型，
 * 但 log_operate.operation 的 CHECK 是既有枚举，新增值要走新 migration，本批不做）。
 */
@Controller('system/employee')
@ApiTags('system/employee')
export class SysEmployeeController {
  constructor(private readonly employeeService: SysEmployeeService) {}

  @Post(':id/bind-user')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutTx()
  @ApiParam({ name: 'id', type: String, required: true, description: 'employee id' })
  @ApiWalnutOkResponse({
    description: 'bind one login account to the employee (one account one employee)',
    DTO: SysEmployeeDTOUpdateResponse,
  })
  async bindUser(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysEmployeeDTOBindUserRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(
      SysEmployeeDTOUpdateResponse,
      await this.employeeService.bindUser(id, payload.userId, ctx.em),
    )
  }

  @Post(':id/unbind-user')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutTx()
  @ApiParam({ name: 'id', type: String, required: true, description: 'employee id' })
  @ApiWalnutOkResponse({
    description: 'unbind the login account from the employee (idempotent)',
    DTO: SysEmployeeDTOUpdateResponse,
  })
  async unbindUser(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(
      SysEmployeeDTOUpdateResponse,
      await this.employeeService.unbindUser(id, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysEmployeeDTOCreateRequest) {
    return plainToInstance(SysEmployeeDTOCreateResponse, await this.employeeService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysEmployeeDTOReadResponse, await this.employeeService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysEmployeeDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysEmployeeDTOUpdateResponse, await this.employeeService.update(id, payload))
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
      SysEmployeeDTODeleteResponse,
      await this.employeeService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysEmployeeDTOListRequest) {
    return plainToInstance(SysEmployeeDTOListResponse, await this.employeeService.list(payload))
  }
}
