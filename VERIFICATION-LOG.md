# 验证留档（VERIFICATION-LOG）

> **这是什么**：验收过程中**实际撞到的报错与 flaky 现象**的留档，**不是**待办清单的替代品。
> 每条都写清「症状 / 判据（怎么复现或怎么判定）/ 影响 / 本次怎么处置 / 建议方案方向」，
> **后续单独出方案**逐条裁。已经修掉的也留着 —— 「这类假绿是怎么长出来的」比结论更值钱。
>
> 起点：2026-09-29 移除 `apps/admin` 的 `unplugin-auto-import`（[ADR 0020](./apps/docs/src/zh-CN/content/adr/0020-remove-unplugin-auto-import.md)）。
> 主验收结论（types:check / lint / build / 17 段 prepush / build:docs / test 全绿）记在那篇 ADR 的
> `## Consequences`，这里只放**过程中的异常**。

---

## V1 · `unplugin-auto-import` 的旧 dts 残留会让 `vue-tsc` **假绿**（已修）

**症状**：把插件从 `vite.config` 里摘掉之后，**已经存在的本地检出**里那份
`auto-import.d.ts` 不会消失 —— 它是 gitignored 的，`git` 不管未跟踪文件。而
`apps/admin/tsconfig.json` 的 include 是 `types/generated/*.d.ts` 这种**通配**：
旧文件留着，它那 403 行 `declare global { const … }` 就**继续生效**。

**判据（本次实测，同一棵树只改「那份 dts 在不在」）**：

- dts **在** ⇒ `vue-tsc --noEmit` **0 错误**；
- dts **挪走** ⇒ 同一棵树报 **2416 个错误 / 369 个文件 / 170 个名字**。

也就是说：漏 import 这种错误，**这份残留文件能整片吃掉**。CI 是干净检出所以看不见，
受害的正是「拉下这次改动继续开发」的每台机器。

**本次处置**：不给文档让人自己删，改成机械自愈 —— `build/generate/genTypeDeclarations.ts`
在生成前 `rmSync` 掉那份旧产物（`build/utils/paths.ts` 里留了 `legacyAutoImportDtsPath` 与理由）。
生成步骤是每个 `vite` / `vue-tsc` 入口的必经之处（`lint:pre-hooks` 门禁守），所以一次 `pnpm dev`
就清干净了。已实测：手动放回一份 67712 字节的旧 dts，跑 `node build/generate/index.ts` 后消失。

**建议方案方向**：这是「生成物 × 通配 include × gitignore」这个组合的通病，不止 auto-import 一家。
可以考虑给「生成物」建一条通则：**每个生成器声明自己写哪些文件，入口统一清理「本目录下不再声明的
文件」**；或在 `lint:pre-hooks` 旁边加一段「生成物清单对账」。

## V2 · 手写 `.d.ts` 借全局类型 → `skipLibCheck` 把错误藏成静默 `any`（已修）

**症状**：补完全部显式 import 后，仍剩 **1 条**看不懂的错误：

```
src/store/modules/user/user-scroll.ts(24,51): error TS7006: Parameter 'i' implicitly has an 'any' type.
```

**根因**：`apps/admin/src/store/types.d.ts` 用了 `Ref<…>`（`IStoreUser.Scroll` 等处）却**从来没
import 过 `Ref`**，借的是 auto-import dts 的全局类型再导出。dts 一走，这里在 `vue-tsc` 里
**一个错误都不报** —— `skipLibCheck: true` 跳过所有 `.d.ts` 的类型检查：`Ref` 静默退化成 `any`，
只在**消费方**漏成一句毫不相干的「参数隐式 any」。除 `Ref` 外还有 5 个
`ValueOfAppConst*`（`CollapseMode` / `TabStyleMode` / `TabCloseMode` / `TabAffixMode`）同一形态。

**判据**：拿「被全局化的 40 个类型名 × 全部手写 `.d.ts`」做笛卡尔积扫「用了但没 import」→
全仓命中**只有这 1 个文件、6 个名字**；对**值**的全局名同样扫了一遍，命中全是
`name` / `version` / `readonly` 这类属性名与关键字的假阳性（值全局在 `.d.ts` 里没有借道空间）。

**本次处置**：补显式 import（`Ref` 并入既有的 `vue` 类型行，5 个 `ValueOfAppConst*` 并入既有的
`@/const` 行）→ 残留错误归零。

**建议方案方向**：**`skipLibCheck: true` 是本仓最大的静默面**（它跳过的不只是 `node_modules`，
是**全部** `.d.ts`，含我们自己写的那 16 份）。值得单独评估：① 那 6 个名字的扫描做成常驻门禁
（本次是一次性脚本，没进仓）；② 或对手写 `.d.ts` 关掉 `skipLibCheck`（`skipLibCheck` 是全局开关，
做不到按目录 —— 需要换思路，例如把手写 `.d.ts` 改成 `.ts`）。

## V3 · `vite-plugin-checker` 的 ESLint 只在启动时跑一次（已修）

**症状**：dev 里的 `[ESLint] Found 0 error and 0 warning` 是**假绿**：改文件之后它不再重跑。

**根因**：`build/vite/plugin/checker.ts` 里写的是 `watchPath: '../../../src'`，而该选项是
**相对 vite root（`apps/admin`）** 解析的（插件源码 `path.resolve(root, watchPath)`）⇒ 实际监视
`<repo 的上一级>/src`，**那个目录不存在**，chokidar 什么也不看。

**判据**：`Test-Path D:\walnut-admin\src` → `False`（`apps\src` 同样不存在）；插件分发代码里
`resolveWatchTarget(root, options.watchPath)` 的形态可直接读到。

**本次处置**：改成 `watchPath: 'src'`，并在配置里写明「相对 root 解析、别改回 `../`、也别删掉去赌
默认值（默认是 root，会把 `node_modules` 一起看）」。

**建议方案方向**：这类「路径写错 → 工具静默降级成什么都不做」的配置没有门禁看得见。
可以给几个已知的 watch 型选项加一条启动期断言（目录不存在就直接报错），成本极低。

## V4 · 前端卡在 splash：空库 + 启动序列没容错（**既有问题，与本次无关**）

**症状**：`pnpm dev`（前后端都起）后浏览器停在 `index.html` 里那屏 loading，控制台一片红。

**判据（headless Chrome 实测，前后两份代码都跑了）**：

| 观察 | 改动后 | `git stash` 回到 HEAD（auto-import 仍在） |
|------|--------|------------------------------------------|
| DOM 里 `<div class="app-loading">` | 仍在 | 仍在 |
| 控制台有 `vue-devtools` 注入（说明 JS 跑了） | 有 | 有 |
| 控制台有 `setupApp` 末尾那行 `App Initializing` | **无** | **无** |
| 控制台有 `ReferenceError` / `is not defined` / `Uncaught` | **无** | **无** |

⇒ 两次**逐项一致**：卡住的位置与 auto-import 无关。真正的链是：
`main.ts` 的 `await setupApp(app)` 在 `app.mount('#app')` **之前**，而 `setupApp` 里
`await setupI18n(app)` 依赖的 `GET /w/v1/system/locale/message/zh_CN` 返回 **500**：

```
[AppTechCacheAppSettingsService] "undefined" is not valid JSON
[WalnutAdminFilterExceptionAll]  Cannot read properties of undefined (reading 'data')
  at SysLocaleSharedService.getLocaleMessage (... locale.shared.service.ts:83:66)
```

而库是空的 —— 启动 cron 自己打了 `app settings count : 0` / `locale message count : 0`。
`setupApp` 里任何一个 await 抛出 ⇒ `mount` 永不执行 ⇒ 只剩 splash + 控制台刷屏，
**这正好是用户最初报的「一万个错误」**。

**本次处置**：不动（不在本次范围）。**已在仓里登记**：
`apps/docs/src/zh-CN/content/monorepo/architecture-todo.md` 的「前端启动序列没有容错」。

**建议方案方向**：① 那几组启动调用分清「没它就不能进页面」与「可以先进页面再补」，后者的 await
挪到 `mount` 之后，或在组合根统一收敛错误；② **本地无播种脚本** —— `apps/server` 没有
`seed` / `db:init`（本次查过 package.json 与全仓文件），空库必然卡死，端到端验证因此做不了，
建议补一个最小 seed。

## V5 · `eslint --concurrency=auto` 崩过一次（flaky，未修）

**症状**：`pnpm lint` / `pnpm lint:fix`（都是 `eslint . --concurrency=auto`）会偶发崩溃，退出码
**`-1073741819`（0xC0000005，ACCESS_VIOLATION）**；`--fix` 崩在中途会**落下半修复的工作区**
（部分文件已按 import 顺序重排、其余没动 —— 本次第一次崩就是这种状态，靠「改动文件数没变」才发现）。

**判据（本次一共跑了 9 次，同机 12 逻辑核 / 64 GB 内存）**：

| 命令 | 次数 | 崩溃 |
|------|------|------|
| `eslint . --concurrency=auto`（`lint` 或 `lint:fix`） | 7 | **2**（`lint:fix` 1 次、`lint` 1 次） |
| `eslint . --fix --concurrency=2` | 1 | 0 |
| `eslint . --concurrency=4` | 2 | 0 |

崩溃与「同时还有别的重活」不必然相关：第一次崩时机器上只有它自己，第二次崩时后台正在跑
`build:docs`。ESLint 自己每次都打
`ESLintPoorConcurrencyWarning: You may disable concurrency or use a numeric concurrency setting`。

**影响**：这是**门禁本身的可靠性**问题 —— `pnpm lint` 是 `prepush` / CI 的前端质量门之一，
偶发崩溃会被读成「lint 没过」（或更糟：`--fix` 崩完留下一半格式化的工作区，人以为已经修好了）。
CI 上大概率不复现（runner 核数与负载不同），所以它更像是**本地开发环境**的坑。

**可疑成因**：`--concurrency=auto` 在本机取 12 个 worker，而脚本同时设了
`NODE_OPTIONS=--max-old-space-size=8192` —— 12 × 8 GB 的堆上限在 64 GB 机器上撞到原生层分配失败
是合理猜测，但**没有取证**（没有抓崩溃转储），别当结论用。

**本次处置**：**不改**（按「留档后单独出方案」的口径），验证结论按「固定并发下全绿」记。

**建议方案方向**：把 admin（与 server）的 `--concurrency=auto` 换成固定值（本机实测 2 与 4 都不崩）
或去掉；要保留 `auto` 的话，`lint:fix` 使用前应能检出「半修复」状态（例如 `--fix` 后紧接一次
`--no-fix` 复核）。

## V6 · 后台作业 + `2>&1` 会把成功报成 exit 1（采集假失败）

**症状**：`pnpm build` 以后台作业方式跑、输出经 PowerShell `2>&1` 合并，作业结论是 **exit 1**，
但日志末尾是 `✓ built in 3m 36s`、`dist/` 产物齐全、没有任何构建期错误。

**判据**：同一目录改用 OS 级重定向重跑 —— `cmd /c "pnpm build > build2.log 2>&1"` 后
`$LASTEXITCODE` = **0**。且那次日志被 harness 记了「some output was dropped from memory」
（83KB 输出）。

**影响**：纯采集层问题，但会**把人引向错误的排查方向**（本次确实先去翻了构建日志）。

**建议方案方向**：大输出 + 后台作业时统一 `cmd /c "… > file 2>&1"`，退出码单独打印；
harness 侧把「输出被丢弃」与「进程退出码」两件事在报告里分开写。

## V7 · `CLAUDE.md` 的字数预算已贴到 99%，而预算表的读数早已过期（观察）

**判据**：`pnpm lint:doc-budget` 打印 `99%  1234 / 1250  CLAUDE.md`，而同一张表里那行的 `why`
写的是「当前 1089（87%）」—— 读数与现状差 145 字符，且**没有任何门禁守着这个读数**
（`lint:doc-budget` 只查用量上下界，不解析 `why` 文本）。再涨一行就红。

**建议方案方向**：`why` 里的「当前 N」要么从 `reports` 里动态生成，要么删掉只留判据
（本仓自己的纪律就是「别写会腐烂的计数」，这条读数正是一个会腐烂的计数）。

## V8 · `json` 围栏里放带注释的 JSON5 不会被 `lint:doc-ts` 拦（观察）

**判据**：本次删掉的两段 `guide/configuration.md` 块标的是 ` ```json `，内容却是带 `//` 注释的
JSON5（非法 JSON）。`lint:doc-ts` 只解析标成 `ts` 的块 ⇒ 一路绿灯。
`apps/docs/AGENTS.md` 只警告了反方向（「JSON 别标成 `ts`」）。

**建议方案方向**：给 `lint:doc-ts`（或另起一段）加 `json` / `jsonc` 分支：
标 `json` 的必须真能 `JSON.parse`，JSON5 一律改标 `jsonc`。

## V9 · UnoCss web fonts 抓取超时以 Error 形态出现（观察）

**判据**：dev 与 build 都打：

```text
[unocss] Failed to fetch web fonts: https://fonts.googleapis.com/css2?family=DM+Sans&...
Error: [unocss] Fetch web fonts timeout.
    at Timeout._onTimeout (@unocss/preset-web-fonts/dist/index.mjs:257:45)
```

本机网络到 `fonts.googleapis.com` 不通时会稳定复现；**不影响产物**（构建照样 `✓ built`），
但它在日志里长成 `Error:` + 栈，很容易被读成致命错误。

**建议方案方向**：给 preset-web-fonts 配 `offline: true` 或本地字体，或把超时降级成 warn。

---

## 附：本次**验证通过**的口径（留档备查，便于日后比对）

| 项 | 结果 |
|----|------|
| `apps/admin` `vue-tsc --noEmit`（隐藏 auto-import dts 后） | **0 错误**（起点 2416） |
| admin `eslint .` | exit 0（9 次里 2 次崩在 `--concurrency=auto`；固定并发 3/3 通过 —— 见 V5） |
| `pnpm --filter @walnut/admin build` | exit 0，产物齐全（见 V6 的采集差异） |
| `pnpm dev` 三行检查器（checker **0.14.5**） | `[ESLint] 0` / `[TypeScript] 0` / `[vue-tsc] 0` |
| `pnpm prepush` | **17/17 段全绿**，总 54.9s |
| `pnpm build:docs` | exit 0（0 死链） |
| `pnpm test` | 13/13 turbo 任务通过 |
| 浏览器运行期（headless） | **无** `ReferenceError` / `is not defined` / `Uncaught`；但卡 splash，见 V4 |
