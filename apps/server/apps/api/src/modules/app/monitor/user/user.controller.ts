import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { AppMonitorUserService } from '@walnut-server/app-domain'

import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminDecoratorOperateLog, WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'

import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorDataScopeSystemChannel, WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorHasPermission, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { AppTokenService } from '@walnut-server/token'
import { AppRoutes } from '@walnut/contract'
import { RequestHeaders } from '@walnut/contract/http'
import { plainToInstance } from 'class-transformer'
import {
  AppMonitorUserDTO,
  AppMonitorUserDTOListRequest,
  AppMonitorUserDTOListResponse,
  AppMonitorUserDTOReadResponse,
  AppMonitorUserDTOUpdateState,
} from './dto/user.dto'

const Permissions = {
  LIST: 'app:monitor:user:list',
  READ: 'app:monitor:user:read',
  FORCE_QUIT: 'app:monitor:user:forceQuit',
} as const

const { WalnutAdminDecoratorList, WalnutAdminDecoratorRead } = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.APP_MONITOR_USER,
  DTO: AppMonitorUserDTO,
})

/**
 * B6 迁移（controller 层，B1 同款）：路由参数 ParamMongoId → uuid 参数装饰器；事务
 * 句柄 `ctx.dbSession` → `ctx.em`；`.toObject()` 移除，出参统一 plainToInstance。
 * forceQuit 的 refresh revoke 写腿仍在 Mongo（B7），同一事务里 em + dbSession 并传。
 */
@Controller(AppRoutes.MONITOR_USER)
@ApiTags('app/monitor/user')
export class AppMonitorUserController {
  private readonly logger = new Logger(AppMonitorUserController.name)

  constructor(
    private readonly monitorUserService: AppMonitorUserService,
    private readonly tokenService: AppTokenService,
  ) { }

  /**
   * F-47（2026-11，安全纵深）：`POST state` 的 `userId` 是**客户端自报的身份声明**，
   * 而该端点 Sign / JWT / CAP / Device 四个守卫全 Free（匿名心跳必须可用）——
   * 旧实现直接把它写进 `app_monitor_user.user_id`，等于任何人都能把任意用户 ID 挂到
   * 自己的监控行上：在线列表会把受害者显示成在线、`sys_user_device` 会被写成
   * 「受害者 + 攻击者设备」、`auth=false` 心跳还能反向清掉别人的关联。
   *
   * 现在的口径：**只有携带通过验签的 AT 时才采信 userId**，否则忽略该字段（心跳照常
   * 更新 focus / left / currentRouter，只是不关联用户）。这里只做「验签 + 过期」
   * （tokenService.verifyAccessToken，与 socket 握手同一把尺），会话键存在性由
   * 其它需要认证的端点把关 —— 本端点要冒的风险只有「把一个 userId 挂到自己那一行」，
   * 而一枚验签通过的 AT 已经证明调用方持有该用户的令牌。
   *
   * 注意：`auth` 字段仍是客户端自报（本轮不动）—— 它只影响列表上的「已登录」标记，
   * 不参与任何数据关联；真正的用户关联只看 userId。
   */
  private async resolveVerifiedUserId(req: IWalnutAdminExpressRequest) {
    const authorization = req.headers?.[RequestHeaders.AUTHORIZATION.toLowerCase()] as string | undefined

    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return null
    }

    const token = authorization.slice('Bearer '.length).trim()

    if (token === '') {
      return null
    }

    const payload = await this.tokenService.verifyAccessToken(token)

    return payload?.userId ?? null
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppMonitorUserDTOListRequest) {
    return plainToInstance(AppMonitorUserDTOListResponse, await this.monitorUserService.list(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(AppMonitorUserDTOReadResponse, await this.monitorUserService.read(id))
  }

  @Delete('force-quit/:id')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.FORCE_QUIT)
  @WalnutTx()
  // F-18（DOC-07）：force-quit 此前既没有 200 schema，也没有 {id} 路径参数文档
  // （@WalnutAdminDecoratorParamUuid 是自定义参数装饰器，swagger 反射不到）。
  @ApiParam({ name: 'id', type: String, required: true, description: 'monitor row id (uuid)' })
  @ApiWalnutOkResponse({
    description: 'force quit the monitored session (admin kick; revokes the device refresh token)',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.APP_MONITOR_USER,
    action: WalnutAdminConstDecoratorLogOperateAction.DELETE,
    operateType: WalnutAdminConstDecoratorLogOperateType.APP_MONITOR_USER_FORCE_QUIT,
  })
  async forceQuit(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    // B7b 归一：signout 的 refresh 写腿迁 PG —— 单 em
    return this.monitorUserService.forceQuitByMonitorId(id, ctx.em)
  }

  @Post('state')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'report / update the online state of the current device (anonymous heartbeat)',
    primitive: 'boolean',
  })
  // 数据权限三期：在线监控心跳是匿名系统通道（无 ALS 描述符也要写 app_monitor_user）
  @WalnutAdminDecoratorDataScopeSystemChannel()
  async monitor(
    // 批次 8 / B6：**行键**就是它 —— 服务端从签名 Cookie 解析出的设备身份。
    // 请求体里的 deviceId 已被 DTO 白名单摘除（带上来即 40099），visitorId 只作校验。
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() data: AppMonitorUserDTOUpdateState,
  ) {
    // F-47：userId 只认「验签通过的 AT」，请求体里的 userId 一律被这里覆盖 ——
    // 无 AT（匿名心跳）时落 null，service 的 nil 过滤会把它丢掉（auth=false 的显式
    // 清零分支仍照旧生效：登出后 user_id 清空）。
    const userId = await this.resolveVerifiedUserId(req)

    return this.monitorUserService.updateState(
      deviceId,
      { ...data, userId },
      ctx.em,
    )
  }
}
