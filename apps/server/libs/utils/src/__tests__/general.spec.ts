import { objectToPaths } from '@walnut/utils/object-paths'
import { describe, expect, it } from 'vitest'

import { objectToPaths as objectToPathsFromGeneral, omitUndefined } from '../general'

/**
 * 上收回归：`@walnut-server/utils/general` 的旧导入面必须仍指向同一实现，
 * 默认行为与迁移前一致（服务端旧实现无 ignoreKeys）。
 */
describe('objectToPaths re-export（general.ts）', () => {
  it('与 @walnut/utils/object-paths 是同一函数', () => {
    expect(objectToPathsFromGeneral).toBe(objectToPaths)
  })

  it('嵌套对象 / 数组 / null 的扁平结果与迁移前一致', () => {
    expect(
      objectToPathsFromGeneral({
        a: { b: 1, c: [2, { d: 'x' }] },
        e: null,
        f: false,
        g: {},
        h: [],
      }),
    ).toEqual({
      'a.b': 1,
      'a.c[0]': 2,
      'a.c[1].d': 'x',
      e: null,
      f: false,
    })
  })
})

describe('omitUndefined（真 PATCH 的 service 侧收尾）', () => {
  it('只删 undefined：显式 null / false / 空串 / 空数组都保留', () => {
    expect(
      omitUndefined({
        a: undefined,
        b: null,
        c: false,
        d: '',
        e: [],
        f: 0,
      }),
    ).toEqual({ b: null, c: false, d: '', e: [], f: 0 })
  })

  it('不改入参（返回新对象）', () => {
    const source = { a: undefined, b: 1 }
    const result = omitUndefined(source)
    expect(result).not.toBe(source)
    expect(Object.hasOwn(source, 'a')).toBe(true)
  })
})
