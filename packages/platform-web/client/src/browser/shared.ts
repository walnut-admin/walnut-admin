import type { Slots } from 'vue'
import { detectIncognito } from 'detectincognitojs'
import { Base64 } from 'js-base64'
import { isUndefined } from 'lodash-es'
import { getCurrentInstance } from 'vue'

// 嵌套对象 ↔ 扁平 path 已上收 `@walnut/utils/object-paths`（双端共用），此处保留旧导入面。
// 第二参数仍兼容历史调用 `objectToPaths(res, ['watermark'])`。
export { objectToPaths, pathsToObject } from '@walnut/utils/object-paths'
export type { ObjectToPathsOptions, PathRecord } from '@walnut/utils/object-paths'

export function getDefaultSlotText(slots: Slots): string {
  const str = (slots.default && slots.default()[0].children) as string

  if (str)
    return str.trimStart().trimEnd()

  return ''
}

export function isInSetup() {
  if (!getCurrentInstance())
    console.error('IsInSetup', 'Hook can only be used in `setup` function!')
}

// handle undefined to defaultValue
export const getBoolean = (val: any, df = true) => (isUndefined(val) ? df : val)

// get boolean or return value is boolean
export const getFunctionBoolean = <T>(val: any, cbParams: T, defaultVal = true) => (isUndefined(val) ? defaultVal : typeof val === 'boolean' ? val : val(cbParams))

// easy detect device type
export function detectDeviceType() {
  const userAgent = navigator.userAgent.toLowerCase()

  if (/mobile/i.test(userAgent)) {
    return 'Mobile'
  }
  else if (/tablet/i.test(userAgent) || (/android/i.test(userAgent) && !/mobile/i.test(userAgent))) {
    return 'Tablet'
  }
  else {
    return 'Desktop'
  }
}

// get is in incognito mode
export async function getIsInIncognitoMode() {
  try {
    const result = await detectIncognito()
    return result.isPrivate
  }
  catch (error) {
    console.error(error)
    return false
  }
}

// get cpu core count
export function getCPUCoreCount() {
  if ('hardwareConcurrency' in navigator) {
    return navigator.hardwareConcurrency
  }
  else {
    console.warn('navigator.hardwareConcurrency is not supported')
    return 0
  }
}

// get memory in gb
// LINK https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
// `deviceMemory` 至今没进 lib.dom，只能靠 `'deviceMemory' in navigator` 收窄 —— 而 `in` 收窄
// 按定义把新补出来的属性标成 `unknown`（这就是 admin 侧 initial payload 里 `unknown → number`
// 那个报错的真源头）。Device Memory API 的规范类型就是 number（单位 GB），所以这里只做 typeof
// 收窄、不做断言：返回类型钉成 number，下游不必各自再猜一次。
export function getMemoryGB(): number {
  if ('deviceMemory' in navigator) {
    const memory = navigator.deviceMemory
    return typeof memory === 'number' ? memory : 0
  }
  else {
    console.warn('navigator.deviceMemory is not supported')
    return 0
  }
}

// get cpu archittecture
export async function getGPUArchitecture() {
  try {
    if ('gpu' in navigator) {
      const adapter = await navigator.gpu.requestAdapter()

      if (!adapter) {
        console.warn('webGPU adapter is not supported')
        return 'not supported'
      }

      const device = await adapter.requestDevice()

      return device.adapterInfo.architecture
    }
    else {
      console.warn('navigator.gpu is not supported')
      return 'not supported'
    }
  }
  catch (error) {
    console.error(error)
    return 'not supported'
  }
}

export function toUrlSafeBase64(b64: string): string {
  return Base64.toBase64(b64, true)
}

export function fromUrlSafeBase64(b64url: string): string {
  return Base64.fromBase64(b64url)
}

interface MockListParams {
  page?: {
    page?: number
    pageSize?: number
  }
}

export function mockListApi<T>(arr: T[]) {
  return (params: MockListParams) => {
    const num = params.page?.page || 1
    const size = params.page?.pageSize || 10
    const total = arr.length

    return {
      data: arr.slice((num - 1) * size, (num - 1) * size + size),
      total,
    }
  }
}
