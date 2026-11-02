# package 下沉探索：跨端共享面的下一批候选

> **状态：【提案·待拍板】｜ 日期：2026-11-02**
>
> 输入：解耦 22 提交（34 个后端内部 lib 八层分层）、契约上收（contract 新增
> setting / mfa / user-lock / preference / sse / socket 六模块，123 条路由常量 +
> parity 门禁）、utils 上收（object-paths / sign-raw，server 已消费 `@walnut/utils`）
> 之后的现状扫仓 + 2024-2026 外部实践对照。
>
> 本轮**不实施任何代码改动**。本文只给候选、证据、成本、风险与批次建议；拍板后按
> 「落地批次建议」逐批执行。约束底线沿用：ADR 0007（后端内部 lib 不提升为 workspace
> 包）、ADR 0016（校验栈不迁 zod）、路线图 §3（HTTP 出入参 100% 由 OpenAPI 生成，
> contract 只放两端运行时共享物）。

## 0. 结论先行

一句话结论：**跨端「值」的上收基本做完了，剩下的大头不是再建包，而是把两条已开工
但没收口的链路做完（OpenAPI 请求体、UI 抽包），加一条防漂移门禁（权限串）；ADR 0017
遗留的 `@walnut/i18n` 与 `@walnut/security` 在今天的形态下都不值得建。**

### 0.1 一览表

| 编号 | 候选 | 目标 | 优先级 | 前置条件 |
|------|------|------|--------|----------|
| C1 | 修 `@walnut/ui` 抽包断裂：Form 的 componentMap 三条悬空 import | `@walnut/ui` | **P0** | 无 |
| C2 | 退役 `createWalnutStore` 与 `@walnut/client` 死导出 | `@walnut/client`（收缩） | **P0** | 无 |
| C3 | 权限串对账门禁（先门禁，不迁字符串） | `@walnut/scripts`（校验脚本） | **P0** | 先拍板「seed 是目录真源」 |
| C4 | OpenAPI 请求体收口，退役手写 `request.d.ts` | `@walnut/api-types` | **P0** | server 补真实 requestBody；openapi 重导出 |
| C5 | `@walnut/ui` 首批零依赖组件迁移（8 个） | `@walnut/ui` | **P1** | C1；admin 构建/类型检查全绿 |
| C6 | 权限目录常量整体上收（125 串进 contract） | `@walnut/contract` | **P2（暂不做）** | C3 结果；seed 补齐决策 |
| C7 | server `libs/utils` 残余（`mask` 系列双端化） | `@walnut/utils` | **P2（暂不做）** | 前端出现本地掩码需求 |
| C8 | contract 契约体检（cookie / token-key 注释与消费登记） | `@walnut/contract` | **P2** | 无 |
| C9 | `@walnut/i18n` | 不建 | **不做** | — |
| C10 | `@walnut/security` | 不建 | **不做** | — |
| C11 | 共享运行时校验（zod / Standard Schema） | 不建 | **不做** | ADR 0016 的触发条件未变 |
| C12 | 字典映射 / 日期数字格式化 / 环境判定 / 存储 key 上收 | 不建 | **不做** | — |
| C13 | UI 巨型组件（Form / Table / Tree）抽包 | 不建 | **不做** | 第二个前端 app 或独立设计系统 |

### 0.2 本提案不做（先给理由，详述见 §3）

| 候选 | 结论 | 一句话理由 |
|------|------|------------|
| `@walnut/i18n` | 不做 | admin 的 `messages` 是空对象，语言包唯一来源是数据库；双端 i18n 引擎不同，没有可共享的运行时资产 |
| `@walnut/security` | 不做 | 密码学原语已在 `@walnut/client`；admin 残余 442 行是 store / router / axios 编排，不是可复用安全逻辑 |
| 共享校验（zod） | 不做 | ADR 0016 的四个触发条件一个都没触发；NestJS 12 的 Standard Schema 仍是加法，且不解决 OpenAPI 生成 |
| 字典 / 格式化 / 环境 / 存储 key | 不做 | 字典在库（14 类型 / 169 行 seed），admin 无硬编码状态映射；格式化只有前端；环境判定按 ADR 0017 属 app；存储 key 两端语义不相交 |
| UI 巨型组件抽包 | 不做 | Form 2021 行、Table 1573 行、Tree 550 行，且依赖 store / router / i18n / 业务组件；拆分是独立项目，不是「顺手迁包」 |

## 1. 扫仓方法与实测读数

### 1.1 读数（可复跑）

下表所有数字都由本节的命令在本仓当前工作树上实测得到（2026-11-01 夜；
`git status` 的既有改动不属于本轮）。§2 里引用的每个数字都能在本表或 §1.2 找到
对应命令；引用时请重跑，不要抄死数字。

| 读数 | 值 | 命令 |
|------|----|------|
| server 权限装饰器使用点 | 128 | `grep -rn "@WalnutAdminDecoratorHasPermission" apps/server --include=*.ts \| wc -l` |
| controller 本地 `Permissions` 表 | 28 | `grep -rln "const Permissions = {" apps/server/apps/api/src apps/server/libs --include=*.ts \| wc -l` |
| server 权限字面量（去重） | 125 | 见 §1.2 的脚本（扫描 `system:` / `app:` / `me:` 前缀） |
| seed 菜单里的权限串（去重） | 104 | 同上脚本（解析 `apps/server/db/seed/sys_menu.json`） |
| server 有、seed 无的权限串 | 23 | 同上脚本（差集） |
| admin 模板拼接权限点 | 42（9 个文件） | 同上脚本（反引号模板字面量） |
| admin 完整字面权限串 | 19（含 3 条测试夹具） | 同上脚本 |
| admin 手写请求类型 | 30 个 interface + 2 个 type 别名（31 个导出）/ 182 行 | `grep -c interface apps/admin/src/api/request.d.ts` |
| 手写请求类型的消费文件 | 15 | `grep -rl "IRequestPayload" apps/admin/src --include=*.ts --include=*.vue \| wc -l` |
| OpenAPI 已文档化 requestBody 的缺失面 | 42 条写端点 | 见 §1.2 的脚本（遍历 `openapi.json`） |
| admin 剩余 UI 组件目录 | 22 | `find apps/admin/src/components/UI -mindepth 1 -maxdepth 1 -type d \| wc -l` |
| `@walnut/ui` 已迁组件 | 3（.vue） | `find packages/platform-web/ui/src -name "*.vue" \| wc -l` |
| `@walnut/ui` 真实模板使用 | 1 个组件 / 2 处（demo） | `grep -rn "<WDynamicTags\\|<WSwitch\\|<WTimePicker" apps/admin/src --include=*.vue` |
| `@walnut/client` 导出 | 54 | `packages/platform-web/client/src/index.ts` |
| `@walnut/client` 无外部消费的导出 | 4 | 见 §1.2 的脚本 |
| `createWalnutStore` 消费点 | 0 | `grep -rn "createWalnutStore" apps --include=*.ts --include=*.vue \| grep -v node_modules \| grep -v platform-web/client` |
| admin store 文件（defineStore） | 23 | `grep -rn "defineStore(" apps/admin/src/store --include=*.ts \| wc -l` |
| admin 本地 i18n 消息 | 0（`messages: {}`） | `grep -n "messages: {}" apps/admin/src/locales/index.ts` |
| server i18n 目录 | 2 语言 / 8 JSON / 254 行 | `wc -l apps/server/apps/api/src/i18n/*/*.json \| tail -1` |
| server `libs/security` | 3435 行 | `find apps/server/libs/security/src -name "*.ts" \| xargs wc -l \| tail -1` |
| admin 安全编排与传输层 | 812 行（app-security 253 + axios 目录 559） | `wc -l apps/admin/src/store/modules/app/app-security.ts`；`find apps/admin/src/utils/axios -name "*.ts" \| xargs wc -l \| tail -1` |
| `@walnut/client` 密码学原语 | 488 行 | `find packages/platform-web/client/src/browser/crypto -name "*.ts" \| xargs wc -l \| tail -1` |
| server `libs/const` 总量 | 604 行（21 个文件，9 个已 re-export contract） | `find apps/server/libs/const/src -name "*.ts" \| xargs wc -l \| tail -1` |
| server `libs/utils` 总量 | 577 行（11 个文件） | `find apps/server/libs/utils/src -name "*.ts" \| xargs wc -l \| tail -1` |
| contract 前端消费文件 | 52 | `grep -rl "@walnut/contract" apps/admin/src --include=*.ts --include=*.vue \| wc -l` |
| contract cookie key 的前端消费 | 0（45 个 server 文件） | `grep -rl "WalnutAdminConstCookieKeys" apps --include=*.ts \| grep -v node_modules \| grep -v contract/src` |
| contract token key 的前端消费 | 0（仅 token.service） | `grep -rl "WalnutAdminConstAppTokenKey" apps --include=*.ts \| grep -v node_modules` |

### 1.2 两个一次性脚本的判据

权限面脚本（Node，统计 server / seed / admin 三份目录）：

```bash
node -e "
const fs=require('fs'),path=require('path');
const srcs=(d,out=[])=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);
  if(f.isDirectory()){if(['node_modules','dist','.turbo'].includes(f.name))continue;srcs(p,out)}
  else if(/\.(ts|vue)$/.test(f.name))out.push(p)}return out};
const seed=new Set();const walk=x=>{if(Array.isArray(x))x.forEach(walk);
  else if(x&&typeof x==='object')Object.values(x).forEach(walk);
  else if(typeof x==='string'&&/^(system|app|me):[A-Za-z0-9:]+$/.test(x))seed.add(x)};
walk(JSON.parse(fs.readFileSync('apps/server/db/seed/sys_menu.json','utf8')));
const server=new Set();for(const f of [...srcs('apps/server/apps/api/src'),...srcs('apps/server/libs')]){
  for(const m of fs.readFileSync(f,'utf8').matchAll(/['\\\"]([a-z]+(?::[A-Za-z0-9]+){2,})['\\\"]/g))server.add(m[1])}
console.log('seed',seed.size,'server',server.size,'server-not-in-seed',[...server].filter(p=>!seed.has(p)).length);
console.log([...server].filter(p=>!seed.has(p)).join('\n'));
"
```

OpenAPI requestBody 缺失面脚本：

```bash
node -e "
const s=require('./apps/server/openapi.json');const missing=[];
for(const [p,ops] of Object.entries(s.paths))for(const [m,op] of Object.entries(ops)){
  if(!['post','put','patch','delete'].includes(m))continue;
  if(!op.requestBody)missing.push(m.toUpperCase()+' '+p)}
console.log('write ops without documented requestBody:',missing.length);
console.log(missing.join('\n'));
"
```

### 1.3 上一轮已收面（本轮不重复提案）

force-quit / user-lock / preference / MFA 类型 / roleMode / SSE / socket payload /
123 条路由常量 / `objectToPaths` / `buildSignRaw` / `maskEmail` 修复，均已上收或已登记。
本轮聚焦：**还没上收的重复面、已开工但没收口的链路、以及「上轮判定 server-only」的复核**。

## 2. 候选详述（P0 / P1 / P2）

### 2.1 C1：修 `@walnut/ui` 抽包断裂（P0）

**动机（实测）**

- `apps/admin/src/components/UI` 现有 22 个组件目录；2026-08 的提交把
  `Switch` / `DynamicTags` / `TimePicker` 三个目录整体移进了 `@walnut/ui`，
  但 Form 的 `componentMap` 仍按 `../../../../<Name>/index.ts` 从 admin 目录动态导入。
  三个目标目录**已不存在**（`ls` 直接报 No such file or directory）。
- 构建**不会红**：`npx vite build --mode development` 退出码 0，但产物里的
  componentMap 只有 21 个 UI 条目，缺这三个键；运行时落到
  `Unknown variable dynamic import` 分支。三条 `Base:` schema
  （`Base:Switch` / `Base:TimePicker` / `Base:DynamicTags`）在 demo 表单里都有使用，
  打开即失败。这证明「构建绿」不是这条链路的守卫。
- `@walnut/ui` 的 3 个组件里，`WDynamicTags` 有 2 处 demo 使用，`WSwitch` /
  `WTimePicker` 模板使用为 0（只剩 Form 的类型引用）。

**目标**：`@walnut/ui`（不新建包）。

**成本**：约 0.5 人日。改 Form `componentMap` 的 3 个映射（指向
`@walnut/ui/<Name>`），或删掉这 3 个 schema 类型并同步 demo。无依赖变化，无构建变化。

**风险**：低。唯一决策点是「这三个类型是否还保留」——保留就指向包，删掉就删干净，
不能继续留悬空 import。

**优先级**：P0。这是已存在的运行时缺陷，修复成本最低，且是 C5 的前置。

### 2.2 C2：退役 `createWalnutStore` 与 `@walnut/client` 死导出（P0）

**动机（实测）**

- `createWalnutStore` 在 `apps/**` 与 `packages/**` 的消费点为 **0**（排除自身定义与
  barrel）。它是 ADR 0017 Step 3.4 为「24 个 store 文件去样板」而加的，但 admin 的
  23 个 `defineStore` 仍各自手写 6 行 `useInside / useOutside / getCurrentInstance`
  访问器（示例：`apps/admin/src/store/modules/app/app-cached-views.ts` 末尾）。
- `@walnut/client` 的 54 个导出中，有 4 个**包内包外都无消费**：
  `createWalnutStore`、`downloadByOnlineUrl`、`getFunctionBoolean`、
  `useDraggableElement`。
- `pinia` 在 `@walnut/client` 里**只**被 `createWalnutStore.ts` 使用；退役它即可把
  `pinia` 从 peerDependencies 摘掉，包面更诚实。

**目标**：`@walnut/client`（收缩，不新建包）。

**成本**：约 0.5 人日。删 4 个导出，其中两个是整文件（`createWalnutStore.ts`、
`useDraggableElement.ts`），另两个函数从各自的 download / shared 文件里移除；
`package.json` 摘 `pinia` peer 与 devDependency（只剩它一个消费者）；
CHANGELOG 记一条 breaking（包是源码直消费，仓内零调用）。

**风险**：低。仓内零消费；若外部有人用，需要 minor/major 版本决策——本仓是
fixed 组发布，按既有 release 流程处理。

**优先级**：P0。零风险清死代码，同时消除「工厂存在但没人用」的认知负担。

### 2.3 C3：权限串对账门禁（P0，先门禁不迁字符串）

**动机（实测）**

- 服务端：128 个 `@WalnutAdminDecoratorHasPermission` 使用点，散在 **28 个
  controller 本地 `Permissions` 表**里，去重后 **125 条**权限字面量。
- 数据侧：`apps/server/db/seed/sys_menu.json` 里 **104 条**权限串。
- 两端差集：**23 条 server 代码里有、seed 里没有**。例如
  `system:user:pass:reset`、`system:user:mfa:totp:rebind`、
  `system:user:preference:updateTheme`、`app:health:postgres`、`app:key:read`、
  `app:shared:ali:sts`。这些端点要么只对 ROOT 生效，要么是内部端点——**当前没有任何
  机制区分**，也没有门禁阻止新增第四条无 seed 的权限。
- 前端：admin 有 **42 处模板拼接**（9 个文件，形如 `system:${authKey}:list`）+
  **19 条完整字面量**（含 3 条测试夹具）。`authKey` 的取值（`log:operate`、
  `dict:type`、`deleted` 等）与 server 的表名/权限前缀是**靠约定对齐**的。

**目标**：先做门禁（`@walnut/scripts` 的新校验脚本，或 server 侧 spec），
**不**在这一批把 125 条串迁进 contract。

**成本**：1-2 人日。脚本扫三份来源并输出 file:line；prepush / CI 接线；
为 23 条内部权限建显式 allowlist（每条写理由）；加一条「篡改注入必须失败」的自测。

**风险**：中低。门禁天然会一次报出 23 条差异，需要产品/后端先拍板：
`app:health:*`、`app:demo:*`、`app:shared:*` 是内部端点还是漏种；allowlist 一旦
失控就退化成摆设（判据写法沿用 `check-doc-refs.ts` 的「每条豁免必须写理由」）。

**优先级**：P0。它不改运行时，只把「静默漂移」变成「显式红」，与 ADR 0023 的
route parity 是同一套方法论。**为什么不直接迁 contract**：seed 是权限的运行时数据
真源，把 125 条串搬进 contract 只是多一份镜像，且要动 28 个 controller + 9 个
admin 文件；门禁用 1/10 的成本拿到主要收益。C6 保留为「门禁跑一段时间后再决定」。

### 2.4 C4：OpenAPI 请求体收口，退役手写 `request.d.ts`（P0）

**动机（实测）**

- `apps/admin/src/api/request.d.ts` 仍有 **30 个 interface + 2 个 type 别名**
  （182 行），被 **15 个文件**消费（`IRequestPayload`）。这正是路线图 §3
  「HTTP 出入参 100% 由 OpenAPI 生成」的最后一块未收口面：`models.d.ts`（304 行）
  已退役，`response.d.ts` 已收缩，唯独请求侧还手写。
- `openapi.json` 有 **42 条写端点没有 requestBody**（其中多数是按路径/删除语义本就
  无 body，但真实带 `@Body()` 的缺口确实存在）。已实证一处漂移：
  admin 的 `authMfaTotpGenerateAPI` 仍发 `{ name }`，而 server 的
  `generateTotp` 根本没有 `@Body`——请求字段被静默忽略。
- 外部实践与本仓现状一致：生成物 check-in + CI `git diff --exit-code` 已是本仓既有
  做法（`openapi:check`），「生成物 + 薄别名层」也是推荐形态；缺的不是机制，而是
  **最后 31 个手写类型的替换**。

**目标**：`@walnut/api-types`（不新建包）。server 侧补齐真实 requestBody 的
DTO 文档化，admin 侧改 import 生成的操作类型。

**成本**：2-3 人日。逐端点核对 `@Body()`（重点：`/system/user/device/*` 的
rename/lock、`/system/user/mfa/totp/*`、`/system/user/mfa/webauthn/*`、
`/system/user/identity/*`）；重跑 `openapi:export` + `openapi:generate`，
审 `openapi.json` 与 `schema.d.ts` 的 diff（wire 零变化的预期要写进验收）。

**风险**：中。openapi.json 的字节形态是敏感面（AppModule import 顺序也会影响）；
必须用既有 `openapi:check` 兜底。个别端点（如 TOTP generate）需要先决定「name 是
该补到 server 还是从 admin 删掉」——这属于产品契约，不是纯类型活。

**优先级**：P0。它把一个已声明的 100% 不变量补成真，并同时消掉一类手写镜像漂移；
与 C3 同属「先让漂移可见，再收口」。

### 2.5 C5：`@walnut/ui` 首批零依赖组件迁移（P1）

**动机（实测）**

- admin 剩 22 个 UI 组件目录。按「无 `@/` 依赖、无跨目录相对 import」筛，
  **8 个组件可直接迁**：Card（66 行）、ColorPicker（35）、DatePicker（21）、
  Dropdown（94）、Input（93）、InputNumber（30）、Modal（159）、TreeSelect（114），
  合计 **612 行**。
- 下一档 3 个（ButtonConfirm 43、ButtonGroup 26、IconButton 90）只依赖
  Button / Icon；而 Button 读 `user-permission` store、Icon 读 `user-preference`
  store——把权限/偏好判断改成 prop 或注入的 composable，即可再迁 3 个（159 行）。
- 其余 11 个是 app 耦合面：Form（2021 行，依赖业务组件 / i18n / hooks）、
  Table（1573 行，依赖 store / App 主题 / AppNotAuthorized）、Tree（550 行，
  依赖 Extra / UI / i18n / store），以及 Checkbox / Radio / Select（依赖
  `@/components/HOC`）、Descriptions（依赖 Extra / useDict / i18n）、Drawer
  （依赖 router）、ButtonRetry（依赖 useCountdown）。
- 外部实践结论一致：可抽的是「零应用依赖的展示组件」；一旦组件知道 store /
  router / i18n / 业务 DTO，它就不是通用 UI。单 app 仓还要过「三次真实使用」的
  门槛——本仓目前是 1 个 app，所以本批的定位是**划边界 + 清耦合**，不是追求复用收益。

**目标**：`@walnut/ui`。

**成本**：2-3 人日。8 个组件迁移 + build plugin 已扫描包路径（无需改）；
Form `componentMap` 的键名到包路径要做一次统一映射；`components.d.ts` 重新生成。

**风险**：中。admin 无测试 runner（`apps/admin/package.json` 无 vitest），验证只能
靠 `vue-tsc`、`eslint`、`vite build` 与 demo 页手工走查——这是本批最贵的部分，也是
为什么必须先把 C1 的断裂修好，否则「迁移后绿但页面坏」会再次发生。

**优先级**：P1。没有第二个消费方，收益是边界与耦合清理；不与 P0 抢窗口。

### 2.6 C6：权限目录常量整体上收（P2，暂不做）

**动机**：C3 的门禁若显示「三份目录长期无法收敛」，可考虑把 125 条串做成
`@walnut/contract` 的 `as const` 目录，server controller 与 admin 共同 import。

**目标**：`@walnut/contract`。

**成本**：3-5 人日（28 个 controller + 9 个 admin 文件 + contract 四处登记 +
快照 diff）。**风险**：seed 仍是运行时数据真源，contract 目录会变成第四份镜像；
权限是「数据」不是「代码常量」，迁移不消灭漂移，只是把漂移搬进包。

**优先级**：P2（暂不做）。触发条件：① C3 门禁上线后仍持续出现新漂移；
② 出现第二个前端 app 需要同一套权限键；③ 权限开始参与路由/菜单之外的逻辑
（如前端按权限做数据脱敏），需要编译期约束。

### 2.7 C7：server `libs/utils` 残余复核（P2，暂不做）

**动机（实测）**：`libs/utils` 剩 577 行 / 11 个文件。逐项复核：

| 文件 | 现状 | 跨端潜力 | 判定 |
|------|------|----------|------|
| `mask.ts` | `maskEmail` / `maskPhone` / `maskSensitiveFields` / `maskIdentityValue`，server 49 处消费 | 前端目前只消费 server 返回的 `maskedValue`，无本地掩码需求 | P2：出现本地掩码需求再上收 |
| `regex.ts` | `emailOffSensitive` / `phoneNumberSensitive` 在用；`uuidv4` **0 引用** | 无 | 删死条目（可随 C8 一起做） |
| `general.ts` | `objectToPaths` 已 re-export `@walnut/utils`；`generateVerifyCode` / `sleep` 纯函数 | 前端不需要 | 留 server |
| `dayjs.ts` | utc/tz 插件封装，仅 server 令牌过期计算 | 无 | 留 server |
| `pkg.ts` | 读 `process.cwd()/package.json` | 无 | 留 server |
| `headers.ts` / `response.ts` / `dto.ts` / `pg-jsonb.ts` | Nest / 响应壳 / jsonb | 无 | 留 server |

**目标**：`@walnut/utils`（仅 `mask` 系列）。

**结论**：没有新的「纯资产」需要上收；`mask` 是唯一有条件的候选，且当前无消费者。
`uuidv4` 死条目建议直接删。

### 2.8 C8：contract 契约体检（P2）

**动机（实测）**

- `WalnutAdminConstCookieKeys`：45 个 server 文件消费，**admin 0 个**；
- `WalnutAdminConstAppTokenKey`：只有 `apps/server/libs/token/src/token.service.ts`
  消费，**admin 0 个**。
- 两个文件的注释都写着「frontend consumers / used by both」——与实测不符。值本身
  必须保留（快照与 server 前缀逻辑依赖），但注释应改成「当前仅 server 消费；
  为前端预留」，或在 contract 里加一行消费登记。

**目标**：`@walnut/contract`（只改注释与登记，不动值）。

**成本**：0.5 人日（纯注释/文档）。**风险**：无。**优先级**：P2（准确性卫生）。

## 3. 本提案不做（逐项理由）

### 3.1 C9：`@walnut/i18n` 不值得建

- admin 的 i18n 实例是 `messages: {}`，**本地零语言包**；语言包唯一来源是后端
  `/system/locale/message/:locale`（seed `sys_locale.json` 626 KB）。也就是说
  「前端语言包」这个资产根本不在代码里。
- server 的 i18n 是 `nestjs-i18n`：2 种语言 × 4 个 JSON，共 254 行 / 每语言 92 个
  叶子键（business 27 / email 10 / index 2 / response 53），且已有
  `i18n.generated.d.ts` 类型。admin 拿到的错误消息是 server 翻译好的 `msg`，
  不消费这 92 个键。
- 双端唯一的共享物是 `Locale` 枚举，**已经在 contract 里**。ADR 0017 §3.2 设想的
  `LocaleFetcher` / `LocaleCache` 是单 app 的启动接线，搬进包只是给一个 app 加一层
  peer 依赖。
- 结论：不做。同步动作：从 `check-doc-refs.ts` 的 `ALLOWED_MISSING_PACKAGES`
  摘掉 `@walnut/i18n`，并把 ADR 0017 的 Phase 3.2 勾选项标为「不做（2026-11-02 评估）」。

### 3.2 C10：`@walnut/security` 不值得建

- server `libs/security` 是 3435 行的 Nest 域（cap / risk / sensitive / sign），
  与 DI、Redis、guards 绑定，ADR 0007 已排除提升。
- admin 的安全残余是 812 行：`app-security.ts` 253 行 + axios 包装/拦截器 559 行，
  它们是 store / router / axios 的编排；真正的密码学原语 **488 行已在
  `@walnut/client`**（RSA-OAEP、AES-GCM、HKDF、HMAC），且 server 与前端共享的
  签名原文已上收 `@walnut/utils/sign-raw`。
- ADR 0017 §3.3 设想迁「URL 加密 guard + 签名 interceptor crypto + VerifyAuth 类型」，
  但这三者的宿主分别是 router store、axios 实例、UI 组件，抽成包需要定义三组
  provider 接口，收益是零（只有一个 app）。
- 结论：不做。同步动作同上：摘 `ALLOWED_MISSING_PACKAGES` 的
  `@walnut/security`，ADR 0017 Phase 3.3 标记「不做」。

### 3.3 C11：共享运行时校验（zod / Standard Schema）不做

- ADR 0016 的决策与四个触发条件均未变；路线图 §1 已复核「不迁 zod」。
- server 的 libs 下 36 个文件使用 `class-validator` 装饰器体系；`WalnutAdminDecoratorField*`
  已把校验 + 转换 + Swagger 合成一次声明，迁移要重写 100+ DTO。
- 前端表单是 naive-ui 的 `FormItemRule` / async-validator，不存在 zod schema。
- NestJS 12 的 Standard Schema 支持是**加法**：`StandardSchemaValidationPipe` 需要
  显式注册，且不解决 zod → OpenAPI 的生成问题（本轮已核对外部资料）；这恰好是本仓
  拒绝 zod 的核心原因。
- 已有的共享校验只剩叶子谓词 `isEmailAddress` / `isPhoneNumber`，它们已在
  `@walnut/utils/regex`，前端 10 处消费；这已经是合理的共享粒度。
- 结论：不做。触发条件沿用 ADR 0016（前端引入 VeeValidate + Zod / 新绿地模块 /
  class-validator 失维 / 3+ 前端 app）。

### 3.4 C12：字典映射 / 日期数字格式化 / 环境判定 / 存储 key 不做

- **字典**：`sys_dict_type` 14 类、`sys_dict_data` 169 行在库里；admin 通过
  `useDict` / `dictType` 消费，**没有硬编码状态映射**（实测 `probation` /
  `resigned` / `enabled` 在 admin 0 命中）。把这些搬进包等于把数据复制成代码。
- **日期 / 数字格式化**：admin 用 `easy-fns-ts` / `Intl` / `toLocaleString`，
  server 的 `dayjs` 只做令牌过期计算，没有「同一格式化双端各写一份」的面。
- **环境判定**：admin 是 `import.meta.env`（15 处），server 是 `process.env` +
  `isDev/isProd`；ADR 0017 明确纯包不读环境，配置由 app 注入。跨端共享一个
  `isDev` 只会把构建期与运行期的差异藏起来。
- **存储 key**：admin 的 19 个 `AppConstPersistKey` 是 localStorage/IndexedDB 键；
  server 的 cookie key 带 `__Host-` / `__Secure-` 前缀、cache key 是 Redis 键——
  两组**语义不相交**。唯一形似的是 `ACCESS_TOKEN`，但一个是 localStorage 键、
  一个是 JWT payload 的 `key` 值，不是同一物。

### 3.5 C13：UI 巨型组件抽包不做

Form 2021 行、Table 1573 行、Tree 550 行，分别依赖业务组件 / i18n / hooks、
store / App 主题 / 权限组件、Extra / UI / i18n / store。抽出它们需要先做
headless（逻辑与样式分离）+ 插槽/注入协议，是一个独立项目；在只有一个前端 app 的
前提下没有复用收益，只有跨包调试成本。触发条件：出现第二个前端 app，或决定做独立
设计系统。

## 4. 外部实践对照（2024-2026）

本轮联网核对的结论，用于校准上面的取舍（来源清单见 §7）。

### 4.1 contract-first vs codegen-first：本仓的混合形态是对的

2025-2026 的共识是：**单团队 + 单前端仓 → 共享契约包（contract-first）更便宜；
有非 TS 消费方 / 对外 API → OpenAPI 生成（codegen-first）**。本仓实际是混合：
运行时共享值（枚举 / response code / 路由 / socket）走 contract，HTTP 出入参走
OpenAPI 生成。这与「Zod 做真源、再 emit OpenAPI 给外部消费者」的成熟形态同构，
区别只是真源在 class-validator 装饰器而不是 Zod——在 ADR 0016 的约束下不需要改。
关键纪律两条：(1) 共享契约包必须无副作用、可被浏览器与测试廉价导入（本仓 contract
已做到双模构建）；(2) 不共享「肥客户端」，只共享契约（本仓 `@walnut/http` 是薄
adapter，符合）。

### 4.2 共享校验：zod 的收益与坑都在「运行时」，本仓没有这个需求

外部资料反复强调：共享 Zod 的真实收益是**运行时 parse**（API 先于前端部署、null
不期而至），类型只是副产品；坑集中在三处：Nest 的 `tsc` 不编译 rootDir 之外的
源码（需要把 contracts 构建成产物）、`class-validator` DTO 不能共享给前端（会把
reflect-metadata / TypeORM 拖进浏览器）、Zod `.strip()` 会静默删字段。本仓三条都
不成立或不值得：没有前端运行时校验需求、没有跨仓消费方、包构建已是 CJS 双模。
NestJS 12 的 Standard Schema 是「加法」，且第三方资料没有给出 zod → OpenAPI 的
一等支持——与本仓路线图 §1 的判断一致。

### 4.3 UI 抽包边界：Headless + 样式分层，且要过「三次使用」门槛

外部实践把可抽组件限定为「纯展示、零应用依赖」；一旦组件 import store / router /
i18n / 业务 DTO，它就不是通用 UI。成熟形态是 headless 原语（行为/可访问性）+
样式层分离（如 reka-ui 的无样式 primitives）。同时有明确的「三实例规则」：两个使用
可能是巧合，三个才是模式；单 app 仓抽 25 个组件是**为未来抽象**，不是为当下复用。
本仓的 C5 因此只收零依赖的 8 个，并把 Button/Icon 的 store 读取改成 prop/注入作为
第二档前置，而不是一次性搬 22 个。

### 4.4 i18n 包形态：共享的前提是「同一份语言资产」

外部常见形态是「shared/locales 放 JSON，nestjs-i18n 用 assets + outDir 复制，
vue-i18n 直接 import 同一份 JSON」。这要求两端**共享同一套键与文案**。本仓恰好相反：
server 的 92 个键（邮件/响应）与 admin 的界面文案（在数据库）没有交集，admin 连本地
`messages` 都是空的。因此 `@walnut/i18n` 没有可搬的资产——这正是 C9 判「不做」的
外部对照依据，而不是拍脑袋。

### 4.5 类型生成链路：生成物 check-in + CI diff 已是标准，本仓只差收尾

外部最佳实践与本仓一致：生成物提交、禁止手改、CI 重新生成后 `git diff --exit-code`
（本仓 `openapi:check`）、生成物 + 人类可读别名层（本仓 `api-types/src/index.ts` 的
别名正是这一层）、固定生成器版本、输出格式稳定。唯一缺口是 `request.d.ts` 这 31 个
手写类型：它们既不是生成物，也不是「不可推导形状」的登记（后者在
`apps/admin/src/api/types/frontend-shapes.ts` 有明确格式）。C4 就是把它并入既有链路。

### 4.6 权限：单一 typed 目录 + 漂移门禁是主流

外部案例（含一次真实迁移）的教训是：前后端各自手写权限串，最常见的故障是
「前端允许、后端拒绝」的静默错配；修复方式是**单一 typed 目录 + codegen/CI 漂移
检查 + 禁止裸字符串的 lint**。本仓的差异是权限目录的运行时真源在数据库（seed），
所以 C3 选择「门禁优先、目录后置」：先把三份来源的对账做成红/绿，再决定要不要把
目录搬进 contract。这与「单一真源」不矛盾——真源仍是 seed，门禁只是防止代码侧
长出第四份。

## 5. 落地批次建议

### 5.1 P0 批（建议一个迭代内完成，4 个独立提交）

| 批次 | 内容 | 验收判据 |
|------|------|----------|
| P0-1 | C1：Form `componentMap` 三条悬空 import 修掉（指向 `@walnut/ui` 或删除类型） | `pnpm -C apps/admin build` 绿；产物 componentMap 含全部保留类型；demo 的 Switch / TimePicker / DynamicTags 表单可打开且无 `Unknown variable dynamic import`；`grep` 不再出现指向已迁目录的 `../../../../<Name>` |
| P0-2 | C2：删 `createWalnutStore` + 3 个死导出 + `pinia` peer | `grep -rn "createWalnutStore" apps packages --include=*.ts --include=*.vue \| grep -v node_modules` 为 0；`pnpm types:check` 绿；`pnpm build` 绿；client 的 `package.json` 不再声明 pinia |
| P0-3 | C3：权限对账门禁（脚本 + allowlist + 注入自测） | 脚本扫描 server / seed / admin 三份来源并输出 file:line；当前 23 条差异全部进 allowlist 且有理由；篡改注入用例失败；prepush / CI 跑该脚本 |
| P0-4 | C4：补 server requestBody + 删 `apps/admin/src/api/request.d.ts` | `pnpm openapi:export && pnpm openapi:generate && pnpm openapi:check` 零 diff（除预期新增 requestBody）；`grep -rl "IRequestPayload" apps/admin/src` 为 0；`pnpm types:check` 绿；TOTP generate 的 `name` 二选一（补 server 或删前端）已定案 |

P0 的共同点：全部是「把已开工的链路收口或把静默失败变显式」，不引入新包、不改
ADR、不碰 wire（C4 的 requestBody 新增是文档面，wire 零变化）。

### 5.2 P1 批（P0 之后，按 C3 结果排序）

| 批次 | 内容 | 验收判据 |
|------|------|----------|
| P1-1 | C5：迁 8 个零依赖组件；Button/Icon 去 store 化后再迁 3 个 | `@walnut/ui` 组件数从 3 增至 11/14；`vue-tsc` / `eslint` / `vite build` 全绿；demo 的 UI 与 form 页逐项走查；`@walnut/ui` 内 `grep -r "@/` 为 0 |
| P1-2 | C3+C6 的决策收尾：23 条权限差异逐条定性（补 seed / 内部 allowlist / 删代码） | seed 或 allowlist 的最终形态有书面理由；门禁零豁免漂移；跨端权限串的「前端有、后端无」方向另有反向检查 |
| P1-3 | C9/C10 的「不做」落档：ADR 0017 勾选项与 allowlist 清理 | ADR 0017 Phase 3.2/3.3 标「不做（2026-11-02 评估）」；`ALLOWED_MISSING_PACKAGES` 不再含 `@walnut/i18n` / `@walnut/security`；`pnpm lint:docs-refs` 绿 |

### 5.3 P2 批（有空再做）

- C8：contract 的 cookie / token-key 注释与消费登记修正（0.5 人日）。
- C7：删 `regexMap.uuidv4` 死条目；`mask` 系列登记触发条件（出现前端本地掩码需求
  再上收 `@walnut/utils`）。
- C6：只有 C3 门禁长期无法收敛时才启动；启动前先回答「seed 是否仍是真源」。

## 6. 登记与后续

- 本页已在 `apps/docs/.vitepress/config/zh.ts` 的「计划与设计」段追加，`build:docs`
  死链校验覆盖本页。
- 本提案若拍板，需要连带更新的登记面（不在本批执行）：
  1. `packages/tooling/scripts/src/ci/check-doc-refs.ts` 的 `ALLOWED_MISSING_PACKAGES`
     摘掉 `@walnut/i18n` / `@walnut/security`（它们现在的理由是「规划中」）；
     同一张表里 `packages/platform-any/contract/src/data-scope.ts` 已建成，属陈旧豁免，
     可顺手清（该文件已存在，留着会掩盖真正的缺失）。
  2. ADR 0017 的 Phase 3.2 / 3.3 勾选项与 `Remaining Checklist` 标「不做」或「已评估」。
  3. `apps/docs/src/zh-CN/content/plans/libs-decoupling-residuals.md` 的后续投入
     建议里补一句「包下沉见本提案」，避免两份文档各说各话。
- 本文的读数会随代码演进变化；引用时请重跑 §1 的命令，不要抄死数字。

## 7. 联网来源清单

| 主题 | 来源 | 用到的结论 |
|------|------|------------|
| 共享契约 vs codegen | https://www.sprinx.pl/en/blog/nestjs-nextjs-shared-types-monorepo | 单团队/单前端选共享 schema；有外部消费方才上 OpenAPI；共享 class-validator DTO「几乎从不」合适；生成物要 check-in + CI 拦 stale |
| 契约策略全景 | https://www.yashkapure.com/en/blog/api-contracts-between-frontend-and-backend/ | Zod（契约优先）/ tRPC / OpenAPI 生成三路线；生成必须在 CI 做 diff 检查 |
| NestJS 12 Standard Schema | https://dev.to/parsajiravand/nestjs-12-standard-schema-validation-without-class-validator-161f | `schema` 选项只挂元数据，必须显式注册 pipe；class-validator 未废弃；文章未给出 zod → OpenAPI 支持 |
| NestJS 12 概览 | https://stackmaven.io/news/nestjs-12-esm-standard-schema/ | Standard Schema 是加法；Joi 配置校验迁移；未提 Swagger/OpenAPI 生成 |
| 权限目录 | https://blog.savantly.net/un-f-ck-your-authorization-logic/ | 单一 typed 权限目录、前后端共用、漂移门禁；不要按角色分支 |
| UI 抽包风险 | https://gitnation.com/contents/the-hidden-cost-of-shared-frontend-code-lessons-from-8-apps-and-one-monorepo | 共享组件在 8 app 下的跨 app 破坏与抽象膨胀；需要严格依赖契约与分阶段迁移 |
| Headless 分层 | https://reka-ui.com/ | 无样式 primitives：行为/可访问性与样式分离，样式由消费方决定 |
| 组件抽取工具 | https://www.npmjs.com/package/vue-harvest | 以依赖图/耦合信号（store、router、i18n、env）给组件分层——与本轮的手工筛法同构 |
| i18n 共享形态 | https://nestjs-i18n.com/ | nestjs-i18n 的 loader / assets 机制；共享语言包需要两端同一份 JSON 资产 |
| OpenAPI 类型生成 | https://openapi-ts.dev/ | `openapi-typescript` 生成 types-only 产物、由消费方自带 fetch 包装 |
