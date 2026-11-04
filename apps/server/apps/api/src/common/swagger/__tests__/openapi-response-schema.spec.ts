import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, ParameterObject, ResponseObject, SchemaObject } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import { DiscoveryModule } from '@nestjs/core'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test } from '@nestjs/testing'
import { getDataSourceToken } from '@nestjs/typeorm'
import { ALSRequestService } from '@walnut-server/als'
import { AppErrorController, AppKeyController, AppKeyService, AppMonitorCacheController, AppMonitorUserService, AppSettingController, AppSettingRepositoryService, AppSettingService } from '@walnut-server/app-domain'
import { AuthCookieService, AuthOpaqueCoreService, AuthSharedService, AuthSignoutService, OAuthStateService } from '@walnut-server/auth'
import { AppTechCacheAppSettingsService, AppTechCachePermissionsService, AppTechCacheService } from '@walnut-server/cache'
import { WALNUT_ADMIN_OPERATE_LOG_WRITER } from '@walnut-server/crud'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserIdentitySharedService } from '@walnut-server/identity'
import { WALNUT_ADMIN_IP_LOCATION_RESOLVER } from '@walnut-server/ip'
import { SecurityRsaService } from '@walnut-server/rsa'
import { SecurityCapService, SecuritySignService } from '@walnut-server/security'
import { SecurityRiskFailedLoginService } from '@walnut-server/security/risk/modules/failedLogin.service'
import { AppTechSseService } from '@walnut-server/sse'
import { SysDeletedService, SysLogAuthSharedService } from '@walnut-server/system'
import { AppTokenService } from '@walnut-server/token'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppController } from '@/app/app.controller'
import { AppService } from '@/app/app.service'
import { createSwaggerDocument } from '@/common/swagger/swagger.document'
import { AppMonitorUserController } from '@/modules/app/monitor/user/user.controller'
import { OAuthGithubController } from '@/modules/auth/modules/oauth/github/github.controller'
import { AuthOpaqueUserController } from '@/modules/auth/modules/opaque/user/opaque.user.controller'
import { SecurityCapController } from '@/modules/security/cap/cap.controller'
import { SecurityRsaController } from '@/modules/security/rsa/rsa.controller'
import { SecuritySignController } from '@/modules/security/sign/sign.controller'
import { SysDeletedController } from '@/modules/system/deleted/deleted.controller'

/**
 * f-18（DOC-07）：200 响应无 schema 的端点逐个补齐后的**回归钉**。
 *
 * 这些端点分两类，断言形态也不同：
 * - 走 ApiWalnutOkResponse 的（key / setting / cache / monitor / deleted / oauth url / 根路径）：
 *   data 必须是项目壳里的具体形状（$ref 或 primitive）；
 * - 手搓裸 schema 的（cap 两个 FreeResponse 端点、sign initial 的二态返回、oauth callback 的
 *   text/html 渲染页、app/error 的「恒抛」语义）：断言落在那份裸 schema 上。
 *
 * 为什么逐个列端点而不是回扫 openapi.json：check-in 的 openapi.json 由离线导出维护（lead 在
 * 批次结束后统一重导出），单测若依赖它会把「产物过期」变成红色的测试。这里用与导出同一条
 * createSwaggerDocument 装配路径，断言的是**当前源码**的声明。
 */
type CrudMethod = 'get' | 'post' | 'put' | 'delete'

describe('补齐的 200 schema 端点（f-18 / DOC-07）', () => {
  let app: INestApplication | undefined
  let document: OpenAPIObject

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [
        AppController,
        AppErrorController,
        AuthOpaqueUserController,
        AppKeyController,
        AppMonitorCacheController,
        AppMonitorUserController,
        AppSettingController,
        OAuthGithubController,
        SecurityCapController,
        SecurityRsaController,
        SecuritySignController,
        SysDeletedController,
      ],
      providers: [
        // 业务依赖：文档形状用不到实现，一律空对象
        { provide: AppService, useValue: {} },
        { provide: AppKeyService, useValue: {} },
        { provide: AppMonitorUserService, useValue: {} },
        { provide: AppSettingService, useValue: {} },
        { provide: AppSettingRepositoryService, useValue: {} },
        { provide: AppTechCacheService, useValue: {} },
        { provide: SysDeletedService, useValue: {} },
        { provide: SecurityCapService, useValue: {} },
        { provide: SecurityRsaService, useValue: {} },
        { provide: SecuritySignService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: AuthCookieService, useValue: {} },
        { provide: AuthSharedService, useValue: {} },
        // opaque user controller（DOC-20 的 client-error 端点）
        { provide: AuthOpaqueCoreService, useValue: {} },
        { provide: AuthSignoutService, useValue: {} },
        { provide: AppTechSseService, useValue: {} },
        { provide: SecurityRiskFailedLoginService, useValue: {} },
        { provide: SysUserIdentitySharedService, useValue: {} },
        { provide: OAuthStateService, useValue: {} },
        // 4B 的 F-47：monitor user controller 注入了 AppTokenService（可选验签 AT）
        { provide: AppTokenService, useValue: { verifyAccessToken: async () => null } },
        // Guard / Interceptor 依赖：HasPermission、FunctionalGuard、operate-log、auth-log 各自要
        { provide: AppTechCachePermissionsService, useValue: {} },
        { provide: AppTechCacheAppSettingsService, useValue: {} },
        { provide: SysLogAuthSharedService, useValue: {} },
        { provide: WALNUT_ADMIN_OPERATE_LOG_WRITER, useValue: {} },
        { provide: WALNUT_ADMIN_IP_LOCATION_RESOLVER, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: ALSRequestService, useValue: {} },
        // @WalnutTx() 的 WalnutTxInterceptor 依赖 PG 连接
        { provide: getDataSourceToken(WalnutPGConnectionName), useValue: {} },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()

    document = createSwaggerDocument(app)
  })

  afterAll(async () => {
    // beforeAll 失败时 app 未赋值：避免用「close undefined」掩盖真正的装配错误
    await app?.close()
  })

  function operation(path: string, method: CrudMethod) {
    const found = document.paths[path]?.[method]
    expect(found, path).toBeDefined()

    return found!
  }

  /** 200 响应的 application/json schema（原始形态，不假设是不是项目壳） */
  function okSchema(path: string, method: CrudMethod) {
    return jsonSchemaOf(operation(path, method), path)
  }

  function jsonSchemaOf(target: unknown, label: string): SchemaObject {
    const responses = (target as { responses: Record<string, ResponseObject> }).responses
    const response = responses['200']
    const content = response.content
    const media = content === undefined ? undefined : content['application/json']
    const schema = media === undefined ? undefined : (media.schema as SchemaObject | undefined)

    expect(schema, label).toBeDefined()

    return schema!
  }

  /** 项目壳里的 data 段（壳是 allOf: [{ properties }] 单元素形态） */
  function okDataSchema(path: string, method: CrudMethod) {
    const allOf = okSchema(path, method).allOf as SchemaObject[]
    const shell = allOf[0]

    return (shell.properties as Record<string, SchemaObject>).data
  }

  /** data 段的 $ref（$ref 只在 reference 形态的 schema 上，SchemaObject 类型本身不含它） */
  function refOf(schema: SchemaObject) {
    return (schema as SchemaObject & { $ref?: string }).$ref
  }

  function parametersOf(path: string, method: CrudMethod) {
    return (operation(path, method).parameters ?? []) as ParameterObject[]
  }

  describe('根路径 / 演示端点', () => {
    it('根路径 GET / 与 GET /auth 的 data 是 i18n 译文串', () => {
      expect(okDataSchema('/', 'get').type).toBe('string')
      expect(okDataSchema('/auth', 'get').type).toBe('string')
    })
  })

  describe('app/key', () => {
    it('init / rotate 的 data 是 AppKeyDTOSafe', () => {
      expect(refOf(okDataSchema('/app/key/init', 'post'))).toBe('#/components/schemas/AppKeyDTOSafe')
      expect(refOf(okDataSchema('/app/key/rotate/{type}', 'post'))).toBe('#/components/schemas/AppKeyDTOSafe')
    })

    it('rotate 的 {type} 仍是必填枚举参数', () => {
      const type = parametersOf('/app/key/rotate/{type}', 'post').find(parameter => parameter.name === 'type')

      expect(type?.in).toBe('path')
      expect(type?.required).toBe(true)
    })
  })

  describe('app/setting 与 app/monitor', () => {
    it('setting private 的 data 是 AppSettingDTOPrivateResponse（此前无 schema）', () => {
      expect(refOf(okDataSchema('/app/setting/private', 'get')))
        .toBe('#/components/schemas/AppSettingDTOPrivateResponse')
    })

    it('setting cache refresh / cache clear / monitor user state 的 data 是 boolean', () => {
      expect(okDataSchema('/app/setting/cache/refresh', 'post').type).toBe('boolean')
      expect(okDataSchema('/app/monitor/cache/clear', 'delete').type).toBe('boolean')
      expect(okDataSchema('/app/monitor/user/state', 'post').type).toBe('boolean')
      expect(okDataSchema('/app/monitor/user/force-quit/{id}', 'delete').type).toBe('boolean')
    })

    it('force-quit 的 {id} 路径参数也补上了（自定义参数装饰器反射不到）', () => {
      const id = parametersOf('/app/monitor/user/force-quit/{id}', 'delete').find(parameter => parameter.name === 'id')

      expect(id?.in).toBe('path')
      expect(id?.required).toBe(true)
    })
  })

  describe('system/deleted', () => {
    it('recover / me/recover 的 data 是 boolean', () => {
      expect(okDataSchema('/system/deleted/recover', 'post').type).toBe('boolean')
      expect(okDataSchema('/system/deleted/me/recover', 'post').type).toBe('boolean')
    })
  })

  describe('security', () => {
    it('rsa public-key 的 data 是 PEM 串', () => {
      expect(okDataSchema('/security/rsa/public-key', 'get').type).toBe('string')
    })

    it('sign initial 的 data 是二态（缓存命中回吐公钥串 / 首次返回 true）', () => {
      const data = okDataSchema('/security/sign/initial', 'post')
      const variants = (data.oneOf ?? []) as SchemaObject[]

      expect(variants.map(variant => variant.type)).toEqual(['string', 'boolean'])
    })

    it('cap challenge / redeem 是裸 schema（FreeResponse 不套壳）', () => {
      const challengeSchema = okSchema('/security/cap/challenge', 'post')

      expect(challengeSchema.allOf).toBeUndefined()
      expect(challengeSchema.required).toEqual(['challenge', 'token', 'expires'])
      expect((challengeSchema.properties as Record<string, SchemaObject>).challenge.type).toBe('object')

      const redeemSchema = okSchema('/security/cap/redeem', 'post')

      expect(redeemSchema.allOf).toBeUndefined()
      expect((redeemSchema.properties as Record<string, SchemaObject>).success.type).toBe('boolean')
    })
  })

  describe('auth/oauth/github', () => {
    it('oauth url 的 data 是授权 URL 串', () => {
      expect(okDataSchema('/auth/oauth/github/url', 'get').type).toBe('string')
    })

    it('oauth callback 按 text/html 渲染页声明（不是 JSON 业务壳）', () => {
      const responses = operation('/auth/oauth/github/callback', 'get').responses as Record<string, ResponseObject>
      const content = responses['200'].content ?? {}

      expect(Object.keys(content)).toEqual(['text/html'])
    })
  })

  describe('auth/opaque/user', () => {
    it('client-error 按恒抛 40103 的错误语义声明（不是 boolean 成功壳）', () => {
      expect(okDataSchema('/auth/opaque/user/login/client-error', 'post').type).toBe('null')
    })
  })

  describe('app/error/{code}', () => {
    it('code 是必填的响应码枚举参数', () => {
      const code = parametersOf('/app/error/{code}', 'get').find(parameter => parameter.name === 'code')

      expect(code?.in).toBe('path')
      expect(code?.required).toBe(true)
      expect((code?.schema as SchemaObject).enum).toEqual(Object.values(WalnutAdminConstAppResponseCode))
    })

    it('app/error 的 200 声明为恒抛的错误壳（data = null）', () => {
      expect(okDataSchema('/app/error/{code}', 'get').type).toBe('null')
    })
  })
})
