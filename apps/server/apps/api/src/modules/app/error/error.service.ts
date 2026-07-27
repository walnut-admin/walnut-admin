import process from 'node:process'
import { InjectQueue } from '@nestjs/bull'
import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { IWalnutAdminConstAppResponseCode, WalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'

import { Queue } from 'bull'
import { SharedMaskService } from '@/modules/shared/mask/mask.service'
import { AppErrorDTOSafe } from './error.dto'
import { IAppErrorModel } from './error.schema'

@Injectable()
export class AppErrorService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_ERROR)
    private readonly appErrorModel: IAppErrorModel,

    @InjectQueue(WalnutAdminConstAppQueue.ERROR) private readonly errorQueue: Queue,

    private readonly maskService: SharedMaskService,
  ) { }

  private readonly logger = new Logger(AppErrorService.name)

  // custom response code white list
  private readonly whiteListResponseCode: IWalnutAdminConstAppResponseCode[] = [
    WalnutAdminConstAppResponseCode.BAD_REQUEST,
    WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR,
    WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
    WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR_DATABASE,
  ]

  private readonly whiteListPath = ['/', 'app/error']

  async addErrorQueue(req: IWalnutAdminExpressRequest, resData: IWalnutAdminResponseBase, statusCode: number, error: Error) {
    // filter white list response code
    if (!this.whiteListResponseCode.includes(resData.code!)) {
      this.logger.log(`WhiteListCode recived: ${resData.code}`)
      return
    }

    if (this.whiteListPath.includes(req.url)) {
      this.logger.log(`WhiteListPath recived: ${req.url}`)
      return
    }

    const payload: Partial<AppErrorDTOSafe> = {
      message: error.message,
      stack: error.stack!,
      statusCode,
      path: req.url,
      method: req.method as IWalnutAdminConstAppHTTPMethods,
      headers: this.maskService.maskHeaders(req.headers),
      payload: {
        body: JSON.stringify(this.maskService.maskFields(req.body ?? {})),
        params: JSON.stringify(this.maskService.maskFields(req.params ?? {})),
        query: JSON.stringify(this.maskService.maskFields(req.query ?? {})),
      },
      errorType: error.name,
      userId: req?.user?.userId,
      responseCode: resData.code!,
      responseMsg: resData.msg,
      ip: req.realIp,
      env: process.env.NODE_ENV,
    }

    await this.errorQueue.add(
      WalnutAdminConstAppProcess.APP_ERROR,
      payload,
      { removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 },
    )

    return true
  }

  async insertToDB(payload: Partial<AppErrorDTOSafe>) {
    await this.appErrorModel.create(payload)
  }
}
