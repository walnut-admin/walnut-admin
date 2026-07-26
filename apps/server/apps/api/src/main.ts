import type { NestExpressApplication } from '@nestjs/platform-express'
import type { ValidationError } from 'class-validator'
import { join } from 'node:path'
import process from 'node:process'
import {
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory, Reflector } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { apiReference } from '@scalar/nestjs-api-reference'
import { WalnutAdminExceptionRequestDataError } from '@walnut/exceptions/base/400'

import { getAllConstraints } from '@walnut/utils/response'

import { useContainer } from 'class-validator'
import { AppModule } from './app/app.module'
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

  const reflector = app.get(Reflector)

  app.set('trust proxy', true)

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
        // 入参 �?填充 undefined，设置为false可以过滤�?
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
  const options = new DocumentBuilder()
    .setTitle('NestJS Walnut Admin App')
    .setDescription('Document of API details')
    // https://docs.npmjs.com/cli/v10/using-npm/scripts
    .setVersion(process.env.npm_package_version!)
    .addBearerAuth()
    .build()

  const documentFactory = () => SwaggerModule.createDocument(app, options)

  app.use(
    `/${openapiPrefix}`,
    apiReference({
      content: documentFactory,
      theme: 'moon',
    }),
  )

  await app.listen(port)

  console.log(`APP is running in ${env} mode on ${await app.getUrl()}`)
  console.log(
    `Swagger document is host on ${await app.getUrl()}/${openapiPrefix}`,
  )
}
void bootstrap()
