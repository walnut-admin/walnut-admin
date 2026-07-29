import type { ArgumentsHost } from '@nestjs/common'
import { RequestHeaders } from '@walnut/contract/http'

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
    console.error(error)
  }
}
