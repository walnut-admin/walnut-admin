import { objectToPaths as objectToPathsFromUtils, pathsToObject as pathsToObjectFromUtils } from '@walnut/utils/object-paths'
import { describe, expect, it } from 'vitest'

import { objectToPaths, pathsToObject } from './shared'

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
