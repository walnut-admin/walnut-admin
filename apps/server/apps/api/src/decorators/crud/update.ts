import { applyDecorators, HttpCode, HttpStatus, Put } from '@nestjs/common'

import { ApiParam } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut-server/const/decorator/logOperate'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'
import { WalnutAdminDecoratorOperateLog } from '../walnut/log.operate.decorator'

export function WalnutAdminDecoratorUpdate(options: IWalnutAdminCrudOptions, field: string = 'id') {
  const { operateLog, swagger } = options

  const { title, needOperateLog = true } = operateLog

  const { DTO, description = `修改 ${title}` } = swagger

  const decorators = [
    Put(`:${field}`),
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
  ]

  if (needOperateLog) {
    decorators.push(
      WalnutAdminDecoratorOperateLog({
        title,
        action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
      }),
    )
  }

  return applyDecorators(...decorators)
}
