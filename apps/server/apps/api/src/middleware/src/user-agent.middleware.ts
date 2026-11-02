import type { NextFunction } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { isDev } from '@walnut-server/config/utils/env'
import { RequestHeaders } from '@walnut/contract/http'
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
    const userAgent = req.headers[RequestHeaders.USER_AGENT]
    const parsedUA = !isNil(userAgent) ? UAParser(userAgent) : undefined

    req.userAgent = parsedUA

    // check if request is from bot or crawler
    req.isBot = !isNil(userAgent) ? isbot(userAgent) : false

    // check if request is from Postman Runtime and in dev mode
    // （F-44：这是**噪声过滤**不是安全边界 —— 详见 isPostmanRuntimeRequest 的注释）
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
   *
   * F-44（2026-11，安全纵深）—— **这是噪声过滤，不是安全边界**。本仓库唯一的真源就是
   * 这里：`req.isPostman` 由本方法赋值，下游（sign / security / device / cap 四个 guard、
   * blacklist-path 中间件、request-decrypt / response-encrypt 两个拦截器）全部只是读它。
   *
   * 为什么可以这样说：
   * 1) 它被 `isDev` 门住 —— isDev 是模块求值期常量（libs/const/src/app/env.ts），
   *    production 构建里恒 false，所以生产路径上 `req.isPostman` 永远是 false；
   * 2) 判断依据是**客户端自报的 UA 字符串**，任何人都能伪造成 `PostmanRuntime/7.x`。
   *    所以它挡不住任何人，只是让本地用 Postman 调签名 / 人机验证 / 设备校验明显的
   *    接口时不必走一遍握手（那些守卫在调试期的报错噪声很大）。
   * 3) 由此推出一条部署纪律：**dev（NODE_ENV=development）环境不能暴露到公网**。
   *    否则伪造 UA 即可跳过签名 / CAP / 设备校验 —— 那时候问题在「把 dev 当生产用」，
   *    不在这条豁免。历史上 P0-2 / P0-4 的修复也都建立在「生产路径 isPostman=false」上。
   *
   * 纯注释补充（F-44 不改任何逻辑）：所有读 `req.isPostman` 的豁免分支都加了指向本段的
   * 一行注释，避免后来者把「调试便利」误读成「防护可关」。
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
    const userAgent = req.headers[RequestHeaders.USER_AGENT]

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
