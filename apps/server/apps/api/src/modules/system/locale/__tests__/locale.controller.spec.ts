import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, ParameterObject, RequestBodyObject, ResponseObject, SchemaObject } from '@nestjs/swagger'
import { DiscoveryModule } from '@nestjs/core'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test } from '@nestjs/testing'
import { getDataSourceToken } from '@nestjs/typeorm'
import { ALSRequestService } from '@walnut-server/als'
import { AppTechCachePermissionsService } from '@walnut-server/cache'
import { WALNUT_ADMIN_OPERATE_LOG_WRITER } from '@walnut-server/crud'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_IP_LOCATION_RESOLVER } from '@walnut-server/ip'
import { SysLocaleService } from '@walnut-server/system'
import { Locale } from '@walnut/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSwaggerDocument } from '@/common/swagger/swagger.document'
import { SysLocaleController } from '../locale.controller'

/**
 * F-19（DOC-11）+ F-20（DOC-05 / DOC-14）：locale 三个端点的 wire 契约。
 *
 * 这三处都不是「漏写装饰器」那么简单：
 * - create / update 的 body 是**翻译映射**（自定义参数装饰器 TransformedLocaleBody 反射不出
 *   类型），此前 requestBody 整个缺席；
 * - message 的 locale 是 union 字面量（emitDecoratorMetadata 反射成 Object），cache 带
 *   DefaultValuePipe(1) 却被标成 required —— 两者都只能显式声明。
 *
 * 断言落在 createSwaggerDocument 的产物上：parameter 的最终形态（含 explorer 对自动推断
 * 参数与手写参数的合并）只有产物能证明。
 */
describe('system/locale swagger 声明（F-19 / F-20）', () => {
  let app: INestApplication | undefined
  let document: OpenAPIObject

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [SysLocaleController],
      providers: [
        { provide: SysLocaleService, useValue: {} },
        // 方法级 @WalnutAdminDecoratorHasPermission 挂的是 controller 级 guard，
        // Nest 会解析它的依赖（权限点缓存服务）—— 文档形状用不到，给空实现即可
        { provide: AppTechCachePermissionsService, useValue: {} },
        // create / update 挂 @WalnutTx()（WalnutTxInterceptor 依赖 PG 连接）
        { provide: getDataSourceToken(WalnutPGConnectionName), useValue: {} },
        // CRUD 工厂的 operate-log 装饰器挂 @UseInterceptors(WalnutAdminInterceptorRequestOperateLog)，
        // 它的 5 个依赖只用于请求期写操作日志 —— 文档形状用不到，一律空实现
        { provide: WALNUT_ADMIN_OPERATE_LOG_WRITER, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: ALSRequestService, useValue: {} },
        { provide: WALNUT_ADMIN_IP_LOCATION_RESOLVER, useValue: {} },
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

  function requestBodySchema(path: string, method: 'post' | 'put') {
    const operation = document.paths[path]?.[method]
    expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined()

    const requestBody = operation!.requestBody as RequestBodyObject | undefined
    expect(requestBody, `${method.toUpperCase()} ${path}`).toBeDefined()
    expect(requestBody!.required).toBe(true)

    return requestBody!.content['application/json'].schema as SchemaObject
  }

  /** 映射 body 的三条判据：固定键 key/oldKey、其余键 = 语言 uuid → 译文串、key 必填 */
  function expectLocaleMappingBody(schema: SchemaObject) {
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['key'])

    const properties = schema.properties as Record<string, SchemaObject>
    expect(properties.key.type).toBe('string')
    expect(properties.oldKey.type).toBe('string')

    const additional = schema.additionalProperties as SchemaObject
    expect(additional.type).toBe('string')
  }

  it('创建端点的 requestBody 是翻译映射（此前完全缺席）', () => {
    expectLocaleMappingBody(requestBodySchema('/system/locale', 'post'))
  })

  it('更新端点的 requestBody 同样是翻译映射', () => {
    expectLocaleMappingBody(requestBodySchema('/system/locale/{id}', 'put'))
  })

  it('message 的 locale 是必填路径枚举（此前参数完全缺失）', () => {
    const parameters = (document.paths['/system/locale/message/{locale}']?.get?.parameters ?? []) as ParameterObject[]
    const locale = parameters.find(parameter => parameter.name === 'locale')

    expect(locale, 'path parameter locale').toBeDefined()
    expect(locale!.in).toBe('path')
    expect(locale!.required).toBe(true)
    expect((locale!.schema as SchemaObject).enum).toEqual(Object.values(Locale))
  })

  it('message 的 cache 是可选 query（DefaultValuePipe(1) ≠ 必填）', () => {
    const parameters = (document.paths['/system/locale/message/{locale}']?.get?.parameters ?? []) as ParameterObject[]
    const cacheParameters = parameters.filter(parameter => parameter.name === 'cache')

    // 手写 @ApiQuery 与自动推断的 cache 必须合并成一条，不能出现重复参数
    expect(cacheParameters).toHaveLength(1)
    expect(cacheParameters[0].in).toBe('query')
    expect(cacheParameters[0].required).toBe(false)
    expect((cacheParameters[0].schema as SchemaObject).type).toBe('number')
  })

  it('message 的 200 是项目壳 + 「消息 key → 译文」映射', () => {
    const responses = document.paths['/system/locale/message/{locale}'].get!.responses as Record<string, ResponseObject>
    const schema = responses['200'].content?.['application/json']?.schema as SchemaObject

    expect(schema).toBeDefined()

    const shell = (schema.allOf as SchemaObject[])[0]
    const data = (shell.properties as Record<string, SchemaObject>).data

    expect(data.type).toBe('object')
    expect((data.additionalProperties as SchemaObject).type).toBe('string')
  })
})
