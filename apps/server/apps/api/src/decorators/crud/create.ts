import { applyDecorators, HttpCode, HttpStatus, Post } from '@nestjs/common'

import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut/const/decorator/logOperate'
import { ApiWalnutOkResponse } from '@walnut/decorators/swagger'
import { WalnutAdminDecoratorOperateLog } from '../walnut/log.operate.decorator'

export function WalnutAdminDecoratorCreate(options: IWalnutAdminCrudOptions) {
  const { operateLog, swagger } = options

  const { title, needOperateLog = true } = operateLog

  const { DTO, description = `添加 ${title}` } = swagger

  const decorators = [
    Post(),
    HttpCode(HttpStatus.OK),
    ApiWalnutOkResponse({
      description,
      DTO,
    }),
  ]

  if (needOperateLog) {
    decorators.push(
      WalnutAdminDecoratorOperateLog({
        title,
        action: WalnutAdminConstDecoratorLogOperateAction.CREATE,
      }),
    )
  }

  return applyDecorators(...decorators)
}
