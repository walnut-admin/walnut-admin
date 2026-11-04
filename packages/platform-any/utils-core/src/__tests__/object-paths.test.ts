import { describe, expect, it } from 'vitest'

import { objectToPaths, pathsToObject } from '../object-paths'

/**
 * 迁移钉住测试：期望值取自上收前的两份历史实现（服务端 lodash 版 / 客户端 lodash-es 版）
 * 在同一 fixture 上的实际输出 —— 默认行为必须与两者都逐键一致，ignoreKeys 必须与客户端一致。
 */
describe('objectToPaths（默认行为 = 服务端/客户端旧实现并集）', () => {
  const nested = {
    a: { b: 1, c: [2, { d: 'x' }] },
    e: null,
    f: false,
    g: {},
    h: [],
  }

  it('嵌套对象 + 数组 + null/false，空对象/空数组不产生 path', () => {
    expect(objectToPaths(nested)).toEqual({
      'a.b': 1,
      'a.c[0]': 2,
      'a.c[1].d': 'x',
      'e': null,
      'f': false,
    })
  })

  it('根数组', () => {
    expect(objectToPaths([1, { a: 2 }])).toEqual({
      '[0]': 1,
      '[1].a': 2,
    })
  })

  it('根原始值落在空 path（与服务端旧实现一致）', () => {
    expect(objectToPaths('x')).toEqual({ '': 'x' })
    expect(objectToPaths(null)).toEqual({ '': null })
  })

  it('undefined 值保留为显式 key（旧实现同款，序列化环节再丢弃）', () => {
    expect(objectToPaths({ a: undefined, b: 1 })).toStrictEqual({ a: undefined, b: 1 })
  })

  it('object.create(null) 视为 plain object', () => {
    const obj = Object.create(null)
    obj.a = 1
    expect(objectToPaths(obj)).toEqual({ a: 1 })
  })

  it('date / 类实例不下钻，作为叶子值', () => {
    const date = new Date(0)
    class Foo {
      bar = 1
    }
    expect(objectToPaths({ date, foo: new Foo() })).toStrictEqual({ date, foo: new Foo() })
  })
})

describe('objectToPaths ignoreKeys（= 客户端旧实现）', () => {
  const fixture = {
    meta: { watermark: { status: true, content: 'w' }, title: 't' },
    watermark: 1,
  }

  it('最后一段命中即停止下钻（meta.watermark 与根 watermark 同时命中）', () => {
    expect(objectToPaths(fixture, ['watermark'])).toEqual({
      'meta.watermark': { status: true, content: 'w' },
      'meta.title': 't',
      'watermark': 1,
    })
  })

  it('完整 path 命中同样停止下钻', () => {
    expect(objectToPaths(fixture, ['meta.watermark'])).toEqual({
      'meta.watermark': { status: true, content: 'w' },
      'meta.title': 't',
      'watermark': 1,
    })
  })

  it('第二参数兼容客户端历史的 string[] 位置形式与新 options 形式', () => {
    expect(objectToPaths(fixture, ['watermark']))
      .toEqual(objectToPaths(fixture, { ignoreKeys: ['watermark'] }))
  })

  it('空 ignoreKeys 与省略参数产出一致', () => {
    expect(objectToPaths(fixture, [])).toEqual(objectToPaths(fixture))
    expect(objectToPaths(fixture, {})).toEqual(objectToPaths(fixture))
  })
})

describe('pathsToObject（= 客户端旧实现的 lodash set 行为）', () => {
  it('还原嵌套对象与数组', () => {
    expect(pathsToObject({
      'a.b': 1,
      'a.c[0]': 2,
      'a.c[1].d': 'x',
      'e': null,
      'f': false,
    })).toEqual({
      a: { b: 1, c: [2, { d: 'x' }] },
      e: null,
      f: false,
    })
  })

  it('a[0] 形式补数组', () => {
    expect(pathsToObject({ 'a[0]': 1, 'a[1]': 2 })).toEqual({ a: [1, 2] })
  })

  it('根级数字段按 lodash 语义生成对象（非数组）', () => {
    expect(pathsToObject({ '[0].id': 1, '[1].id': 2 })).toEqual({
      0: { id: 1 },
      1: { id: 2 },
    })
  })

  it('空 path / 特殊 key 与 lodash 一致', () => {
    expect(pathsToObject({ '': 'root' })).toEqual({ '': 'root' })
    expect(pathsToObject({ 'a[b]': 1, 'x-y': 2 })).toEqual({ 'a': { b: 1 }, 'x-y': 2 })
  })

  it('与 objectToPaths 往返（忽略空容器丢失，属旧实现既有行为）', () => {
    const source = { a: { b: 1, c: [2, { d: 'x' }] }, e: null, f: false }
    expect(pathsToObject(objectToPaths(source))).toEqual(source)
  })
})
