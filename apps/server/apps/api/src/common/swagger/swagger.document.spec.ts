import { Controller, Get, Post } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { WalnutAdminGuardJwtFree, WalnutAdminGuardJwtOptional } from '@walnut-server/auth'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'
import { describe, expect, it } from 'vitest'

import { applySwaggerBearerAuth, createSwaggerDocument } from './swagger.document'

/**
 * F-08：受保护端点声明 `security: [{ bearer: [] }]`，匿名（JwtFree）端点保持不声明。
 * 批次6-B：JwtOptional（匿名与登录态都能调）声明成 `[{ bearer: [] }, {}]` —— 数组即「或」，
 * 空对象即「不带凭据也行」。
 *
 * 断言落在 `SwaggerModule.createDocument` 的**产物**上，而不是装饰器元数据：安全声明的最终形态
 * 由 explorer 决定（它会重排 / 合并 metadata），只有钉产物才能同时证明「注入被执行了」与
 * 「explorer 把它收编进了 operation」。
 */

@Controller('spec/swagger/protected')
class SpecSwaggerProtectedController {
  /** 绝大多数端点的形态：走 ApiWalnutOkResponse 组装点 */
  @Get()
  @ApiWalnutOkResponse({ description: 'protected endpoint with project response shell', primitive: 'boolean' })
  withResponseShell() {
    return true
  }

  /** 一个 swagger 装饰器都没有的端点（health / cap / monitor 这类）：注入必须同样覆盖 */
  @Post()
  bareEndpoint() {
    return true
  }

  /** 方法级 JwtFree：只有该端点匿名，同 controller 的其余端点仍受保护 */
  @Get('anonymous')
  @WalnutAdminGuardJwtFree()
  methodLevelAnonymous() {
    return true
  }
}

/** JwtOptional 的端点（目前线上只有 user_preference 的 read）：可带 bearer，也可匿名 */
@Controller('spec/swagger/optional')
class SpecSwaggerOptionalController {
  @Get()
  @WalnutAdminGuardJwtOptional()
  @ApiWalnutOkResponse({ description: 'optional endpoint (bearer or anonymous)', primitive: 'boolean' })
  optional() {
    return true
  }

  /** 同 controller 里不带 Optional 的端点：必须仍是单 bearer（Optional 不得泄漏到整类） */
  @Get('protected')
  protected() {
    return true
  }
}

@Controller('spec/swagger/anonymous')
@WalnutAdminGuardJwtFree()
class SpecSwaggerAnonymousController {
  @Get()
  @ApiWalnutOkResponse({ description: 'anonymous endpoint', primitive: 'boolean' })
  anonymous() {
    return true
  }
}

async function createSwaggerTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers: [SpecSwaggerProtectedController, SpecSwaggerOptionalController, SpecSwaggerAnonymousController],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()

  return app
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

describe('createSwaggerDocument（F-08：bearer 声明批量注入）', () => {
  it('受保护端点都声明 security: [{ bearer: [] }]（含只有响应壳的、以及完全没有 swagger 装饰器的）', async () => {
    const app = await createSwaggerTestApp()

    try {
      const document = createSwaggerDocument(app)

      // 走 ApiWalnutOkResponse 组装点
      expect(document.paths['/spec/swagger/protected'].get?.security).toEqual([{ bearer: [] }])
      // 没有任何 swagger 装饰器 —— 覆盖「不走工厂的端点」这条判据
      expect(document.paths['/spec/swagger/protected'].post?.security).toEqual([{ bearer: [] }])
    }
    finally {
      await app.close()
    }
  })

  it('jwtOptional（JwtOptional）端点声明两条：先 bearer、再空要求（= 可带 bearer，也可匿名）', async () => {
    const app = await createSwaggerTestApp()

    try {
      const document = createSwaggerDocument(app)

      // OpenAPI 的 security 数组是「或」关系：{} = 不带任何凭据 → 匿名可达
      expect(document.paths['/spec/swagger/optional'].get?.security).toEqual([{ bearer: [] }, {}])
      // 同一 controller 里没有 Optional 的端点不受影响（判据是方法级元数据，不是类）
      expect(document.paths['/spec/swagger/optional/protected'].get?.security).toEqual([{ bearer: [] }])
    }
    finally {
      await app.close()
    }
  })

  it('匿名端点不声明 security，且文档级不设 security（「未声明」即匿名）', async () => {
    const app = await createSwaggerTestApp()

    try {
      const document = createSwaggerDocument(app)

      // 类级 JwtFree：整个 controller 匿名
      expect(document.paths['/spec/swagger/anonymous'].get?.security).toBeUndefined()
      // 方法级 JwtFree：只该端点匿名
      expect(document.paths['/spec/swagger/protected/anonymous'].get?.security).toBeUndefined()

      // 文档根必须留空：否则匿名端点会「继承」根上的 bearer，与实现（匿名可访问）相反
      expect(document.security).toBeUndefined()
    }
    finally {
      await app.close()
    }
  })

  it('operation 引用的 scheme 一定在 securitySchemes 里（与 swagger.options 的 addBearerAuth 对齐）', async () => {
    const app = await createSwaggerTestApp()

    try {
      const document = createSwaggerDocument(app)

      const referencedSchemes = new Set<string>()
      for (const pathItem of Object.values(document.paths)) {
        for (const method of HTTP_METHODS) {
          for (const requirement of pathItem[method]?.security ?? []) {
            Object.keys(requirement).forEach(name => referencedSchemes.add(name))
          }
        }
      }

      expect(referencedSchemes.size).toBeGreaterThan(0)

      const declaredSchemes = Object.keys(document.components?.securitySchemes ?? {})
      expect([...referencedSchemes].filter(name => !declaredSchemes.includes(name))).toEqual([])
    }
    finally {
      await app.close()
    }
  })

  it('重复组装不叠加 security 条目（Scalar 每次取文档都会重新 createDocument）', async () => {
    const app = await createSwaggerTestApp()

    try {
      const first = createSwaggerDocument(app)
      const second = createSwaggerDocument(app)

      expect(first.paths['/spec/swagger/protected'].get?.security).toEqual([{ bearer: [] }])
      expect(second.paths['/spec/swagger/protected'].get?.security).toEqual([{ bearer: [] }])

      // 已注入过 ⇒ 第二次是空转（幂等标记）
      expect(applySwaggerBearerAuth(app)).toBe(0)
    }
    finally {
      await app.close()
    }
  })
})
