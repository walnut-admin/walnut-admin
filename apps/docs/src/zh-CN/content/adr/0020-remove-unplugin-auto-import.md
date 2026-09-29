# ADR-0020: 移除 `unplugin-auto-import`

**Date:** 2026-09-29
**Status:** Accepted

## Context

`apps/admin` 从脚手架时代起就挂着 `unplugin-auto-import`：vue / vue-router / `vue-i18n` / `@vueuse/core`
四个 preset，加上 `src/{const,locales,router,store/modules,hooks,socket}` 六个目录的扫描，以及
`useForm` / `useTable` / `useCRUD` / `WTablePreset*Column` 四个手写条目。它注入的**隐式全局**不止一层：

1. **值**：`const computed: typeof import('vue').computed` 这类 `declare global`，403 个；
2. **类型**：`declare global { export type { Ref, ComputedRef, PropType, VNode, InjectionKey, … } from 'vue' }`
   —— 17 个 vue 类型 + 23 个目录导出的 `ValueOfAppConst*`，**在 `.ts` / `.vue` / `.d.ts` 里都生效**；
3. **模板**：`vueTemplate: true` 生成的 `declare module 'vue' { interface ComponentCustomProperties { … } }`
   —— 模板里直接写 `isDark` / `toggleDark` 也算数。

代价在大型项目里是实打实的：读代码时看不出依赖来源、删文件不会有任何工具报错、`knip` 之类的静态
分析全瞎、`.d.ts` 里的隐式类型借道还会被 `skipLibCheck` 藏起来（见 Decision 3）。

**这次移除的触发点是一次误判**：`pnpm dev` 起来后控制台一片红，被归因为「auto-import 不生效了」。
实测结论是**它一直好好在工作**（`predev` 正常生成 dts；dev 里三个检查器全 0；抓 dev server 的转换
结果能看到注入的 `import { useAppStoreMenu } from "/src/store/modules/app/app-menu.ts"`）。真正的原因
是后端没起来 ⇒ 每个 API 经代理 `ECONNREFUSED` ⇒ 启动序列没容错、卡在 splash（已登记在
`architecture-todo.md` 的「前端启动序列没有容错」）。

**但移除的决定与那次误判无关** —— 隐式全局本身就是理由，误判只是让这件事被提上日程。

## Decision 1: 移除插件，全部改显式 import

`unplugin-auto-import` 从 vite 插件表、`build/generate` 的生成物、`apps/admin/package.json` 与
`pnpm-workspace.yaml` 的 catalog 里一并删除；369 个文件里的隐式全局改为显式 import。

**迁移方法本身是本决策的一半**（可复用）：隐式全局的清单不要靠人肉 grep ——

1. **固化映射表**：移除前把生成的 `types/generated/auto-import.d.ts` 留一份当「符号 → 模块」的真源
   （值走 `const X: typeof import(...)`，类型走 `export type { … } from ...` 两段）；
2. **让编译器出清单**：把那份 dts 挪走、直接跑 `vue-tsc`，得到**精确**的待办清单 —— 实测 **2416 个
   错误 / 369 个文件 / 170 个不同名字**（2077 条 `Cannot find name` —— `TS2304` 2075 + `TS2552` 2，
   其余是连带的隐式 any 与模板侧的 `TS2339 Property 'x' does not exist on type 'ComponentPublicInstance<…>'`）；
3. **codemod 补 import**：按「文件 × 模块」分组，每模块一条 import，类型符号走 `import type`，落点优先
   `<script setup>`（SFC 编译器会把 import 提升到模块级，实测 238 个 `.vue` 全部只有单个 `<script setup>`，
   无一例跨块冲突），写完跑 `eslint --fix` 让 `perfectionist/sort-imports` 归位；
4. **判据是编译器回 0**，不是「看上去都补上了」。实测落到 368 个文件 / 998 条 import，残留 1 条。
5. **清理已废除的生成物，而且要机械地清**：那份 dts 是 **gitignored** 的 —— `git pull` 到这次改动时
   它**不会被删掉**（git 不管未跟踪文件），而 `tsconfig.json` 的 include 是 `types/generated/*.d.ts`
   这种**通配**：旧文件留着，那 403 行 `declare global` 就**继续生效**。实测同一棵树只改「那份 dts
   在不在」：**在 ⇒ `vue-tsc` 0 错误；挪走 ⇒ 2416 个错误** —— 残留会让漏 import **整片假绿**，
   CI（干净检出）看不见，受害的是每台拉下这次改动的机器。所以清理写在
   `build/generate/genTypeDeclarations.ts` 里（每个 `vite` / `vue-tsc` 入口的必经之处，
   `lint:pre-hooks` 门禁守着），而不是在文档里指望人自己删。

**溢出到 grep 之外的那条**（Decision 3）就是这套流程的价值所在：只有「把类型面收干净再让编译器
说话」才能把它逼出来。

## Decision 2: 保留 `unplugin-vue-components`，不一起摘

两者常被当成一件事（都是 antfu 的 unplugin、都在同一份 `genTypeDeclarations` 里生成 dts），
但**风险剖面完全不同**，所以分两批：

| | `unplugin-auto-import` | `unplugin-vue-components` |
|---|---|---|
| 隐式的是 | 标识符（值 + 类型） | 模板里的**组件标签** |
| 编译器能不能兜住 | **能** —— 漏了必报 `TS2304` / `TS2339` | **不能** —— 实测把它那份 dts 挪走，`vue-tsc` 报 **0 错误** |
| 规模 | 369 文件 / 170 符号 | 317 个 `.vue` 里 **227 个**用了 **88 个**注册组件，约 **485 处** |
| 漏了会怎样 | 类型检查直接红 | 运行时报解析不到组件 |

「编译器兜不住」的成因值得记下来：tsconfig 没开 `vueCompilerOptions.strictTemplates`，未知组件按
`any` 放行（auto-import 的 dts 里还留了个空的 `interface GlobalComponents {}`）。所以摘组件自动注册
**没有安全网**，只能靠 codemod + 运行时冒烟，属于独立一件事。

## Decision 3: 把「编译器看不到的地方」当一等公民查

移除过程中唯一需要人手改的地方，恰好是编译器**看不到**的那处：

`src/store/types.d.ts` 用了 `Ref<[string, { top: number, left?: number }][] | null>`，但**从来没 import 过
`Ref`** —— 它借的是 auto-import dts 的全局类型再导出。隐藏那份 dts 之后，这里在 `vue-tsc` 里
**一个错误都不报**，因为 `skipLibCheck: true` 跳过所有 `.d.ts` 的类型检查：`Ref` 静默退化成 `any`，
只在**消费方**漏出一句莫名其妙的 `TS7006: Parameter 'i' implicitly has an 'any' type`。

所以这次专门补了一道扫描：拿「被全局化的 40 个类型名 × 全部手写 `.d.ts`」做笛卡尔积，找出
「用了但没 import」的名字。结果是**全仓只有这 1 个文件、6 个名字**（`Ref` + 5 个 `ValueOfAppConst*`）——
补上显式 import 后 `vue-tsc` 归零。

同一条扫描对**值**的全局名跑了一遍，命中全是 `name` / `version` / `readonly` 这类属性名与关键字的
假阳性 —— 值全局在 `.d.ts` 里没有借道空间，这一点可以放心。

## Decision 4: 「不许隐式全局」由 `vue-tsc` 机械守

纪律写在两处指引里（根 `AGENTS.md` 关键纪律 4、`apps/admin/AGENTS.md`「别名与导入」），但**守卫是
编译器**：插件没了之后，漏 import 就是 `TS2304`，`pnpm types:check` / `prepush` / CI 三道闸都会红。
指引里同时写明了「别再把插件加回来」和「只剩 `unplugin-vue-components` 一个隐式机制，而它没有类型
安全网」两件事 —— 后者是本次新发现的、以前没人写下来的坑。

## Alternatives considered

- **不动它**：隐式全局在模板项目里有真实便利（少写 import），且这次事故证明它并没有坏。否决理由：
  便利换来的是「读代码看不出依赖 + 静态分析全瞎」，「这是模板项目、示例代码要短」不构成让
  **全部 369 个业务文件**都丧失可分析性的理由；而且它的三条注入通道（值 / 类型 / 模板）里，
  类型那条已经在生产代码里造成了静默 `any`（Decision 3）。
- **保留插件，但只规定「新代码必须显式 import」**：这正是本次之前 `apps/admin/AGENTS.md` 的写法
  （「是给存量代码的便利，不是风格指引」）。否决理由：**这条规矩没有守卫** —— 存量与新增混在同一个
  文件里时，reviewer 无法判断某个 `computed` 是全局来的还是漏了 import，`tsc` 也不会报。
  一条靠自觉、且与既成事实相反的规矩，实测就是在原地放了两年。
- **连 `unplugin-vue-components` 一起摘**：一次收干净、隐式机制归零。否决理由：227 个文件 / 485 处
  模板改动，而编译器**零覆盖**（Decision 2 的表）；同时动两个变量会让出问题时无法归因。留作独立一件事。
- **开 `strictTemplates` 来给组件注册建安全网**：能让「解析不到的组件」变成编译错误，从而让上一条
  变得可机械化。否决（本次不做）理由：它会对全部 227 个文件的模板重新严格校验，预期会翻出一批与
  本次目标无关的模板类型错误 —— 那是一次独立的类型收紧，不该混进「移除 auto-import」这一批。
  值得单独评估。

## Consequences

- **好处**：369 个文件里的依赖关系变成静态可读；`knip` 这类工具重新看得见这些引用；模板里的
  `isDark` / `toggleDark` 不再依赖 `ComponentCustomProperties` 的隐式注入；顺手修掉了一个被
  `skipLibCheck` 藏了很久的静默 `any`。
- **代价**：每个文件多 1~3 行 import（实测 998 条 / 368 文件，平均 2.7 条）；`pnpm dev` 的
  `predev` 仍要生成 `components.d.ts`（只剩一份生成物），生成步骤与 `lint:pre-hooks` 门禁都保留。
- **口径变化**：`apps/admin/AGENTS.md` 的「两个 unplugin 的 dts」变成一份；`knip.config.ts` 里以
  「auto-import」为由的 `ignore` 注释改为「Pinia / barrel」，并留了一条 `TODO`：那份清单是移除前
  列的，要收紧得先跑 `pnpm knip` 看真实命中（knip 本仓有意维持红色，没有门禁看着它）。
- **验证**：`vue-tsc` 0 错误（**隐藏那份 dts 之后也是 0** —— 这是本次唯一的硬判据）、`eslint` 0 错误
  （它本身在这台机器上偶发崩溃，与本次改动无关，见留档 V5）、
  `vite build` exit 0、`build:docs` 0 死链、`prepush` 17/17 段全绿、`test` 13/13。
  **运行时冒烟只做到「模块图干净」这一层**：headless Chrome 渲染后控制台**无** `ReferenceError` /
  `is not defined` / `Uncaught`（`vue-devtools` 已注入 ⇒ JS 确实跑了）。**端到端没跑通**：本地 Mongo 是
  空库，`setupI18n` 依赖的 `/system/locale/message/zh_CN` 返回 500，`setupApp` 抛在 `mount` **之前**
  ⇒ 停在 `index.html` 那屏 splash。用 `git stash` 回到 HEAD 做了对照：**改动前后逐项一致** ⇒
  与本次移除无关，是既有的「启动序列没容错 + 无播种脚本」。
- **验证留档**：过程中撞到的报错与 flaky（旧 dts 残留造成假绿、`skipLibCheck` 藏起来的静默 `any`、
  checker 的 `watchPath`、splash、`eslint --concurrency=auto` 崩过一次、后台作业把 exit 0 报成 1 …）
  逐条留在仓库根的 `VERIFICATION-LOG.md`，**后续单独出方案**。
- **未做**：`unplugin-vue-components`（Decision 2）、`strictTemplates`（Alternatives 第 4 条）、
  `knip` 那份 `ignore` 清单的收紧 —— 都留作独立批次。

## Related

- [ADR 0017](./0017-package-reorganization.md) —— 包重组时就把「迁入 package 的代码必须显式 import」
  写成硬约束，本决策把同一条规则推广到 admin 全域。
- [ADR 0019](./0019-tsconfig-presets-and-no-mjs.md) —— 生成物与工具链纪律（`.ts` 入口、Node 原生类型剥离）。
