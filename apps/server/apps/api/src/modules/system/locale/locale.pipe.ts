import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { Recordable } from 'easy-fns-ts'

// B2 迁移：langId 从 ObjectId 十六进制串改为 uuid（phase2 4.5），过滤口径同步换 ——
// 语法级校验（8-4-4-4-12 hex），与 WalnutAdminPipeUuid / pg-list.builder 同一正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

@Injectable()
export class LocalePayloadTransformPipe implements PipeTransform<any, any> {
  transform(value: Recordable, _metadata: ArgumentMetadata) {
    return Object.keys(value)
      .filter(i => UUID_REGEX.test(i))
      .map(item => ({
        langId: item,
        key: value.key as string,
        value: value[item] as string,
        oldKey: value.oldKey as string,
      }))
  }
}
