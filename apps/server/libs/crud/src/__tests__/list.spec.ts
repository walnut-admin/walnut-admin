import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, ResponseObject, SchemaObject } from '@nestjs/swagger'
import { Controller } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { CreateWalnutAdminResponseListDTO } from '@walnut-server/list'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { WalnutCrudDecorators } from '../index'

/**
 * F-17（DOC-06）：CRUD 工厂的 list 装饰器此前只发 ApiExtraModels + ApiOkResponse，
 * 不发 ApiOperation —— 全站 19 个列表端点（POST <resource>/list）都缺 summary，
 * 文档导航里只剩 operationId。
 *
 * P2-6：200 的 `data` 必须是**单个分页壳对象**（service 返回 `{ data, total }`，响应
 * 拦截器原样塞进 `{ code, msg, data }`）。旧 schema 把它标成「分页壳的数组」（多包一层），
 * 生成类型与真实 wire 不符。另：行可能是 DTO 的字段子集，由 `listResponseDTO` 表达。
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

// 行裁剪后的响应 DTO：模拟 user 的 SysUserDTOListResponse（list 行 = DTO 的字段子集）
class SpecCrudListRowSubsetDTO {
  @ApiProperty({ type: String, title: 'row id' })
  id: string
}

class SpecCrudListResponseDTO extends CreateWalnutAdminResponseListDTO(SpecCrudListRowSubsetDTO) {}

const CRUD_TITLE = WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO

// 与各模块的真实用法一致：工厂建一次，controller 用它的 list 装饰器
const { WalnutAdminDecoratorList: ListOfSpec } = WalnutCrudDecorators({
  title: CRUD_TITLE,
  DTO: SpecCrudListRowDTO,
})

// 提供 listResponseDTO 的写法（行 = 字段子集）
const { WalnutAdminDecoratorList: ListOfSpecWithResponseDTO } = WalnutCrudDecorators({
  title: CRUD_TITLE,
  DTO: SpecCrudListRowDTO,
  listResponseDTO: SpecCrudListResponseDTO,
})

// 装饰器自带 Post('list')，所以 controller 路径不能再带 list（否则是 /spec/crud/list/list）
@Controller('spec/crud')
class SpecCrudListController {
  @ListOfSpec()
  list() {
    return []
  }
}

@Controller('spec/crud-override')
class SpecCrudListOverrideController {
  @ListOfSpecWithResponseDTO()
  list() {
    return []
  }
}

/** 取某端点 200 响应壳里的 `data` schema（壳是 WalnutAdminSwaggerResponseSuccessSchemeData 产物） */
function dataSchemaOf(document: OpenAPIObject, path: string): SchemaObject {
  const responses = document.paths[path]?.post?.responses as Record<string, ResponseObject> | undefined
  const schema = responses?.['200'].content?.['application/json']?.schema as SchemaObject | undefined

  expect(schema).toBeDefined()

  const shell = (schema!.allOf as SchemaObject[])[0]
  return (shell.properties as Record<string, SchemaObject>).data
}

describe('列表装饰器 WalnutAdminDecoratorList（F-17 summary + P2-6 响应形状）', () => {
  let app: INestApplication | undefined
  let document: OpenAPIObject

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [SpecCrudListController, SpecCrudListOverrideController],
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

  it('200 的 data 是**单个**分页壳对象（不是分页壳数组），行 = 工厂的 DTO', () => {
    const data = dataSchemaOf(document, '/spec/crud/list')

    // P2-6 偏差 1：data 不再是 array，而是分页壳的 $ref
    expect(data.type).toBeUndefined()
    expect((data as { $ref?: string }).$ref)
      .toBe(`#/components/schemas/${SpecCrudListRowDTO.name}ListResponse`)

    // 分页壳的 schema 名由 CreateWalnutAdminResponseListDTO 动态改名而来
    const shell = document.components?.schemas?.[`${SpecCrudListRowDTO.name}ListResponse`] as SchemaObject
    expect(shell).toBeDefined()

    const rowItems = (shell.properties as Record<string, SchemaObject>).data.items as { $ref?: string }
    expect(rowItems.$ref).toBe(`#/components/schemas/${SpecCrudListRowDTO.name}`)
  })

  it('提供 listResponseDTO 时，data 直接 $ref 真实响应类（行 = 其字段子集）', () => {
    const data = dataSchemaOf(document, '/spec/crud-override/list')

    expect((data as { $ref?: string }).$ref)
      .toBe(`#/components/schemas/${SpecCrudListResponseDTO.name}`)

    const shell = document.components?.schemas?.[SpecCrudListResponseDTO.name] as SchemaObject
    expect(shell).toBeDefined()

    const rowItems = (shell.properties as Record<string, SchemaObject>).data.items as { $ref?: string }
    expect(rowItems.$ref).toBe(`#/components/schemas/${SpecCrudListRowSubsetDTO.name}`)
  })
})
