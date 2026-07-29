import type { NextFunction } from 'express'
import { randomBytes } from 'node:crypto'

import { Injectable, NestMiddleware } from '@nestjs/common'
import { RequestHeaders } from '@walnut/contract/http'

function generateRequestId(): string {
  // 1. 获取当前时间戳（毫秒），转为 36 进制�?-9a-z），占约 7-8 �?
  // 示例: "lw1z9x8"
  const timePart = Date.now().toString(36)

  // 2. 生成 9 位随机字符（36 进制），保证唯一�?
  // 示例: "v8m2abc12"
  const randomPart = randomBytes(5).toString('hex').toLowerCase()

  // 3. 拼接
  // 结果示例: "lw1z9x8v8m2abc12"
  return `${timePart}${randomPart}`
}

@Injectable()
export class IdMiddleware implements NestMiddleware {
  constructor() {}

  use(
    req: IWalnutAdminExpressRequest,
    _res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const uuid: string = generateRequestId()
    req.headers[RequestHeaders.ID] = uuid
    req.id = uuid
    next()
  }
}
