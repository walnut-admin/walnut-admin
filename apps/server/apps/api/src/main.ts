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
import { SwaggerModule } from '@nestjs/swagger'
import { getDataSourceToken } from '@nestjs/typeorm'
import { apiReference } from '@scalar/nestjs-api-reference'
import { AppTechRedisService } from '@walnut-server/cache'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'

import { getAllConstraints } from '@walnut-server/utils/response'

import { useContainer } from 'class-validator'
import { AppModule } from './app/app.module'
import { mountProbeRoutes, setDraining } from './app/probes.composition'
import { warnIfWorkerStandalone } from './app/schedule.composition'
import { buildSwaggerDocumentOptions } from './common/swagger/swagger.options'
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

  app.set('trust proxy', true)

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

  // api document
  const openapiPrefix = 'api'
  // options 的唯一来源在 common/swagger/swagger.options.ts（与离线导出 openapi.json 同源）
  const options = buildSwaggerDocumentOptions()

  const documentFactory = () => SwaggerModule.createDocument(app, options)

  app.use(
    `/${openapiPrefix}`,
    apiReference({
      content: documentFactory,
      theme: 'moon',
    }),
  )

  await app.listen(port)

  // 容器/Docker stop 发 SIGTERM 时优雅关闭 PG / Redis / Bull 连接（worker/main.ts 同款）
  app.enableShutdownHooks()

  // draining 监听必须在 enableShutdownHooks() **之后**注册：注册任一信号监听器会抑制
  // Node 的默认终止行为。若提前注册，启动窗口内（Nest 的关闭钩子还没挂上）收到的
  // SIGTERM 会被吞掉 —— 进程继续启动，编排层等不到退出。放在这里之后，信号要么走
  // Nest 的优雅关闭，要么由本监听置位 readiness（编排层停止导流），两者互不干扰。
  // SIGTERM / SIGINT 同款处理（容器 stop / 本地 Ctrl-C 都能让 readiness 先 503）。
  process.on('SIGTERM', () => setDraining(true))
  process.on('SIGINT', () => setDraining(true))

  console.log(`APP is running in ${env} mode on ${await app.getUrl()}`)
  console.log(
    `Swagger document is host on ${await app.getUrl()}/${openapiPrefix}`,
  )
}
void bootstrap()
