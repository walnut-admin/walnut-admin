# `apps/admin` — 前端 SPA · Agent 指引

> 本目录的 agent 指引。仓库级规则见 [`AGENTS.md`](../../AGENTS.md)（唯一真源）。
> 本文件只写**这个 app 特有的、不看就会写错**的东西。

## 技术栈

Vue 3（Composition API + `<script setup>`）· Vite 8 · Naive UI（自动注册）· UnoCSS（Wind preset，
Tailwind v3 兼容）· Pinia · Vue Router（web history）· Vue I18n

- 开发端口 **3100**，`/api` 代理到 `http://127.0.0.1:3000/w/v1`
- 构建：`pnpm build`（Vite 8；可选混淆 / CDN / Sentry / CSP）。PWA 已于 2026-08-08 移除

## 别名与导入

| 别名 | 指向 |
|------|------|
| `@/*` | `apps/admin/src/*` |
| `~/*` | `apps/admin/types/*` |

- 跨模块**禁止相对路径**。
- **`unplugin-auto-import` / `unplugin-vue-components` 是给存量代码的便利，不是风格指引**：
  新写的代码、以及**任何迁进 `packages/` 的代码必须显式 import** —— 那两处不在 auto-import 的
  扫描范围里，靠隐式全局会直接报未定义。

## 组件与 store 约定

- 组件一律 `ComponentName/index.ts`（导出）+ `ComponentName/index.vue`（实现）。
- API 函数以 `API` 结尾。
- ⚠️ **`apps/admin/build/` 是 Vite 构建配置**（plugins / config / proxy），**不是运行时源码** ——
  改它等于改构建，别在里面写业务逻辑。
- store 工厂 `createWalnutStore()` 在 [`@walnut/client`](../../packages/platform-web/client/)，
  但 **admin 侧 26 个 store 文件目前 0 处使用**（待办 A10）—— 新 store 请优先用它，别再复制模式。
- 仓库级的组件与 store 约定见根 [`AGENTS.md`](../../AGENTS.md) 的「关键纪律」8 / 9。

## 三个容易踩的生成物

- **两个 unplugin 的 dts（`types/generated/`，已 gitignore）**：由 `pre*` 钩子统一跑
  `build/generate/index.ts` 生成（dev / build / types:check 前都会跑）；插件自己也会写。
  ⚠️ 以前它们被跟踪且 ignore 规则失效 ⇒ **每次 `pnpm dev` 都弄脏工作区**。
- **`genJSONSchemas` 会从 `src/store/types.d.ts` 的 `IStoreSetting.Dev` 生成
  `.vscode/settings-dev.schema.json`**（它在仓库里、生成结果确定）；改了 store 的 setting 类型
  要跟着重新生成 —— 它也在上面那个统一入口里跑。
- **`types:check:log` 会写 `report/tsc.log`**（该目录被 gitignore，跑完不会脏工作区）。

## 持久化结构改动

改动持久化结构时必须同步 `src/utils/persistent/migrate.ts`，否则老用户的本地数据读不回来。

## 安全相关

OPAQUE 口令 / WebAuthn(FIDO2) / MFA·OTP / RSA 加密 / 设备指纹。**不要**在前端硬编码任何
`*_API_KEY`（历史上有一版 `deepseek.ts` 硬编码过 key —— 该文件已删除，见
[`src/components/Global/AI/docs/REVIEW.md`](./src/components/Global/AI/docs/REVIEW.md) 的 A1）。
