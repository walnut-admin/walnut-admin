import { Injectable, NestMiddleware } from '@nestjs/common'
import { isDev } from '@walnut-server/config/utils/env'
import { WalnutAdminConstAppHeaders } from '@walnut-server/const/app/header'
import { NextFunction } from 'express'
import { isbot } from 'isbot'

import { isNil } from 'lodash'
import { UAParser } from 'ua-parser-js'

@Injectable()
export class UserAgentMiddleware implements NestMiddleware {
  constructor() { }

  async use(
    req: IWalnutAdminExpressRequest,
    _res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const userAgent = req.headers[WalnutAdminConstAppHeaders.USER_AGENT]
    const parsedUA = !isNil(userAgent) ? UAParser(userAgent) : undefined

    req.userAgent = parsedUA

    // check if request is from bot or crawler
    req.isBot = !isNil(userAgent) ? isbot(userAgent) : false

    // check if request is from Postman Runtime and in dev mode
    req.isPostman = this.isPostmanRuntimeRequest(req)

    // check if request is suspicious
    req.isSuspicious = this.detectSuspiciousRequest(req, parsedUA)

    // os/browser/engine context
    req.os = parsedUA?.os?.name as string
      ? `${parsedUA?.os.name}${parsedUA?.os?.version as string ? ` ${parsedUA?.os.version}` : ''}`
      : parsedUA?.ua as string

    req.browser = parsedUA?.browser?.name as string
      ? `${parsedUA?.browser.name}${parsedUA?.browser?.version as string ? ` ${parsedUA?.browser.version}` : ''}`
      : parsedUA?.ua as string

    req.engine = parsedUA?.engine.name
      ? `${parsedUA?.engine.name}${parsedUA?.engine?.version as string ? ` ${parsedUA?.engine.version}` : ''}`
      : parsedUA?.ua as string

    next()
  }

  /**
   * @description check if request is from Postman Runtime and in dev mode
   */
  private isPostmanRuntimeRequest(request: IWalnutAdminExpressRequest) {
    return !!(isDev && request.headers['user-agent']?.includes('PostmanRuntime'))
  }

  /**
   * @description detect suspicious request features
   */
  private detectSuspiciousRequest(
    req: IWalnutAdminExpressRequest,
    parsedUA?: UAParser.IResult,
  ): boolean {
    const userAgent = req.headers[WalnutAdminConstAppHeaders.USER_AGENT]

    // no user-agent
    if (isNil(userAgent)) {
      return true
    }

    // user-agent too short (less than 10 chars, usually fake)
    if (userAgent.length < 10) {
      return true
    }

    // cannot parse os and browser (usually custom scripts)
    if (isNil(parsedUA?.os?.name) && isNil(parsedUA?.browser?.name)) {
      return true
    }

    // suspicious keywords in user-agent (usually custom scripts)
    const suspiciousKeywords = [
      'scanner',
      'scraper',
      'exploit',
      'injection',
      'sqlmap',
      'nikto',
      'nmap',
      'masscan',
    ]

    const lowerUA = userAgent.toLowerCase()
    if (suspiciousKeywords.some(keyword => lowerUA.includes(keyword))) {
      return true
    }

    return false
  }
}
