import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut/exceptions/base/400'
import { isNil } from 'lodash'

@Injectable()
export class WalnutAdminPipeParamEnum implements PipeTransform<Record<string, string>, string> {
  constructor(private vals: Record<string, string | number>, private options: { required: boolean } = { required: true }) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const { required = true } = this.options

    if (
      (required && isNil(value)) || !Object.values(this.vals).map(String).includes(String(value))
    ) {
      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}`,
      )
    }

    return value as string
  }
}
