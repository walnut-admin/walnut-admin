import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, ResponseObject, SchemaObject } from '@nestjs/swagger'
import { Controller } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { WalnutCrudDecorators } from './index'

/**
 * F-17（DOC-06）：CRUD 工厂的 list 装饰器此前只发 ApiExtraModels + ApiOkResponse，
 * 不发 ApiOperation —— 全站 19 个列表端点（POST <resource>/list）都缺 summary，
 * 文档导航里只剩 operationId。
 *
 * 断言落在 SwaggerModule.createDocument 的**产物**上：ApiOperation 的 summary 由
 * explorer 收编，只看装饰器源码看不出最终 operation 有没有它。
 *
 * 这里不用 apps/api 的 createSwaggerDocument —— libs 禁止 import '@/*'（分层门禁），
 * 且本用例要证的只是「工厂自己发出的元数据」，与 bearer 注入 / servers 无关。
 */

class SpecCrudListRowDTO {
  @ApiProperty({ type: String, title: 'row id' })
  id: string

  @ApiProperty({ type: String, title: 'row name' })
  name: string
}

const CRUD_TITLE = WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO

// 与各模块的真实用法一致：工厂建一次，controller 用它的 list 装饰器
const { WalnutAdminDecoratorList: ListOfSpec } = WalnutCrudDecorators({
  title: CRUD_TITLE,
  DTO: SpecCrudListRowDTO,
})

// 装饰器自带 Post('list')，所以 controller 路径不能再带 list（否则是 /spec/crud/list/list）
@Controller('spec/crud')
class SpecCrudListController {
  @ListOfSpec()
  list() {
    return []
  }
}

describe('列表装饰器 WalnutAdminDecoratorList（F-17：summary + 200 壳）', () => {
  let app: INestApplication | undefined
  let document: OpenAPIObject

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [SpecCrudListController],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()

    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('spec').setVersion('0.0.0').build(),
    )
  })

  afterAll(async () => {
    // beforeAll 失败时 app 未赋值：避免用「close undefined」掩盖真正的装配错误
    await app?.close()
  })

  it('operation 带上 summary（值 = 默认的「<title> 列表」，与响应 description 同源）', () => {
    const operation = document.paths['/spec/crud/list'].post

    expect(operation?.summary).toBe(`${CRUD_TITLE} 列表`)
    expect((operation?.responses['200'] as { description?: string }).description)
      .toBe(operation?.summary)
  })

  it('200 schema 仍是项目壳 + 分页列表行（补 summary 不改变响应形状）', () => {
    const responses = document.paths['/spec/crud/list']?.post?.responses as Record<string, ResponseObject> | undefined
    const schema = responses?.['200'].content?.['application/json']?.schema as SchemaObject | undefined

    expect(schema).toBeDefined()

    const shell = (schema!.allOf as SchemaObject[])[0]
    const data = (shell.properties as Record<string, SchemaObject>).data

    expect(data.type).toBe('array')

    const item = (data.items as SchemaObject).allOf as SchemaObject[]
    const listRef = (item[0] as { $ref?: string }).$ref

    // 列表壳的 schema 名由 CreateWalnutAdminResponseListDTO 动态改名而来
    expect(listRef).toBe(`#/components/schemas/${SpecCrudListRowDTO.name}ListResponse`)
    expect(document.components?.schemas?.[`${SpecCrudListRowDTO.name}ListResponse`]).toBeDefined()

    // 行 DTO 也进 components（items.allOf[1].properties.data.items.$ref）
    const rowRef = (
      (item[1]).properties as Record<string, SchemaObject>
    ).data.items as { $ref?: string }

    expect(rowRef.$ref).toBe(`#/components/schemas/${SpecCrudListRowDTO.name}`)
  })
})
