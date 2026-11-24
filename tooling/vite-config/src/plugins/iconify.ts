import type { IconifyPluginOptions } from './custom/iconify/types.ts'
import { IconifyPlugin } from './custom/iconify/index.ts'

/** 图标集合、自定义前缀、扫描范围与 svg 目录都是调用方的约定，一律经 options 传入。 */
export function createIconifyPlugin(options: IconifyPluginOptions) {
  return IconifyPlugin(options)
}
