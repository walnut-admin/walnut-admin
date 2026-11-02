# R1 前端复核：componentMap 断键穷举 + 运行时断言方案 + 删 @walnut/ui 连锁面

> **轮次**：批次 1 · P0 止血 ｜ **R1 前端复核**（只读轮）
> **基线**：HEAD `190a4c5d`（工作树除他人本轮的 4 个 `apps/server/libs/repository/src/__tmp_r1_*.spec.ts` 外干净）
> **范围**：`apps/admin/src/components/UI/Form/src/components/FormItem/componentMap.ts`、`apps/admin/build/vite/plugin/component.ts`、`packages/platform-web/ui/**`、发版/版本文档面
> **本轮未改任何源码/配置**；临时探针建在 `apps/admin/node_modules/.cm-probe/` 与 `$env:TEMP/walnut-cm-probe/`，
> 跑完已清理（本机无 `trash` 命令，故对这两个**临时目录**用了 `Remove-Item` —— 未触碰任何受版本控制的文件）。

## 0. 结论速览

| 问题 | 结论 | 一句话证据 |
|------|------|-----------|
| 到底有几个 key 断？ | **3 个**，全在 UI 分组 | 30 个插值动态 import 目标逐个 `existsSync`：27 存在、3 不存在 |
| 除那 3 个之外还有没有别的断的？ | **没有**，而且是**结构性**的没有 | `componentMap.ts` 是**全 app 唯一**的插值（模板字符串）动态 import；其余 40 处 `import(...)` 全是静态字面量，缺文件在构建期就红 |
| 这 3 个在 `@walnut/ui` 里有替代吗？ | 有，一一对应 | `packages/platform-web/ui/src/{DynamicTags,Switch,TimePicker}/index.ts` 均存在 |
| `Base:Switch` 到底多少处？ | **63** 个 schema 使用点 / 18 个文件（"73"的口径需澄清，见 §1.7） | `grep "type: 'Base:Switch'"` = 63；裸字符串 65；全仓含文档 86 |
| 为什么 `tsc` 和 `vite build` 都看不见？ | 插值动态 import 对类型系统不可见、对 bundler 是运行时查表 | 见 §1.6；实测 `globSync` 对不存在目录返回 `[]` 不抛错 |
| admin 能跑测试吗？ | **不能，一个 runner 都没有**（根与 admin 均无 vitest 二进制） | `node_modules/.bin/vitest` 与 `apps/admin/node_modules/.bin/vitest` 均不存在；只有 client / server / tooling 各装 4.1.2 |
| 最小断言方案 | **静态路径校验**（纯 Node，19ms，30 key 全覆盖）；运行时 loader 方案作为可选加强 | 两者都实测跑过，见 §2 |
| 删包的"立刻红"有几处？ | **6 处硬红**（install / 冻结 lockfile / vue-tsc / versioning 测试 / attribution 测试 / docs-refs） | 见 §3.6 |

---

## 1. 断键穷举（本轮核心产出）

### 1.1 方法：把 4 条模板串还原成绝对路径

`componentMap.ts` 位于 `apps/admin/src/components/UI/Form/src/components/FormItem/`，
四个工厂各自拼一条**插值**路径（模板里的变量由分组常量逐项代入）：

| 分组常量 | 定义行 | 模板串 | 使用行 | 还原后的绝对目录 |
|---------|-------|--------|-------|----------------|
| `BUILT_IN_FORM_ITEM_TYPE_UI` | `5-22` | 4 层 `../../../../` + key + `/index.ts` | `56` | `apps/admin/src/components/UI/<key>/index.ts` |
| `BUILT_IN_FORM_ITEM_TYPE_EXTRA` | `24-32` | 5 层 `../../../../../` + `Extra/` + key + `/index.ts` | `67` | `apps/admin/src/components/Extra/<key>/index.ts` |
| `BUILT_IN_FORM_ITEM_TYPE_BUSINESS` | `34-37` | 5 层 `../../../../../` + `Business/` + key + `/index.ts` | `78` | `apps/admin/src/components/Business/<key>/index.ts` |
| `BUILT_IN_FORM_ITEM_TYPE_EXTEND` | `39-42` | `../Extend/` + key + `/index.ts` | `89` | `.../Form/src/components/Extend/<key>/index.ts` |

> **层数不同的原因**（最容易抄错的地方）：EXTRA / BUSINESS 多一层 `../`，因为它们要从
> `UI/` 跳到 `components/` 顶层；EXTEND 在 Form 内部，所以只有 `../Extend/`。

另有 3 条**写死**的条目（不在分组常量里），同样按 5 层 `../../../../../` 解析：

| key | 声明行 | 还原路径 |
|-----|-------|---------|
| `RoleSelect` | `127-132` | `apps/admin/src/components/Advanced/RoleSelect/index`（无 `.ts` 后缀） |
| `Tinymce` | `133-138` | `apps/admin/src/components/Vendor/Tinymce/index` |
| `JSONEditor` | `139-144` | `apps/admin/src/components/Vendor/JSONEditor/index` |

再加 3 个**非动态**条目（直接引用 naive-ui 组件对象，与"断键"无关）：
`componentMap.set('Slider', NSlider)` / `'DynamicInput', NDynamicInput` / `'InputOtp', NInputOtp`
（`componentMap.ts:123-125`）。**Map 最终 size = 27 + 3 + 3 = 33**（§2 实测输出 `MAP_SIZE=33` 印证）。

### 1.2 全量 30 个动态 key 逐项核对

判据：把还原路径按 `path.resolve(componentMap.ts 所在目录, 路径)` 求绝对路径后 `fs.existsSync`；
"ui 同名实现"判据：`packages/platform-web/ui/src/<key>/index.ts`。

| # | 分组 | key | 解析到的路径（repo 相对） | 存在 | @walnut/ui 同名 |
|---|------|-----|--------------------------|:----:|:-------------:|
| 1 | UI | Button | apps/admin/src/components/UI/Button/index.ts | ✅ | — |
| 2 | UI | ButtonConfirm | apps/admin/src/components/UI/ButtonConfirm/index.ts | ✅ | — |
| 3 | UI | ButtonGroup | apps/admin/src/components/UI/ButtonGroup/index.ts | ✅ | — |
| 4 | UI | ButtonRetry | apps/admin/src/components/UI/ButtonRetry/index.ts | ✅ | — |
| 5 | UI | Checkbox | apps/admin/src/components/UI/Checkbox/index.ts | ✅ | — |
| 6 | UI | ColorPicker | apps/admin/src/components/UI/ColorPicker/index.ts | ✅ | — |
| 7 | UI | DatePicker | apps/admin/src/components/UI/DatePicker/index.ts | ✅ | — |
| 8 | UI | **DynamicTags** | apps/admin/src/components/UI/DynamicTags/index.ts | ❌ | ✅ |
| 9 | UI | Input | apps/admin/src/components/UI/Input/index.ts | ✅ | — |
| 10 | UI | InputNumber | apps/admin/src/components/UI/InputNumber/index.ts | ✅ | — |
| 11 | UI | Radio | apps/admin/src/components/UI/Radio/index.ts | ✅ | — |
| 12 | UI | Select | apps/admin/src/components/UI/Select/index.ts | ✅ | — |
| 13 | UI | **Switch** | apps/admin/src/components/UI/Switch/index.ts | ❌ | ✅ |
| 14 | UI | **TimePicker** | apps/admin/src/components/UI/TimePicker/index.ts | ❌ | ✅ |
| 15 | UI | Tree | apps/admin/src/components/UI/Tree/index.ts | ✅ | — |
| 16 | UI | TreeSelect | apps/admin/src/components/UI/TreeSelect/index.ts | ✅ | — |
| 17 | EXTRA | EmailInput | apps/admin/src/components/Extra/EmailInput/index.ts | ✅ | — |
| 18 | EXTRA | IconPicker | apps/admin/src/components/Extra/IconPicker/index.ts | ✅ | — |
| 19 | EXTRA | LocaleSelect | apps/admin/src/components/Extra/LocaleSelect/index.ts | ✅ | — |
| 20 | EXTRA | Password | apps/admin/src/components/Extra/Password/index.ts | ✅ | — |
| 21 | EXTRA | PhoneNumberInput | apps/admin/src/components/Extra/PhoneNumberInput/index.ts | ✅ | — |
| 22 | EXTRA | VerifyCode | apps/admin/src/components/Extra/VerifyCode/index.ts | ✅ | — |
| 23 | EXTRA | TransitionSelect | apps/admin/src/components/Extra/TransitionSelect/index.ts | ✅ | — |
| 24 | BUSINESS | AreaCascader | apps/admin/src/components/Business/AreaCascader/index.ts | ✅ | — |
| 25 | BUSINESS | Dict | apps/admin/src/components/Business/Dict/index.ts | ✅ | — |
| 26 | EXTEND | Query | .../Form/src/components/Extend/Query/index.ts | ✅ | — |
| 27 | EXTEND | Divider | .../Form/src/components/Extend/Divider/index.ts | ✅ | — |
| 28 | STANDALONE | RoleSelect | apps/admin/src/components/Advanced/RoleSelect/index(.ts) | ✅ | — |
| 29 | STANDALONE | Tinymce | apps/admin/src/components/Vendor/Tinymce/index(.ts) | ✅ | — |
| 30 | STANDALONE | JSONEditor | apps/admin/src/components/Vendor/JSONEditor/index(.ts) | ✅ | — |

**结论：27 / 30 通，3 / 30 断；3 个断键全部集中在 UI 分组，且全部在 `@walnut/ui` 有同名实现。**

### 1.3 第二类"断"：schema key 与 map key 的差集（比悬空 import 更隐蔽）

`componentMap.get(item.type.split(':')[1])`（`Form/src/utils/index.ts:53-55`）意味着：
schema 里出现的 `Base:X` 必须在 map 里有 key `X`；否则 `getTargetComponent` 返回 `undefined`，
`<component :is>`（`Form/src/components/FormItem/index.vue:70-76`）**静默不渲染** ——
不报错、不占位，整行表单控件直接消失。这类"断"比悬空 import 更难发现（后者至少会抛一次）。

三份清单互相对账（20 个 `types.ts` 声明的 schema key × 20 个实际使用 key × 33 个 map key）：

| 对账 | 结果 | 判定 |
|------|------|------|
| `types.ts` 声明了 `Base:*` 但 map 无 key | 仅 `Base:Render` / `Base:Slot` | **不是缺陷** —— 走 `FormItem/index.vue:68-69` 的 `v-if` 分支（`FormItemRender` / `<slot>`），不进 map |
| 实际使用但 `types.ts` 未声明 | **0** | 干净 |
| 使用了 `Base:*` 但 map 缺 key | **0**（除上一条 v-if 分支） | 干净 |
| map 有 key、**无任何 schema 使用** | **15 个**：Slider / DynamicInput / InputOtp / RoleSelect / Tinymce / JSONEditor / EmailInput / IconPicker / LocaleSelect / Password / PhoneNumberInput / VerifyCode / TransitionSelect / Query / Divider | 反向冗余，见下 |

> **这 15 个要分两类，别一刀切删**：
> - `Query` / `Divider` 由 `Form/src/index.vue:49-51` 用**静态** import 直接挂载，
>   map 里的条目是历史残留 —— 删掉不会红，但**不是本轮 P0**；
> - 其余 13 个（`Slider` / `EmailInput` / `RoleSelect` …）是"预留给未来 schema 类型"的条目，删了等价于砍能力面。

**顺带的第三个发现（目录与清单的双向漂移）**：`apps/admin/src/components/UI` 下 22 个目录，
分组常量只覆盖 16 个（其中 3 个目录已不存在），另外 **9 个目录不在任何清单里**：
Card / Descriptions / Drawer / Dropdown / Form / Icon / IconButton / Modal / Table。
不是 bug（它们本来就不作为表单 schema 项），但它证明
「目录名 == 组件名」这个约定**从未被机械校验过** —— 否则 22 vs 16 的差集早该被人问起。

### 1.4 唯一性论证：为什么"还有没有别的断的"答案是"没有"

把 `apps/admin` 下所有 `import( ... )` 与 `require( ... )` 全扫一遍（**52 处**），按**是否可静态解析**分类：

| 形态 | 数量 | 例 | 缺文件时的后果 |
|------|-----:|-----|--------------|
| 静态相对字面量 | **48** | `components/App/AppLock/index.ts:3` 的 `import('./index.vue')`；`router/routes/mainout.ts:61` | **构建期**报错（Vite/Rollup 静态分析） |
| **插值（模板字符串）** | **4** | `componentMap.ts:56,67,78,89` | **运行期**才失败（glob 查表未命中） |
| `globSync` 目录扫描 | 2 | `build/vite/plugin/component.ts:9,13` | 目录不存在 ⇒ 返回 `[]`，**不抛错**（实测） |
| `import.meta.glob` | 2 | `router/utils/route.ts:38`、`views/system/menu/utils.ts:26` | 静态 glob，缺文件不报错，但也不会被引用 |

**结论：全 app 只有 `componentMap.ts` 这 4 处是"目录名拼路径"的插值动态 import。**
所以"除这 3 个之外还有没有别的断的"= **没有**，且这是**结构决定**的，不是巧合：
其余 40 处静态 import 一旦目标消失，构建立刻红。

实测佐证（`tinyglobby`，在 `apps/admin` 下跑）：

```
OK  ../../packages/platform-web/ui/src/*/index.ts     => [".../DynamicTags/index.ts",".../Switch/index.ts",".../TimePicker/index.ts"]
OK  ../../packages/platform-web/NOPE/src/*/index.ts   => []          ← 不抛错
```

这条同时说明两件事：删包后 `component.ts:13` 不会炸；但它会**静默**失去 3 个组件名。

### 1.5 两条独立通路：模板 `<WSwitch>` 与表单 `Base:Switch` 走的不是一条路

| | 通路 A：模板 `<WXxx>` | 通路 B：表单 schema `Base:Xxx` |
|---|---|---|
| 谁解析 | `unplugin-vue-components` + `WalnutAdminComponentResolver`（**构建期**） | `componentMap` + `getTargetComponent`（**运行期**） |
| 来源 | `globSync("src/components/**/**/index.ts")`（`plugin/component.ts:9`），**再被** `globSync("../../packages/platform-web/ui/src/*/index.ts")` **覆盖**（`:13-18`） | 4 条插值 import（`componentMap.ts:56,67,78,89`） |
| 解析规则 | `W` 前缀 → 去掉 W 查 map（`:22-29`） | `componentMap.get(type.split(':')[1])` |
| 3 个组件当前指向 | **`@walnut/ui/<Name>`**（ui glob 覆盖了 admin 的同名项；admin 那 3 个目录已不存在） | **`apps/admin/src/components/UI/<Name>/index.ts`** ← 悬空 |
| 谁在用 | 全仓只有 `<WDynamicTags>`：1 个文件 2 处（`views/demo/UI/DynamicTags.vue:27,29`）；`<WSwitch>` / `<WTimePicker>` **0 处** | `Base:Switch` 63 处 / 18 文件；`Base:TimePicker` 1 处；`Base:DynamicTags` 1 处 |
| 生成物佐证 | `apps/admin/types/generated/components.d.ts`（**tracked**，348 行）只登记 `WDynamicTags`（`:143,312`），**没有** `WSwitch` / `WTimePicker` | — |

**这张表解释三件事**：
1. 为什么 `components.d.ts` 里没有 `WSwitch` —— 插件只登记**模板里真用过**的组件；
2. 为什么"构建绿"：通路 A 完好（ui glob 命中），通路 B 只在**渲染到** `Base:Switch` 时才抛；
3. 为什么修法有两条（改 map 指向 `@walnut/ui` / 删 3 个 schema 类型），而**删包会同时动两条通路**。

### 1.6 为什么 `tsc` 与 `vite build` 都看不见

- **类型系统**：`import(`...`变量`...`)` 的模块说明符不是字面量 ⇒ TS 拿不到可解析模块 ⇒
  对这 4 行**不做存在性检查**（也不报"找不到模块"）。`vue-tsc --noEmit` 因此全绿。
- **bundler**：`@rollup/plugin-dynamic-import-vars` 把 `../../../../*/index.ts` 展开成一张 glob 表；
  表里没有的 key 不在构建期报错，而是运行期抛 `Unknown variable dynamic import: ...`。
- 既有文档已实测过这一点（`plans/package-sinking-proposal.md:137-141`：build 退出码 0，但产物 componentMap 只有 21 条 UI 条目）。
  **本轮用 vitest 复现了同一条错误消息**（§2.2：`Switch :: Unknown variable dynamic import: ../../../../Switch/index.ts`）。

### 1.7 影响面量化（以及"73"这个数字的口径问题）

| 口径 | 数字 | 命令 |
|------|-----:|------|
| `type: 'Base:Switch'`（真实 schema 使用点） | **63** | `grep -rn "type: 'Base:Switch'" apps/admin/src \| wc -l` |
| 使用 `Base:Switch` 的**文件数** | **18** | 同上，去重路径前缀 |
| `apps/admin/src` 内 `Base:Switch` 裸字符串 | 65（63 使用点 + `Form/src/types.ts:293` map key + `:475` type alias） | `grep -ro "Base:Switch" apps/admin/src \| wc -l` |
| 全仓含文档 | 86 | 再加 `apps/docs/**` 的说明文字 |

**"73" 在本轮口径下复现不出来**。最接近的解释是"63 使用点 + 其它文件里的类型与文档引用"，
但 63 是可复核的**使用点**数（命令在上表）。**建议后续统一用"63 处 / 18 个文件"**，否则回归验收没法对账。

**受影响的功能面（按用户可感知程度排序）**：

| 功能面 | 文件数 | 文件 |
|--------|------:|------|
| 开发者设置面板 | 8 | `components/Global/DevSettings/{app,breadcrumb,footer,header,logo,menu,tab}.vue`（themes.vue 用 `Base:Render`） |
| 表单 demo | 5 | `views/demo/form/{baseForm,dialogForm,dividerForm,dynamicForm,queryForm}.vue` |
| 我的 → 偏好设置 | 3 | `views/me/tabs/preference/{accessibility,layout,theme}.vue` |
| 其它 demo | 2 | `views/demo/UI/{Drawer,Modal}.vue`、`views/demo/vendor/OSSUpload/index.vue` |

`Base:TimePicker`（1 处）与 `Base:DynamicTags`（1 处）都只在 `views/demo/form/baseForm.vue` ——
即用户可见面里 **Switch 是唯一的现实功能损失**，另两个只影响 demo 页。

---

## 2. 「运行时断言」的具体写法（含实测）

### 2.1 三档方案，推荐顺序与理由

| 档 | 做法 | 能防什么 | 成本 | 建议 |
|----|------|---------|------|------|
| **① 根治（不是断言，是消除）** | 把 `componentMap.ts:56,67,78,89` 的 4 条插值 import 换成**显式静态 import**（33 条 entry 逐个 `import Xxx from '@/components/...'`）—— 即既定决策 D1 的"显式注册表" | 目标文件消失 ⇒ **`vue-tsc` 编译期红**；不依赖任何测试 runner | 改 1 个文件 ~60 行 + 3 个 schema 类型的去留决策 | **首选**。断言的价值上限就是"把运行期错变成编译期错"，静态 import 直接到顶 |
| **② 兜底断言（保留插值时才需要）** | 一个**纯 Node** spec：解析 `componentMap.ts` 源码 → 还原 30 条路径 → 逐条 `fs.existsSync` | 目录被搬走 / 改名 / 漏建（含**未来**任何新加的 key） | ~45 行 spec，**19ms**，零 mock、零 DOM、零 Vue | 推荐；若走 ①，它仍值得留作"注册表与目录一致性"的看门狗 |
| **③ 真运行时断言** | `import { componentMap }` 真模块 → 取每条 `__asyncLoader()` → `await` 看是否 reject | 同 ②，但连"组件能否被 Vite 解析/装载"一起验 | 需 jsdom + vue-jsx 插件 + `virtual:icon/list` 假模块 + pinia/env 上下文，30 行 config + 50 行 stub，且随组件演化腐烂 | **不作为门禁**；只在手工排查时用 |

> 一句话：**能用静态 import 解决的，不要用测试去兜。** ①做完之后 ② 的价值下降为"防注册表与目录再次漂移"，
> ③ 只在你想确认"这条链路端到端能跑"时用。

### 2.2 实测 B（③ 真运行时断言）：跑过、能看到真实错误消息、但噪声大

**探针位置**：`apps/admin/node_modules/.cm-probe/`（gitignored，跑完已删）。
**为什么放这里而不是 `$env:TEMP`**：``@vitejs/plugin-vue` 必须能从探针目录向上解析到
`apps/admin/node_modules`；放 TEMP 时它解析不到（第一版就是这么失败的，见 §2.5）。

**config**（`vitest.config.mjs`，plain object——**不能** import vitest/config，见 §2.5）：

```js
import vue from '@vitejs/plugin-vue'
const REPO = 'D:/walnut-admin/walnut-admin'
export default {
  plugins: [vue()],
  resolve: { alias: { '@': REPO + '/apps/admin/src', '~': REPO + '/apps/admin/types' } },
  server: { fs: { allow: [REPO] } },
  test: { root: import.meta.dirname, include: ['*.spec.ts'], environment: 'node' },
}
```

**spec 核心**（遍历 map，解出 Vue 的 `__asyncLoader` 并 await）：

```js
for (const [key, comp] of componentMap.entries()) {
  const loader = comp?.__asyncLoader
  if (typeof loader !== 'function') { sync.push(key); continue }
  try { await loader(); ok.push(key) } catch (e) { broken.push(key + ' :: ' + e.message) }
}
```

**命令**（PowerShell 禁 .ps1，必须走 cmd）：

```powershell
cmd /c "cd /d D:walnut-adminwalnut-adminappsadmin
ode_modules.cm-probe && node D:/walnut-admin/walnut-admin/packages/platform-web/client/node_modules/vitest/vitest.mjs run --config vitest.config.mjs"
```

**实际输出（节选，vitest 4.1.2）**：

```
MAP_SIZE=33
OK_COUNT=14 :: Button,ButtonConfirm,ButtonGroup,ColorPicker,DatePicker,Input,InputNumber,TreeSelect,EmailInput,Password,VerifyCode,TransitionSelect,Tinymce,JSONEditor
SYNC_COUNT=3 :: Slider,DynamicInput,InputOtp
BROKEN_COUNT=16
  BROKEN ButtonRetry :: localStorage is not defined
  BROKEN Checkbox :: Failed to parse source for import analysis ...
  BROKEN DynamicTags :: Unknown variable dynamic import: ../../../../DynamicTags/index.ts
  BROKEN Radio :: Failed to parse source for import analysis ...
  BROKEN Select :: Failed to parse source for import analysis ...
  BROKEN Switch :: Unknown variable dynamic import: ../../../../Switch/index.ts
  BROKEN TimePicker :: Unknown variable dynamic import: ../../../../TimePicker/index.ts
  BROKEN Tree :: Failed to parse source for import analysis ...
  BROKEN IconPicker :: Cannot find package 'virtual:icon/list' ...
  BROKEN LocaleSelect :: localStorage is not defined
  BROKEN PhoneNumberInput :: localStorage is not defined
  BROKEN AreaCascader :: Cannot read properties of undefined (reading '0')
  BROKEN Dict :: Cannot read properties of undefined (reading '0')
  BROKEN Query :: localStorage is not defined
  BROKEN Divider :: localStorage is not defined
  BROKEN RoleSelect :: Cannot read properties of undefined (reading '0')
```

**16 个 broken 的分类（这是本档方案最贵的部分）**：

| 类 | 个数 | key | 根因 | 要补什么 |
|----|-----:|-----|------|---------|
| **真断** | **3** | DynamicTags / Switch / TimePicker | 目标文件不存在 | 就是本轮要修的 |
| 缺 DOM | 5 | ButtonRetry / LocaleSelect / PhoneNumberInput / Query / Divider | 模块作用域读 `localStorage`（例：`hooks/component/useCountdown.ts` 的存储 composable） | `environment: 'jsdom'` 或手写 `localStorage` stub |
| 缺 JSX 插件 | 4 | Checkbox / Radio / Select / Tree | 它们 import `@/components/HOC/WithValue` → `WithValue.tsx`（JSX） | 加 `@vitejs/plugin-vue-jsx` |
| 缺应用虚拟模块 | 1 | IconPicker | `virtual:icon/list` 由 admin 自己的 Vite 插件提供 | 手写假模块（`resolveId/load`） |
| 缺应用组合根 | 3 | AreaCascader / Dict / RoleSelect | 模块作用域取 pinia store / env（报 `reading '0'`） | `setActivePinia(createPinia())` + 相关 store 初始化 |

**结论**：③ 作为"一次性排查工具"很好用（它复现了与生产一致的
`Unknown variable dynamic import` 消息，这是本轮最硬的证据），但作为**门禁**不合格 ——
它把 13 个与被测目标无关的环境缺失混进了失败信号里。

> 另一个坑：**第一版没装 vue 插件时，24 个真实存在的 key 全部报错**
> （`Failed to parse source ... Install @vitejs/plugin-vue to handle .vue files`），
> 也就是说 ③ 的输出**强依赖探针配置是否完整** —— 配置漂移会让它变成"永远红"或"假绿"。

### 2.3 实测 A（② 静态路径校验）：**19ms，30 key，恰好 3 断**

**spec**（不 import 任何业务模块；只读源码 + `fs`）：

```ts
import fs from 'node:fs'
import path from 'node:path'

const REPO = 'D:/walnut-admin/walnut-admin'
const CM = path.join(REPO, 'apps/admin/src/components/UI/Form/src/components/FormItem/componentMap.ts')
const DIR = path.dirname(CM)

function keysOf(src: string, name: string): string[] {
  const m = src.match(new RegExp('const ' + name + ' = \[([\s\S]*?)\] as const'))
  if (!m) throw new Error('array not found: ' + name)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

const src = fs.readFileSync(CM, 'utf8')
const groups = [
  ['UI',       'BUILT_IN_FORM_ITEM_TYPE_UI',       '../../../../@KEY@/index.ts'],
  ['EXTRA',    'BUILT_IN_FORM_ITEM_TYPE_EXTRA',    '../../../../../Extra/@KEY@/index.ts'],
  ['BUSINESS', 'BUILT_IN_FORM_ITEM_TYPE_BUSINESS', '../../../../../Business/@KEY@/index.ts'],
  ['EXTEND',   'BUILT_IN_FORM_ITEM_TYPE_EXTEND',   '../Extend/@KEY@/index.ts'],
] as const

const rows = groups.flatMap(([group, constName, tpl]) =>
  keysOf(src, constName).map((key) => {
    const abs = path.resolve(DIR, tpl.replace('@KEY@', key))
    return { group, key, abs, exists: fs.existsSync(abs) }
  }))

// 3 条写死条目
for (const m of src.matchAll(/componentMap.set(s*'([A-Za-z0-9]+)'[sS]*?import('([^']+)')/g)) {
  const abs = path.resolve(DIR, m[2])
  rows.push({ group: 'STANDALONE', key: m[1], abs, exists: fs.existsSync(abs) || fs.existsSync(abs + '.ts') })
}

it('every dynamic import target exists', () => {
  const broken = rows.filter((r) => !r.exists).map((r) => r.group + ':' + r.key)
  expect(broken).toEqual([])
})
```

**命令与输出**：

```powershell
cmd /c "cd /d D:walnut-adminwalnut-adminappsadmin
ode_modules.cm-probe && node D:/walnut-admin/walnut-admin/packages/platform-web/client/node_modules/vitest/vitest.mjs run --config vitest.static.config.mjs"
```

```
TOTAL_KEYS_CHECKED=30
  UI Button exists=true
  ...
  UI DynamicTags exists=false
  ...
  UI Switch exists=false
  UI TimePicker exists=false
  ...
BROKEN_COUNT=3
BROKEN=[
  "UI:DynamicTags -> apps\admin\src\components\UI\DynamicTags\index.ts",
  "UI:Switch -> apps\admin\src\components\UI\Switch\index.ts",
  "UI:TimePicker -> apps\admin\src\components\UI\TimePicker\index.ts"
]
 ❯ static.spec.ts (2 tests | 1 failed) 19ms
      Tests  1 failed | 1 passed (2)
   Duration  1.20s (transform 87ms, import 200ms, tests 19ms, environment 0ms)
```

**这就是推荐的门禁形态**：30 个 key 全覆盖、失败的恰好是那 3 个、19ms、零环境依赖。

### 2.4 落地建议（放哪、要不要 mock、怎么接门禁）

**mock 问题，分档回答**：

| 方案 | 要不要 mock | 说明 |
|------|------------|------|
| ② 静态 | **完全不需要** | spec 不 import `componentMap`，也不 import vue / naive-ui / `@/utils/factory/asyncComponent`。只读源码文本 + `fs.existsSync` |
| ③ 运行时 | **不能 mock `componentMap` 与 `asyncComponent`**（那样测的是 mock），只能**补环境** | 见 §2.2 的 5 类补齐；其中 `localStorage` 与 pinia 是 stub，`virtual:icon/list` 是假模块，vue-jsx 是插件 |

**放哪（两个选项，取决于要不要给 admin 引入 runner）**：

| 选项 | 落点 | 改动 | 优点 | 缺点 |
|------|------|------|------|------|
| **(a) 给 admin 加 vitest** | `apps/admin/vitest.config.ts` + `componentMap.spec.ts`（与被测文件同目录）+ `package.json` 的 `test` 脚本 + devDeps 两行（`vitest` `catalog:`、`@walnut/vitest-config` `workspace:*`） | 4 个文件 / 2 行依赖 | admin 从此有回归网；`turbo run test` 自动覆盖；预设直接复用 `defineWalnutVitestConfig({ environment: 'node' })`（client 就这么用，见 `packages/platform-web/client/vitest.config.ts`） | 给 admin 新增一个依赖与一条 CI 时间 |
| **(b) 不引入 runner，做成门禁脚本** | `packages/tooling/scripts/src/ci/check-form-components.ts` + `bin/walnut-check-form-components.ts` + 根 `package.json` 一行 script + `prepush.ts` 一段 | 4 个文件 | 与仓库现有范式完全一致（`lint:docs-refs` / `lint:adr` / `lint:turbo-cache` 都是这个形态）；零新依赖 | 断言与实现代码隔了一个包，改起来不如同目录 spec 顺 |

**推荐**：先做 ① 的显式注册表（根治），同时落 **(b)** 作为看门狗（零新依赖、与仓库门禁范式一致）。
若 lead 希望 admin 长期有测试能力，则改 (a) —— 两者不冲突，②的 spec 内容可以原样搬过去。

**加进 admin 后的确切命令形态**（Windows 必须走 cmd）：

```powershell
cmd /c "pnpm --filter @walnut/admin run test"        # 或 cmd /c "pnpm -C apps/admin test"
cmd /c "pnpm exec turbo run test --filter=@walnut/admin"
```

**接门禁**：`prepush.ts` 的段是一张表（`id` / `label` / `argv` / `why`），共 **23 段**
（共 **23 段**，`prepush.ts` 内 `id:` 计数）。
加一段 `id: 'form-components'` 即可；CI 侧若走 `pnpm build:admin` 已能覆盖"静态 import 缺文件"那一类，
但覆盖不了本轮的"插值悬空"，所以门禁脚本仍建议独立存在。

### 2.5 两次失败尝试（写下来省下一轮）

1. **config 放 `$env:TEMP` 且 `import { defineConfig } from 'vitest/config'`** ⇒
   `ERR_MODULE_NOT_FOUND: Cannot find package 'vitest' imported from .../vitest.config.mts.timestamp-*.mjs`。
   原因：config 由 Node 直接 ESM 加载，TEMP 下没有 node_modules 可达。**解法**：config 用 plain object 导出，不 import 任何东西。
2. **探针目录在 TEMP、spec 用 `@/...` 别名 import 仓库文件** ⇒ 第一次能跑，
   但把 vue 插件换成"从 admin node_modules 绝对路径 import"很脆。**解法**：探针目录放到
   `apps/admin/node_modules/.cm-probe`，让 Node 向上解析到 admin 的依赖。
3. **没装 vue 插件就跑 ③** ⇒ 24 个真实存在的 key 全报
   `Failed to parse source ... Install @vitejs/plugin-vue`，**看起来像 27 个断键**。这是"探针配置决定结论"的典型陷阱。

---

## 3. 删 `@walnut/ui` 的连锁面（穷举，带 path:line）

### 3.1 代码面（7 处，删包必须动）

| # | 位置 | 内容 | 不动会怎样 |
|---|------|------|-----------|
| 1 | `apps/admin/src/components/UI/Form/src/types.ts:6,7,9` | 3 条 `import type ... from '@walnut/ui/{DynamicTags,Switch,TimePicker}'` | **`vue-tsc` 红**（Cannot find module） |
| 2 | 同上 `:288,293,294` | schema 类型映射表 3 个 key（`'Base:DynamicTags' / 'Base:Switch' / 'Base:TimePicker'`） | 保留则类型引用悬空；删则 63 处使用点全部失去类型 |
| 3 | 同上 `:470,475,476` + `:526,531,532` | 3 个 `DynamicSchemaItemProps<'Base:X'>` 别名 + 3 个 union 成员 | 同上，必须与 #2 同步 |
| 4 | `apps/admin/src/components/UI/Form/src/components/FormItem/componentMap.ts:13,19,56` | UI 分组常量里的 `DynamicTags` / `Switch` / `TimePicker` 三项 + 那条 4 层插值模板 | 就是本轮的 P0（悬空 import） |
| 5 | `apps/admin/types/generated/components.d.ts:143,312` | `WDynamicTags: typeof import('@walnut/ui/DynamicTags')['default']`（**该文件是 tracked 的**，见 `.gitignore:33-34` 的 `!apps/admin/types/generated/components.d.ts`） | **`vue-tsc` 红**（生成物里引用了已删模块）；需跑 `predev` / `pretypes:check` 重生成 |
| 6 | `apps/admin/src/views/demo/UI/DynamicTags.vue:27,29` | 全仓**唯一**的 `<WDynamicTags>` 模板使用（2 处） | 删包后 resolver 不再解析 `WDynamicTags` ⇒ 该 demo 页渲染成空标签 |
| 7 | `apps/admin/package.json:72` | `"@walnut/ui": "workspace:*"` | **`pnpm install` 直接失败**（workspace 包不存在） |

> 附带：#5 的 3 个 `W*` 条目里只有 `WDynamicTags` 存在（`WSwitch` / `WTimePicker` 计数为 **0**），
> 这正是 §1.5 通路 A 的独立佐证。

### 3.2 构建 / 工具链面（5 处，3 处要改 2 处不用）

| # | 位置 | 内容 | 要不要改 |
|---|------|------|---------|
| 8 | `apps/admin/build/vite/plugin/component.ts:12-18` | `globSync('../../packages/platform-web/ui/src/*/index.ts')` + 用它覆盖 `componentMap` | **要改**：整段删掉（否则每次构建都白扫一个不存在的目录；删除**不会炸** —— glob 返回 `[]`，见 §1.4） |
| 9 | `knip.config.ts` | **本来就没有** `packages/platform-web/ui` 的 workspace 条目（只有 `:112` client、`:115` http） | **不用改**（顺带指出：这是 knip 配置里 platform-web 唯一漏登的包，删了正好抹平） |
| 10 | `packages/platform-web/ui/turbo.json` | `tags: ["shared","platform-web"]` | **随包删**。根 `turbo.json` 的 `boundaries` 只按 tag 判定（`platform-any` 禁 `platform-web`、`backend` 禁 `platform-web`），client / http 仍带该 tag ⇒ **根 turbo.json 不用改** |
| 11 | `packages/tooling/eslint-config/nest.ts:64-75` | `no-restricted-imports` 只禁 `@walnut/client` 与 `@walnut/http`，**没有** `@walnut/ui`（ADR 0017:493 曾提议补，一直没实现） | **不用改**（删包后这条缺口自动消失；但若将来重建 ui 包，这条要一起补） |
| 12 | `packages/platform-web/ui/{eslint.config.ts,tsconfig.json,package.json,turbo.json}` + `src/**` | 13 个 tracked 文件（`git ls-files packages/platform-web/ui \| wc -l` = 13） | **随包删**。注意 `monorepo/eslint.md:47` 有"`packages/platform-web/ui` 是唯一一个有本地 eslint 配置的包"这句，删后要改 |

### 3.3 发布 / 版本面（5 处，3 处会立刻红）

| # | 位置 | 内容 | 后果 |
|---|------|------|------|
| 13 | `pnpm-workspace.yaml:113`（fixed 组见 `:102-120`） | 组成员 `'@walnut/ui'` | **不改 ⇒ `versioning-config.test.ts:19-25` 红**（断言"组成员数 == 有 version 的 workspace 包数，且两个集合逐名相等"） |
| 14 | `packages/tooling/release/src/release/attribution.ts:49` | `'ui': '@walnut/ui'` | **不改 ⇒ `attribution.test.ts:33-39` 红**（断言"表里每个值都是真实存在的 workspace 包（没有幽灵包名）"） |
| 15 | `packages/tooling/commitlint-config/index.ts:14` | `'ui'` scope | 可保留（只是白名单字符串）。对齐建议删；注意 `attribution.test.ts:49` 断言 `SCOPE_TO_PACKAGE` 的 key ⊆ 该白名单 —— 两边同时删最干净 |
| 16 | `pnpm-lock.yaml:1035,1037,1937` | importer `'@walnut/ui': link:../../packages/platform-web/ui` + `packages/platform-web/ui:` 段 | **不跑 `pnpm install` 重生成 ⇒ CI 红**：`ci.yml:42 / :248 / :353` 都是 `pnpm install --frozen-lockfile` |
| 17 | `.changeset/ledger.yaml:392-399` | `"@walnut/ui@0.1.0": { dir: packages/platform-web/ui, intents: [...] }` | 发版台账条目。**未找到机械校验它的代码**（`packages/**` 下无 ledger 读取器命中），属"记账清理"，不红 |

> `.changeset/.release-state.json` 只有版本/分支/步骤字段（无逐包清单），**不用改**。

### 3.4 文档面（14 个活文档，删包后 `lint:docs-refs` 会红）

校验规则在 `packages/tooling/scripts/src/ci/check-doc-refs.ts`：

- `:33` `FROZEN = /content\/(archive|industry-research)\//` —— **冻结语料不扫**（此类共 8 个文档提到 `@walnut/ui`，全部安全）；
- `:46` `PATH_CHECK_EXCLUDED = /content\/adr\/|architecture-todo\.md$/` —— **只豁免"路径"检查**，**包名照样查**；
- `:121` `liveDocs() = lsFilesWithUntracked('*.md').filter(非冻结)` —— 扫的是**全仓所有 tracked md**；
- `:389` 判定 `realPackages.has(ref) || ref in ALLOWED_MISSING_PACKAGES`。

**删包后仍会引用 `@walnut/ui` 的活文档（14 个）**：

| 文档 | 出现次数 | 性质 | 建议 |
|------|--------:|------|------|
| `apps/docs/.../adr/0017-package-reorganization.md` | 11 | 历史决策记录 | ADR 不可改写 ⇒ 进 `ALLOWED_MISSING_PACKAGES` 豁免（有先例：`'@walnut/ai': '已删除的空壳包'`） |
| `apps/docs/.../plans/package-sinking-proposal.md` | 16 | 已完成/已决策的提案 | 提案页可加"已执行（D1）"注记；引用仍需豁免 |
| `apps/docs/.../adr/0012-toolchain-divergence.md` | 2 | 历史决策记录（tags 表） | 同上 |
| `apps/docs/.../monorepo/architecture-todo.md` | 7 | **现状描述**（"`@walnut/ui` 剩余组件"待办项） | **必须改写**：此项随包删除而关闭 |
| `apps/docs/.../monorepo/architecture.md` | 5 | **现状描述**（放哪张表 / 依赖图 / 包职责表 / 目录树 / README 链接） | **必须改写** |
| `apps/docs/.../monorepo/glossary.md` | 2 | **现状描述**（术语表"目前只有 3 个"） | **必须改写** |
| `apps/docs/.../monorepo/package-scripts.md` | 1 | **现状描述**（源码直消费包清单，含 vue-tsc 那句） | **必须改写** |
| `apps/docs/.../monorepo/turbo.md` | 1 | **现状描述**（tags 表） | **必须改写** |
| `apps/docs/.../monorepo/turbo-cache-boundary.md:81` | 1 | **现状描述 + 路径**（"改 `packages/platform-web/ui/src/index.ts` → 11 个"；该文件**不在** `PATH_CHECK_EXCLUDED` 里） | **必须改写**（包名与路径双红） |
| `apps/docs/.../monorepo/eslint.md:47` | 1 | **现状描述**（"唯一有本地 eslint 配置的包"） | **必须改写** |
| `apps/docs/.../frontend/base/plugin.md:18` | 1 | **现状描述**（resolver 扫 `@walnut/ui`） | **必须改写** |
| `packages/platform-web/client/README.md` | 2 | **现状描述**（边界段"组件进 `@walnut/ui`" / 依赖段） | **必须改写** |
| `README.md`（仓库根） | 1 | **现状描述**（目录树 `ui/ @walnut/ui`） | **必须改写** |
| `apps/admin/CHANGELOG.md` | 1 | 历史发版记录 | 进 `ALLOWED_MISSING_PACKAGES` 豁免 |

（另有 `packages/platform-web/ui/README.md` 5 处、`.../CHANGELOG.md` 2 处随包删除，不计入。）

**两条备选处置**（需 lead 拍板，见 §3.7）：
- **A. 全面修引用**：10 个"现状描述"文档改写 + 4 个历史类文档（ADR 0012/0017、提案页、admin CHANGELOG）进豁免清单。
- **B. 全部豁免**：把 `@walnut/ui` 加进 `ALLOWED_MISSING_PACKAGES`（1 行 + 理由），文档全部不动。
  —— 便宜，但**违背该清单自己的注释**（`check-doc-refs.ts:17-18`："清单变长本身就是信号（说明有人开始往门禁里塞豁免而不是修引用）"）。
  推荐 **A**（现状描述必须跟上现实，历史文档可豁免）。

### 3.5 建议的删除顺序（12 步，前 7 步在同一个提交里）

| 步 | 动作 | 为什么这个顺序 |
|---|------|--------------|
| 1 | 用**显式静态 import** 重写 `componentMap.ts:50-93` 的 4 个工厂（33 条 entry 逐个 import），或先把 3 个 key 指向 `@walnut/ui/<Name>` | 先把"运行期才炸"变"编译期就炸"，后续任何删错都会在 `vue-tsc` 立刻现形 |
| 2 | 决定 3 个 schema 类型的去留（删 or 保留但换实现） | 它决定第 1 步写成什么样 |
| 3 | 删 `Form/src/types.ts:6,7,9` 的 3 条 import，同步 `:288,293,294` / `:470,475,476` / `:526,531,532` | 与第 2 步同一个提交，否则类型检查中间态红 |
| 4 | 删 `build/vite/plugin/component.ts:12-18` 的 ui 扫描段 | 与第 3 步解耦（它只影响组件名解析） |
| 5 | 处理 `<WDynamicTags>`：`views/demo/UI/DynamicTags.vue` 整文件删（或改用 Naive 原生） | 唯一模板使用点 |
| 6 | 删 `apps/admin/package.json:72` 依赖 | 必须在删目录**之前**，否则中间态 install 失败 |
| 7 | 删 `packages/platform-web/ui/**`（13 个 tracked 文件） | 到这里代码面已无引用 |
| 8 | 改 `pnpm-workspace.yaml:113` fixed 组 + `attribution.ts:49`（+ 可选 `commitlint-config/index.ts:14`） | 三个"门禁测试"面 |
| 9 | 改 10 个"现状描述"文档（§3.4 表）+ 4 个历史类文档进豁免清单 | 文档面 |
| 10 | 跑 `pnpm -C apps/admin run pretypes:check`（或 `predev`）重生成 `components.d.ts`，确认 `WDynamicTags` 条目消失 | 它是 tracked 的，必须与代码同提交 |
| 11 | 跑 `pnpm install` 重生成 `pnpm-lock.yaml` | **本轮不允许跑**；但它是"CI 不红"的必要步骤 |
| 12 | 全绿验证：`pnpm types:check` / `pnpm lint` / `pnpm boundaries` / `pnpm test`（含 release 包）/ `pnpm lint:docs-refs` / `pnpm build:admin` | 见 §3.6 |

### 3.6 "删了立刻红"清单（6 条硬红，按红的先后排序）

| 序 | 红的位置 | 触发条件 | 修法 |
|---|---------|---------|------|
| 1 | `pnpm install` | 删了目录但没删 `apps/admin/package.json:72` 的 `workspace:*` | 第 6 步先于第 7 步 |
| 2 | CI `pnpm install --frozen-lockfile`（`ci.yml:42,248,353`） | 删了包但没重生成 `pnpm-lock.yaml` | 第 11 步 |
| 3 | `pnpm -C apps/admin run types:check`（vue-tsc） | ①`Form/src/types.ts` 3 条 import 未删；②`components.d.ts:143,312` 未重生成 | 第 3 / 第 10 步 |
| 4 | `pnpm test` → `versioning-config.test.ts` | `pnpm-workspace.yaml` fixed 组未删 | 第 8 步 |
| 5 | `pnpm test` → `attribution.test.ts` | `attribution.ts:49` 未删 | 第 8 步 |
| 6 | `pnpm lint:docs-refs`（prepush + CI） | 14 个活文档仍引用 `@walnut/ui`（或 `turbo-cache-boundary.md` 的路径） | 第 9 步 |

### 3.7 **不会**红的（澄清，避免过度施工）

| 事项 | 为什么不会红 |
|------|------------|
| 根 `turbo.json` 的 `boundaries` | 规则按 **tag** 判定（`platform-any` / `backend` 禁 `platform-web`），client/http 仍带 `platform-web` tag |
| `knip.config.ts` | 本来就没登记 ui 包（只有 client / http） |
| `packages/tooling/eslint-config/nest.ts` | 只禁 `@walnut/client` / `@walnut/http`，从未禁 `@walnut/ui` |
| `.changeset/.release-state.json` | 无逐包清单 |
| `component.ts` 的 `globSync` | 目录不存在时**返回 `[]` 不抛错**（§1.4 实测）—— 所以忘了删它也不会红，只会留下死代码 |
| `.changeset/ledger.yaml` 条目 | 未找到机械校验 ledger 与真实包的对应关系 |
| `syncpack` 段 | 配置是 `$LOCAL` + `pinVersion: workspace:*`，只要 admin 的依赖行先删掉就没有 `workspace:*` 指向幽灵包 |

---

## 4. 前置结论

1. **P0 是真的，而且不是"1 个"是"3 个"**：30 个插值动态 import 目标里恰好 3 个悬空
   （`DynamicTags` / `Switch` / `TimePicker`，全在 UI 分组），逐个 `existsSync` 有据（§1.2）。
   其余 27 个（含 3 条写死条目）**全部存在** —— "除这 3 个之外还有别的断的"这个问题的答案是**没有**，
   而且原因是结构性的：`componentMap.ts` 是全 app **唯一**的插值动态 import，另外 40 处 `import(...)` 都是静态字面量（§1.4）。

2. **失败形态是"静默"，这是它活了 4 个月的原因**：**321** 个 schema 使用点里 **63** 次是 `Base:Switch`（18 个文件）——它是全仓第 2 常用的表单项，仅次于 `Base:Input` 的 157 次。
   渲染时 `componentMap.get('Switch')` 拿到一个 loader 指向不存在的文件 ⇒ 运行期
   `Unknown variable dynamic import` ⇒ 该表单项**不渲染、不报错、不占位**。
   三道本可以拦住它的门全失效：`tsc` 看不见插值说明符、`vite build` 绿（通路 A 完好）、admin **没有任何测试 runner**（§2）。

3. **影响面：Switch 是唯一现实功能损失，TimePicker / DynamicTags 只伤 demo**。
   Switch 覆盖开发者设置面板 8 个文件 + 我的-偏好 3 个文件（用户可见）；
   TimePicker / DynamicTags 各只有 1 个使用点，都在 `views/demo/form/baseForm.vue`。
   **"73 处"这个数字本轮复现不出来**：可复核的是 **63 处 / 18 个文件**（§1.7），建议验收统一用这个口径。

4. **修的时候最容易踩的三个坑**：
   ① **4 条模板串层数不同**（UI 4 层、EXTRA/BUSINESS 5 层、EXTEND `../Extend`），改的时候顺手统一成同一个前缀会**造出新的悬空**；
   ② `Base:Render` / `Base:Slot` **不能补进 map** —— 它们走 `FormItem/index.vue:68-69` 的 `v-if` 分支，进 map 反而会破坏渲染；
   ③ 改完必须**重生成 `apps/admin/types/generated/components.d.ts`**（它是 tracked 文件，`.gitignore:33-34` 特意 !negate 过），否则 `vue-tsc` 会因为生成物里的 `@walnut/ui/DynamicTags` 而红。

5. **断言方案的优先级是"消灭 > 兜底 > 模拟"**：★首选把 4 条插值 import 换成显式静态 import（缺文件 = 编译期红，
   不依赖任何 runner）；★次选 §2.3 的静态路径校验 spec（**19ms / 30 key / 零 mock / 恰好 3 断**，实测）；
   ★不推荐把"真运行时 loader 断言"当门禁 —— 它需要补 5 类环境（DOM / JSX 插件 / 虚拟模块 / pinia / env），
   会把 **13 个与被测目标无关的失败**混进信号（§2.2 实测 16 broken 里只有 3 个是真的）。

6. **删包的连锁面比"删一个目录"大一个量级：6 条硬红**，其中 3 条是**仓库门禁测试**（versioning-config / attribution / docs-refs），
   2 条是 **install 链**（`apps/admin/package.json:72` + `pnpm-lock.yaml` 的 `--frozen-lockfile`），
   1 条是 **tsc**（Form 的 3 条类型 import + tracked 的 `components.d.ts`）。
   反过来，有 7 处**不会红**（根 turbo boundaries、knip、nest eslint 规则……），别在上面白费功夫（§3.7）。

7. **文档面是本轮最容易被低估的一块**：`pnpm lint:docs-refs` 扫**全仓所有 tracked md**（`check-doc-refs.ts:121`），
   删包后 **14 个活文档**仍引用 `@walnut/ui`；其中 **10 个是"现状描述"必须改写**，
   另 4 个（ADR 0012 / ADR 0017 / 提案页 / admin CHANGELOG）属"历史叙述"，需进豁免而不是改写。推荐：现状类改掉，历史类（ADR / CHANGELOG）进
   `ALLOWED_MISSING_PACKAGES`（有 `'@walnut/ai': '已删除的空壳包'` 的先例），
   **不要**把整个包名一免了之 —— 那正是该清单注释里反对的"往门禁里塞豁免"。
