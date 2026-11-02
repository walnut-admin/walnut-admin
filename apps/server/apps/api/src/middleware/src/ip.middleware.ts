import type { NextFunction } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'
import * as requestIp from '@supercharge/request-ip'
import { RequestHeaders } from '@walnut/contract/http'

/**
 * realIp 的取法与「边缘代理」的强耦合（F-11 / SEC-007 / CQ-006）
 *
 * @supercharge/request-ip 是 **header 优先**：命中 X-Forwarded-For / X-Real-IP 等头就取
 * 其中首个地址，完全**不校验跳数**，也不看 Express 的 trust proxy 设置 —— 它与
 * `app.set('trust proxy', APP_TRUST_PROXY_HOPS)`（main.ts）是两条并存的通道，本中间件
 * 这条才是下面这些安全控制的输入：IP 黑名单（ip.guard）、限流 tracker
 * （throttler.guard:getTracker）、失败登录临时拉黑与扫描路径永久拉黑、设备 IP 变更跟踪
 * （device.guard）、风控（risk.guard）、审计日志与时区定位。
 *
 * 因此**部署口径是这个文件的运行前提**：生产入口必须由边缘 nginx 用真实对端地址
 * **覆写**（不是追加）这两个头 —— deploy/nginx/conf.d/api.conf:50-57 的
 *   proxy_set_header X-Forwarded-For $remote_addr;
 *   proxy_set_header X-Real-IP     $remote_addr;
 * 就是这条约束；一旦改成 $proxy_add_x_forwarded_for（追加），客户端自带的伪造值会留在
 * 首位并成为 realIp，可绕过/嫁祸 IP 维度的一切判定（永久黑名单可被指向任意 IP）。
 * 同理，任何**绕过 nginx 的直连暴露**都会让上面的头变成攻击者可控输入 —— 端口映射
 * 只允许 80/443（见 deploy/docker-compose.yml）。
 *
 * 改这里之前先确认这两件事没被破坏；代码侧无法自证「前面到底有没有那一跳」。
 */
@Injectable()
export class IpMiddleware implements NestMiddleware {
  constructor() {}

  async use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const ip = requestIp.getClientIp(req)

    req.headers[RequestHeaders.IP] = ip
    req.realIp = ip!

    next()
  }
}
