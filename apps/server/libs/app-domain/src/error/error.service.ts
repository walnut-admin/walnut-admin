import type { IWalnutAdminErrorReporter } from '@walnut-server/exceptions'
import type { AppErrorEntity } from './entity/error.entity'
import process from 'node:process'
import { InjectQueue } from '@nestjs/bull'
import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'

import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { IWalnutAdminConstAppResponseCode, WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { Queue } from 'bull'
import { SharedMaskService } from '../shared/mask/mask.service'
import { AppErrorBasicRepository } from './error.basic.repository'
import { AppErrorDTOSafe } from './error.dto'

@Injectable()
export class AppErrorService implements IWalnutAdminErrorReporter {
  constructor(
    private readonly appErrorBasicRepo: AppErrorBasicRepository,

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
    // schema（Mongo 元数据基座）与 PG 实体的字段形态差异在此收口：
    // - response_code 列是 varchar(16)（phase2 4.22），AppResponseCode const 是数值型，落列转 text；
    // - userId 松引用 uuid 直传（B1：删去原 processor 里的 ObjectId 包装）。
    // 断言只桥接 DTO 侧的 ObjectId/object 宽类型，不改字段集
    await this.appErrorBasicRepo.create({
      ...payload,
      responseCode: payload.responseCode == null ? null : String(payload.responseCode),
    } as Partial<AppErrorEntity>)
  }
}
