/**
 * @description 嵌套对象与扁平 path 映射的互转（双端共用纯函数）。
 *
 * 上收自两处历史实现：
 * - 服务端 `apps/server/libs/utils/src/general.ts` 的 `objectToPaths`（无 ignoreKeys）；
 * - 客户端 `packages/platform-web/client/src/browser/shared.ts` 的 `objectToPaths` / `pathsToObject`
 *   （objectToPaths 支持 ignoreKeys）。
 *
 * 兼容口径：
 * - `objectToPaths(obj)` 的默认行为与两处旧实现逐键一致（lodash `isPlainObject` / `isArray` 语义）；
 * - `ignoreKeys` 的判定与客户端旧实现一致：**完整路径**或**路径最后一段**命中即停止下钻，
 *   把整个子树作为该 path 的值（`{ flat: 'meta.watermark' }` 场景）；
 * - 第二参数仍接受 `string[]`（客户端历史调用形如 `objectToPaths(res, ['watermark'])`），
 *   等价于 `{ ignoreKeys: [...] }`，保证消费方零改动；
 * - `pathsToObject` 复刻 lodash `set` 的路径解析与数组补插行为（客户端旧实现即 lodash `set`）。
 */

export type PathRecord = Record<string, any>

export interface ObjectToPathsOptions {
  /**
   * 命中即停止下钻的 key（完整 path 或最后一段），命中的子树原样作为值。
   */
  ignoreKeys?: string[]
}

/**
 * @description lodash `isPlainObject` 的等价实现（覆盖 JSON 数据与 `Object.create(null)`）。
 */
function isPlainObject(value: unknown): value is PathRecord {
  if (value === null || typeof value !== 'object')
    return false

  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * @description 嵌套对象 → 扁平 path 映射。
 * `{ a: { b: 1 } }` → `{ 'a.b': 1 }`；数组下标形如 `a[0].b`。
 */
export function objectToPaths<T>(
  obj: T,
  options: ObjectToPathsOptions | string[] = {},
): PathRecord {
  const ignoreKeys = Array.isArray(options) ? options : options.ignoreKeys ?? []
  const result: PathRecord = {}

  function process(value: unknown, path: string) {
    if (ignoreKeys.length) {
      const lastKey = path.split('.').pop() || path
      if (ignoreKeys.includes(path) || ignoreKeys.includes(lastKey)) {
        result[path] = value
        return
      }
    }

    if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        process(value[key], path ? `${path}.${key}` : key)
      }
    }
    else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        process(value[i], path ? `${path}[${i}]` : `[${i}]`)
      }
    }
    else {
      result[path] = value
    }
  }

  process(obj, '')
  return result
}

// ---- lodash castPath / stringToPath / baseSet 的等价实现（pathsToObject 用） ----

const reIsPlainProp = /^\w*$/
const reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/
// 与 lodash 同款（MIT）：处理 `a.b`、`a[0].b`、`a["b"]`、`a[b]` 等形态
const rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g
const reEscapeChar = /\\(\\)?/g
const reIsUint = /^(?:0|[1-9]\d*)$/
const MAX_SAFE_INTEGER = 9007199254740991

function isIndex(value: unknown): boolean {
  return typeof value !== 'symbol'
    && reIsUint.test(String(value))
    && Number(value) >= 0
    && Number(value) < MAX_SAFE_INTEGER
}

function stringToPath(path: string): string[] {
  const result: string[] = []

  if (path.charCodeAt(0) === 46 /* . */)
    result.push('')

  path.replace(rePropName, (match: string, number: string, quote: string, subString: string) => {
    result.push(quote ? subString.replace(reEscapeChar, '$1') : (number || match))
    return match
  })

  return result
}

/**
 * @description 与 lodash `castPath` 同口径：`a` / `a-b` / `''` 视为单 key；
 * 含 `.` 或 `[...]` 的路径才解析为多段。
 */
function castPath(path: string): string[] {
  return reIsPlainProp.test(path) || !reIsDeepProp.test(path) ? [path] : stringToPath(path)
}

/**
 * @description 扁平 path 映射 → 嵌套对象（lodash `set` 等价：数字段在下一段为索引时补数组）。
 */
export function pathsToObject<T extends object, R extends PathRecord = T>(pathsObj: T): R {
  const result: PathRecord = {}

  for (const path of Object.keys(pathsObj)) {
    const value = (pathsObj as PathRecord)[path]
    const keys = castPath(path)
    const lastIndex = keys.length - 1

    let nested: PathRecord = result

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]

      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        break

      if (i === lastIndex) {
        nested[key] = value
        break
      }

      const current = nested[key]
      const next = pathsOfValue(current) ? current : (isIndex(keys[i + 1]) ? [] : {})

      nested[key] = next
      nested = next
    }
  }

  return result as R
}

/** lodash `isObject`：对象与函数都算（pathsToObject 只处理写入的中间容器） */
function pathsOfValue(value: unknown): value is PathRecord {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}
