import type { Recordable } from 'easy-fns-ts'
import type { IncomingHttpHeaders } from 'node:http'
import { Injectable } from '@nestjs/common'
import { maskEmail, maskPhone, maskSensitiveFields } from '@walnut-server/utils/mask'
import { isNil } from 'lodash'

@Injectable()
export class SharedMaskService {
  private readonly sensitiveHeaders = ['authorization', 'cookie', '_csrf', 'x-csrf-token']

  maskFields<T extends Record<string, any>>(obj: T, extraKeys?: string[]) {
    return maskSensitiveFields(obj, extraKeys)
  }

  maskHeaders(headers: IncomingHttpHeaders): Recordable {
    if (isNil(headers))
      return {}

    const filteredHeaders: Recordable = {}

    for (const [key, value] of Object.entries(headers)) {
      if (this.sensitiveHeaders.includes(key.toLowerCase())) {
        filteredHeaders[key] = '[FILTERED]'
      }
      else {
        filteredHeaders[key] = value as string
      }
    }

    return filteredHeaders
  }

  maskEmail(email: string) {
    return maskEmail(email)
  }

  maskPhone(phone: string) {
    return maskPhone(phone)
  }
}
