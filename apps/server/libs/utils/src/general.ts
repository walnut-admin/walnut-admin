import { random } from 'lodash'

// 嵌套对象 ↔ 扁平 path 已上收 `@walnut/utils/object-paths`（双端共用），此处保留旧导入面
export { objectToPaths } from '@walnut/utils/object-paths'
export type { ObjectToPathsOptions, PathRecord } from '@walnut/utils/object-paths'

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
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 去掉值为 `undefined` 的自有键（浅层）。
 *
 * 真 PATCH 的 service 侧收尾：update DTO 用 `RealPartialType(..., { preserveAbsent: true })`
 * 后，请求里没给的键保持 undefined；service 再把它们滤掉，让「未给列不进 UPDATE」成为
 * 结构性事实（不依赖 TypeORM 对 undefined 列的跳过行为）。
 * 显式 `null`（有意的清空）**保留** —— 只删 undefined。
 */
export function omitUndefined<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
