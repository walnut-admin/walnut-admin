import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, ParameterObject, ResponseObject, SchemaObject } from '@nestjs/swagger'
import { DiscoveryModule } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { getDataSourceToken } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SecuritySensitiveCheckResponseDTO, SecuritySensitiveService, WalnutAdminConstSecurityLevel, WalnutAdminConstSecuritySensitiveType } from '@walnut-server/security'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSwaggerDocument } from '@/common/swagger/swagger.document'
import { SecuritySensitiveController } from './sensitive.controller'

/**
 * F-07：`GET /security/sensitive/check` 的必填 query 参数此前在 openapi 里是空数组，
 * 端点「文档层面不可调用」。
 *
 * 根因不是漏写装饰器，而是 union 字面量类型（`IWalnutAdminConstSecurityLevel`）经
 * `emitDecoratorMetadata` 反射成 `Object` —— @nestjs/swagger 只自动文档化反射型为
 * String / Number / Boolean 的 `@Query` 参数。所以断言必须落在文档产物上：
 * 单看装饰器源码看不出「最终 parameters 里到底有没有它」。
 */
describe('security/sensitive swagger 声明（F-07）', () => {
  let app: INestApplication | undefined
  let document: OpenAPIObject
  let parameters: ParameterObject[]

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [SecuritySensitiveController],
      providers: [
        { provide: SecuritySensitiveService, useValue: {} },
        // verify 端点挂 @WalnutTx()（WalnutTxInterceptor 依赖 PG 连接）；文档形状用不到连接
        { provide: getDataSourceToken(WalnutPGConnectionName), useValue: {} },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()

    document = createSwaggerDocument(app)
    parameters = (document.paths['/security/sensitive/check']?.get?.parameters ?? []) as ParameterObject[]
  })

  afterAll(async () => {
    // beforeAll 失败时 app 未赋值：避免用「close undefined」掩盖真正的装配错误
    await app?.close()
  })

  function queryParameter(name: string) {
    const found = parameters.find(parameter => parameter.name === name)
    expect(found, `query parameter ${name}`).toBeDefined()

    return found!
  }

  it('level 是必填 query 枚举（此前该 op 的 parameters 为空）', () => {
    const level = queryParameter('level')

    expect(level.in).toBe('query')
    expect(level.required).toBe(true)
    expect((level.schema as SchemaObject).enum).toEqual(Object.values(WalnutAdminConstSecurityLevel))
  })

  it('type 是可选 query 枚举（与实现一致：不传也能调）', () => {
    const operationType = queryParameter('type')

    expect(operationType.in).toBe('query')
    expect(operationType.required).toBe(false)
    expect((operationType.schema as SchemaObject).enum).toEqual(Object.values(WalnutAdminConstSecuritySensitiveType))
  })

  it('200 响应是项目壳 + SecuritySensitiveCheckResponseDTO（handler 本就 plainToInstance 它）', () => {
    const operation = document.paths['/security/sensitive/check'].get!

    expect(operation.summary).toBe('Check verification status for a security level')

    const responses = operation.responses as Record<string, ResponseObject>
    expect(Object.keys(responses)).toEqual(['200'])

    const responseSchema = responses['200'].content?.['application/json']?.schema as SchemaObject
    const properties = (responseSchema.allOf as SchemaObject[])[0].properties as Record<string, SchemaObject>

    expect((properties.data as { $ref?: string }).$ref)
      .toBe(`#/components/schemas/${SecuritySensitiveCheckResponseDTO.name}`)
    expect(document.components?.schemas?.[SecuritySensitiveCheckResponseDTO.name]).toBeDefined()
  })

  it('该端点仍是登录态（F-08 的 bearer 声明同时生效）', () => {
    expect(document.paths['/security/sensitive/check'].get!.security).toEqual([{ bearer: [] }])
  })
})
