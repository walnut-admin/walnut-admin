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
  // 忽略清单只放**一类**，并写清理由；**新增忽略必须给出理由**，否则等于把校验关回去了：
  ignoreDeadLinks: [
    // 冻结的历史语料：archive/ 与 industry-research/ 有意引用当时存在的路径，不参与校验
    /^\/content\/(archive|industry-research)\//,
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
