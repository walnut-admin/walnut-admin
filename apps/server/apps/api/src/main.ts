import type { NestExpressApplication } from '@nestjs/platform-express'
import type { ValidationError } from 'class-validator'
import type { DataSource } from 'typeorm'
import { join } from 'node:path'
import process from 'node:process'
import {
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory, Reflector } from '@nestjs/core'
import { getDataSourceToken } from '@nestjs/typeorm'
import { apiReference } from '@scalar/nestjs-api-reference'
import { AppTechRedisService } from '@walnut-server/cache'
import { WalnutAdminConstAppEnv, WalnutAdminEnv } from '@walnut-server/const/app/env'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'

import { getAllConstraints } from '@walnut-server/utils/response'

import { useContainer } from 'class-validator'
import { AppModule } from './app/app.module'
import { mountProbeRoutes, setDraining } from './app/probes.composition'
import { warnIfWorkerStandalone } from './app/schedule.composition'
import { createSwaggerDocument } from './common/swagger/swagger.document'
import { WalnutAdminLogger } from './modules/techniques/logger'
import { SocketIoAdapter } from './socket/socket.adapter'

// middleware => guards => interceptors => pipes => interceptors

// In general, the request lifecycle looks like the following:
// Incoming request
// Globally bound middleware
// Module bound middleware
// Global guards
// Controller guards
// Route guards
// Global interceptors (pre-controller)
// Controller interceptors (pre-controller)
// Route interceptors (pre-controller)
// Global pipes
// Controller pipes
// Route pipes
// Route parameter pipes
// Controller (method handler)
// Service (if exists)
// Route interceptor (post-request)
// Controller interceptor (post-request)
// Global interceptor (post-request)
// Exception filters (route, then controller, then global)
// Server response
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WalnutAdminLogger,
  })

  const configService = app.get(ConfigService)
  const APIPrefix = configService.get<string>('app.api.prefix')!
  const APIVersion = configService.get<string>('app.api.version')!

  const port = configService.get<number>('app.port')!
  const env = configService.get<string>('NODE_ENV')!

  // WORKER_STANDALONE=true 时本进程已让出 cron 与 bootstrap（见 schedule.composition.ts）：
  // 打一条启动 warn，避免「worker 没起」只表现为「缓存不更新、cron 不跑」
  warnIfWorkerStandalone()

  const reflector = app.get(Reflector)

  /*
   * F-11（trust proxy 跳数）：**不能**用 `trust proxy = true` —— 那等于信任任意长度的
   * 代理跳，客户端自带 X-Forwarded-For 即可伪造 req.ip / req.ips。而本项目的 IP 维度
   * 控制全都吃 `req.realIp`（IpMiddleware 用 @supercharge/request-ip，header 优先，
   * 与 Express 的 trust proxy 是**两条并存通道**）：IP 黑名单（ip.guard）、限流 tracker
   * （throttler.guard）、失败登录临时拉黑与扫描路径永久拉黑、设备 IP 变更跟踪
   * （device.guard）、风控（risk.guard）。伪造 XFF 的后果不止绕过，还包括**嫁祸**
   * 任意 IP 进永久黑名单。
   *
   * 所以这里收窄成**具体跳数**：APP_TRUST_PROXY_HOPS（可选，默认 1 = docker 单层
   * nginx：deploy/docker-compose.yml 只发布 80/443，nginx 用 $remote_addr **覆写**
   * XFF / X-Real-IP，见 deploy/nginx/conf.d/api.conf:50-57）。与边缘 nginx 的耦合口径
   * 在 middleware/src/ip.middleware.ts 头注释里有同一段警示。
   *
   * 非整数/负数（含未配置）一律回落默认 1：宁可信任「恰好一跳」也不要回到 true。
   */
  const trustProxyHops = Number.parseInt(
    String(configService.get('APP_TRUST_PROXY_HOPS') ?? ''),
    10,
  )
  app.set(
    'trust proxy',
    Number.isInteger(trustProxyHops) && trustProxyHops >= 0
      ? trustProxyHops
      : 1,
  )

  /*
   * 探针（W2-B）：raw Express 路由，必须在 NestFactory.create 之后、listen 之前挂载
   * （此时 Nest router / 全局中间件 / 全局过滤器都还没注册，请求先被探针接住）。
   * 完整契约见 ./app/probes.composition.ts 头注释。
   * 依赖用惰性 getter：挂载时不解析容器实例，请求到达时才 app.get。
   */
  mountProbeRoutes(app, {
    pg: () => app.get<DataSource>(getDataSourceToken(WalnutPGConnectionName)),
    redis: () => app.get(AppTechRedisService),
  })

  /* static file */
  // test: http://127.0.0.1:3000/static/images/demo.png
  app.useStaticAssets(join(__dirname, '/public'), {
    prefix: `/${APIPrefix}/v${APIVersion}/static/`,
    setHeaders(res: IWalnutAdminExpressResponse, _path, _stat) {
      // TODO not working, IDM would init
      res.set('Content-Disposition', 'inline')
    },
  })

  /* email template */
  app.setBaseViewsDir(join(__dirname, '/views/'))
  /* hbs engine for email */
  app.setViewEngine('hbs')

  /* uri verioning */
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: APIVersion,
    prefix: `${APIPrefix}/v`,
  })

  /* socket io adapter */
  app.useWebSocketAdapter(new SocketIoAdapter(app, configService))

  // global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transformOptions: {
        // 入参不填充 undefined，设为 false 可以过滤掉未设置字段
        exposeUnsetFields: false,
      },
      exceptionFactory: (errors: ValidationError[]) =>
        new WalnutAdminExceptionRequestDataError(
          getAllConstraints(errors).join(','),
        ),
    }),
  )

  // https://github.com/nestjs/nest/issues/528#issuecomment-523144687
  useContainer(app.select(AppModule), { fallbackOnErrors: true })

  // global intercepters
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector, {
      excludeExtraneousValues: true, // remove fields that are not in the DTO
      enableCircularCheck: true,
    }),
  )

  // api document（F-10：**仅非生产挂载**）
  const openapiPrefix = 'api'
  // 为什么按环境关掉：这段是 raw express 挂载（app.use），在 Nest 路由与全局 guard 链
  // **之外**摘不到任何认证 —— 全量 Scalar 文档 = 接口清单 + wire DTO 字段 + 权限点，
  // 是生产对外最省事的侦察面。口径与 apps/server/AGENTS.md「开发模式下 Scalar API
  // Reference 在 http://localhost:3000/api」一致：文档本来就只承诺开发环境提供。
  //
  // 判据用 libs/const 的 WalnutAdminEnv（process.env.NODE_ENV 的模块求值快照），与启动
  // 脚本的 cross-env NODE_ENV=production 同源（start:prod / 容器 env），不依赖 env 文件里
  // 是否又写了一遍 NODE_ENV。stage 仍挂载（预发需要联调文档）。
  if (WalnutAdminEnv !== WalnutAdminConstAppEnv.PROD) {
    // 组装点唯一：common/swagger/swagger.document.ts（options 来源 + bearer 批量注入，
    // 与离线导出 openapi.json 同一条路径）。工厂是惰性的（Scalar 每次取文档都会调），
    // 注入带幂等标记，重复调用不会叠加 security 数组。
    const documentFactory = () => createSwaggerDocument(app)

    app.use(
      `/${openapiPrefix}`,
      apiReference({
        content: documentFactory,
        theme: 'moon',
      }),
    )
  }

  await app.listen(port)

  /*
   * 容器/Docker stop 发 SIGTERM 时的优雅关闭。Nest 的关闭序列是：
   * prepareClose → onModuleDestroy（Redis quit）→ beforeApplicationShutdown（CAP 落盘）
   * → dispose（停 HTTP / socket.io）→ onApplicationShutdown（TypeORM 关池、Bull 关队列）。
   *
   * ① cap.js 的 `process.exit(0)` 竞争已在 @walnut-server/security/cap 里根治：它在构造期
   *    抢注册的 SIGTERM/SIGINT/SIGQUIT/beforeExit 被摘掉，cleanup 改由
   *    SecurityCapService.beforeApplicationShutdown 调用（见 libs/security/src/cap/cap.shutdown.ts
   *    头注释）。这里**不需要**再为 cap 做任何兜底。
   *
   * ② `useProcessExit: true` 是必须的：Nest 默认在关闭序列跑完后
   *    `process.kill(process.pid, signal)` 重发信号（nest-application-context.js:245-252），
   *    而下面给 SIGTERM/SIGINT 注册的 `setDraining` 监听器会**接住**这次重发（Node 只在
   *    没有监听器时才走默认终止）—— 进程于是交给「事件循环自然空掉」，只要还剩一句异步
   *    尾巴（winston 传输、socket.io 定时器）就永远不退出。改成显式 process.exit(0)：退出码
   *    与 cap.js 自己 `exit(0)` 的旧行为一致，但**只在整个序列（含 PG / Bull 的
   *    onApplicationShutdown）跑完之后**才发生。
   */
  app.enableShutdownHooks(undefined, { useProcessExit: true })

  // draining 监听必须在 enableShutdownHooks() **之后**注册：注册任一信号监听器会抑制
  // Node 的默认终止行为。若提前注册，启动窗口内（Nest 的关闭钩子还没挂上）收到的
  // SIGTERM 会被吞掉 —— 进程继续启动，编排层等不到退出。放在这里之后，信号要么走
  // Nest 的优雅关闭，要么由本监听置位 readiness（编排层停止导流），两者互不干扰。
  // SIGTERM / SIGINT 同款处理（容器 stop / 本地 Ctrl-C 都能让 readiness 先 503）。
  process.on('SIGTERM', () => setDraining(true))
  process.on('SIGINT', () => setDraining(true))

  console.log(`APP is running in ${env} mode on ${await app.getUrl()}`)
  // 与挂载条件同一判据：生产没挂文档就不要打「文档在这里」的日志（否则是误导性的暴露暗示）
  if (WalnutAdminEnv !== WalnutAdminConstAppEnv.PROD) {
    console.log(
      `Swagger document is host on ${await app.getUrl()}/${openapiPrefix}`,
    )
  }
}
void bootstrap()
