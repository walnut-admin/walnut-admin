import { applyDecorators, HttpCode, HttpStatus, Post } from '@nestjs/common'

import { ApiExtraModels, ApiOkResponse, ApiOperation, getSchemaPath } from '@nestjs/swagger'
import { WalnutAdminSwaggerResponseSuccessSchemeData } from '@walnut-server/decorators/swagger'
import { CreateWalnutAdminResponseListDTO } from '@walnut-server/list'

export function WalnutAdminDecoratorList(options: IWalnutAdminCrudOptions) {
  const { operateLog, swagger } = options

  const { title } = operateLog

  const { DTO, description = `${title} 列表` } = swagger

  return applyDecorators(
    Post('list'),
    HttpCode(HttpStatus.OK),
    // F-17（DOC-06）：create/read/update/delete 走 ApiWalnutOkResponse，那里内联了
    // ApiOperation({ summary })，而 list 手搓了特殊 schema（分页壳 + 行 DTO 分离，
    // ApiWalnutOkResponse 的 dataSchema 表达不了）—— 于是全站 19 个 POST */list 都缺
    // summary，文档导航里只剩 operationId。summary 在这里显式补一次，description 仍与
    // 其它五个工厂同源（默认 `${title} 列表`，调用方可用 swagger.description 覆盖）。
    ApiOperation({ summary: description }),
    ApiExtraModels(CreateWalnutAdminResponseListDTO(DTO!), DTO!),
    ApiOkResponse({
      description,
      schema: WalnutAdminSwaggerResponseSuccessSchemeData({
        type: 'array',
        items: {
          allOf: [
            { $ref: getSchemaPath(CreateWalnutAdminResponseListDTO(DTO!)) },
            {
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: getSchemaPath(DTO!) },
                },
              },
            },
          ],
        },
      }),
    }),
  )
}
