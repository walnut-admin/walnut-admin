import type { DynamicModule, Provider, Type, ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { ClassSerializerInterceptor, ValidationPipe, VersioningType } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { getAllConstraints } from '@walnut-server/utils/response'

import { createCache } from 'cache-manager'
import { useContainer } from 'class-validator'

import { AppModule } from '@/app/app.module'
import { ensureIntegrationPgDatabase, getWalnutPgDataSource } from '../../integration/helpers/create-integration-app'

/**
 * API 级测试装配：与 `integration/helpers/create-integration-app` 同源的完整 AppModule 装配
 * （全局 guard 链 / 中间件链齐全），在此基础上**补齐 main.ts 的应用配置**——
 * API 级测试的请求要穿过真实 HTTP 栈，因此 URI 版本化（`/{prefix}/v{version}`）、
 * 全局 ValidationPipe（whitelist + forbidNonWhitelisted + transform）、
 * 全局 ClassSerializerInterceptor（excludeExtraneousValues）必须与生产 bootstrap 同形，
 * 否则 400 / 序列化行为与真实服务不一致。
 *
 * CACHE_MANAGER 维持集成装配同款内存替换，决定与理由（评估结论，后续批次沿用）：
 * - **替换不是选择而是必须**：生产 CACHE_MANAGER 的 `@keyv/redis` store 是 ESM-only 包，
 *   与 CJS 的 `@nestjs/cache-manager` 在 vitest 模块图里存在 keyv 双包隐患
 *   （`instanceof Keyv` 恒 false → 工厂把 Redis store 再包一层 Keyv → 崩在
 *   `_checkIterableAdapter`），见 integration 侧同款注释；
 * - **真实的 Redis 缓存本来就在**：会话 / 签名握手（aesKey、nonce、signTicket、RSA 公钥）、
 *   设备与权限缓存全部走 `AppTechCacheService`（直连 ioredis，`WALNUT_CACHE_*` 前缀），
 *   与生产同一条路——CACHE_MANAGER 只承载 `@WalnutAdminDecoratorCache` 装饰器缓存；
 * - 用例间缓存污染：内存实现随每个 spec 文件的 app 实例生灭，天然隔离；真 Redis 侧的
 *   `WALNUT_CACHE_*` 键由各 spec 的 `cleanupWalnutCacheKeys`（见 api-client）按本轮 seed 片段 SCAN 清理。
 *
 * @param extraProviders 额外 provider（预留，与集成装配同口径）。
 */
export async function createApiApp(extraProviders: Provider[] = []): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule as unknown as Type<unknown> | DynamicModule],
    providers: extraProviders,
  })
    .overrideProvider(CACHE_MANAGER)
    .useValue(createCache())
    .compile()

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })

  const configService = app.get(ConfigService)
  const apiPrefix = configService.get<string>('app.api.prefix')!
  const apiVersion = configService.get<string>('app.api.version')!

  // 与 main.ts bootstrap 逐项对齐（静态资源 / 模板引擎 / socket 与 API 测试无关，不装配）
  app.set('trust proxy', true)

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: apiVersion,
    prefix: `${apiPrefix}/v`,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transformOptions: {
        exposeUnsetFields: false,
      },
      exceptionFactory: (errors: ValidationError[]) =>
        new WalnutAdminExceptionRequestDataError(
          getAllConstraints(errors).join(','),
        ),
    }),
  )

  // class-validator 自定义约束（如 LocaleLangIdValidate）是 @Injectable —— 与 main.ts 同款容器接管
  useContainer(app.select(AppModule), { fallbackOnErrors: true })

  const reflector = app.get(Reflector)
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector, {
      excludeExtraneousValues: true,
      enableCircularCheck: true,
    }),
  )

  await app.init()

  ensureIntegrationPgDatabase(app)

  return app
}

export { getWalnutPgDataSource }

/** API 前缀内的路径拼接：`/{prefix}/v{version}/system/lang` 之类由这里统一生产 */
export function apiPath(configService: ConfigService, url: string): string {
  const apiPrefix = configService.get<string>('app.api.prefix')!
  const apiVersion = configService.get<string>('app.api.version')!
  return `/${apiPrefix}/v${apiVersion}${url}`
}
