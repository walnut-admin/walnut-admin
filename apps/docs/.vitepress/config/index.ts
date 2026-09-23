import { defineConfig } from 'vitepress'
import { pagefindPlugin } from 'vitepress-plugin-pagefind'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'

import { search as enSearch } from './en'
import { shared } from './shared'
import { zh, search as zhSearch } from './zh'

export default defineConfig({
  ...shared,
  // 内置死链校验（默认其实是 true，等于关掉）。开着它 = `vitepress build` 在链接失效时直接失败，
  // 不需要额外依赖或 CI 步骤 —— 这就是本仓的「文档链接门禁」。
  //
  // 忽略清单只放两类，每条都写清理由；**新增忽略必须给出理由**，否则等于把校验关回去了：
  ignoreDeadLinks: [
    // ① 冻结的历史语料：archive/ 与 industry-research/ 有意引用当时存在的路径，不参与校验
    /^\/content\/(archive|industry-research)\//,
    // ② 指向「规划中但尚未编写」的组件文档页的链接。`content/frontend/component/` 目前只有
    //    index.md，那份索引按功能分层列了 ~74 个待写组件页。补页之前这些链接必然是死的，
    //    详见架构待办的「文档死链」条目。
    /^\.\/(advanced|app|business|extra|ui|vendor)\//,
    /^\.\.?\/component\//,
    /^\/component\//,
  ],
  locales: {
    root: { label: '简体中文', ...zh },
    // 'en-US': { label: 'English', ...en },
  },
  markdown: {
    image: {
      lazyLoading: true,
    },
    config: (md) => {
      md.use(tabsMarkdownPlugin)
    },
  },
  vite: {
    server: {
      port: 8886,
      open: true,
    },

    plugins: [
      pagefindPlugin({
        locales: {
          ...zhSearch,
          ...enSearch,
        },
      }),
    ],
  },
})
