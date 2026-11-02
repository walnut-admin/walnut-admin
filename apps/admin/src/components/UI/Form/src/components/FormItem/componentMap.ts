import type { Component } from 'vue'
import type { WForm } from '../../types'
import { NDynamicInput, NInputOtp, NSlider } from 'naive-ui'
import { createAsyncComponent } from '@/utils/factory/asyncComponent'

/**
 * 表单 schema 的组件注册表 —— **显式、逐条、模块说明符是字面量**。
 *
 * ## 为什么不再是「目录名 == 组件名」的模板串动态 import
 *
 * 2026-11 之前这里是四个工厂（`getUIComponents` / `getExtraComponents` / `getBusinessComponents` /
 * `getExtendComponents`），每条都写成 `import(`../../../../%C%key}/index.ts`)`。
 * 那种写法有两个洞，且**两道门都看不见**：
 *
 * - `tsc / vue-tsc`：说明符不是字面量 ⇒ 拿不到可解析的模块 ⇒ 不做存在性检查；
 * - `vite build`：`@rollup/plugin-dynamic-import-vars` 把它展开成一张 glob 表，
 *   表里没有的 key **构建期不报错**，到运行期才抛 `Unknown variable dynamic import`。
 *
 * 代价已经发生过一次：`Switch / DynamicTags / TimePicker` 三个组件被搬进 `@walnut/ui` 后，
 * 这里的路径仍指向 `apps/admin/src/components/UI/` ⇒ 三个 schema 类型（`Base:Switch` 用了 63 处）
 * 渲染时静默不出现，构建与类型检查全绿。
 *
 * 现在每个条目的说明符都是**字面量**：缺文件时 `vue-tsc` 立刻红、`vite build` 立刻红。
 * 保留 `import()` 而不是改成顶层 `import X from …` 是有意的 —— 仍然是**按需分包**，
 * 30 个表单项组件不会被塞进首屏 chunk（三个 naive 直挂项除外，它们本来就是同步引用）。
 *
 * ## key 名的编译期约束（2026-11 R3 补）
 *
 * 上一版的表声明成 `Record<string, ModuleLoader>`，key 没有字面量类型约束 —— 于是
 * **只把 key 写错、路径没写错**（`Swtich: () => import('@/components/UI/Switch')`）会**全绿**，
 * 而 `Base:Switch` 的 63 处 schema 又变回静默不渲染（与上面同一个故障模式）。
 * 现在每张表用 `satisfies FormItemTable`，key 的取值域是 `types.ts` 里
 * `ComponentPropPool` 的 **key 集合去掉前缀**（`Base:Switch` → `Switch`）—— 写错 key 当场红。
 * 注意 `satisfies` 保留字面量推断，所以 `register()` 看到的仍是各表的真实 key。
 *
 * ## 维护约定
 *
 * 加一个表单项组件 = ① 在 `types.ts` 的 `ComponentPropPool` 里加一行 `'Base:<Name>'`；
 * ② 在下面某张表里加一行 `<Name>: () => import('…')`。两步都漏不掉：漏 ① 时 key 不在取值域里，
 * 漏 ② 时 schema 端没有实现（`types.ts` 的类型别名会指向不存在的 key）。
 * **不要**再引入任何拼接路径的 import（`pnpm lint:dynamic-imports` 会拦 `apps/**` 下重新出现的插值 `import()`）。
 */

/** 懒加载模块：说明符必须是字面量，缺文件在编译期/构建期即报错 */
type ModuleLoader = () => Promise<{ default: Component }>

/** 去掉 `Base:` / `Extra:` 这类前缀，取 schema 里的组件名（联合类型上会逐项分发） */
type StripPrefix<K extends string> = K extends `${string}:${infer Rest}` ? Rest : never

/**
 * 本注册表允许的 key 集合 —— **单一真源是 `types.ts` 的 `ComponentPropPool`**，这里只做前缀剥离。
 * 不要再手写一份 key 名单（那会变成第二个真源，必然漂移）。
 */
type SchemaComponentKey = StripPrefix<keyof WForm.Schema.ComponentPropPool<unknown>>

/** 一张注册表：key 必须落在 `SchemaComponentKey` 里，值必须能解析出 `Component` */
type FormItemTable = Partial<Record<SchemaComponentKey, ModuleLoader>>

/** 内建表单项（`Base:<key>`）—— 位于 `apps/admin/src/components/UI/` */
const BUILT_IN_UI = {
  Button: () => import('@/components/UI/Button'),
  ButtonConfirm: () => import('@/components/UI/ButtonConfirm'),
  ButtonGroup: () => import('@/components/UI/ButtonGroup'),
  ButtonRetry: () => import('@/components/UI/ButtonRetry'),
  Checkbox: () => import('@/components/UI/Checkbox'),
  ColorPicker: () => import('@/components/UI/ColorPicker'),
  DatePicker: () => import('@/components/UI/DatePicker'),
  DynamicTags: () => import('@/components/UI/DynamicTags'),
  Input: () => import('@/components/UI/Input'),
  InputNumber: () => import('@/components/UI/InputNumber'),
  Radio: () => import('@/components/UI/Radio'),
  Select: () => import('@/components/UI/Select'),
  Switch: () => import('@/components/UI/Switch'),
  TimePicker: () => import('@/components/UI/TimePicker'),
  Tree: () => import('@/components/UI/Tree'),
  TreeSelect: () => import('@/components/UI/TreeSelect'),
} satisfies FormItemTable

/** 扩展表单项（`Base:<key>`）—— 位于 `apps/admin/src/components/Extra/` */
const BUILT_IN_EXTRA = {
  EmailInput: () => import('@/components/Extra/EmailInput'),
  IconPicker: () => import('@/components/Extra/IconPicker'),
  LocaleSelect: () => import('@/components/Extra/LocaleSelect'),
  Password: () => import('@/components/Extra/Password'),
  PhoneNumberInput: () => import('@/components/Extra/PhoneNumberInput'),
  VerifyCode: () => import('@/components/Extra/VerifyCode'),
  TransitionSelect: () => import('@/components/Extra/TransitionSelect'),
} satisfies FormItemTable

/** 业务表单项（`Business:<key>`）—— 位于 `apps/admin/src/components/Business/` */
const BUILT_IN_BUSINESS = {
  AreaCascader: () => import('@/components/Business/AreaCascader'),
  Dict: () => import('@/components/Business/Dict'),
} satisfies FormItemTable

/** 表单外壳扩展（不是 schema 项，挂在 Form 自己的扩展位上）—— 位于本目录的 `../Extend/` */
const BUILT_IN_EXTEND = {
  Query: () => import('../Extend/Query'),
  Divider: () => import('../Extend/Divider'),
} satisfies FormItemTable

/**
 * 以**固定名字**注册、但不在任何分组清单里的条目。
 *
 * 它们与分组条目的唯一区别是「不从清单循环里生成」—— 注册表改成显式之后这个区别已经没有意义，
 * 保留独立对象只是为了让人一眼看出**这 3 个是历史遗留的具名注册**（原来写死在文件末尾）。
 */
const NAMED_EXTRAS = {
  RoleSelect: () => import('@/components/Advanced/RoleSelect'),
  Tinymce: () => import('@/components/Vendor/Tinymce'),
  JSONEditor: () => import('@/components/Vendor/JSONEditor'),
} satisfies FormItemTable

/** Form component map */
const componentMap = new Map<string, Component>()

/**
 * 把注册表灌进 `componentMap`。
 *
 * `createAsyncComponent` 要的是「能解析出 Component 的 loader」，而 `import()` 解出的是模块对象，
 * 所以这里统一取一次 `default`（包装与分组无关，因此只写一遍）。
 */
function register(table: FormItemTable) {
  for (const [key, load] of Object.entries(table)) {
    if (!load)
      continue
    componentMap.set(key, createAsyncComponent(() => load().then(m => m.default)))
  }
}

register(BUILT_IN_UI)
register(BUILT_IN_EXTRA)
register(BUILT_IN_BUSINESS)
register(BUILT_IN_EXTEND)
register(NAMED_EXTRAS)

// raw：直接挂 naive-ui 的组件对象，没有懒加载
componentMap.set('Slider', NSlider)
componentMap.set('DynamicInput', NDynamicInput)
componentMap.set('InputOtp', NInputOtp)

export { componentMap }
