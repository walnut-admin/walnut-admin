import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'

import { WalnutAdminExceptionInvalidID } from '@walnut-server/exceptions/base/400'
import { isNil } from 'lodash'

/**
 * PostgreSQL `uuid` 主键的入口校验（对应 Mongo 版 `WalnutAdminPipeMongoId`）。
 * 语法级校验（8-4-4-4-12 hex），不区分版本 —— v4（gen_random_uuid）/ v7（uuidv7）/
 * v5（ETL 派生）三种存量通道都要放行，见 phase2 第 3 节 ID 三通道。
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

@Injectable()
export class WalnutAdminPipeUuid implements PipeTransform<unknown, string> {
  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (isNil(value) || !isUuid(value)) {
      throw new WalnutAdminExceptionInvalidID()
    }

    return value as string
  }
}

@Injectable()
export class WalnutAdminPipeUuids implements PipeTransform<unknown, string[]> {
  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (isNil(value)) {
      throw new WalnutAdminExceptionInvalidID()
    }

    const ids = (value as string).split(WalnutAdminConstAppConfig.idSeparator)

    ids.forEach((id) => {
      if (!isUuid(id)) {
        throw new WalnutAdminExceptionInvalidID()
      }
    })

    return ids
  }
}
