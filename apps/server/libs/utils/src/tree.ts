/**
 * 树工具（服务端内部纯函数）。
 *
 * 判据：只在后端消费、且是**树结构语义**而非「双端同源字节」—— 因此不进 `@walnut/utils`
 * （那个包只收前后端逐字节一致的两件事），落在 `@walnut-server/utils`。
 */

/** 树节点最小形状：children 可选（叶子节点可以没有 children 键，wire 形态同 `formatTree` 的 omit） */
export interface TreeNodeLike<T> {
  children?: T[]
}

/**
 * @description 递归树过滤（标准语义）。
 *
 * 规则（与 easy-fns-ts `filterTree` 的「命中节点整棵返回」不同）：
 * - 节点命中 predicate ⇒ 保留该节点，**并继续递归过滤其 children**（命中的父不豁免子孙）；
 * - 节点未命中但有命中后代 ⇒ 保留节点 + 过滤后的 children（作为祖先路径保留）；
 * - 节点与全部后代都不命中 ⇒ 剪除。
 *
 * 输出是新对象（浅拷贝 + 新 children 数组），不修改入参；空 children 不落键 ——
 * 与 `formatTree` 叶子形态（omit 掉空 children）保持一致。
 *
 * @example
 * // 剪掉所有 type === 'element' 的节点（含 catalog/menu 的后代）
 * const withoutElement = filterTree(fullTree, node => node.type !== 'element')
 */
export function filterTree<T extends TreeNodeLike<T>>(
  nodes: readonly T[],
  predicate: (node: T) => boolean,
): T[] {
  const result: T[] = []

  for (const node of nodes) {
    const children: T[] | undefined = Array.isArray(node.children) ? node.children : undefined
    const filteredChildren = children === undefined ? [] : filterTree(children, predicate)
    const hit = predicate(node)

    if (!hit && filteredChildren.length === 0) {
      continue
    }

    const next = { ...node }
    if (filteredChildren.length > 0) {
      next.children = filteredChildren
    }
    else {
      Reflect.deleteProperty(next, 'children')
    }
    result.push(next)
  }

  return result
}
