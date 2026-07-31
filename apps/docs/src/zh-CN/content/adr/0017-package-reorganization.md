# ADR-0017: Package 重组——多维标签 + 目录分组

**Date:** 2026-07-31
**Status:** Proposed

## Context

现有 `packages/` 目录有 5 个平铺的包，ADR-0006 定义了按运行时 API 依赖分层的体系（Pure → Browser → Node → Framework）。经过实际使用和全面审计，暴露出以下问题：

1. **`@walnut/utils` 边界模糊**：运行时代码是纯的（`TextEncoder`/`TextDecoder` 在 Node ≥11 中全局可用），但类型文件（`deep-ref.d.ts`、`object-key.d.ts`）依赖 Vue 类型且未在 `package.json` 中声明——声称"零依赖"只在运行时成立。
2. **`@walnut/axios` 命名误导**：实际上几乎双运行时（只有 `cancel.ts` 中一行 `location.pathname` 是浏览器 only），但命名暗示通用 HTTP 客户端，放在 `platform-web/` 下更诚实。
3. **平铺结构无扩展性**：5 个包平铺还能管理，但未来加到 10+ 包时就需要目录分组和更精确的分类体系。
4. **前端大量代码未抽离**：~135 个 composables、25 个 UI 组件、Cookie 工具、Pinia store 工厂模式（24 个文件重复）仍在 `apps/admin/` 中。
5. **Server libs 有可提纯的代码**：`libs/const` 全部是纯 TS 常量对象，`libs/utils` 的纯子集（`general`/`regex`/`mask`/`dayjs`/`pkg`）正好是 `@walnut/utils` 的定位——但 server 当前不从 `@walnut/utils` import 任何东西。
6. **跨端重复定义**：WebSocket 事件名前后端各定义一套、Cookie key 名前端硬编码、AES-GCM 有线格式常量重复、列表分页类型重复、30+ 处 API URL 硬编码而 `contract/routes.ts` 无人引用。

### 行业参照

搜索了 TanStack、Nx、Vercel 等大型 TS monorepo 的设计模式：

- **TanStack**：`{project}-core`（框架无关）+ `{framework}-{project}` adapter。Core 包零运行时依赖，adapter 只做薄封装。
- **Nx 大型 monorepo（Trellis: 14 apps, 1200+ libs）**：多维标签——`scope`（shared/domain）、`type`（feature/ui/data-access/util）、`platform`（web/server/any）、`layer`（public/db/external），用 ESLint `enforce-module-boundaries` 强制执行。
- **社区共识**：Pure 共享包应通过工厂函数/构造函数接受配置，不直接读取环境变量。`.env` 文件只在 `apps/*` 中。

## Decision

### 总体方案：多维标签 + 目录分组

**目录分组**将 ADR-0006 的分类哲学编译到文件系统层面——看到目录就知道能不能用：

```
packages/
├── platform-any/          ← 无运行时依赖，前后端都能用
│   ├── contract/          @walnut/contract
│   ├── utils-core/        @walnut/utils        (拆分后保留纯函数)
│   └── types/             @walnut/types        (新增)
│
├── platform-web/          ← 浏览器 API + Vue
│   ├── client/            @walnut/client
│   ├── http/              @walnut/http         (原 axios)
│   ├── ui/                @walnut/ui           (新增)
│   ├── i18n/              @walnut/i18n         (新增)
│   └── security/          @walnut/security     (新增)
│
└── tooling/               ← 开发工具
    └── eslint-config/     @walnut/eslint-config
```

**标签体系**（每个包的 `package.json` 中声明）：

| 维度 | 标签 | 说明 |
|------|------|------|
| **platform** | `any` / `web` / `node` | 运行时平台，与目录对应 |
| **type** | `contract` / `utils` / `client` / `http` / `ui` / `i18n` / `security` / `tooling` | 包的功能类型 |
| **runtime** | `none` / `dom` / `web-crypto` / `vue` / `node` / `nestjs` | 具体运行时 API 依赖 |

**每个包的标签赋值**（写入 `package.json` 的 `"walnut"` 字段）：

| Package | platform | type | runtime |
|---------|----------|------|---------|
| `@walnut/contract` | `any` | `contract` | `none` |
| `@walnut/utils` | `any` | `utils` | `none` |
| `@walnut/types` | `any` | `contract` | `none` |
| `@walnut/client` | `web` | `client` | `dom`, `web-crypto`, `vue` |
| `@walnut/http` | `web` | `http` | `dom`, `vue` |
| `@walnut/ui` | `web` | `ui` | `dom`, `vue` |
| `@walnut/i18n` | `web` | `i18n` | `vue` |
| `@walnut/security` | `web` | `security` | `dom`, `web-crypto`, `vue` |
| `@walnut/eslint-config` | `any` | `tooling` | `none` |

边界规则（在 `turbo.json` boundaries 中已有雏形，需扩展）：
- `platform:node` 不能依赖 `platform:web`
- `platform:any` 不能依赖 `platform:web` 或 `platform:node`
- `type:contract` 不能依赖任何有运行时的包

### 各 Package 详细设计

---

## 1. `@walnut/contract`（platform-any/contract/）

**定位**：前后端共享的类型 + 常量——零运行时依赖。现有包，内容不变，只需补充。

### 现有内容（保留全部）

| 文件 | 内容 |
|------|------|
| `src/http.ts` | `RequestHeaders`（12 个自定义 header 常量） |
| `src/response-code.ts` | `WalnutAdminConstAppResponseCode`（~60 个业务码） |
| `src/response.ts` | `ResponseBase<T>` 响应信封 |
| `src/pagination.ts` | `SortOrder`/`SortParam`/`BaseListParams`/`BaseListResponse` |
| `src/menu.ts` | `MenuType`/`MenuTernal`/`CacheKeyStrategy` |
| `src/role.ts` | `Role`/`RoleType` |
| `src/token.ts` | JWT token payload 类型 |
| `src/routes.ts` | `AuthRoutes`/`SystemRoutes`/`AppRoutes` 等 API 路由常量 |
| `src/i18n.ts` | `Locale`/`LocaleType` |

### 新增内容

**准入标准**：前端和后端**都必须用到**。只有一方用，就留在那方。

| 来源 | 内容 | 前端用到？ | 后端用到？ | 判定 |
|------|------|-----------|-----------|------|
| `apps/server/apps/api/src/socket/socket.const.ts` | `WalnutAdminSocketEvents`（`lock:lock`/`lock:unlock`/`force:quit`）+ `WalnutAdminSocketRooms` | ✅ `apps/admin/src/socket/event.ts` 重复定义了相同字符串 | ✅ 原定义在此 | **进 contract** |
| `apps/server/libs/const/src/app/cookie.ts` | Cookie key 名常量（`CAPJS_TOKEN`/`DEVICE_ID`/`RT_JTI`/`SIGN_TICKET` 等） | ✅ `apps/admin/src/const/persistent.ts` 已硬编码 | ✅ 原定义在此 | **进 contract** |
| `apps/server/libs/const/src/app/token.ts` | Token key 名（`ACCESS_TOKEN`/`REFRESH_TOKEN`/`SESSION_KEY`） | ✅ `StoreKeys`/`AppConstPersistKey` 中已重复 | ✅ 原定义在此 | **进 contract** |
| `packages/utils/src/crypto/const.ts` 中的 `AES_GCM` | AES-GCM 有线格式常量（`IV_LENGTH: 12`/`TAG_LENGTH: 16`） | ✅ `packages/client` WebCrypto 加密依赖 | ✅ server `crypto.service.ts` 中重复定义 | **进 contract** |
| `apps/server/apps/api/src/common/dto/shared.dto.ts` | `DeviceTypeConst`/`SharedUserAgentDTO` 等的纯类型（去掉 class-validator 装饰器） | ✅ admin 上报设备信息 | ✅ server 接收设备信息 | **进 contract** |
| `apps/server/libs/const/src/app/strategy.ts` | Auth 策略名称常量 | ❌ Passport 策略名，前端不感知 | ✅ | **留在 server** |
| `apps/server/modules/auth/modules/otp/otp.const.ts` | `otpType`/`OtpIdentityTypeMap` | ❓ 待确认——admin 在 MFA 设置页是否展示了 OTP 选项列表 | ✅ | **待确认，暂不进** |

### 需修复的问题

| 问题 | 修复 |
|------|------|
| `response.ts` 注释写 "code (0 = success)" | 改为 "code (20000 = success)" |
| `routes.ts` 已导出但 **0 处消费** | 前后端各 30+ 处硬编码路径需迁移（Phase 2） |
| `IListRequestParams`（server `libs/utils/listAggregate.ts`）与 `BaseListParams` 结构重复 | Server 侧统一用 contract 的 `BaseListParams`/`SortParam` |

---

## 2. `@walnut/utils` → 拆分（platform-any/utils-core/）

**定位**：纯 JavaScript 工具函数——零运行时依赖（npm 依赖 `js-base64` 除外）。前后端都能用。

### 现有运行时导出（全部保留在 `utils-core` 中）

| 导出 | 源文件 | 运行时依赖 | 分类 |
|------|--------|-----------|------|
| `AES_GCM` / `PEM` / `RSA_OAEP`（常量） | `crypto/const.ts` | 无（`RSA_OAEP.PUBLIC_EXPONENT` 用了 `Uint8Array`——Node ≥4 全局可用） | ✅ 纯 |
| `AesGcmRawInput` 等类型 | `crypto/const.ts` | 无 | ✅ 纯 |
| `arrayBufferToBase64` / `uint8ArrayToBase64` / `base64ToUint8Array` / `base64ToArrayBuffer` | `crypto/transformer.ts` | `js-base64`（通用 npm 包） | ✅ 纯 |
| `uint8ArrayToHex` / `hexToUint8Array` / `arrayBufferToHex` | `crypto/transformer.ts` | 无 | ✅ 纯 |
| `utf8ToUint8Array` / `uint8ArrayToUtf8` | `crypto/transformer.ts` | `TextEncoder`/`TextDecoder`（Node ≥11 / 所有浏览器全局可用） | ✅ 双运行时可用 |
| `withAsyncConditionalEncryption` / `withSyncConditionalEncryption` | `persistent/enhance/*.ts` | 无（只在接口上操作） | ✅ 纯 |
| `SingletonPromise` | `queue.ts` | 无 | ✅ 纯 |
| `isEmailAddress` / `isPhoneNumber` | `regex.ts` | 无 | ✅ 纯 |

### 从 `apps/server/libs/utils/` 迁入的纯函数

| 源文件 | 函数 | 说明 |
|--------|------|------|
| `libs/utils/src/general.ts` | `generateVerifyCode` / `sleep` / `objectToPaths` | 纯 TS，前后端都可用 |
| `libs/utils/src/regex.ts` | `regexMap`（脱敏正则） | 与现有 `isEmailAddress`/`isPhoneNumber` 配套 |
| `libs/utils/src/mask.ts` | `maskEmail` / `maskPhone` / `maskSensitiveFields` | 纯函数（唯一依赖 mongoose `isObjectIdOrHexString`——可参数化） |
| `libs/utils/src/pkg.ts` | `getPackageJsonData` | Node 端读取 package.json；前端可参考但用途有限 |
| `libs/utils/src/dayjs.ts` | `AppDayjs` | dayjs 实例；如要迁入需将 dayjs 加入 `dependencies` |

### 要迁出的内容

| 文件 | 迁往 | 原因 |
|------|------|------|
| `src/types/storage.d.ts` | `@walnut/types` | `IStorageSync extends Storage` 依赖 DOM `Storage` 接口 |
| `src/types/deep-ref.d.ts` | `@walnut/types` | 使用 `Ref`/`MaybeRefOrGetter` from `vue`，但 `package.json` 未声明 vue |
| `src/types/object-key.d.ts` | `@walnut/types` | 显式 `import type { UnwrapRef } from 'vue'`——未经声明的 Vue 依赖 |
| `src/crypto/const.ts` 中的 `AES_GCM` 常量 | `@walnut/contract` | 有线格式常量——前后端必须一致 |

### `package.json` 变化

```diff
- "description": "Zero-dependency shared utilities"
+ "description": "Pure JS utility functions — consumed by both frontend and backend"
  "dependencies": {
-   "js-base64": "catalog:"
+   "js-base64": "catalog:",
+   "dayjs": "catalog:"       // 从 server libs/utils 迁入 AppDayjs 时添加
  }
```

> **注意**：server 当前声明了 `@walnut/utils` 为依赖但 **从未 import**（死依赖）。迁入 `libs/utils` 的纯函数后，server 应开始使用 `@walnut/utils` 而不是 `@walnut-server/utils` 中的纯函数，或删除依赖声明。

---

## 3. `@walnut/types`（新增，platform-any/types/）

**定位**：环境无关的类型声明——不依赖 Vue、DOM、Node。这是当前 `@walnut/utils` 分裂的产物——用来收容既不纯也不属于 `@walnut/contract` 的类型。

### 内容

| 来源 | 文件 | 说明 |
|------|------|------|
| `packages/utils/src/types/` | `storage.d.ts` | `IStorageSync`/`IStorageAsync`/`IStorageOptions`/`IStorageData`——不需要 DOM `Storage` 继承链的版本 |
| `packages/utils/src/types/` | `deep-ref.d.ts` → 重写为无 Vue 版本 | 取 `IsPrimitive`/`IsFunction`/`NoDistribute` 等纯类型体操部分，去掉 `Ref`/`MaybeRefOrGetter` |
| `packages/utils/src/types/` | `object-key.d.ts` → 去掉 `UnwrapRef` 导入 | `UnionToIntersection`/`RecordToUnion`/`ShortEmits`/`DeepKeyOf`——纯类型体操 |
| `packages/utils/src/types/` | `universal.d.ts` | `Fn`/`PromiseFn`/`IActionType`——纯类型 |
| `apps/admin/src/api/` | `models.d.ts` | `IModels` 命名空间——与 server Mongoose schema 手工维护的类型镜像 |
| `apps/admin/src/api/` | `request.d.ts` | `IRequestPayload` 命名空间 |
| `apps/admin/src/api/` | `response.d.ts` | `IResponseData` 命名空间 |

**`IModels`/`IRequestPayload`/`IResponseData` 的提取是最大的跨端类型共享机会**——当前前后端各自手工维护同一套业务对象类型的镜像。迁入 `@walnut/types` 后，server DTO 可 import 这些类型（作为 interface 而非 class-validator class），前端 API 层同样 import。

> **注意**：`deep-ref.d.ts` 的 Vue 依赖部分（`SafeDeepMaybeRef`/`IDeepMaybeRef`）和 `object-key.d.ts` 的 `UnwrapRef` 部分应保留在原地或迁入 `@walnut/client`——它们只在 Vue 组件代码中有意义。

---

## 4. `@walnut/client` → 扩展（platform-web/client/）

**定位**：浏览器 API + Vue composables——前端 only。现有包，合并 `utils-web` 的内容和 Pinia helpers。

### 现有内容（全部保留）

| 目录 | 内容 |
|------|------|
| `browser/crypto/` | Web Crypto API 包装（RSA-OAEP/AES-GCM/HKDF/HMAC） |
| `browser/file/` | `base64ToBlob`/`downloadByUrl` 等 |
| `browser/window/` | `wbtoa`/`watob` |
| `browser/shared.ts` | `detectDeviceType`/`getCPUCoreCount` 等 + 混杂的纯函数 |
| `hooks/vueuse/` | vueuse 薄封装 composables |
| `hooks/core/` | `useContext`/`useState`/`useProps`/`useLocalRefresh` |
| `hooks/component/` | `useGlobalAsyncComponent` |
| `hooks/web/` | `useBlob`/`useLinkTag` |
| `timer/` | `useExpireTimer` |
| `persistent/storage/` | `localStorage`/async/sync composables |
| `persistent/idb/` | IndexedDB vault |
| `persistent/enhance/` | AES-GCM/Base64 localStorage 增强 |

### 从 `apps/admin/` 迁入

| 来源 | 内容 | 说明 |
|------|------|------|
| `utils/persistent/Cookie.ts` | `Cookie` 类 + `setCookie`/`getCookie`/`removeCookie` | 最明显的遗漏——`document.cookie` 封装 |
| `utils/persistent/migrate.ts` | `setupStorageMigrations()` | localStorage/sessionStorage 版本清理 |
| `utils/window/open.ts` | `openExternalLink`/`openOAuthWindow` | 参数注入抽离 `mainoutConst` 依赖 |
| `hooks/component/useCountdown.ts` | `useCountdownStorage` | 依赖 `useAppStorageSync`（已在 client 中） |
| `layout/default/hooks/useFixedTopScroll.ts` | 滚动状态机 composable | 最高可复用性的独立 composable |
| `hooks/component/useDriver.ts` | `useDriver` | driver.js tour 封装 |
| `components/Global/AI/utils/cache.ts` | `LRUMap<K,V>` | 纯数据结构——可选择性放入 `utils-core` |
| `components/Global/AI/utils/parser/index.ts` | `extractJSON`/`isBufferWaitingForJSON` | 纯字符串解析——可选择性放入 `utils-core` |

### Pinia Store 工厂函数

24 个 store 文件重复的 `defineStore` 样板：

```ts
// 当前：每个 store 文件都复制此模式
const useAppStoreXInside = defineStore(StoreKeys.X, {...})
const useAppStoreXOutside = () => useAppStoreXInside(store)
export function useAppStoreX() {
  if (getCurrentInstance()) return useAppStoreXInside()
  return useAppStoreXOutside()
}
```

在 `@walnut/client` 中新增 `createWalnutStore()` 工厂：

```ts
// @walnut/client 新增导出
export function createWalnutStore<T>(storeKey: string, setup: () => T): () => T {
  const inside = defineStore(storeKey, setup)
  const outside = () => inside(store)
  return () => {
    if (getCurrentInstance()) return inside()
    return outside()
  }
}
```

### 已知问题

- `browser/shared.ts` 混合了浏览器 only 函数和纯函数（`getBoolean`/`objectToPaths`/`pathsToObject`）——Phase 2 可考虑分离
- `vue-router` 在 `package.json` 中声明为依赖但未被 import——死依赖，应移除
- 自动导入是抽离的关键障碍：Cookie.ts 中 `useAppEnvSeconds()` 无显式 import——迁入 package 后必须改为显式 import

---

## 5. `@walnut/http`（platform-web/http/，原 `@walnut/axios`）

**定位**：基于 axios fetch adapter 的 HTTP 客户端——主要面向浏览器，但核心逻辑几乎双运行时。

### 迁移

| 步骤 | 内容 |
|------|------|
| 重命名 | `@walnut/axios` → `@walnut/http`，目录 `packages/axios/` → `packages/platform-web/http/` |
| 抽象 `location.pathname` | `cancel.ts` 中唯一的浏览器 only 行：将"当前页面 key"改为可注入参数，默认值用 `typeof location !== 'undefined' ? location.pathname : '/'`——这样整个包在 Node 中也能跑 |
| 更新依赖声明 | 所有 `@walnut/axios` import → `@walnut/http` |
| Server ESLint 规则同步 | `nest.mjs` 中的 `no-restricted-imports` 从 `@walnut/axios*` 改为 `@walnut/http*` |

### 实际上的双运行时能力

现状：`cancel.ts` 中一行 `location.pathname`（`ReferenceError` in Node）。其余全部适配器（cache/throttle/retry/merge/id）是纯 JS 逻辑，`instance.ts` 使用 `axios.getAdapter('fetch')` 而非 XHR adapter。抽象掉 `location.pathname` 后，整个包在 Node ≥18 中可正常运行。

> **注意**：这不是说现在就要让后端用这个包——server 有 `@nestjs/axios`。但包的设计不应无缘无故阻止双运行时可用性。

---

## 6. `@walnut/ui`（新增，platform-web/ui/）

**定位**：基于 Naive UI 的 Vue 组件库——所有组件遵循 `index.ts` + `index.vue` 结构，`register` + `use*` hook 模式。

### Phase 1 迁入（核心 UI 组件，25 个）

`apps/admin/src/components/UI/` 全部：

```
Button, ButtonConfirm, ButtonGroup, ButtonRetry, Card, Checkbox,
ColorPicker, DatePicker, Descriptions, Drawer, Dropdown, DynamicTags,
Form, Icon, IconButton, Input, InputNumber, Modal, Radio, Select,
Switch, Table, TimePicker, Tree, TreeSelect
```

其中 **WForm** 和 **WTable** 是 schema 驱动引擎，拥有自己的 hook 套件——最具 package 价值。

### Phase 2 迁入（Advanced + Extra）

| 类别 | 组件 | 说明 |
|------|------|------|
| Advanced | `ApiSelect`/`CRUD`/`RoleSelect` | `WCRUD` 组合 WForm+WTable，`useCRUD` + `useSafeForm` |
| Extra（naive-free） | `AbsImage`/`Arrow`/`CapsLockTooltip`/`Copy`/`Eyedropper`/`FlipClock`/`Flipper`/`Scrollbar`/`TextScroll`/`Title`/`Transition`/`QRCode` | 不依赖 naive-ui，更可复用 |
| Extra（naive-coupled） | `IconPicker`/`JSON`/`Message`/`Password`/`VerifyCode`/`LocaleSelect`/`TransitionSelect` | 依赖 naive-ui |
| Extra（带数据） | `CountryCallingSelect`/`EmailInput`/`PhoneNumberInput` | 自带国家数据表 |

### Phase 3 迁入（Vendor 封装层）

```CodeMirror, CodeMirrorMerge, Cropper, ECharts, JSONEditor, LocationPicker, Mindmap, OSSUpload, SignPad, Tinymce```

### 关键约束

- **`naive-ui` 是 peerDependency**——不对 naive-ui 版本做假设
- **自动注册兼容**：当前 `WalnutAdminComponentResolver` 扫描 `src/components/**/**/index.ts` 自动注册 `W*` 前缀组件。迁入 package 后需改为指向 package 路径，或由 package 内部自注册
- **自动导入迁移**：组件内部使用的 `$message`/`$dialog`/`$notification`（挂载到 `window` 上的 naive-ui 全局方法）在 package 中需显式 import

---

## 7. `@walnut/i18n`（新增，platform-web/i18n/）

**定位**：后端驱动的动态国际化模块——vue-i18n 的 setup + locale 状态机 + Naive UI locale 映射。

### 迁入内容

| 来源 | 内容 |
|------|------|
| `apps/admin/src/locales/index.ts` | `setupI18n`/`AppI18n`/`useAppI18n`（vue-i18n bootstrap，消息从后端 API 获取） |
| `apps/admin/src/store/modules/app/app-locale.ts` | Locale 状态机：缓存加载、`baseI18nKeyList` 过滤、lang 列表 |
| `apps/admin/src/App/src/naive/src/locale.ts` | Naive UI + date locale 映射 |
| `apps/admin/src/App/src/hooks/useAppLocale.ts` | Preference → locale 监听 |

### 依赖注入要求

模块当前依赖全局 store（`useAppStoreApp`）和 API（`getI18nMsgAPI`）——抽离为 package 时需要：
- `LocaleFetcher` 接口（消费者注入后端 API 调用）
- `LocaleCache` 接口（消费者注入存储方案）

### 不建议迁入

- `views/system/lang/`（语言管理页面——管理员功能，app-specific）
- `components/App/AppLocalePicker`（locale 切换 UI——关注点分离）

---

## 8. `@walnut/security`（新增，platform-web/security/）

**定位**：浏览器端安全机制封装——URL 加密、签名拦截器、二次验证类型。

### 迁入内容

| 来源 | 内容 | 说明 |
|------|------|------|
| `apps/admin/src/router/utils/crypto.ts` | AES-GCM URL params/query 加密 | 版本前缀编码 |
| `apps/admin/src/router/guard/modules/encrypt/params.ts` | 加密 route params guard | 需消费方注入加密 key |
| `apps/admin/src/router/guard/modules/encrypt/querys.ts` | 加密 query string guard | 同上 |
| `apps/admin/src/router/utils/query.ts` | `stringifyQuery`/`parseQuery` | qs 封装 |
| `apps/admin/src/utils/axios/interceptors/request/crypto.ts` | 请求体字段级 AES+RSA 加密 | 需注入加密 key 和 sign header 构建器 |
| `apps/admin/src/utils/axios/utils.ts` | `setTokenHeaderWithConfig` | Token header 设置 |
| `apps/admin/src/components/Global/VerifyAuth/types.ts` | `VerifyAuthMethodType`/`VerifyAuthOptions`/`VerifyAuthResult` | 纯类型，已在 contract 的 cross-cutting 考虑中 |

### 依赖注入要求

安全机制当前深度耦合全局 store（`useAppStoreSecurity`/`useAppStoreUser`）——抽离时需要：
- `SignProvider` 接口（消费者注入签名构建逻辑）
- `CryptoKeyProvider` 接口（消费者注入 RSA/AES key 获取逻辑）
- `VerifyAuthHandler` 接口（消费者注入验证回调）

---

## 9. `@walnut/eslint-config`（tooling/eslint-config/，不变）

现有包，位置从 `packages/eslint-config/` → `packages/tooling/eslint-config/`。内容不变。

### 同步更新

```diff
# nest.mjs — no-restricted-imports
- "@walnut/client*"
- "@walnut/axios*"
+ "@walnut/client*"      // platform-web，后端不能 import
+ "@walnut/http*"        // platform-web，后端不能 import
+ "@walnut/ui*"          // platform-web，后端不能 import
+ "@walnut/i18n*"        // platform-web，后端不能 import
+ "@walnut/security*"    // platform-web，后端不能 import
```

---

## 10. Server 侧清理（不在 `packages/` 中，但配套执行）

### `libs/const` —— 迁出共享常量到 `@walnut/contract`

| 迁出内容 | 目标 |
|----------|------|
| `app/cookie.ts`（cookie key 名） | `@walnut/contract` |
| `app/token.ts`（token key 名） | `@walnut/contract` |
| `app/header.ts` 已是从 contract 的 re-export——保持不变 | — |
| `app/lang.ts` 已是从 contract 的 re-export——保持不变 | — |
| `app/responseCode.ts` 已是从 contract 的 re-export——保持不变 | — |
| `app/strategy.ts`（auth 策略名——前端不用，留在 server `libs/const`） | — |

### `libs/utils` —— 纯子集迁入 `@walnut/utils-core` + 去掉重复类型

| 动作 | 内容 |
|------|------|
| 迁入 `@walnut/utils-core` | `general.ts`（`generateVerifyCode`/`sleep`/`objectToPaths`）、`regex.ts`、`mask.ts`、`dayjs.ts`、`pkg.ts` |
| 统一列表类型 | `listAggregate.ts` 的 `IListRequestParams` → 改为 import `@walnut/contract` 的 `BaseListParams`/`SortParam` |
| 保留在 server | `dto.ts`（`RealPickType`/`RealPartialType`——NestJS ClassSerializerInterceptor 强依赖）、`response.ts`（NestJS `ValidationError` 类型）、`headers.ts`（Express `ArgumentsHost`） |

### `libs/config` —— env 验证三重复消除

当前同一个 ~55 个 env var 名在三个地方手工维护：
1. `libs/config/src/validation.ts`（class-validator class）
2. `libs/types/src/process.d.ts`（`NodeJS.ProcessEnv` ambient）
3. 9 个 `registerAs` factory

建议：用一个 `EnvSchema`（Zod 4 已在 catalog 中）作为单一来源，分别生成 class-validator 验证类和 TypeScript 类型。**这是 server 内部重构，不涉及 `packages/`**。

### 死依赖清理

`@walnut/server` 的 `package.json` 声明了 `@walnut/utils` 和 `@walnut/axios` 为依赖但从未 import：
- `@walnut/axios` → 待改名后移除
- `@walnut/utils` → 如果能开始使用迁入后的 `@walnut/utils` 则保留；否则移除

### layering 违规修复

`libs/exceptions/src/exception.filter.ts` 从 `apps/api/src/` import（lib 依赖 app——方向错误）。filter 应迁入 app，或通过接口注入。

---

## Phased Implementation Plan

> **每步原则**：改 → 验 → 提交。不积累未验证的变更。

### Phase 1：目录重组 + 现有包迁移

#### Step 1.1：创建分组目录 + 移动 `contract`

- 创建 `packages/platform-any/`、`packages/platform-web/`、`packages/tooling/`
- 移动 `packages/contract/` → `packages/platform-any/contract/`
- 更新 `pnpm-workspace.yaml`：`packages: ['packages/*']` → `packages: ['apps/*', 'packages/platform-any/*', 'packages/platform-web/*', 'packages/tooling/*']`
- 更新所有 `@walnut/contract` import（~100 个文件）——仅更新 package 路径，import 名不变
- **验证**：`pnpm types:check` + `pnpm lint` 零错误；`pnpm dev` 前端 HMR 正常

#### Step 1.2：拆分 `utils` → `utils-core` + 创建 `types`

- 移动 `packages/utils/` → `packages/platform-any/utils-core/`（包名保持 `@walnut/utils`）
- 从 `utils-core` 迁出到 `@walnut/types`：
  - `src/types/storage.d.ts`（DOM `Storage` 依赖）
  - `src/types/deep-ref.d.ts`（Vue `Ref`/`MaybeRefOrGetter` 依赖——去除后重写为纯类型体操）
  - `src/types/object-key.d.ts`（Vue `UnwrapRef` import 去除后重写）
- 创建 `packages/platform-any/types/`（包名 `@walnut/types`）
- `deep-ref.d.ts` 中的 `SafeDeepMaybeRef`/`IDeepMaybeRef`（Vue 专属部分）→ 迁入 `@walnut/client`
- 从 `utils-core` 迁出 `AES_GCM` 常量 → `@walnut/contract`（Phase 2 执行）
- 更新 `@walnut/utils` 的 `package.json` description
- **验证**：`pnpm types:check`（检查 utils-core 不再有 vue 类型依赖）；前端 `pnpm dev` 正常；后端确认受影响文件编译通过

#### Step 1.3：重命名 `axios` → `http`

- 移动 `packages/axios/` → `packages/platform-web/http/`
- 包名 `@walnut/axios` → `@walnut/http`
- 全局替换所有 import：`@walnut/axios` → `@walnut/http`
- 抽象 `cancel.ts` 中 `location.pathname`：
  ```ts
  // 改为可注入参数，默认值兼容 Node
  const currentPath = typeof location !== 'undefined' ? location.pathname : '/'
  ```
- 更新 ESLint `nest.mjs` 的 `no-restricted-imports`：`@walnut/axios*` → `@walnut/http*`
- `@walnut/server` 的 `package.json` 移除 `@walnut/axios` 依赖声明（死依赖）
- **验证**：`pnpm types:check` + `pnpm lint`；前端 API 调用正常；`grep -r "@walnut/axios" apps/ packages/` 零结果

#### Step 1.4：移动 `client` + `eslint-config`

- 移动 `packages/client/` → `packages/platform-web/client/`
- 移动 `packages/eslint-config/` → `packages/tooling/eslint-config/`
- 更新所有 `@walnut/client` import（~50 个文件）
- **验证**：`pnpm types:check` + `pnpm lint` 零错误；前端 composables 正常加载

#### Step 1.5：配置收尾

- `turbo.json` boundaries 标签同步新包名 + platform 标签
- `pnpm-workspace.yaml` 确认所有子目录被正确匹配
- ESLint `nest.mjs` `no-restricted-imports` 补全 `@walnut/ui*`/`@walnut/i18n*`/`@walnut/security*`
- 更新所有 ADR 文档中引用的旧 package 名
- **验证**：`turbo boundaries` 零违规；`pnpm build` 全量构建成功

### Phase 2：Contract 补全 + Server 清理

#### Step 2.1：`@walnut/contract` 补全共享常量

- 新增 `src/socket.ts`：`WalnutAdminSocketEvents` + `WalnutAdminSocketRooms`
- 新增 `src/cookie.ts`：cookie key 常量（从 `libs/const/app/cookie.ts` 迁出）
- 新增 `src/token-key.ts`：token key 常量（从 `libs/const/app/token.ts` 迁出）
- 新增 `src/crypto-wire.ts`：AES-GCM 有线格式常量（从 `packages/utils/crypto/const.ts` 迁出）
- 注释修正 `response.ts`："code (0 = success)" → "code (20000 = success)"
- **验证**：`pnpm types:check` 零错误

#### Step 2.2：前后端迁移到共享常量

- 前端 `apps/admin/src/socket/event.ts` → 删除 `AppSocketEvents`，改为 import `@walnut/contract/socket`
- 前端 `apps/admin/src/const/persistent.ts` → 改为 import contract cookie token keys
- 后端 `apps/server/apps/api/src/socket/socket.const.ts` → 改为 import contract
- 后端 `libs/const/app/cookie.ts` + `token.ts` → 改为 re-export contract
- 后端 `crypto.service.ts` → 使用 contract `AES_GCM` 常量替代本地重复定义
- **验证**：`grep -r "lock:lock" apps/admin/src apps/server/` 只有一个来源（contract）；前后端各自 `pnpm types:check` 零错误

#### Step 2.3：迁移 API 路由硬编码路径

- Admin `src/api/**` 中 30+ 处硬编码 `url: '/system/...'` → 改为 `url: SystemRoutes.X`
- Server controllers 的 `@Controller('system/user')` → `@Controller(SystemRoutes.USER)`
- **检验方式**：`grep -rn "url: '/" apps/admin/src/api/` 检查剩余硬编码；`grep -rn "@Controller('" apps/server/apps/api/src/` 检查 server 侧
- **验证**：前端 API 调用正常、后端路由注册正常

#### Step 2.4：统一列表分页类型 + Server libs/utils 纯子集迁入

- Server `listAggregate.ts` 的 `IListRequestParams` → 改为 import `@walnut/contract` 的 `BaseListParams`/`SortParam`
- Server `libs/utils/` 纯子集（`general.ts`/`regex.ts`/`mask.ts`/`dayjs.ts`/`pkg.ts`）迁入 `@walnut/utils`
- `@walnut/server` 的 `package.json` 将 `@walnut/utils` 从死依赖变为真实使用
- **验证**：`pnpm types:check` 零错误；后端 `pnpm test` 通过；后端列表 API 功能正常

### Phase 3：新增 Package 创建

#### Step 3.1：`@walnut/ui` Phase 1 —— 核心 25 组件

- 创建 `packages/platform-web/ui/`（包名 `@walnut/ui`）
- 迁入 `apps/admin/src/components/UI/` 全部 25 个组件
- `naive-ui` 设为 peerDependency
- 更新 `WalnutAdminComponentResolver`（`build/vite/plugin/component.ts`）指向 package 路径
- **验证**：`pnpm types:check` + `pnpm lint`；`pnpm dev` 中所有 W* 组件正常渲染；演示页面 `views/demo/data.ts` 正常

#### Step 3.2：`@walnut/i18n`

- 创建 `packages/platform-web/i18n/`（包名 `@walnut/i18n`）
- 迁入 locale bootstrap + 状态机 + naive locale 映射
- 定义 `LocaleFetcher`/`LocaleCache` 接口，在 admin 中注入实现
- **验证**：前端语言切换正常、后端消息加载正常、Naive UI locale 跟随切换

#### Step 3.3：`@walnut/security`

- 创建 `packages/platform-web/security/`（包名 `@walnut/security`）
- 迁入 URL 加密 guard + 签名 interceptor crypto + `VerifyAuth` 类型
- 定义 `SignProvider`/`CryptoKeyProvider`/`VerifyAuthHandler` 接口，在 admin 中注入实现
- **验证**：URL 加密参数解密正常、API 签名正确、二次验证弹窗正常

#### Step 3.4：`@walnut/client` 扩展

- 新增 `createWalnutStore()` 工厂函数到 `@walnut/client`
- 迁入 Cookie 工具、`setupStorageMigrations`、`useCountdownStorage`、`useFixedTopScroll`
- Admin 中 24 个 store 文件逐个迁移到 `createWalnutStore()`
- 移除 `@walnut/client` 中 `vue-router` 死依赖声明
- **验证**：所有 Pinia store 功能正常；Cookie 读写正常；`pnpm types:check` 零错误

### Phase 4：自动导入迁移 + 最终验证

#### Step 4.1：修复自动导入

- 迁入 package 的代码中，所有通过 `unplugin-auto-import` 隐式获取的全局变量改为显式 import
- 更新 `apps/admin/build/vite/plugin/auto-import.ts` 指向新 package
- 更新 `apps/admin/build/vite/plugin/component.ts` 指向新 package
- **验证**：`pnpm dev` 中无 import 错误；浏览器 console 无 `is not defined` 错误

#### Step 4.2：全量验证

- `pnpm types:check` — 所有 package + apps 零错误
- `pnpm lint` — 零错误
- `pnpm build` — 全量构建成功
- `pnpm dev` — 前端 HMR 正常、所有页面可访问
- `pnpm dev:server` — 后端启动正常、API 响应正常
- `turbo boundaries` — 零违规

---

## Consequences

1. **目录即文档**：看到 `packages/platform-web/` 就知道后端不能 import——无需查 tag 或 ADR
2. **`@walnut/utils` 边界清晰**：拆分后 `utils-core` 是真正的纯 JS，`types/` 收容了环境相关的类型声明
3. **共享常量去重**：socket 事件名、cookie/token key、AES-GCM 有线格式只在 contract 中定义一次
4. **Pinia store 样板消除**：24 个文件中的 `defineStore` 重复模式被 `createWalnutStore()` 替代
5. **新增 package 铺好路**：`@walnut/ui`（25 组件）、`@walnut/i18n`、`@walnut/security` 有明确的迁入清单和依赖注入接口
6. **Server 死依赖清理**：`@walnut/axios` 和 `@walnut/utils` 要么真正使用，要么移除声明
7. **破坏性改动集中**：Phase 1 目录重组 + 重命名影响上百个文件，但后续 Phase 是增量添加
8. **自动导入是高风险点**：大量 admin 代码依赖 unplugin-auto-import 的全局变量——迁入 package 后必须改为显式 import。这是最容易出 bug 的环节

## Related

- [ADR-0001](0001-package-naming.md) — 包命名：诚实命名
- [ADR-0002](0002-dual-mode-consumption.md) — 双模式消费
- [ADR-0005](0005-jit-vs-build.md) — 前端 only 包 JIT，共享包 CJS 构建
- [ADR-0006](0006-runtime-api-separation.md) — 按运行时 API 依赖分层——本条 ADR 是对其的升级和细化
- [ADR-0011](0011-dependency-governance-release.md) — 依赖治理 + changeset 发布
- [ADR-0012](0012-toolchain-divergence.md) — 前后端工具链分歧（含 tag-based boundaries）
- [ADR-0013](0013-barrel-exports-policy.md) — Barrel export 策略
