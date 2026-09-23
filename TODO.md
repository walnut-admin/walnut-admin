# TODO —— 产品与功能待办

> **这不是架构待办。** 两本账刻意分开：
> - **本文件**：产品 / 功能与体验待办，按「重要紧急」分四档。多是**产品取舍**，没有机械判据。
> - **[架构待办](apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)**：架构与工程债，
>   每条都能写出一条机械判据（门禁 / 测试 / 脚本）。
>
> **编号是被源码引用的锚点。** 带编号的条目（`000` / `111` / `999`）在源码注释里被引用 ——
> `// TODO 000` 就是「见本文件 000 条」；实测 **40 处注释 / 38 个文件**（`000` 19 处、`111` 17 处、
> `999` 2 处 ×2 行）。**改这些编号等于改那些注释的锚点**，要改就一起改。
> `888` 与 `99` **不是**锚点（零引用）。
>
> **格式**：`- [ ]` / `- [x]`；~~删除线~~ = 想过但不做。
> 📌 **2026-09-23**：逐条对照代码核实过一遍，结论写在每条下面（`核实：`）。勾选框本身
> 最后一次真实维护是 2026-07-26（三仓合并那次），**比代码旧两个多月** —— 所以别只看勾。

## 重要紧急

- [x] dev setting / features / user settings 急需分离，现在都耦合在appsettings里了
- [x] menu字段：usedDicts/usedLocales/watermark/watermarkconfig/queryEnhanced/queryEnhancedMode/paramsEnhanced/paramsEnhancedMode/full/query，menu表把乱七八糟的字段都塞进meta里，不要平铺字段
- [x] 弹出类的form做表单内容改变关闭提示
- [x] form支持嵌套字段
- [x] 移除所有eslint/ts error
- [x] 已经缓存了的页面不要loadingbar
- [x] lock security 有问题
- [ ] 示例模块，设备模块，删除模块，认证模块

  核实：**示例 / 设备 / 删除三个模块都已落地** —— 示例 74 个页面（`views/demo/**`）、
  设备（`views/system/device/` + server `modules/system/{device,user_device}`）、
  删除（`views/system/deleted/` + server `modules/system/deleted/`，含恢复）。
  **只剩认证模块的三个 provider 是 stub**：`views/auth/src/shared/other.vue`
  里 wechat / alipay / qq 直接弹 `app.base.wip`。所以整条**不能勾**。

- [x] 强退在线用户(修改密码/重置密码都会提出当前在线的用户)
- [x] ~~~vue3-mindmap，能帮忙捋捋思路~~~
- [ ] 菜单内嵌query，以及手动跳转的query的留存

  核实：**「留存」已做，「菜单内嵌」没做**。留存：`router/guard/afterEach.ts` 把带 query 的
  跳转记进 tab，`store/modules/app/app-tab.ts` 存取，点 tab 时 `useTabsActions.ts` 还原。
  内嵌：`api/models.d.ts` 的 `SystemMenuMeta` **没有 `query` 字段**，而且侧边菜单点击时
  `TheAside/src/menu.vue` 是**刻意** `omit(targetTab, 'query')` 的 —— 要做得先定这是不是
  有意为之。**另注**：本文件第 6 条提到的 `queryEnhanced` / `paramsEnhanced` 两个词今天
  只存在于本文件（实现已改叫 `router/guard/modules/encrypt/{querys,params}.ts`）。

- [x] 用户表加一个字段，角色是分开模式还是合并模式，都可以自定义，同时如果是分开模式，右上角配合选择切换权限
- [x] 路由加密，单独指query，param感觉没有加密的必要?（query和params的加密解密都完成了，但配置需要进一步细化）
- [x] 修改密码功能

  核实：**已做**（勾选框是旧的）。自助改密 `views/me/tabs/security/tab1/`（OPAQUE 流程）+
  管理端重置他人密码 `views/system/user/index.vue`；server 侧
  `modules/auth/modules/opaque/{user,admin}/opaque.*.controller.ts` 都有端点。
  遗留一条代码内 TODO：设/改密码前的校验（`tab1/opaque.vue` 的 `// TODO before set/change
  password need to do verify if has`）。

- [ ] 个人信息页面

  核实：**半个**。`/me` 页存在（4 个 tab：basic / security / account / prefer，basic 是可提交的
  资料表单）。**没有**独立的只读「查看资料」页，也没有叫 Profile 的路由 —— 若本条原意就是
  「有地方看自己的信息」，那它已达成；若是要单独一个查看页，则没有。

- [ ] 用户查看，完善抽屉，同时手机号/邮箱作为敏感信息，都需要单独处理

  核实：**比条目描述的更糟**，且敏感信息尚未单独处理。
  ① 用户列表的「查看」按钮走的是 `onReadAndOpenUpdateForm`，而 `CRUD/index.vue` 只在传了
  `descriptionProps` 时才切只读 —— 用户模块没传 ⇒ **点「查看」打开的是可编辑的更新抽屉**，
  且只显示 userName / status / roles，连手机号/邮箱/头像都没有。
  ② 手机号/邮箱在 `user_identity` 模型里服务端 AES-256-GCM 加密、返回时打码
  （`maskedValue`），管理端用户模块从不展示它们。
  ③ 「弹全局验证弹窗再重试」是明写的未完成：`utils/axios/interceptors/response/interceptor.ts`
  的 `// TODO call up global modal to verify, then retry request after verified`（组件与
  store 其实都有了，就是没接上）。

- [ ] 找回密码

  核实：**没做**，且是 UI stub —— `views/auth/src/common/opaque.vue` 的 `onForgetPassword()`
  只弹一句 toast，无接口无路由；按钮还受后端开关 `getOpaqueForgetEnabled` 控制。

- [x] api 函数重命名 结尾都以API结束 好区分是请求函数
- [x] ~~merge request的axios adapter完成了，字典数据接口需要重新梳理一下，可以不用initDict在form/table/desc组件里了~~
- [x] checker貌似导致了HMR不好使（可能也是多个plugin使用导致的，还需要排查） => vite.config.ts define环境变量就好了
- [x] auto import 不能滥用，项目大了之后，会显得很乱
- [x] server cert 加密请求参数?
- [x] url/params 的参数 不要做配置 直接superjson + cryptojs
- [x] store 重构了是重构了 但是还是有很多地方风格没有统一 需要挨个整理一下
- [x] 设备不支持 那个页面应该统一化 因为可能还有其他类型的不支持
- [x] font-size => naive-ui有些内部组件不支持px的override（主要是涉及到虚拟滚动/select/menu等等
- [x] 升级vite7
- [x] lock逻辑 都统一规划到lock store中 后续接入接口也方便
- [x] px => rem => 应该是base-font change的最佳方案？项目中px全部剔除掉
- [ ] features 页面统一风格

  核实：**没做**。共用壳 `<WDemoCard>` 存在（61 个文件在用），但 features 那批不一致：
  `views/demo/features/*` 9 个页面里只有 2 个用它，`views/features/*` 4 个页面各写各的根markup。

- [x] JSON表单项
- [ ] 字体自定义

  核实：**只做了字号，没做字体**。`Preference.Accessibility` 里只有 `fontSize`（`useAppFontSize`
  落到 `document.documentElement.style.fontSize`）；全仓搜不到 font-family 设置，字体族写死在
  `uno.config.ts` 的 `presetWebFonts`。

- [x] 色盲模式细分 - 纯css区分 naive做了一定量的适配 当然都是ai干的
- [ ] 完善个人设置页面吧，基本功能都有了

  核实：**还差得不少**。`/me` 四个 tab 里：`tabs/account.vue` 是**12 行的字面 stub**；
  security 的 tab2 有 3/4 个 TOTP 动作 + WebAuthn 弹 `wip`，tab3 有 2/3 行 wip 且
  `onInit` 整段被注释。能用的是 basic 资料、security tab1（密码/手机/邮箱身份）、
  tab4、preference 的 basic/accessibility/theme/layout。

- [ ] casl数据权限 已经有demo了

  核实：**本仓没有这个 demo**。全仓搜 `casl` 只命中本文件与架构待办；`@casl/*` 不在依赖里；
  现在的权限判断是字符串式（`hasPermission('system:user:read')`）。

- [ ] org大模块 包括职工 部门 岗位等 要融合casl功能

  核实：**零证据**。搜「部门 / 岗位 / 职工 / department」在 `apps/admin/src` 与
  `apps/server` 的模块目录下 **0 命中**；server 的 `modules/system/` 里没有 org 类模块。

- [ ] opaque 注册 忘记密码

  核实：**只有开关，没有流程**。后端配置项 `opaque: { register, forget }` 与前端读取都在，
  忘记密码按钮也渲染了，但处理函数就是上面的 toast stub；**注册页/注册流程在 `views/auth/**`
  里完全不存在**。

- [ ] wind4 preset

  核实：**没做，且文档已如实写明**。`uno.config.ts` 仍用 `presetWind3`；
  `frontend/base/plugin.md` 写着「暂未升级到 `preset-wind4`，因配置有变化，待后续调整」。
  `@unocss/preset-wind4` 只作为传递依赖躺在 lockfile 里。

## 重要不紧急

- [x] 999 查看[issue](https://github.com/vuejs/vue-router-next/issues/626)。嵌套路由的keep-alive有问题，为了暂时让keep-alive好使，就把路由扁平化了。但是左侧menu和头部的breadcrumb需要做相应的变动（路由不再是树状结构，但在左侧菜单和面包屑的位置逻辑还是原来树状的逻辑）

  核实：**已做，而且已经「转正」** —— `router/utils/route.ts` 里写着
  「I have decided to make this into a final solution, not for temporarily anymore」。
  上游 issue #626 至今仍 open，所以扁平化会留着。
  ⚠️ 但 `apps/docs/src/{zh-CN,en-US}/guide/deep/route.md` 里那段示例**已过期**：它引用的
  `_tempFlatNestedRoutes` 在源码里早就改名成 `transformToTwoLevelRouteTree`。
  （en-US 那份还有中文注释乱码 —— 该文件是 GBK 误解码的产物。）

- [x] ~~888 查看[issue](https://github.com/vuejs/core/issues/4294)。项目中组件的props的类型定义都在vue的文件的外部，引入并使用到defineProps上会导致编译错误，暂时为了解决问题，都在组件内部又重新定义了一遍props的类型，后续支持了就可以从外部文件引入类型了。~~
- [ ] 000 /* @vue-ignore */ ugly

  核实：**未做，而且那个 hack 今天仍然是必需的**（19 处）。它是 **Vue SFC 编译器的逃生口**
  （不是 TS 的东西）：`@vue/compiler-sfc` 遇到 `interface Props extends /* @vue-ignore */ X`
  时跳过对 `X` 的解析，不加就**硬编译报错**。根因是 naive-ui 的 props 类型是
  `ExtractPublicPropTypes<…>` 这类工具类型，编译器走不动。
  **「ugly」具体丑在哪**：被跳过的那部分**不会进运行时的 `props` 声明**，只能靠
  `inheritAttrs` 默认 true 兜着 —— 所以对 `inheritAttrs: false` 的组件会静默失效
  （仓里 `UI/Tree` 就是另一种写法：不 extends，改成收一个 `treeProps?: TreeProps`）。
  Vue 3.5.34 与 3.5.40 的编译器里那 4 条代码路径一模一样 ⇒ **没有版本级的修复可等**。

- [ ] 111 tsx explict import

  核实：**标记还在（17 处），但它们更像「约定」而不是「待修的工作」**。
  标记总是紧挨着一个**组件 import**（同一文件的 composable 仍是自动导入的）—— 因为这些文件是
  `.tsx` 或 `<script lang="tsx">`。
  **`111` 与第 98 行的 `99` 是同一件事**（同症状同办法，两处编号，所以 111 一直看着像没做）。
  上游 `unplugin-auto-import#75` 的状态是 **已关闭（2021-11-27）、而且是个提问不是 bug**，
  **没有上游修复可等**。理论上今天的 `unplugin-vue-components` 也许能认未导入的 JSX 组件，
  但仓里 27 个 tsx 文件**已经零例外地显式导入**，没有反证 —— 要动它得先真跑一次构建验证，
  而且根 `AGENTS.md` 纪律 4 已经把「显式 import」定为规则。**建议：当成过时但无害的文档，别批量删。**

- [x] axios config demo
- [x] 页面中的错误模拟 demo
- [ ] pdf/word/excel/print.js plugin

  核实：**没做**。`frontend/base/vendor.md` 把它们列在「后续插件集成计划」里；依赖与用法都没有。

- [x] error monitor (sentry?)
- [x] untyper
- [ ] ~~cdn 也是配合其他插件貌似会有问题~~

  核实：**这不是待办，是个已写下的决定**。插件在但空转（`cdn({ modules: [] })`，且由
  `env.build.cdn` 开关控制）；`plugin.md` 写着「项目中暂未使用，因与其他插件配合时功能实现不佳；
  建议改用 VueUse 的 `useScriptTag` 做懒加载」。⇒ 划掉。

- [x] 混淆 vite-plugin-bundle-obfuscator 基础混淆，高级混淆配合其他plugin打包后会有问题
- [ ] 拆分面板 splitpanes

  核实：**没做**。全仓搜 `splitpanes` 只命中本文件。

- [ ] markdown (vditor)

  核实：**没做**，只在 `vendor.md` 的后续计划里。

- [ ] fullcalendar

  核实：**没做**，同上。

- [x] tiptap 替代 tinymce? A: 不用tiptap替换了，直接self host了，也可以用
- [x] vite-plugin-csp-guard/vite-plugin-istanbul

## 不重要不紧急

- [x] 打包优化+自动化部署
- [x] 第三方认证
- [x] case police
- [x] 菜单 自定义动画/记住滚动位置/页面离开提示(路由和全局)
- [x] 动态设置tab的名称，图标，badge, 进入之前的路由钩子处理
- [x] 输入框的定制插槽 - 复制
- [x] vue-tsc 错误全部消除（至少是真的全部消除过一次了
- [ ] layout 扩展

  核实：**判不了**，本条没写清「扩展」指什么。现状：`Preference.Layout` 有 layoutMode +
  header/tabs 各项，`preference/layout.vue` 是配置表单，另有 `DevSettings` 齿轮面板；
  没找到指向「缺某一项」的 TODO。

- [ ] 主题扩展

  核实：**判不了**。持久化的主题偏好今天只有 `{ dark: boolean }` 一个开关，主题覆写在代码侧
  （`App/src/naive/src/theme.ts`）。「扩展」是指主题预设还是配色方案，原文没说。

- [x] 手机号组件，邮箱填充组件
- [ ] 身份证组件

  核实：**没做**。搜 `idCard` / `身份证` 在 `apps/admin/src` 与 `packages` 下 0 命中
  （只有 server 的 identity 注释里提过这个类型名）。

- [x] https://github.com/theajack/disable-devtool
- [x] https://github.com/rrweb-io/rrweb sentry自带录屏功能，这个就不集成了
- [ ] https://github.com/hrynko/vue-pdf-embed

  核实：**没做**。无依赖无用法；PDF 只在 `vendor.md` 的计划清单里。

- [x] cap https://github.com/tiagorangel1/cap
- [x] https://github.com/zumerlab/snapdom https://github.com/sindresorhus/capture-website still use html-to-image
- [x] https://github.com/yjl9903/unplugin-info
- [x] https://github.com/SSShooter/mind-elixir-core instead of vue3-mindmap
- [x] https://github.com/vite-pwa/vite-plugin-pwa
- [x] https://github.com/antfu/case-police not that sensitive
- [x] https://github.com/sindresorhus/capture-website
- [x] closure-compiler (尝试搞过，难搞)

- [x] 后台自定义code
- [x] 后台入参校验
- [x] 登录日志/操作日志
- [x] 权限模块开发
- [x] hover css
- [x] tab样式重做
- [x] 劫持F5事件
- [x] 搜索组件
- [x] ~~~99 tsx + setup + auto-import 打包后会出问题，暂时需要显式引入 [issue](https://github.com/antfu/unplugin-auto-import/issues/75)~~~

## 不知道如何解决的问题

> 核实：两条都**不再是「不知道如何解决」**，代码里已经有解法或缓解，缺口写在各条下面。

1. - Q: tab右键快照在特定页面特定滚动模式下会报错，报错还一点详细都没有，不知道什么导致的错误 [issue](https://github.com/bubkoo/html-to-image/issues/314)
   - A: 发现了，是css的 w: 属性导致的错误 就是 unocss的attribute 用法 去掉吧 确实很hack的写法 还会导致报错
2. - Q: cap token也做到axios的响应拦截器了，逻辑类似refresh token，但在access token 和 cap token都失效时，调用多个接口会导致多次触发刷新逻辑
   - A: **大部分已在代码里解决**：两条刷新链路各自包了 `SingletonPromise`
     （`interceptors/response/{capJSToken,refreshToken}.ts`，原语在
     `packages/platform-any/utils-core/src/queue.ts` —— 共享在途 promise、settle 后清空）。
     **残留缺口**：cap 与 access token 的**去重器是两个独立实例**，所以在「两个 token 同时失效」
     的并发爆发下仍可能各刷一次，中间重试的请求还可能再弹一轮 —— 缺一个共享的「正在刷新」闸门。
3. - Q: 加了json-editor后，开 OBFUSCATOR 打包后 codemirror 会报错?
   - A: **只有类级别的解释，没有 codemirror 专属的**；缓解已落在配置里
     （`build/vite/plugin/obfuscator.ts` 用 `low-obfuscation` +
     `autoExcludeNodeModules.manualChunks`，且由 `VITE_BUILD_OBFUSCATOR` 控制）。
     `plugin.md` 写的是「medium/high 可能导致打包错误，最容易和懒加载或 CDN 插件冲突」。
     json-editor 一侧（`components/Vendor/JSONEditor` 包 `json-editor-vue`，拉进 codemirror 6）
     **本身没有任何混淆相关注记** —— 真复现一次再补一条具体结论即可关闭。

## 另一个 TODO

`apps/server/TODO.md` 是后端仓的历史草稿（另有 18 条未完成），**刻意留着当历史**，
不是本仓 backlog —— 见 [架构待办](apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)
与 `apps/server/README.md` 的说明。
