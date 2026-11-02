import type { ArgumentsHost } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { RequestHeaders } from '@walnut/contract/http'

// F-16：本函数是纯工具（无 DI 可注入），用模块级 Logger 实例把异常接进 Nest 日志管道。
// 调用点都在请求期（成功拦截器 / 异常过滤器），自定义 Logger（Winston + ALS requestId）
// 那时已装好，异常不再落到裸 console。
const logger = new Logger('WalnutAdminSetCustomHeaders')

export function setCustomHeaders(context: ArgumentsHost) {
  const ctx = context.switchToHttp()
  const response = ctx.getResponse<IWalnutAdminExpressResponse>()
  const request = ctx.getRequest<IWalnutAdminExpressRequest>()

  if (request.url.includes('/sse/'))
    return

  try {
    response.setHeader(RequestHeaders.ID, request.id)
    response.setHeader(RequestHeaders.IP, request.realIp)
    response.setHeader(RequestHeaders.TIMEZONE, request.timezone)
    response.setHeader(RequestHeaders.LANGUAGE, request.language)
    response.setHeader(RequestHeaders.VERSION, request.version)
    response.setHeader(RequestHeaders.REPO_VERSION, request.repoVersion)
  }
  catch (error) {
    logger.error('set custom response headers failed', error)
  }
}
