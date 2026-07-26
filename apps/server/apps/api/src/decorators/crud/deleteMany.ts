import { applyDecorators, Delete, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiParam } from '@nestjs/swagger'

import { WalnutAdminConstAppConfig } from '@walnut/const/app/config'
import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut/const/decorator/logOperate'
import { ApiWalnutOkResponse } from '@walnut/decorators/swagger'
import { WalnutAdminDecoratorOperateLog } from '../walnut/log.operate.decorator'

export function WalnutAdminDecoratorDeleteMany(options: IWalnutAdminCrudOptions, field: string = WalnutAdminConstAppConfig.deleteManyField) {
  const { operateLog, swagger } = options

  const { title, needOperateLog = true } = operateLog

  const { DTO, description = `根据 ${field} (逗号分割)删除 ${title}` }
    = swagger

  const decorators = [
    Delete(`/deleteMany/:${field}`),
    HttpCode(HttpStatus.OK),
    ApiWalnutOkResponse({
      description,
      DTO,
    }),
    ApiParam({
      name: field,
      type: String,
      required: true,
      description: `${title} ${field} 字符串，逗号分割`,
    }),
  ]

  if (needOperateLog) {
    decorators.push(
      WalnutAdminDecoratorOperateLog({
        title,
        action: WalnutAdminConstDecoratorLogOperateAction.DELETE_MANY,
      }),
    )
  }

  return applyDecorators(...decorators)
}
