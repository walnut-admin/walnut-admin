import type { Recordable } from 'easy-fns-ts'
import { cloneDeep, isNil } from 'lodash'
import { isObjectIdOrHexString } from 'mongoose'
import { regexMap } from './regex'

const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'pass',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'privateKey',
  'email',
  'emailAddress',
  'phone',
  'phoneNumber',
  'idCard',
]

const sensitiveRegexMap = {
  pass: /pass|token|key|secret/i,
  email: /email/i,
  phone: /phone/i,
}

export function maskEmail(email: string): string {
  if (!email)
    return ''

  return email.replace(
    regexMap.emailOffSensitive,
    (_, a: string, b: string, c: string) => a + b.replace(/./g, '*') + c,
  )
}

export function maskPhone(phone: string): string {
  if (!phone)
    return ''

  return phone.replace(
    regexMap.phoneNumberSensitive,
    '$1****$2',
  )
}

/**
 * @description recursively mask sensitive fields in an object
 * @param obj any object
 * @param extraKeys extra sensitive fields (optional)
 */
export function maskSensitiveFields<T extends Record<string, any>>(obj: T, extraKeys: string[] = []) {
  const sensitiveKeys = new Set([...DEFAULT_SENSITIVE_KEYS, ...extraKeys].map(k => k.toLowerCase()))
  const visited = new WeakSet<Recordable>()

  function walk(target: Recordable): Recordable {
    if (isNil(target) || typeof target !== 'object')
      return target

    if (visited.has(target))
      return target
    visited.add(target)

    if (Array.isArray(target)) {
      return target.map(walk)
    }

    if (target instanceof Date || target instanceof RegExp || target instanceof Map || target instanceof Set || typeof target === 'function') {
      return target
    }

    // Handle MongoDB ObjectId - convert to string to avoid exposing internal buffer
    // ObjectId has _bsontype='ObjectId' and toHexString() method
    if (isObjectIdOrHexString(target) && typeof target.toHexString === 'function') {
      return target.toString() as unknown as Recordable
    }

    const result: Recordable = {}

    for (const key of Object.keys(target)) {
      const value = target[key] as Recordable

      if (sensitiveKeys.has(key.toLowerCase())) {
        if (sensitiveRegexMap.pass.test(key)) {
          result[key] = '[MASKED]'
        }
        else if (sensitiveRegexMap.email.test(key) && typeof value === 'string') {
          result[key] = maskEmail(value)
        }
        else if (sensitiveRegexMap.phone.test(key) && typeof value === 'string') {
          result[key] = maskPhone(value)
        }
        else {
          result[key] = '[MASKED]'
        }
      }
      else {
        result[key] = walk(value)
      }
    }

    return result
  }

  const cloned = cloneDeep(obj)

  return walk(cloned)
}
