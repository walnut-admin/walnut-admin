import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ALSRequestService } from '@walnut-server/als'
import { Observable } from 'rxjs'
import { buildWalnutDataScopeRlsSettings } from '@/common/repository/data-scope.rls'
import { WALNUT_DATA_SCOPE_SYSTEM_CHANNEL_METADATA_KEY } from '@/decorators/walnut/dataScope.decorator'
import { DataScopeService } from '@/modules/system/data-scope/data-scope.service'

/**
 * 请求级 ALS 上下文（数据权限一期扩展）。
 *
 * 时序：全局 guard 链 → 本拦截器 → handler。JWT guard 已把 `request.user` 挂上，
 * 这里解析数据权限描述符（Redis 缓存优先）并连同 userId 一起种进 ALS；基类仓库
 * （common/repository/pg-base.repository.ts）从 ALS 读 scope 注入行级谓词。
 *
 * 为什么必须在拦截器而不是 guard：guard 先于拦截器执行，且登录链的前置查询
 * （sys_user/sys_device/user_device）不能带数据权限（否则断登录）。注册表因此只放
 * 业务表，系统表显式豁免（见 common/repository/data-scope.ts 豁免清单）。
 *
 * 未登录请求（login/公开端点）也建 store 但不种描述符 —— 这类请求若触碰已注册
 * 业务表，基类会 fail-closed 抛错（不会静默按 ALL 放行）。
 */
@Injectable()
export class ALSRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly asyncContext: ALSRequestService,
    private readonly dataScopeService: DataScopeService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler<any>) {
    const request = context.getType() === 'http'
      ? context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
      : undefined

    // JwtOptional 端点在匿名请求下可能把 req.user 置成 null / false（passport 形态不统一），
    // 只有拿到真实 userId 才解析 —— 否则会以 undefined 去查 sys_user（TypeORM 直接抛错）。
    const userId = request?.user?.userId
    const hasUser = typeof userId === 'string' && userId !== ''

    const [dataScope, userDeptId] = hasUser
      ? await Promise.all([
          this.dataScopeService.resolveForUser(userId),
          this.dataScopeService.resolveUserDeptId(userId),
        ])
      : [undefined, undefined]

    // 数据权限三期：把描述符翻译成事务级 RLS 设置，挂到 request 上供
    // WalnutTxInterceptor 在 startTransaction 后写入（基类自动事务直接读 ALS）。
    // 无描述符的处理器分两类：显式标记的登录链/心跳系统通道 → system（放行）；
    // 其余匿名请求 → anonymous（策略拒绝）。已登录请求永远按描述符，标记不降级。
    const systemChannel = this.reflector.getAllAndOverride<boolean>(
      WALNUT_DATA_SCOPE_SYSTEM_CHANNEL_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    ) === true

    const rlsSettings = buildWalnutDataScopeRlsSettings(dataScope, userId, { systemChannel, userDeptId })

    if (request !== undefined) {
      request.dataScopeRls = rlsSettings
    }

    return new Observable((subscriber) => {
      this.asyncContext.run(() => {
        if (hasUser) {
          this.asyncContext.set('userId', userId)

          if (dataScope !== undefined) {
            this.asyncContext.set('dataScope', dataScope)
          }
        }

        // 基类自动事务从 ALS 直接取同一份设置（含 userDeptId），避免二次推导
        this.asyncContext.set('rlsSettings', rlsSettings)

        next.handle().subscribe(subscriber)
      })
    })
  }
}
