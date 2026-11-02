import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { isNil } from 'lodash'

@Injectable()
export class WalnutAdminPipeParamEnum implements PipeTransform<Record<string, string>, string> {
  constructor(private vals: Record<string, string | number>, private options: { required: boolean } = { required: true }) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const { required = true } = this.options

    if (isNil(value)) {
      // required: false 时缺省放行（值不参与枚举比对 —— String(undefined) 恒不在值集里，
      // 落到下面会把「未传」误判成「传错」，optional 形态根本不可用）
      if (!required) {
        return undefined as unknown as string
      }

      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}`,
      )
    }

    if (!Object.values(this.vals).map(String).includes(String(value))) {
      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}`,
      )
    }

    return value as string
  }
}
