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

  maskIdentityValue(type: string, value: string): string {
    if (type === 'phoneNumber') {
      const countryCode = value.startsWith('+') ? value.slice(0, value.length - 11) : ''
      const mainNumber = countryCode ? value.slice(value.length - 11) : value
      return `${countryCode}${mainNumber.slice(0, 3)}****${mainNumber.slice(-4)}`
    }

    if (type === 'emailAddress') {
      const [local, domain] = value.split('@')
      if (local.length <= 2) {
        return `*@${domain}`
      }
      return `${local[0]}${'*'.repeat(local.length - 2)}${local.at(-1)}@${domain}`
    }

    if (type === 'idCard') {
      if (value.length === 18) {
        return `${value.slice(0, 6)}********${value.slice(-4)}`
      }
      return `${value.slice(0, 4)}****${value.slice(-4)}`
    }

    if (type === 'password') {
      return '********'
    }

    return value
  }
}
