import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
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
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler<any>) {
    const request = context.getType() === 'http'
      ? context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
      : undefined

    // JwtOptional 端点在匿名请求下可能把 req.user 置成 null / false（passport 形态不统一），
    // 只有拿到真实 userId 才解析 —— 否则会以 undefined 去查 sys_user（TypeORM 直接抛错）。
    const userId = request?.user?.userId
    const hasUser = typeof userId === 'string' && userId !== ''

    const dataScope = hasUser
      ? await this.dataScopeService.resolveForUser(userId)
      : undefined

    return new Observable((subscriber) => {
      this.asyncContext.run(() => {
        if (hasUser) {
          this.asyncContext.set('userId', userId)

          if (dataScope !== undefined) {
            this.asyncContext.set('dataScope', dataScope)
          }
        }

        next.handle().subscribe(subscriber)
      })
    })
  }
}
