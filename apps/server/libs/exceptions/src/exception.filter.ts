import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common'

import { setCustomHeaders } from '@walnut-server/utils/headers'
import { I18nContext } from 'nestjs-i18n'
import { AppErrorService } from '@/modules/app/error/error.service'
import { SharedBLPathService } from '@/modules/shared/BLPath/BLPath.service'
import { WalnutAdminExceptionHandler } from './handler'

export async function translateResponseMessage(res: IWalnutAdminResponseBase, i18n: I18nContext) {
  return await i18n?.t(res.msg ?? '')
}

@Catch()
export class WalnutAdminFilterExceptionAll implements ExceptionFilter {
  private readonly logger = new Logger(WalnutAdminFilterExceptionAll.name)

  constructor(
    private readonly appErrorService: AppErrorService,
    private readonly sharedBLPathService: SharedBLPathService,
  ) {}

  async catch(
    exception: Error,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<IWalnutAdminExpressResponse>()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    // P1-4 修复（2026-10-27）：skip 名单（favicon/health/metrics + `/state`、`/heartbeat`
    // 后缀 —— BLPathService「不观察」表）在这里**不再提前裸 return**。提前 return 的本意
    // 是 favicon 类噪声不打错误库，但对命中名单的真实路由（如 POST /app/monitor/user/state）
    // 等于异常不落响应、请求静默悬挂到客户端超时。skip 语义收窄为「不记录」：错误日志与
    // 错误入库照旧跳过，统一异常壳的响应恒落盘。
    const skipObservation = this.sharedBLPathService.shouldSkip(request.path)

    const i18n = I18nContext.current()!

    if (!skipObservation) {
      this.logger.error(exception)
    }

    const walnutErrorResponse = WalnutAdminExceptionHandler(exception, request.id, i18n)

    const translatedErrorMsg = await translateResponseMessage(
      walnutErrorResponse,
      i18n,
    )

    // insert error to db
    const responseData = Object.assign(walnutErrorResponse, { msg: translatedErrorMsg })
    if (!skipObservation) {
      await this.appErrorService.addErrorQueue(request, responseData, HttpStatus.OK, exception)
    }

    // set custom headers
    setCustomHeaders(host)

    response.status(HttpStatus.OK).json(responseData)
  }
}
