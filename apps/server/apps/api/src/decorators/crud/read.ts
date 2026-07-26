import { applyDecorators, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiParam } from '@nestjs/swagger'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'

export function WalnutAdminDecoratorRead(options: IWalnutAdminCrudOptions, field: string = 'id') {
  const { operateLog, swagger } = options

  const { title } = operateLog

  const { DTO, description = `根据 ${field} 查询 ${title}` } = swagger

  return applyDecorators(
    Get(`:${field}`),
    HttpCode(HttpStatus.OK),
    ApiWalnutOkResponse({
      description,
      DTO,
    }),
    ApiParam({
      name: field,
      type: String,
      required: true,
      description: `${title} ${field}`,
    }),
  )
}
