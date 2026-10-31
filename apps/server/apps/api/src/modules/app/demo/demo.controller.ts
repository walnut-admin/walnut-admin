import { Body, Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import {
  WalnutAdminDecoratorParamUuid,
  WalnutAdminDecoratorParamUuids,
} from '@walnut-server/decorators/params'

import { plainToInstance } from 'class-transformer'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { AppDemoService } from './demo.service'
import {
  AppDemoDTOCreateRequest,
  AppDemoDTOCreateResponse,
  AppDemoDTODeleteResponse,
  AppDemoDTOListRequest,
  AppDemoDTOListResponse,
  AppDemoDTOReadResponse,
  AppDemoDTOSafe,
  AppDemoDTOUpdateRequest,
  AppDemoDTOUpdateResponse,
} from './dto/demo.dto'

const Permissions = {
  CREATE: 'app:demo:create',
  READ: 'app:demo:read',
  UPDATE: 'app:demo:update',
  DELETE: 'app:demo:delete',
  LIST: 'app:demo:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO,
  DTO: AppDemoDTOSafe,
})

/**
 * B1 迁移模板（controller 层）：
 * - 路由参数 ParamMongoId(s) → uuid 参数装饰器；
 * - 事务句柄 `ctx.dbSession` → `ctx.em`（WalnutTxContext 双引擎上下文，已迁侧取 em）；
 * - 响应组装 `.toObject()` 移除（PG 实体即 POJO），统一 `plainToInstance(DTO, entity)`
 *   —— 实体字段的可空性比 DTO 宽，直配构造器过不了 TS，plainToInstance 免转型。
 */
@Controller('app/demo')
@ApiTags('app/demo')
export class AppDemoController {
  constructor(private readonly demoService: AppDemoService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: AppDemoDTOCreateRequest) {
    return plainToInstance(AppDemoDTOCreateResponse, await this.demoService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(AppDemoDTOReadResponse, await this.demoService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: AppDemoDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(AppDemoDTOUpdateResponse, await this.demoService.update(id, payload))
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
      AppDemoDTODeleteResponse,
      await this.demoService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDeleteMany()
  @WalnutTx()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuids() ids: string[],
  ) {
    const deleted = await this.demoService.deleteMany(ids, user.userId, ctx.em)

    return deleted.map(i => plainToInstance(AppDemoDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppDemoDTOListRequest) {
    return plainToInstance(AppDemoDTOListResponse, await this.demoService.list(payload))
  }
}
