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

**本次处置（2026-09-29，已修）**：分两步。

① 补显式 import（`Ref` 并入既有的 `vue` 类型行，5 个 `ValueOfAppConst*` 并入既有的 `@/const` 行）
→ 残留错误归零。

② **把这条静默面本身做成门禁**：新增 `pnpm lint:dts`（`walnut-check-dts`）。做法是把 admin 手写的
`.d.ts` 单独拉进一个工程（`apps/admin/tsconfig.dts.json`）、**关掉 `skipLibCheck`**，再**只报仓库内、
且路径段里没有 `node_modules` 的诊断** —— 关掉 `skipLibCheck` 会连依赖的 `.d.ts` 一起查（实测 15 条
错误全来自依赖：`@vueuse/core` / `naive-ui` / `vue-i18n` / `@vue/compiler-core` …），那不是我们的
代码；一个开始报「你改不了的错」的门禁等于没有门禁。

**门禁首跑就抓到 16 处诊断 / 6 个文件**（全部已修，见 commit `c22d925`）：两处 PWA 残留（PWA
2026-08-08 移除，但 `/// <reference types="vite-plugin-pwa/*" />` 与一个 `virtual:pwa-register/vue`
模块声明还留着）、`web-vitals` v5 已无的 `FIDMetric`/`onFID`、`declare global` 里多余的 `declare`
（TS1038）、把命名空间当类型用的 `echarts: ECharts`（TS2709）、`interface HTMLAttributes extends
HTMLAttributes`（自己继承自己，TS2310 —— 那个文件已整个删除）、`Recordable` 忘了 import（4 处）、
一个指向**从未在仓里存在过**的模型（`IModels.SystemLogOperateDevice`）的类型引用，以及两处只有这条
门禁能看见的 `@types/gtag.js` 误用（把全局类型包当模块 import、`Gtag.DataLayer` 这个成员根本不存在
而仓里零处用它）。

**它顺带逼出两处真 bug**（以前被静默 any 挡着）：`views/system/log/operate/index.vue` 把**对象**快照
塞给了要**文本**的 `WCodeMirrorMerge`；`ECharts` 的 `chartInst` 混用了 UMD 与 ESM 两套类型身份。

**还剩一件事（见 V12）**：想全局关掉 `skipLibCheck` 现在做不到 —— echarts 会挡路，所以门禁只收
`.d.ts`（`.d.ts` 的 import 会把普通 `.ts` 拉进 program，那些文件上的库身份问题按 `.d.ts` 过滤掉）。

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

## V4 · 前端卡在 splash：空库 + 启动序列没容错（**已修**）

**症状**：`pnpm dev`（前后端都起）后浏览器停在 `index.html` 里那屏 loading，控制台一片红。

**成因链**：`main.ts` 是 `await setupApp(app)` 再 `app.mount('#app')` —— 启动序列里**任何一步抛出**
都会让 `mount` 永不执行，用户只看到一屏 loading，原因只在控制台。而空库时这一步**必然**抛：
`setupI18n` 依赖的 `GET /w/v1/system/locale/message/zh_CN` 返回 **500**（库是空的，启动 cron 自己
打了 `locale message count : 0`）：

```
[AppTechCacheAppSettingsService] "undefined" is not valid JSON
[WalnutAdminFilterExceptionAll]  Cannot read properties of undefined (reading 'data')
  at SysLocaleSharedService.getLocaleMessage (... locale.shared.service.ts:83:66)
```

**判据（CDP 实测，同一环境、同一份库 —— 改前 / 改后各跑一次）**：

| 观察 | 改前（HEAD） | 改后 |
|------|--------------|------|
| `#app` 里还有 `<div class="app-loading">` | **是**（等了 75s 仍在 splash） | **否** |
| 页面正文 | `Walnut Admin`（只剩 splash 标题） | 登录页（正文可见） |
| 控制台 `setupApp` 末尾那行 `App Initializing` | **无** | **有** |
| 未捕获异常 | 1 条：`TypeError: useAppMessage(...).create is not a function` | 0 条 |
| 失败步骤的可见性 | 只在控制台，且是一句与根因无关的 TypeError | 逐条 `[bootstrap] 可降级步骤失败：device-id / sign / locale-messages` + 一条汇总 warning |

**本次处置（已修）**：把组合根从 `App/src/App.ts` 挪进 `App/src/bootstrap.ts`，并把启动序列拆成
**带名字、带关键性的一步步**：

- **关键步**（store / i18n 壳 / router）失败 ⇒ **不 mount**，把 splash 换成一屏**能读懂的**错误
  （`renderBootstrapFailure`，纯 DOM、不用 `innerHTML`，带「失败的步骤 + 错误消息 + 重试」）；
- **可降级步**（GA / 指纹 / 设备 / 签名 / 语言包 / sentry）失败 ⇒ 记下来照常进页面，mount 之后
  逐条 `console.error` + 一条 `$message.warning` 汇总（`reportBootstrapProblems`）；
- 网络类步骤加**超时兜底**（20s）：请求挂死时 `await` 永不 resolve，那是「无限 splash」的另一种成因，
  光靠 try/catch 拦不住；
- `setupI18n` 拆成 `installI18n`（同步、不会失败）+ `loadLocaleMessages`（网络，可降级）——
  装 i18n 是进页面的前提，拿语言包不是；
- `App/src/scripts/index.ts` 的四步各自成函数，报错能说清是哪一步（原来只得到一句「启动失败」）。

**两条分支都实测过**：可降级路径见上表；关键路径把 `installI18n` 临时改成抛错后，页面显示
「应用启动失败 / 失败的步骤：i18n / probe: …」，未捕获异常 0 条。

**顺带更正一条测量教训**：本条目最初那版「判据」用的是 headless `--dump-dom` 的截图对比
（结论「前后都停在 splash、所以与 auto-import 无关」）。**那次对比是无效测量**：dev server 的模块图
太大，headless 的 virtual-time 预算跑不完 —— 我们的代码**一行都没执行**，两次都只是静态
`index.html` 的 splash。改前/改后两张表都是在**代码确实跑起来**的前提下测的（CDP 走真实时间）。
教训：**「页面没变化」不等于「代码跑了但结果一样」**，先确认被测代码执行过（判据：`App Initializing`
这类只可能由它打出的日志，或页面正文真的变了）。

**仍待立项（V4 的另一半）**：**本地无播种脚本** —— `apps/server` 没有 `seed` / `db:init`（查过
package.json 与全仓文件），空库时前端只能降级启动（语言包/设备/签名三步都会失败）。
而**播种数据在仓里根本不存在**：前端语言包的唯一来源就是库（`src/locales/` 只有一个 index.ts，
没有内置兜底语言文件），用户还需要 OPAQUE 注册记录（口令要走客户端协议，不是随便插一条 hash）。
所以这一半**不该由 agent 凭空造数据集**，建议单独立项，方向：① 从演示库导出 `app_setting` +
`sys_lang` + locale messages 当 fixtures；② 用户/角色/菜单走「初始化向导」或一次性导入脚本。

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

**本次处置（2026-09-29，已修）**：全仓 **16 个 manifest / 33 处** `--concurrency=auto` 一律改成
`--concurrency=4`（含各包 `lint` / `lint:fix`、根 `lint:root` / `lint:root:fix`，以及根 `lint-staged`
里那条 `eslint --fix`）。改之前先量了代价 —— 同一个 `apps/admin` 全量 lint：

```text
--concurrency=auto   28.1s
--concurrency=4      26.8s   ← 固定值反而最快
--concurrency=6      28.3s
```

worker 越多调度开销越明显（ESLint 自己也会打 `ESLintPoorConcurrencyWarning`），所以这不是
「拿速度换稳定」，是两边都赚。理由与这组数字写进了 `content/monorepo/package-scripts.md`
（`package.json` 存不下注释，而这个 `4` 一旦被「优化」回 `auto` 就会把崩溃带回来）。
改后复跑：`--concurrency=4` **5/5 通过**（含 `lint` 与 `lint:fix`）。

**还建议做**：给上游 `eslint` 提一个可诊断性问题 —— `0xC0000005` 这种原生崩溃没有任何可用输出
（连「哪个 worker 崩了」都没有）；以及 `lint:fix` 崩在中途会留下**半修复**工作区，理想情况下
`--fix` 要么原子要么能检出残留（例如 `--fix` 后紧接一次不带 `--fix` 的复核）。

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

**本次处置（2026-09-29）：不改，按「环境噪声（已知）」结案。** 理由：它**不是缺陷** —— dev 与 build
都成功（`✓ built`）、产物完整，只是 UnoCss 的 `preset-web-fonts` 在拿不到 `fonts.googleapis.com` 时
把超时抛在 `setTimeout` 里，于是 Node 打出一整段 `Error:` + 栈，看起来像致命错误。而任何「修」都要
么改产物行为（`offline: true` 会让构建不再内联 Google Fonts 的 `@import`，CI 有网时会与本地产出不同）、
要么只是把噪声挪个位置；本机网络受限是**本机**的事，不该让仓库为它改产物。真嫌吵的话按下面第二条走。

**建议方案方向**（留作可选）：① 想彻底不抓就别用 `presetWebFonts` 的远程 provider（换本地字体文件）；
② 想保留抓取、只是别让它长得像崩溃，得等 UnoCss 把这条 `logger.error` 换成 warn（上游），或在
`uno.config.ts` 里给 `presetWebFonts` 传一个更短的 `timeout` 缩短卡顿窗口。

## V10 · 一次提交几百个文件时 pre-commit 必挂（**已修**，lint-staged 上游 bug）

**症状**：分批次提交这次改动时，第一笔（369 个暂存文件）在 pre-commit 直接失败，输出只有一句
**「命令行太长」**（`lint-staged` 把 lint 任务标成 `[FAILED]` 后回滚了暂存状态）；而逐个文件跑
`eslint --fix` 全是 exit 0。

**根因（读分发代码确认，不是猜）**：`lint-staged@17.0.2` 的 CLI 把该选项算成
`parseInt(values['max-arg-length'], 10)` —— **没传时是 `NaN`**；而 `lib/index.js` 里那个合理的默认值
`maxArgLength = getMaxArgLength() / 2`（win32 = 4095）是**解构默认值**，只在「值为 `undefined`」时
生效 ⇒ `NaN` 不是 `undefined` ⇒ 默认值失效 ⇒ `chunkFiles` 走 `if (!maxArgLength)` 那条分支
**静默关掉分块** ⇒ 所有暂存路径塞进一条命令，超过 Windows 的 8191 字符上限。

**判据**：`node_modules/lint-staged/lib/cli.js:184` 与 `lib/index.js:94`、`lib/chunkFiles.js:49`
三处连线可直接读到；`lib/index.js:37` 的 `getMaxArgLength()` 在 `win32` 返回 8191。

**影响**：**任何** Windows + lint-staged 17.x 的仓库，只要一次提交的文件够多（本仓实测 369 个必挂、
少量文件不会）就会撞上；CI（Linux）不受影响，所以这是一个只在本地阻断提交的坑。

**本次处置**：在 `lefthook.yml` 的 pre-commit 里显式传
`pnpm exec lint-staged --max-arg-length=4000`（贴着 win32 默认值 8191/2，跨平台也安全），
并把上面这段根因写进配置注释；commit `1e5b2e6` 已落地。**实测 369 个文件的提交随后正常通过**
（lint-staged 8.61s ✓ / commitlint ✓）。

**建议方案方向**：这是上游 bug，除了本地兜住，值得给上游提 issue/PR（`cli.js` 把
`parseInt(...)` 换成 `values['max-arg-length'] === undefined ? undefined : parseInt(...)`，
让解构默认值生效）。另外可考虑把这条不变量做成机械判据 —— 但那需要跑一次真实的多文件提交，
成本高于收益，暂不做。

---

## V11 · 新增 bin 后 `pnpm install` 不链接它（本地空转一次）

**症状**：给 `@walnut/scripts` 加了新 bin（`walnut-check-dts`）与根脚本 `lint:dts` 之后，
`pnpm lint:dts` 报 `'walnut-check-dts' is not recognized as an internal or external command`，
而同一个 bin 直接 `node packages/tooling/scripts/bin/check-dts.ts` 跑得好好的。

**判据**：`pnpm install` 的输出是 **`Already up to date`**（9ms），`node_modules/.bin/walnut-check-dts`
**不存在**；`pnpm install --force`（5.5s）之后 bin 出现、`pnpm lint:dts` exit 0。
`Test-Path node_modules/.bin/walnut-check-dts` 一条命令就能判定。

**影响**：只影响**已有检出**拉下「新增 bin」这类改动之后的第一次本地门禁运行；CI 不受影响
（全新 `pnpm install --frozen-lockfile` 会链接 bin）。症状看起来像「门禁脚本写错了」，
实际是链接问题 —— 会浪费一轮排查。

**本次处置**：不改（属于 pnpm 行为，不是本仓的 bug），只记一笔，并把它写进了那个 commit 的正文。

**建议方案方向**：真要消除这一坑，可以在 `pnpm lint:dts` 跑不通时给出更响的提示 ——
但那需要包一层脚本，成本高于收益；**更省的办法是记住 `--force`**（或者以后新增 bin 的那次提交里
顺带把这条写进 commit 正文，本次就是这么做的）。

## V12 · 想全局关掉 `skipLibCheck` 现在做不到：echarts 会挡路

**症状**：V2 那条「或对手写 `.d.ts` 关掉 `skipLibCheck`」看着最干净，实测**卡在 echarts**。
关掉 `skipLibCheck` 之后 `src/components/Vendor/ECharts/on-demand.ts:28`（`window.echarts = echarts`）
报 TS2322：`typeof import("echarts/core")` 不能赋给
`typeof import("echarts/core") & typeof import("echarts/types/dist/echarts")` ——
两边的 `Axis` / `Scale` 各带一套私有 `_setting`，**互不兼容**。

**判据**：把 `types/window.d.ts` 里我们自己那条 `Window.echarts` 声明**整条删掉**，这条错误
**照样存在**（实测 1 条不降）⇒ 冲突来自 echarts 自己的 UMD 全局声明，不是我们引入的。

**影响**：决定了 `pnpm lint:dts` 的扫描面必须收窄到 `.d.ts`（`isOwnFile` 第一条判据）——
`.d.ts` 里的 `import` 会把普通 `.ts` 一起拉进 program，那些文件上会报出这类**只有关掉
`skipLibCheck` 才成立**的库身份问题。同时它也说明：**本仓现在没法把 `skipLibCheck` 全局关掉**，
echarts（可能还有别的库）会是第一道墙。

**本次处置（2026-09-29，已修）**：**把 `window.echarts` 这个隐式全局整个删掉**，而不是继续给它打补丁 ——
echarts 的组件本来就只有两处用到它（`on-demand.ts` 赋值、`index.vue` 读），改成消费方直接
`import echarts from './on-demand'`：全局没了、`as typeof window.echarts` 那个断言没了、
`types/window.d.ts` 里那条与 UMD 撞车的声明也没了 ⇒ **双身份从根上消失**（顺带与仓里「不许隐式全局」
的方向一致）。

**复核**：`apps/admin/src/components/Vendor/ECharts/on-demand.ts` 在关掉 `skipLibCheck` 后
**0 条错误**（改前 1 条）；门禁 `pnpm lint:dts` 仍 0 错误。

**还剩一道墙（不是 echarts 了）**：关掉 `skipLibCheck` 后**依赖自身**仍报 13 条
（`@vueuse/core` / `naive-ui` / `vue-i18n` / `@vue/compiler-core` / `unplugin-info` …）。
那些不是我们的代码、修不了 ⇒ **全局关掉 `skipLibCheck` 仍然不可行**，但这条已经不再是
「echarts 挡路」，而是「依赖的 `.d.ts` 质量」这个无法在本仓解决的事实。所以 `pnpm lint:dts`
的做法（只收 `.d.ts` + 按路径过滤依赖）是长期解，不是权宜之计。

---

## V13 · **生产构建产物根本跑不起来**（`resolve.conditions` 抹掉了 Vite 默认条件；**已修**）

**症状**：把 `dist` 用静态服务器伺服、真实 Chrome 打开，页面**执行到一半抛未捕获异常**、停在
splash：

```
Uncaught TypeError: Cannot destructure property '__extends' of 'e(...).default' as it is undefined.
  source: http://127.0.0.1:4173/static/js/vendor-033kZhHc.js
```

**先更正我自己写错的一版归因**：本条目最初说「cropperjs × tslib」—— **错的**。当时只看到压缩产物里
那段类代码紧挨着解构语句，而压缩后**模块边界看不见**，把相邻当成了同源。实据是：

1. `pnpm --filter @walnut/admin why tslib` —— admin 到 tslib 的路径只有 **2.3.0**（echarts / zrender）
   与 **2.8.1**（构建期工具）；**cropperjs 根本不依赖 tslib**（它只依赖 `@cropper/elements` / `@cropper/utils`）。
2. 产物里搜 `tslib` 只剩 **1 处** —— 是 **UMD 工厂**（`define('tslib', ['exports'], …)`）。
   也就是说某种依赖被解析到了 **CJS/UMD 入口**，而不是 ESM 入口。
3. tslib 2.3.0 的 `exports` 是 `{ module: ./tslib.es6.js, import: ./modules/index.js, default: ./tslib.js }`
   —— **它本来有 ESM 分支**；只有把 `module` / `import` 条件一起抹掉，才会落到 `default`（UMD）。

**根因**：`apps/admin/vite.config.ts` 写的是 `resolve.conditions: ['source']`，而该选项是**替换**而不是
追加（Vite 8 的默认是 `['module', 'browser', 'development|production']`）⇒ **每个 `exports` 映射里没有
`source` 分支的依赖都会落到 `default`**。tslib 落到 UMD，那份 UMD 自带 `__esModule` 标记，打包器据此
**不再合成 `default`**，消费方却仍在 `.default` 上解构 `__extends` ⇒ 打开即崩。

`source` 的收益也远小于代价：全仓只有 `@walnut/contract` 与 `@walnut/utils` 声明了它；
`ui` / `client` / `http` / `types` 用的是**纯字符串 exports**（本来就直吃源码、不需要条件）。

**判据（含对照，排除「本次改动引入」）**：`git stash` 回 HEAD 源码、删掉孤立的未跟踪文件后
**重新构建**（`✓ built in 5m 7s`，exit 0），同一台机器同一个 Chrome 打开 → **一模一样的报错**
（`vendor-DDDO6QgV.js`）⇒ 既有缺陷，与 V4/V12 无关。

**本次处置（已修）**：把默认条件写回来，`source` 仍排最前：

```ts
conditions: ['source', 'module', 'browser', 'development|production'],
```

- 重新构建后产物里 `tslib` 出现次数 **1 → 0**（UMD 工厂彻底消失），坏形态不再存在；
- 静态伺服 + CDP 实测：`splash: false`（**已挂载**）、无 `__extends` 异常、登录页正常渲染；
- dev 侧同样实测（`https://127.0.0.1:3100` + 后端）：`splash: false` + 按 V4 的设计逐条报降级步骤
  ⇒ 没带坏日常开发路径。

**两条给后来人的结论**：

1. **构建绿 ≠ 跑得起来**：CI 的 admin 那步只有 `pnpm build`（加 dist 密钥扫描），**没有运行期冒烟**，
   所以这道红灯一直没人看见；而它意味着「按文档构建出来的产物打不开」。建议补一步「静态伺服 dist +
   断言 `#app` 已挂载」—— 这类错误只有运行期看得见。
2. `minify: false` 在生产构建里**不生效**（实测产物大小与压缩后一致、崩溃依旧）—— 排障别指望它，
   证据要从「依赖解析到哪个入口」上取（`why` + 产物里搜入口特征串）。

---

## V15 · 注释里的 emoji 会变成乱码（**已加门禁**）

**症状**：用户看到「注释写成乱码」：同一份文件里**中文正常、emoji 坏掉**（`` 显示成 `鈿狅笍`、
`` 显示成 `鉁?`）。

**根因（两个叠加，都不是文件坏了 —— 全仓扫过：0 处真乱码）**：

1. **我用 PowerShell `Set-Content -Encoding utf8` 写过仓里的文件** —— 那条路径会加 **BOM**（`vite.config.ts`
   因此带上 BOM，`unicode-bom` 直接让构建红），并在非 UTF-8 代码页下读写时弄坏非 BMP 字符。
2. emoji 本身在非 UTF-8 代码页下**必然**乱码：`` 是 `U+26A0 U+FE0F`（基础字符 + **变体选择符**），
   `` 之类在基本平面之外（代理对）—— 中文有稳定双字节表示，emoji 没有，所以「中文没坏、emoji 坏了」。

**本次处置（已加门禁）**：本地规则 `walnut-comment/no-emoji`
（`packages/tooling/eslint-config/comment-rules.ts`），三个预设共用（与 `turbo-env-vars` 同一模式）：

- **只查注释，不查字符串**（刻意收窄）：CLI 输出图标、用例里对文档的逐字断言都不属注释；文档站正文是
  markdown，本仓 eslint 刻意不 lint。
- 判定用 `\p{Extended_Pictographic}` + 变体选择符 / 零宽连接符，**刻意不含排版符号**（`→` `⇒` `≤`）——
  全仓注释大量在用，误报会让规则变噪声。
- **可自动修复**（删 emoji 并吃掉相邻一个空格），所以存量一条命令清干净。
- 存量：`pnpm lint:fix` + `pnpm lint:root:fix` 清掉注释里 **140 处**；eslint 覆盖面之外的文本文件
  （workflow `.yml` / `.gitignore` / `cliff.toml` / nginx `.conf` / `lefthook.yml`）另清 **20 处** `#` 注释。

**已知空白（要不要补门禁另议）**：那 20 处所在的文件**没有 eslint 守**（根级 `lint:root` 只扫
`*.ts *.json *.yaml`），所以这类文件的注释 emoji 目前**没有机械判据**。补法：一个扫「所有被跟踪文本
文件」注释的小门禁（按扩展名分派 `#` / `//` / `/* */` 注释形态）。

**顺带一条纪律**：仓里的文件**只用编辑工具写**，不要用 shell 重定向 / `Set-Content` —— 本次的 BOM 与
「emoji 坏、中文不坏」都源自那一类写入。

---

## 附：本次**验证通过**的口径（留档备查，便于日后比对）

| 项 | 结果 |
|----|------|
| `apps/admin` `vue-tsc --noEmit`（隐藏 auto-import dts 后） | **0 错误**（起点 2416） |
| `pnpm types:check`（全仓，含 V2 修复后） | **15/15 任务通过** |
| admin `eslint .` | exit 0（V5 修掉 `--concurrency=auto` 后：固定 4，未再崩） |
| `pnpm --filter @walnut/admin build` | exit 0，产物齐全（见 V6 的采集差异） |
| `pnpm dev` 三行检查器（checker **0.14.5**） | `[ESLint] 0` / `[TypeScript] 0` / `[vue-tsc] 0` |
| `pnpm prepush` | **18/18 段全绿**（V2 之后新增 `dts` 段），总 45.1s |
| `pnpm build:docs` | exit 0（0 死链） |
| `pnpm test` | 13/13 turbo 任务通过；`@walnut/scripts` 363/363、`@walnut/release` 198/198 |
| 浏览器运行期（CDP 实测，dev 模式） | 改后：**已挂载**（splash 消失）+ 逐条降级提示 + `App Initializing`；改前：卡 splash + 1 条未捕获异常（见 V4） |
| 浏览器运行期（静态伺服 `dist`） | **跑不起来**：`vendor-*.js` 抛 `__extends of undefined`（见 V13，既有问题） |

## 结案状态（2026-09-29）

| 条目 | 状态 |
|------|------|
| V1 旧 dts 残留假绿 | **已修**（生成器自愈清理） |
| V2 `skipLibCheck` 静默 any | **已修** + **已加门禁** `pnpm lint:dts`（16 处诊断全修） |
| V3 checker `watchPath` | **已修** |
| V4 启动序列没容错 | **已修**（组合根逐步隔离 + 关键步错误屏 + 可降级步提示 + 20s 超时；CDP 实测改前卡 splash、改后挂载并逐条报失败） |
| V4b 本地无 seed | **待立项**（数据源不在仓里：前端语言包唯一来源是库；用户还要 OPAQUE 注册记录 —— 不该由 agent 凭空造数据集，方向见 V4 末段） |
| V5 `--concurrency=auto` 崩 | **已修**（16 个 manifest / 33 处 → 固定 4，实测不慢反快） |
| V6 后台作业报 exit 1 | **定性完毕**（采集层，非项目问题） |
| V7 预算读数腐烂 / CLAUDE.md 99% | **已修**（读数不写进表，上限按现状重校） |
| V8 `json` 围栏放 JSON5 无人拦 | **已修**（`lint:doc-ts` 加严格 JSON 校验 + 7 处改标 `jsonc`） |
| V9 UnoCss 字体超时像致命错 | **定性完毕：不改**（环境噪声，非缺陷） |
| V10 lint-staged 大提交必挂 | **已修**（`--max-arg-length=4000` + 用例钉住） |
| V11 新增 bin 不链接 | **已定性**（`pnpm install --force` 一次） |
| V12 echarts 双身份挡全局关 `skipLibCheck` | **已修**（删掉 `window.echarts` 隐式全局，改直接 import；echarts 那道墙消失，剩下的是依赖自身 13 条） |
| V13 生产产物跑不起来 | **已修**（根因是 `resolve.conditions: ['source']` **替换**掉了 Vite 默认条件 ⇒ 依赖落到 CJS/UMD 入口；把默认条件写回来即可。产物里 UMD 工厂 1 → 0、CDP 实测已挂载、dev 侧同样正常） |
| V14 prepush 不跑各包 lint | **已修**（prepush 表补 `lint` 段 = `turbo run lint`，与发版电池对齐；`prepush.test.ts` 整表断言同步） |
| V15 注释里的 emoji 变乱码 | **已加门禁**（本地规则 `walnut-comment/no-emoji`，可自动修复；存量清 140 + 20 处。已知空白：eslint 覆盖面外的 `.yml` / `.gitignore` / `.toml` 注释暂无机械判据） |

**仍然打开的**：V4b（seed，数据源不在仓里）、V15 的空白（eslint 覆盖面之外的文本文件注释 emoji）；
另外 **CI 缺一步「构建产物冒烟」**（V13 建议，见该条末段）—— 这三条都属于「需要单独裁定」的量级。
