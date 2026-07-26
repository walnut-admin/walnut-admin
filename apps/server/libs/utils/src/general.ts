import type { Recordable } from 'easy-fns-ts'
import { forEach, isArray, isPlainObject, random } from 'lodash'

export function generateVerifyCode(length = 6) {
  const start = Number.parseInt(
    `1${Array.from({ length: length - 1 })
      .fill('0')
      .join('')}`,
  )

  const end = Number.parseInt(`${Array.from({ length }).fill('9').join('')}`)

  const code = random(start, end, false)

  return code
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function objectToPaths<T>(obj: T) {
  const result: Recordable = {}

  function process(value: T, path: string) {
    if (isPlainObject(value)) {
      forEach(value as Recordable, (v: string, k: string) => {
        process(v as T, path ? `${path}.${k}` : k)
      })
    }
    else if (isArray(value)) {
      forEach(value, (v, i) => {
        process(v as T, path ? `${path}[${i}]` : `[${i}]`)
      })
    }
    else {
      result[path] = value
    }
  }

  process(obj, '')
  return result
}
