# `apps/docs` — 文档站 · Agent 指引

> 本目录的 agent 指引。仓库级规则见 [`AGENTS.md`](../../AGENTS.md)（唯一真源）。
> 本文原为 `apps/docs/CLAUDE.md`，2026-09-23 迁到本文件名（跨工具可读），
> `CLAUDE.md` 现在只剩一行 `@AGENTS.md` 导入。

## Project Overview

Walnut Admin 的文档站，VitePress 构建，中英双语（**实际以中文为主**）。
上游仓库：https://github.com/walnut-admin/walnut-admin ｜ 线上：https://walnut-admin-doc.netlify.app

## 开发命令

```bash
pnpm dev        # dev server，端口 8886，自动开浏览器
pnpm build      # 生产构建（**同时是死链门禁**，见下）
pnpm preview    # 预览构建产物
pnpm lint       # ESLint（fix: pnpm lint:fix）
pnpm taze       # 交互式更新依赖
```

## 架构

### VitePress 配置

配置拆在 `.vitepress/config/`：

- `index.ts` — 主入口，合并 shared + 各 locale 配置
- `shared.ts` — 通用设置（title / base / sitemap / logo / social）
- `zh.ts` — 中文 locale（nav / sidebar / search / footer）
- `en.ts` — 英文 locale（当前基本未启用）

关键点：dev 端口 **8886**；源码在 `src/`；**URL rewrites `zh-CN/:rest*` → `:rest*`**
（中文是根 locale）；插件：pagefind（搜索）、tabs（选项卡）、mermaid（图表）。

### 内容结构

```
src/
├── zh-CN/              # 中文内容（主）
│   ├── content/        # 主文档（monorepo / frontend / backend / shared / adr / archive / industry-research）
│   ├── record/         # 开发记录
│   ├── announcement/   # 版本公告
│   ├── index.md        # 首页
│   └── support.md      # 支持页
├── en-US/              # 英文内容（少量）
└── public/             # 静态资源
```

### 主题与组件

`.vitepress/theme/index.ts`：扩展默认主题，注册全局组件 `<WPageTitle>` / `<WFrontLink>` /
`<WBaseLink>`，集成 mermaid（亮/暗主题切换 'dark' / 'forest'）与 tabs。

### Markdown 扩展

1. **Tabs**（`vitepress-plugin-tabs`）：
   ````md
   :::tabs
   == Tab 1
   内容 1
   == Tab 2
   内容 2
   :::
   ````
2. **Mermaid**（`vitepress-mermaid-renderer`）：安全类文档（如 `src/zh-CN/content/shared/sign.md`）大量使用
3. 图片默认懒加载

### 版本管理

`scripts/fetch-version.js` 从 GitHub 拉最新发版号写入 `version.json`，导航栏读它显示版本。

## Code Style

- 用共享的 `@walnut/eslint-config` vue 预设（配置在 `eslint.config.ts`）
- pre-commit 跑 lint-staged 自动修暂存文件
- 包管理器由 `packageManager` 字段 + corepack 锁定（旧的 `preinstall: npx only-allow pnpm` 已于 2026-09-21 移除）

## 重要约定

1. **语言**：以中文（`zh-CN`）为主，编辑时保持既有中文风格一致。
2. **Mermaid**：改动图表（尤其 `shared/sign.md`）要确认亮/暗两种主题下都能正确渲染。
3. **导航 / 侧边栏**：新增页面必须在 `.vitepress/config/zh.ts` 的 sidebar 数组里登记，否则页面不可达。
4. **自定义组件**：`WPageTitle` / `WFrontLink` / `WBaseLink` 全局注册，任意 markdown 可直接用。
5. **死链校验就是构建本身**：`ignoreDeadLinks` 已从 `true` 收窄成**白名单**（冻结语料 + 尚未编写的
   组件页），`vitepress build` 遇到真死链直接失败；CI 里有 `Docs build (dead-link check)` 一步。
   ⚠️ **VitePress 只查 `.md` 链接** —— 非 `.md` 的相对链接、以及 `apps/docs/src/` 之外的 markdown，
   由 `pnpm lint:docs-refs`（`@walnut/scripts` 的 `check-doc-refs`）负责。
6. **⚠️ 正文里绝不写原始 `${{ … }}`**：VitePress 把 markdown 当 Vue 模板编译，段落或表格里的
   `${{ x }}` 会被当**插值**求值，构建直接以 `Cannot read properties of undefined` 失败
   （2026-09-23 实测踩到）。**围栏代码块里是安全的**（VitePress 用 `v-pre` 渲染）。要行内展示，
   要么去掉外层花括号只写表达式，要么用 `<span v-pre>` 包起来。
7. **Locale**：根 locale 是中文（靠 rewrites），所以中文在 `/`，英文在 `/en-US/`。
8. **别在正文里写会变的计数**（包数 / 包清单 / bin 数 / catalog 条目数 / 「N 份配置」）。
   2026-09-23 一天之内就在这批文档里抓到 **三处已经烂掉的计数**：`14 个 workspace 包`（实为 15）、
   `@walnut/scripts 的 4 个 bin`（实为 5，且其中一处的列举本身还漏了一个）、
   `248 个依赖`（实为 242）—— 它们**没有任何门禁**能拦，因为没有工具知道你想说的是哪个数。
   **要写就写判据而不是数字**：能机械核对的东西（如「组成员数必须等于有 version 的包数，由
   `versioning-config.test.ts` 机械拦」）比一个会腐烂的常数有用得多；确实要写数字时，
   写明它是**哪个 commit / 哪一天**的口径。**加新包 / 新 bin 时**主动 grep 一遍
   `` 个包 ``、`` 个 bin ``、`条目` 这类词。
