import type { Recordable } from 'easy-fns-ts'
import { cloneDeep, isNil } from 'lodash'
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

/**
 * @description 邮箱展示掩码：local 段保留前 1-2 个字符、其余逐字符打 `*`，`@domain` 原样。
 * local 段 ≤2 个字符时没有可掩部分，原样返回；`+` `.` `%` `-` 与字母数字同属保留前缀的
 * 字符类，会占用保留位（如 `a+b@example.com` → `a+*@example.com`）。
 */
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

    // （历史注记：MongoDB ObjectId 实例的 toString 特判已随 Phase 5a 摘除 mongoose 一并移除
    // —— 全仓不再产生 ObjectId 实例，id 一律是 uuid 字符串，走下方的通用键遍历即可。）

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

/**
 * @description 身份标识展示掩码（user_identity 专用；libs 解耦批 6 随身份内核下沉）。
 *
 * 从 app 的 SharedMaskService.maskIdentityValue 逐句搬入：phoneNumber / emailAddress /
 * idCard / password 四类，其余类型原样返回。SharedMaskService 侧改为单行委托，行为零变化。
 */
export function maskIdentityValue(type: string, value: string): string {
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
