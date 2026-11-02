import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, ResponseObject, SchemaObject } from '@nestjs/swagger'
import { DiscoveryModule } from '@nestjs/core'
import { DiskHealthIndicator, HttpHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus'
import { Test } from '@nestjs/testing'
import { AppTechCachePermissionsService } from '@walnut-server/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSwaggerDocument } from '@/common/swagger/swagger.document'
import { AppTechHealthController, getDiskHealthCheckPath } from './health.controller'
import { AppTechHealthProbeService } from './health.probe.service'

// P3-22：disk 健康检查路径此前硬编码 `C:/`，非 Windows 部署恒失败（DiskHealthIndicator
// 抛错 → 全局兜底 50000）。单测钉住平台分支；HTTP 层的「受控二值」仍由 health.api-spec 覆盖。
describe('app/health disk 根路径（P3-22 跨平台）', () => {
  it('win32 → 系统盘 C:/', () => {
    expect(getDiskHealthCheckPath('win32')).toBe('C:/')
  })

  it('linux / darwin 等类 Unix → /', () => {
    expect(getDiskHealthCheckPath('linux')).toBe('/')
    expect(getDiskHealthCheckPath('darwin')).toBe('/')
  })
})

/**
 * F-09 / 裁决 Q5-a：health 五个端点的 swagger 声明覆盖 terminus 默认值。
 *
 * 两个失真点各自有用例：
 * 1. terminus `@HealthCheck()` 自带 `503`，而本仓实现失败时是 HTTP 200 + code 50000
 *    （全局异常过滤器兜底）—— 声明 503 会让编排方判活误判；
 * 2. terminus 声明的 `{status, info, details, error}` 外壳不是本仓的响应形状：真实响应是
 *    统一壳 `{code, msg, data}`，`data` 是 `{ <indicator>: { status, ... } }`。
 *
 * 断言落在 `createSwaggerDocument` 的产物上（关掉 terminus 默认声明的那半边也必须被证伪，
 * 只改装饰器不算修完）。
 */
const HEALTH_ENDPOINTS = [
  { path: '/app/health/network', indicator: 'baidu' },
  { path: '/app/health/postgres', indicator: 'postgres' },
  { path: '/app/health/memory-heap', indicator: 'memory-heap' },
  { path: '/app/health/memory-rss', indicator: 'memory-rss' },
  { path: '/app/health/disk', indicator: 'disk' },
]

/** 取某 health 端点 200 响应的壳 properties，并顺带钉住「只有 200」这件事 */
function okShellProperties(document: OpenAPIObject, path: string) {
  const operation = document.paths[path]?.get
  expect(operation, path).toBeDefined()

  const responses = operation!.responses as Record<string, ResponseObject>
  expect(Object.keys(responses), path).toEqual(['200'])

  const schema = responses['200'].content?.['application/json']?.schema as SchemaObject
  expect(schema, path).toBeDefined()

  return (schema.allOf as SchemaObject[])[0].properties as Record<string, SchemaObject>
}

describe('app/health swagger 声明（F-09：覆盖 terminus 默认、去 503）', () => {
  let app: INestApplication | undefined
  let document: OpenAPIObject

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [AppTechHealthController],
      providers: [
        // F-36：PG 探针下沉 probe service（DataSource 归它），本 spec 只验文档形状 ——
        // 控制器现在依赖 probe service 而不是 DataSource token
        { provide: AppTechHealthProbeService, useValue: {} },
        // 方法级 @WalnutAdminDecoratorHasPermission 挂的是 controller 级 guard，
        // Nest 会解析它的依赖（权限点缓存服务）—— 文档形状用不到，给空实现即可
        { provide: AppTechCachePermissionsService, useValue: {} },
        { provide: HttpHealthIndicator, useValue: {} },
        { provide: MemoryHealthIndicator, useValue: {} },
        { provide: DiskHealthIndicator, useValue: {} },
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

  it('五个端点都只声明 200，不再有现实里不可达的 503', () => {
    for (const { path } of HEALTH_ENDPOINTS) {
      const responses = document.paths[path].get!.responses as Record<string, ResponseObject>

      expect(responses['503'], path).toBeUndefined()
      expect(Object.keys(responses), path).toEqual(['200'])
    }
  })

  it('200 形状 = 项目统一壳，data 里恰好是该端点自己的 indicator 键', () => {
    for (const { path, indicator } of HEALTH_ENDPOINTS) {
      const properties = okShellProperties(document, path)

      const dataProperties = (properties.data).properties ?? {}
      expect(Object.keys(dataProperties), path).toEqual([indicator])

      const indicatorSchema = dataProperties[indicator] as SchemaObject
      expect(indicatorSchema.required, path).toEqual(['status'])
      expect((indicatorSchema.properties!.status as SchemaObject).enum, path).toEqual(['up', 'down'])
    }
  })

  it('壳里的 code 带着全量响应码枚举（F-09 的 code enum 在 health 上同样生效）', () => {
    for (const { path } of HEALTH_ENDPOINTS) {
      const properties = okShellProperties(document, path)

      expect(properties.code.enum, path).toEqual(Object.values(WalnutAdminConstAppResponseCode))
    }
  })
})
