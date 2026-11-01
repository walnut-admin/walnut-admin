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
  return new Promise(resolve => setTimeout(resolve, ms))
}
