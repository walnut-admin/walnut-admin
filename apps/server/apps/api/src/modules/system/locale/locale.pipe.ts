import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { Recordable } from 'easy-fns-ts'

// B2 迁移：langId 从 ObjectId 十六进制串改为 uuid（phase2 4.5），过滤口径同步换 ——
// 语法级校验（8-4-4-4-12 hex），与 WalnutAdminPipeUuid / pg-list.builder 同一正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

@Injectable()
export class LocalePayloadTransformPipe implements PipeTransform<any, any> {
  transform(value: Recordable, _metadata: ArgumentMetadata) {
    const payload = Object.keys(value)
      .filter(i => UUID_REGEX.test(i))
      .map(item => ({
        langId: item,
        key: value.key as string,
        value: value[item] as string,
        oldKey: value.oldKey as string,
      }))

    // P3-20：body 里没有任何 langId 键（`{}` / 只有 key）时旧实现产出 `[]`，
    // 二段式管道的 ParseArrayPipe 对空数组不校验任何 item，service 在 payload[0]
    // 上解引用 → TypeError → 全局兜底 50000。校验层语义：一次提交至少一个翻译键。
    if (payload.length === 0) {
      throw new WalnutAdminExceptionRequestDataError(
        'payload must contain at least one langId key (`<langId>: value`)',
      )
    }

    return payload
  }
}
