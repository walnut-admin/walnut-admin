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
    // ⚠️ `en-US` locale **有意保持注释状态**（2026-09-23 的裁决：**不要英文站**）。
    // 现状：`apps/docs/src/en-US/**` 有 40+ 篇，但它**不被服务** —— 而且它的内容其实是**中文**
    // （例如 `component/UI/table.md` 开头是「# 表格」），并不是英文站，只是一棵没被服务的副本。
    // 处置：**冻结**（不删、不修、不翻译），当作历史语料看待。
    // 删除是可以的（git 里有全部历史），但要先明确说一声 —— 40+ 个文件的删除不该顺手做。
    // 已登记在架构待办（原 F9，现落在 P3-21 的说明里）。
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
