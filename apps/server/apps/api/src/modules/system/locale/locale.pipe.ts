import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { Recordable } from 'easy-fns-ts'

import { Types } from 'mongoose'

@Injectable()
export class LocalePayloadTransformPipe implements PipeTransform<any, any> {
  transform(value: Recordable, _metadata: ArgumentMetadata) {
    return Object.keys(value)
      .filter(i => Types.ObjectId.isValid(i))
      .map(item => ({
        langId: item,
        key: value.key as string,
        value: value[item] as string,
        oldKey: value.oldKey as string,
      }))
  }
}
