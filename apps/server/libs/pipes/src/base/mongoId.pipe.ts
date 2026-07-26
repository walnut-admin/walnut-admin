import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminConstAppConfig } from '@walnut/const/app/config'

import { WalnutAdminExceptionInvalidID } from '@walnut/exceptions/base/400'
import { isNil } from 'lodash'
import { Types } from 'mongoose'

@Injectable()
export class WalnutAdminPipeMongoId implements PipeTransform<unknown, string> {
  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (isNil(value)) {
      throw new WalnutAdminExceptionInvalidID()
    }

    if (!Types.ObjectId.isValid(value as string)) {
      throw new WalnutAdminExceptionInvalidID()
    }

    return value as string
  }
}

@Injectable()
export class WalnutAdminPipeMongoIds implements PipeTransform<unknown, string[]> {
  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (isNil(value)) {
      throw new WalnutAdminExceptionInvalidID()
    }

    const ids = (value as string).split(WalnutAdminConstAppConfig.idSeparator)

    ids.forEach((id) => {
      if (!Types.ObjectId.isValid(id)) {
        throw new WalnutAdminExceptionInvalidID()
      }
    })

    return ids
  }
}
