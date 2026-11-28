<script setup lang="ts">
import type { DefaultTheme } from 'vitepress'
import { useData, useRoute } from 'vitepress'
import { computed } from 'vue'

// 显式给 `useData` 传泛型：它的默认参数是 `any`（`useData<T = any>()`），
// 不传泛型时 `theme.value.nav` 之类全是 any，类型检查等于没接。
// LINK node_modules/vitepress/dist/client/index.d.ts → `useData<T = any>()`
const { theme, page, frontmatter } = useData<DefaultTheme.Config>()
const route = useRoute()

// 导航节点按 VitePress 的 `NavItem` 三态镜像（**每个成员都有必填属性**，否则是「弱类型」，
// TS 会对没有共同属性的成员报 TS2559）：
//   · NavItemWithLink     → { text, link }
//   · NavItemWithChildren → { items }
//   · NavItemComponent    → { component }（没有 text/link，本组件对它不做任何事）
// 不能简单写一个 `{ text?; link?; items? }` 的「共同超集」：全可选的形状是弱类型，
// `NavItemComponent` 会被 TS2559 挡掉；而加 `[key: string]: unknown` 索引签名去
// 「解除弱类型」又会让 `NavItemWithLink`（`items?: never`）反过来不可赋值 —— 两条路都试过。
type NavNode = { text: string; link: string } | { items: NavNode[] } | { component: string }

function isLinkNode(node: NavNode): node is { text: string; link: string } {
  return 'link' in node
}

function isItemsNode(node: NavNode): node is { items: NavNode[] } {
  return 'items' in node
}

// 从导航配置中查找匹配的标题
function findTitleInNav(nodes: readonly NavNode[], path: string): string | null {
  for (const node of nodes) {
    if (isLinkNode(node) && path.startsWith(node.link)) {
      return node.text
    }
    if (isItemsNode(node)) {
      const nestedTitle = findTitleInNav(node.items, path)
      if (nestedTitle) return nestedTitle
    }
  }
  return null
}

// 从侧边栏配置中查找匹配的标题。侧边栏节点直接用 VitePress 的 `SidebarItem`
// （它的 `text?` / `link?` / `items?` 本来就是全可选的，不需要另立类型）。
function findTitleInSidebar(
  nodes: readonly DefaultTheme.SidebarItem[],
  path: string,
): string | null {
  for (const node of nodes) {
    if (node.link && path.startsWith(node.link)) {
      return node.text ?? null
    }
    if (node.items) {
      const nestedTitle = findTitleInSidebar(node.items, path)
      if (nestedTitle) return nestedTitle
    }
  }
  return null
}

// `themeConfig.sidebar` 有两种形态：`SidebarItem[]`（单组）或 `SidebarMulti`（按路径分组，
// 本站在 zh.ts 里用的就是这种），后者每组还可能写成 `{ items, base }`。统一摊平成「组数组」。
function sidebarGroupsOf(sidebar: DefaultTheme.Sidebar | undefined): DefaultTheme.SidebarItem[][] {
  if (!sidebar) return []
  const groups = Array.isArray(sidebar) ? [sidebar] : Object.values(sidebar)
  return groups.map((group) => (Array.isArray(group) ? group : group.items))
}

// 计算当前页面的标题
function getPageTitle(): string {
  const path = route.path

  // 优先从导航中查找
  const navTitle = findTitleInNav(theme.value.nav ?? [], path)
  if (navTitle) return navTitle

  // 然后从侧边栏查找
  for (const group of sidebarGroupsOf(theme.value.sidebar)) {
    const sidebarTitle = findTitleInSidebar(group, path)
    if (sidebarTitle) return sidebarTitle
  }

  // 最后使用frontmatter或默认标题
  return page.value.title || '未设置标题'
}

/**
 * 用 `computed` 而不是「`onMounted` 赋值 + `watch(route)`」：VitePress 是 **SSG** ——
 * `onMounted` 在构建期（Node 里渲染 HTML）根本不会执行，旧实现产出的静态页 `<h1>` 全是空的
 * （`v-if="pageTitle"` 落空后走 `v-else` 的 frontmatter 分支，没有 frontmatter.title 的页面
 * 就渲染成「未设置标题」）。`computed` 在 SSR 与客户端水合时都会求值，且 `route` / `theme` /
 * `page` 都是响应式的，切页自动重算 —— 不需要手写 `watch`。
 *
 * 三态联合类型与两个类型守卫（`NavNode` / `isLinkNode` / `isItemsNode`）保持不变：那是给
 * VitePress `NavItem` 的三种成员形状建的最小可判别集，不要退回弱类型（注释见上）。
 */
const pageTitle = computed(() => getPageTitle())
</script>

<template>
  <h1 v-if="pageTitle">
    {{ pageTitle }}
  </h1>
  <h1 v-else>
    <!-- 用 `useData().frontmatter` 而不是模板里的 `$frontmatter`：
         `$frontmatter` 是 VitePress 在 `app.config.globalProperties` 上定义的运行时全局属性，
         但它**没有**对应的 TS 声明（不 augment `ComponentCustomProperties`），在 .vue 模板里
         会报 TS2339。`frontmatter` 是同一个 Ref，且带类型。 -->
    {{ frontmatter.title || '未设置标题' }}
  </h1>
</template>
