import { applyDecorators, Delete, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiParam } from '@nestjs/swagger'

import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'
import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut-server/const/decorator/logOperate'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'
import { WalnutAdminDecoratorOperateLog } from '../walnut/log.operate.decorator'

export function WalnutAdminDecoratorDelete(options: IWalnutAdminCrudOptions, field: string = WalnutAdminConstAppConfig.deleteField) {
  const { operateLog, swagger } = options

  const { title, needOperateLog = true } = operateLog

  const { DTO, description = `根据 ${field} 删除 ${title}` } = swagger

  const decorators = [
    Delete(`:${field}`),
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
        action: WalnutAdminConstDecoratorLogOperateAction.DELETE,
      }),
    )
  }

  return applyDecorators(...decorators)
}
