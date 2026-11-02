import type { OpenAPIObject } from '@nestjs/swagger'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildSwaggerDocumentOptions } from './swagger.options'

/**
 * F-52（DOC-17 / 裁决 Q10-a）：文档 servers = URI versioning 的真实前缀。
 *
 * 导出物（openapi.json）里的 paths 是**去掉前缀**的形态（main.ts 的 enableVersioning：
 * prefix = APP_API_PREFIX + '/v'），没有 servers 时消费方只能靠仓外知识拼前缀。
 *
 * 断言落在 DocumentBuilder 的产物的 servers 上；env 用 vi.stubEnv 造（值来自
 * libs/config 的 app.config 工厂，与运行时同源）。
 */
describe('buildSwaggerDocumentOptions servers（F-52）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function build(): Omit<OpenAPIObject, 'paths'> {
    // npm_package_version 由 pnpm 脚本注入；单测里补一个，避免 setVersion 收到 undefined
    vi.stubEnv('npm_package_version', '0.0.0-test')

    return buildSwaggerDocumentOptions()
  }

  it('按 APP_API_PREFIX / APP_API_VERSION 生成相对 server URL', () => {
    vi.stubEnv('APP_API_PREFIX', 'w')
    vi.stubEnv('APP_API_VERSION', '1')

    const servers = build().servers

    expect(servers).toHaveLength(1)
    expect(servers?.[0]?.url).toBe('/w/v1')
    // 相对 URL 的意图要写进 description —— 消费方不该把它当绝对地址缓存
    expect(servers?.[0]?.description).toContain('APP_API_PREFIX')
  })

  it('前缀两侧多余斜杠被规整（部署里 api/w 与 /api/w 两种写法都出现过）', () => {
    vi.stubEnv('APP_API_PREFIX', '/api/w/')
    vi.stubEnv('APP_API_VERSION', '2')

    expect(build().servers?.[0]?.url).toBe('/api/w/v2')
  })

  it('拿不到 env 时不声明 server（宁缺勿错，不猜前缀）', () => {
    vi.stubEnv('APP_API_PREFIX', '')
    vi.stubEnv('APP_API_VERSION', '')

    // DocumentBuilder.build() 的缺省形态是空数组，不是 undefined
    expect(build().servers).toEqual([])
  })

  it('版本不是数字时同样不声明（口径与 app.config 的 Number.parseInt 一致）', () => {
    vi.stubEnv('APP_API_PREFIX', 'w')
    vi.stubEnv('APP_API_VERSION', 'v1')

    expect(build().servers).toEqual([])
  })
})
