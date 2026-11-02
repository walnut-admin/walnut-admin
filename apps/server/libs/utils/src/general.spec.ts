import { objectToPaths } from '@walnut/utils/object-paths'
import { describe, expect, it } from 'vitest'

import { objectToPaths as objectToPathsFromGeneral } from './general'

/**
 * 上收回归：`@walnut-server/utils/general` 的旧导入面必须仍指向同一实现，
 * 默认行为与迁移前一致（服务端旧实现无 ignoreKeys）。
 */
describe('objectToPaths re-export（general.ts）', () => {
  it('与 @walnut/utils/object-paths 是同一函数', () => {
    expect(objectToPathsFromGeneral).toBe(objectToPaths)
  })

  it('嵌套对象 / 数组 / null 的扁平结果与迁移前一致', () => {
    expect(objectToPathsFromGeneral({
      a: { b: 1, c: [2, { d: 'x' }] },
      e: null,
      f: false,
      g: {},
      h: [],
    })).toEqual({
      'a.b': 1,
      'a.c[0]': 2,
      'a.c[1].d': 'x',
      'e': null,
      'f': false,
    })
  })
})
