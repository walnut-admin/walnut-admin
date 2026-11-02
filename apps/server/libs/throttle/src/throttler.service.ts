import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ThrottlerModuleOptions,
  ThrottlerOptionsFactory,
} from '@nestjs/throttler'

/**
 * 限流配置（@nestjs/throttler）。
 *
 * **存储是进程内的**：这里没有配置 `storage`，@nestjs/throttler 用的是默认内存存储 ——
 * 计数只活在本进程，不跨实例共享。
 *
 * 当前部署形态（deploy/docker-compose.yml 单个 backend 容器，nginx 反代到它）下这是可接受的：
 * 进程内计数恰好等于全局限流，且省掉一次 Redis 往返。**用户已确认多副本时再评估**（裁决记录
 * 见批次 3 的 F-13 第 2 项），所以这里只登记约束、不改实现、不新增依赖。
 *
 * ── 多副本前置条件（扩副本之前必须先解决）──────────────────────────────────────
 * 一旦 backend 扩到 N 个副本（水平扩容 / k8s 多 pod / 滚动更新期间新旧 pod 并存），同一个 IP
 * 的请求会被各实例**独立**计数：实际通过量 ≈ N × APP_THROTTLE_LIMIT / APP_THROTTLE_TTL，
 * 限流阈值随副本数线性放大，针对登录/验证码/枚举接口的节流代价降到 1/N。届时的选择：
 * 1. 换成共享存储（@nestjs/throttler 的 storage 选项接 Redis）—— 需要先裁决是否可接受该依赖/
 *    适配层，**不要在本批里顺手加**；
 * 2. 或把 IP 维度限流前移到边缘（nginx `limit_req`），应用侧只保留账号维度节流。
 * 在那之前：不要把 backend 扩到多副本。
 *
 * 另外，限流的 tracker 是 `req.realIp`（libs/guards/src/guards/throttler.guard.ts），它的可信度
 * 依赖边缘 nginx 覆写 X-Forwarded-For —— 见 apps/api/src/middleware/src/ip.middleware.ts 头注释。
 */
@Injectable()
export class ThrottlerConfigService implements ThrottlerOptionsFactory {
  private readonly logger = new Logger('ConfigService - Throttler')

  constructor(private readonly configService: ConfigService) {}

  createThrottlerOptions(): ThrottlerModuleOptions {
    this.logger.log('[ThrottlerLog] Initiating throttler module...')

    return [
      {
        ttl: Number(this.configService.get<number>('app.throttle.ttl')) * 1000,
        limit: Number(this.configService.get<number>('app.throttle.limit')),
      },
    ]
  }
}
