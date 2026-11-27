import { describe, expect, it } from 'vitest'

import { filterTree } from '../tree'

/**
 * 递归树过滤语义（2026-11 F1，替换 easy-fns-ts `filterTree` 的「命中即整棵返回」）：
 * - 命中 ⇒ 保留并继续递归过滤 children；
 * - 未命中但有命中后代 ⇒ 保留祖先路径 + 过滤后的 children；
 * - 全不命中 ⇒ 剪除；
 * - 不修改入参、不把空 children 落键（与 formatTree 叶子形态一致）。
 */

interface Node {
  id: string
  type: 'catalog' | 'menu' | 'element'
  children?: Node[]
}

function node(id: string, type: Node['type'], children?: Node[]): Node {
  return children === undefined ? { id, type } : { id, type, children }
}

describe('filterTree：递归树过滤', () => {
  it('父未命中、子命中 ⇒ 保留父 + 过滤后的子树', () => {
    const tree = [
      node('catalog', 'catalog', [
        node('element-a', 'element'),
        node('menu', 'menu', [node('element-b', 'element')]),
      ]),
    ]

    const result = filterTree(tree, (item) => item.type !== 'element')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('catalog')
    expect(result[0].children?.map((child) => child.id)).toEqual(['menu'])
    // 命中节点不豁免后代：menu 下的 element 也被剪掉，且空 children 不落键
    expect(result[0].children?.[0].children).toBeUndefined()
  })

  it('节点命中但子孙全不命中 ⇒ 节点保留、空 children 被省略', () => {
    const result = filterTree(
      [node('menu', 'menu', [node('el-1', 'element'), node('el-2', 'element')])],
      (item) => item.type !== 'element',
    )

    expect(result).toEqual([{ id: 'menu', type: 'menu' }])
    expect('children' in result[0]).toBe(false)
  })

  it('全不命中 ⇒ 剪除（顶层叶子与整棵子树都消失）', () => {
    const tree = [node('el-a', 'element'), node('catalog', 'catalog', [node('el-b', 'element')])]

    // predicate 只认 menu：element 叶子与「只有 element 后代的 catalog」都全不命中
    expect(filterTree(tree, (item) => item.type === 'menu')).toEqual([])
  })

  it('未命中但有命中后代 ⇒ 保留祖先路径（多层）', () => {
    const tree = [
      node('root', 'catalog', [
        node('mid', 'catalog', [node('hit-menu', 'menu'), node('el', 'element')]),
        node('el-top', 'element'),
      ]),
    ]

    const result = filterTree(tree, (item) => item.type === 'menu')

    expect(result).toEqual([
      {
        id: 'root',
        type: 'catalog',
        children: [
          {
            id: 'mid',
            type: 'catalog',
            children: [{ id: 'hit-menu', type: 'menu' }],
          },
        ],
      },
    ])
  })

  it('不修改入参（输出为浅拷贝 + 新 children 数组）', () => {
    const leaf = node('el', 'element')
    const parent = node('catalog', 'catalog', [node('menu', 'menu'), leaf])
    const tree = [parent]
    const snapshot = structuredClone(tree)

    const result = filterTree(tree, (item) => item.type !== 'element')

    expect(tree).toEqual(snapshot)
    expect(result[0]).not.toBe(parent)
    expect(result[0].children).not.toBe(parent.children)
    expect(result[0].children?.[0]).not.toBe(parent.children?.[0])
  })

  it('空树 / 无 children 的输入原样返回新数组', () => {
    expect(filterTree([], () => true)).toEqual([])
    expect(filterTree([node('leaf', 'menu')], () => true)).toEqual([{ id: 'leaf', type: 'menu' }])
  })
})
