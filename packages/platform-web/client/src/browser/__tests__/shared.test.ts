import { objectToPaths as objectToPathsFromUtils, pathsToObject as pathsToObjectFromUtils } from '@walnut/utils/object-paths'
import { describe, expect, it } from 'vitest'

import { getMemoryGB, objectToPaths, pathsToObject } from '../shared'

/**
 * 上收回归：`@walnut/client/browser/shared` 的旧导入面必须仍指向同一实现，
 * 且历史调用形态 `objectToPaths(res, ['watermark'])` 继续可用（消费方零改动）。
 */
describe('objectToPaths / pathsToObject re-export（browser/shared.ts）', () => {
  it('与 @walnut/utils/object-paths 是同一函数', () => {
    expect(objectToPaths).toBe(objectToPathsFromUtils)
    expect(pathsToObject).toBe(pathsToObjectFromUtils)
  })

  it('历史 string[] 位置参数仍生效（忽略 key 不下钻）', () => {
    expect(objectToPaths({
      meta: { watermark: { status: true }, title: 't' },
      watermark: 1,
    }, ['watermark'])).toEqual({
      'meta.watermark': { status: true },
      'meta.title': 't',
      'watermark': 1,
    })
  })

  it('pathsToObject 还原嵌套表单', () => {
    expect(pathsToObject({ 'layout.mode': 'vertical', 'layout.tab[0]': 'home' })).toEqual({
      layout: { mode: 'vertical', tab: ['home'] },
    })
  })
})

/**
 * `getMemoryGB` 的返回类型曾经是 `unknown`：`'deviceMemory' in navigator` 的 `in` 收窄把
 * Device Memory API（lib.dom 至今未收录）补成 unknown，下游 admin 的 initial payload 因此
 * 在 `satisfies` 下报 `unknown → number`。这里钉住「按 typeof 收窄，非 number 一律降级 0」。
 */
describe('getMemoryGB', () => {
  it('deviceMemory 是 number 时原样返回（单位 GB）', () => {
    Object.defineProperty(navigator, 'deviceMemory', { value: 8, configurable: true })

    try {
      expect(getMemoryGB()).toBe(8)
    }
    finally {
      Reflect.deleteProperty(navigator, 'deviceMemory')
    }
  })

  it('deviceMemory 不是 number 时降级为 0', () => {
    Object.defineProperty(navigator, 'deviceMemory', { value: '8', configurable: true })

    try {
      expect(getMemoryGB()).toBe(0)
    }
    finally {
      Reflect.deleteProperty(navigator, 'deviceMemory')
    }
  })
})
