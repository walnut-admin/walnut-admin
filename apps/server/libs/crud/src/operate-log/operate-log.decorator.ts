import type { IWalnutAdminIpLocationResolver } from '@walnut-server/ip'
import type { IWalnutAdminOperateLogWriter } from './operate-log.ports'
import { applyDecorators, CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor, SetMetadata, UseInterceptors } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ALSRequestService } from '@walnut-server/als'
import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'

import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppEvent } from '@walnut-server/const/app/event'
import { IWalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction } from '@walnut-server/const/decorator/logOperate'

import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { runAfterCommit } from '@walnut-server/db'
import { translateResponseMessage } from '@walnut-server/exceptions/exception.filter'
import { WalnutAdminExceptionHandler } from '@walnut-server/exceptions/handler'
import { WALNUT_ADMIN_IP_LOCATION_RESOLVER } from '@walnut-server/ip'
import { maskSensitiveFields } from '@walnut-server/utils/mask'
import { toWalnutPgJsonbPayload } from '@walnut-server/utils/pg-jsonb'
import { WalnutAdminResponseSuccess } from '@walnut-server/utils/response'
import { Recordable } from 'easy-fns-ts'
import { I18nContext } from 'nestjs-i18n'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { WALNUT_ADMIN_OPERATE_LOG_WRITER } from './operate-log.ports'

const WalnutAdminConstDecoratorLogOperateTitleMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_OPERATE_TITLE')
const WalnutAdminConstDecoratorLogOperateActionMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_OPERATE_ACTION')
const WalnutAdminConstDecoratorLogOperateTypeMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_OPERATE_TYPE')

// B8：导出供 int-spec 驱动真实拦截器本体（auth 侧拦截器本就是导出形态，对齐）
@Injectable()
export class WalnutAdminInterceptorRequestOperateLog implements NestInterceptor {
  private readonly logger = new Logger(WalnutAdminInterceptorRequestOperateLog.name)

  constructor(
    private readonly reflector: Reflector,
    // 批 4：两个跨层服务改为端口注入（实现分别在 libs/ip / libs/system，
    // 经 SharedIpModule / SysLogOperateRepoModule 的 useExisting 绑定）；
    // F-14 起 IP 定位端口随实现住在 libs/ip（crud → ip = assemble → base）
    @Inject(WALNUT_ADMIN_OPERATE_LOG_WRITER)
    private readonly logOperateWriter: IWalnutAdminOperateLogWriter,
    private readonly eventEmitter: EventEmitter2,
    private readonly alsRequestService: ALSRequestService,
    @Inject(WALNUT_ADMIN_IP_LOCATION_RESOLVER)
    private readonly ipLocationResolver: IWalnutAdminIpLocationResolver,
  ) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now()
    const i18n = I18nContext.current()!

    const title = this.reflector.get<string>(
      WalnutAdminConstDecoratorLogOperateTitleMetadataKey,
      context.getHandler(),
    )

    const action = this.reflector.get<IWalnutAdminConstDecoratorLogOperateAction>(
      WalnutAdminConstDecoratorLogOperateActionMetadataKey,
      context.getHandler(),
    )

    const operateType = this.reflector.get<IWalnutAdminConstDecoratorLogOperateType>(
      WalnutAdminConstDecoratorLogOperateTypeMetadataKey,
      context.getHandler(),
    )

    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()
    const response = ctx.getResponse<IWalnutAdminExpressResponse>()
    const className = context.getClass().name
    const handlerName = context.getHandler().name

    const insertToLogOperate = async (
      resData: IWalnutAdminResponseBase,
      success: boolean,
    ) => {
      try {
        const durationMs = Date.now() - now

        const location = await this.ipLocationResolver.getLocationFromBaidu(request.realIp) as string

        const translatedMsg = await translateResponseMessage(resData, i18n)

        const snapshotBefore = this.alsRequestService.get('snapshotBefore') as Recordable
        const snapshotAfter = this.alsRequestService.get('snapshotAfter') as Recordable

        // B8（phase2 4.16 / Q7 定案）：request/response 数据直写 jsonb 列（不再 stringify），
        // 序列化失败原文落 raw_* 旁路列 —— 行不因序列化失败整体丢失
        const requestPayload = toWalnutPgJsonbPayload(request?.body ?? {})
        const responsePayload = toWalnutPgJsonbPayload(
          Object.assign(resData, { msg: translatedMsg }),
        )

        const operateLog = await this.logOperateWriter.create({
          title,
          actionType: action,
          operation: operateType,
          method: request.method as IWalnutAdminConstAppHTTPMethods,
          url: request.url,
          httpVersion: request.httpVersion,

          statusCode: response.statusCode,

          requestData: requestPayload.data,
          rawRequestData: requestPayload.raw,
          responseData: responsePayload.data,
          rawResponseData: responsePayload.raw,
          durationMs,

          os: request.os,
          browser: request.browser,

          ip: request.realIp,
          location,

          deviceId: getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID),

          // B8（phase3-plan §4）：user_id 松引用列是 uuid，B7a 起 token 里的 userId
          // 即 PG uuid —— 直传；匿名请求为 null（Mongo 时代
          // `new Types.ObjectId(undefined)` 生成随机 ObjectId，属脏数据，不复刻）
          userId: request.user?.userId ?? null,
          userName: request.user?.userName as string,

          invokingMethod: `${className}.${handlerName}`,
          success,

          snapshotBefore: maskSensitiveFields(snapshotBefore),
          snapshotAfter: maskSensitiveFields(snapshotAfter),
        })

        if (action === WalnutAdminConstDecoratorLogOperateAction.DELETE) {
          const id = request.params[WalnutAdminConstAppConfig.deleteField] as string
          if (id) {
            // B9 收口：logOperateId / deletedId 均为 PG uuid，监听侧直等更新
            // sys_deleted（SysDeletedPgRepoService，uuid 直等）。
            //
            // P2-29（2026-10-29）：回填事件必须等业务事务提交后再发 —— 本拦截器的 tap
            // 执行时机早于外层 `@WalnutTx()` 的 commit，旧实现「立即 emit」会让监听侧
            // 在事务未提交时按 deletedId 更新（affected=0，关联永久丢失）。runAfterCommit
            // 在有事务上下文时推迟到提交后、无事务上下文时内联执行（对齐 P2-12 手法）。
            await runAfterCommit(async () => {
              this.eventEmitter.emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, { logOperateId: operateLog.id, deletedId: id })
            })
          }
          else {
            this.logger.warn(`${className}.${handlerName} - ${WalnutAdminConstAppConfig.deleteField} do not exists on request params`)
          }
        }

        if (action === WalnutAdminConstDecoratorLogOperateAction.DELETE_MANY) {
          const ids = request.params[WalnutAdminConstAppConfig.deleteManyField] as string
          if (ids) {
            // B9 收口：同上（P2-29 同款 after-commit 推迟）
            await runAfterCommit(async () => {
              this.eventEmitter.emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE_MANY, { logOperateId: operateLog.id, deletedIds: ids })
            })
          }
          else {
            this.logger.warn(`${className}.${handlerName} - ${WalnutAdminConstAppConfig.deleteManyField} do not exists on request params`)
          }
        }

        return operateLog
      }
      catch (error) {
        this.logger.error(error)
      }
    }

    return next.handle().pipe(
      tap({
        next: (res: IWalnutAdminExpressRequest) => {
          void insertToLogOperate(WalnutAdminResponseSuccess(res, request.id), true)
        },
        error: (e: Error) => {
          void insertToLogOperate(WalnutAdminExceptionHandler(e, request.id, i18n), false)
        },
      }),
    )
  }
}

// Note: IWalnutAdminLogOperateOptions 由本 lib 的 types.d.ts 全局声明（批 4 从 app 迁入）

/**
 * @description Custom operate log decorator, normally used for create/update/delete/export/import actions
 */
export function WalnutAdminDecoratorOperateLog(log: IWalnutAdminLogOperateOptions) {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorLogOperateTitleMetadataKey, log.title),
    SetMetadata(WalnutAdminConstDecoratorLogOperateActionMetadataKey, log.action),
    SetMetadata(WalnutAdminConstDecoratorLogOperateTypeMetadataKey, log.operateType),
    UseInterceptors(WalnutAdminInterceptorRequestOperateLog),
  )
}
