import { applyDecorators, HttpCode, HttpStatus, Post } from '@nestjs/common'

import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger'
import { WalnutAdminSwaggerResponseSuccessSchemeData } from '@walnut-server/decorators/swagger'
import { CreateWalnutAdminResponseListDTO } from '../../common/dto/list.dto'

export function WalnutAdminDecoratorList(options: IWalnutAdminCrudOptions) {
  const { operateLog, swagger } = options

  const { title } = operateLog

  const { DTO, description = `${title} 列表` } = swagger

  return applyDecorators(
    Post('list'),
    HttpCode(HttpStatus.OK),
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
