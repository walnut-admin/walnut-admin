import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut/exceptions/base/400'
import { isNil } from 'lodash'

@Injectable()
export class WalnutAdminPipeRequired implements PipeTransform {
  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (isNil(value)) {
      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}; error: required`,
      )
    }
    return value
  }
}
