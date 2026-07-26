import type { ArgumentsHost } from '@nestjs/common'
import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'

export function setCustomHeaders(context: ArgumentsHost) {
  const ctx = context.switchToHttp()
  const response = ctx.getResponse<IWalnutAdminExpressResponse>()
  const request = ctx.getRequest<IWalnutAdminExpressRequest>()

  if (request.url.includes('/sse/'))
    return

  try {
    response.setHeader(WalnutAdminConstAppHeaders.ID, request.id)
    response.setHeader(WalnutAdminConstAppHeaders.IP, request.realIp)
    response.setHeader(WalnutAdminConstAppHeaders.TIMEZONE, request.timezone)
    response.setHeader(WalnutAdminConstAppHeaders.LANGUAGE, request.language)
    response.setHeader(WalnutAdminConstAppHeaders.VERSION, request.version)
    response.setHeader(WalnutAdminConstAppHeaders.REPO_VERSION, request.repoVersion)
  }
  catch (error) {
    console.error(error)
  }
}
