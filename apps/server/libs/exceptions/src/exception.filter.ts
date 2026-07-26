import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common'

import { setCustomHeaders } from '@walnut/utils/headers'
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

    // prevent annoying favicon error
    if (this.sharedBLPathService.shouldSkip(request.path))
      return

    const i18n = I18nContext.current()!

    this.logger.error(exception)

    const walnutErrorResponse = WalnutAdminExceptionHandler(exception, request.id, i18n)

    const translatedErrorMsg = await translateResponseMessage(
      walnutErrorResponse,
      i18n,
    )

    // insert error to db
    const responseData = Object.assign(walnutErrorResponse, { msg: translatedErrorMsg })
    await this.appErrorService.addErrorQueue(request, responseData, HttpStatus.OK, exception)

    // set custom headers
    setCustomHeaders(host)

    response.status(HttpStatus.OK).json(responseData)
  }
}
