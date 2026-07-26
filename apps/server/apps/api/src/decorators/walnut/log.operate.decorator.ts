import { applyDecorators, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, SetMetadata, UseInterceptors } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { WalnutAdminConstAppConfig } from '@walnut/const/app/config'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { WalnutAdminConstAppEvent } from '@walnut/const/app/event'

import { IWalnutAdminConstAppHTTPMethods } from '@walnut/const/app/methods'
import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction } from '@walnut/const/decorator/logOperate'

import { translateResponseMessage } from '@walnut/exceptions/exception.filter'
import { WalnutAdminExceptionHandler } from '@walnut/exceptions/handler'
import { maskSensitiveFields } from '@walnut/utils/mask'
import { WalnutAdminResponseSuccess } from '@walnut/utils/response'
import { Recordable } from 'easy-fns-ts'
import { Types } from 'mongoose'
import { I18nContext } from 'nestjs-i18n'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { SysLogOperateRepoService } from '@/modules/system/logs/operate/repo/log.operate.repo.service'
import { getWalnutAdminCookie } from './cookie.decorator'

const WalnutAdminConstDecoratorLogOperateTitleMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_OPERATE_TITLE')
const WalnutAdminConstDecoratorLogOperateActionMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_OPERATE_ACTION')
const WalnutAdminConstDecoratorLogOperateTypeMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_OPERATE_TYPE')

@Injectable()
class WalnutAdminInterceptorRequestOperateLog implements NestInterceptor {
  private readonly logger = new Logger(WalnutAdminInterceptorRequestOperateLog.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly logOperateRepoService: SysLogOperateRepoService,
    private readonly eventEmitter: EventEmitter2,
    private readonly alsRequestService: ALSRequestService,
    private readonly sharedIpService: SharedIpService,
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
        const correspondingMS = Date.now() - now

        const location = await this.sharedIpService.getLocationFromBaidu(request.realIp) as string

        const translatedMsg = await translateResponseMessage(resData, i18n)

        const snapshotBefore = this.alsRequestService.get('snapshotBefore') as Recordable
        const snapshotAfter = this.alsRequestService.get('snapshotAfter') as Recordable

        const operateLog = await this.logOperateRepoService.create({
          title,
          actionType: action,
          operation: operateType,
          method: request.method as IWalnutAdminConstAppHTTPMethods,
          url: request.url,
          httpVersion: request.httpVersion,

          statusCode: response.statusCode,

          requestData: JSON.stringify(request?.body ?? {}),
          responseData: JSON.stringify(
            Object.assign(resData, { msg: translatedMsg }),
          ),
          correspondingMS,

          os: request.os,
          browser: request.browser,

          ip: request.realIp,
          location,

          deviceId: getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID),

          userId: new Types.ObjectId(request.user?.userId),
          userName: request.user?.userName as string,

          invokingMethod: `${className}.${handlerName}`,
          success,

          snapshotBefore: maskSensitiveFields(snapshotBefore),
          snapshotAfter: maskSensitiveFields(snapshotAfter),
        })

        if (action === WalnutAdminConstDecoratorLogOperateAction.DELETE) {
          const id = request.params[WalnutAdminConstAppConfig.deleteField] as string
          if (id) {
            this.eventEmitter.emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, { logOperateId: operateLog._id.toString(), deletedId: id })
          }
          else {
            this.logger.warn(`${className}.${handlerName} - ${WalnutAdminConstAppConfig.deleteField} do not exists on request params`)
          }
        }

        if (action === WalnutAdminConstDecoratorLogOperateAction.DELETE_MANY) {
          const ids = request.params[WalnutAdminConstAppConfig.deleteManyField] as string
          if (ids) {
            this.eventEmitter.emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE_MANY, { logOperateId: operateLog._id.toString(), deletedIds: ids })
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

// Note: LogOperateOptions interface has been moved to @walnut/types/walnut-admin/log.d.ts
// as IWalnutAdminLogOperateOptions

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
