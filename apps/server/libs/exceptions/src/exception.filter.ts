import type { ArgumentsHost } from '@nestjs/common'
import {
  Catch,
  ExceptionFilter,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common'

import { SharedBLPathService } from '@walnut-server/blpath'
import { setCustomHeaders } from '@walnut-server/utils/headers'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { I18nContext } from 'nestjs-i18n'
import { IWalnutAdminErrorReporter, WALNUT_ADMIN_ERROR_REPORTER } from './error-reporter.port'
import { WalnutAdminExceptionHandler } from './handler'

export async function translateResponseMessage(res: IWalnutAdminResponseBase, i18n: I18nContext) {
  return await i18n?.t(res.msg ?? '')
}

/**
 * 错误入库判据（F-13）：**只**把服务端 / 未预期异常送进 Bull → DB，4xx 客户端错误不落库。
 *
 * 判据取**统一响应壳里的业务码**而不是异常类型，因为 handler 已经把「客户端错误 vs 服务端错误」
 * 归一化到这一处了（@walnut/contract 的 response-code.ts：前三位对应 HTTP 状态码，4xxxx / 5xxxx）：
 * - 自定义业务异常（带 errCode）→ 原样透出，如 40114、40603；
 * - Nest 原生 HttpException → 按 status 映射（400/401/403/404/406/408/429 …）；
 * - 未预期异常（Error / TypeError / QueryFailedError 兜底）→ 50000。
 *
 * 所以 >= 50000 恰好等价于「服务端 bug 或依赖不可用」：这类要归档、要能查栈、要能告警；
 * 而 4xxxx（参数校验、未认证/令牌过期、MFA 待验证、无权限、风控与黑名单拦截）是**客户端可自愈**
 * 的输入问题，量大且无诊断价值 —— 落库只会把错误表变成「用户输错密码」日志，真故障被噪声埋掉。
 *
 * 无法判定响应码（理论上 handler 一定给）时**保守入队**：宁可多一条记录，也不要漏掉真故障。
 */
export function shouldReportException(code?: number): boolean {
  if (typeof code !== 'number' || !Number.isFinite(code))
    return true

  return code >= WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR
}

@Catch()
export class WalnutAdminFilterExceptionAll implements ExceptionFilter {
  private readonly logger = new Logger(WalnutAdminFilterExceptionAll.name)

  constructor(
    private readonly sharedBLPathService: SharedBLPathService,
    @Inject(WALNUT_ADMIN_ERROR_REPORTER)
    private readonly errorReporter: IWalnutAdminErrorReporter,
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

    // insert error to db（F-13：只有 5xx / 未预期异常入库 —— 判据与理由见 shouldReportException；
    // skipObservation 的 blpath 名单仍然先兜一层：favicon/health/metrics/*/state、*/heartbeat 类噪声
    // 连日志都不打，自然也不落库）
    const responseData = Object.assign(walnutErrorResponse, { msg: translatedErrorMsg })

    if (!skipObservation && shouldReportException(responseData.code)) {
      await this.errorReporter.addErrorQueue(request, responseData, HttpStatus.OK, exception)
    }

    // set custom headers
    setCustomHeaders(host)

    response.status(HttpStatus.OK).json(responseData)
  }
}
