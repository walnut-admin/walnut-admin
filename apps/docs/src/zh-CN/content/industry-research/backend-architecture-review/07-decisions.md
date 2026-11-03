# 07 · 决策记录（已定）

> 决策日期：**2026-11-02** ｜ 决策人：用户 ｜ 记录：Lead
> 状态：**A 档 6 条已全部敲定**，B 档 14 条按推荐执行（未被否决）。
> ⚠️ 原始 6 份调研报告（01/02/03/03b/04/05）在写入后被删除（未跟踪文件，git 无法恢复）。
> 本文件与 00/06/08/09 已按会话内证据重建；六份全文待并行线收工、工作树稳定后按最终树重出。

---

## 一、决策记录表

| # | 主题 | 结论 | 类型 |
|---|------|------|------|
| **D0** | 仓库定位 | **a：单体内后台**（packages 的正当性 = 本仓自己的复用） | 已定 |
| **D1** | `@walnut/ui` | **A：删除**（组件回 admin + componentMap 改显式注册表） | 已定 |
| **D2** | list 查询契约 | **A：两段走**（先止血，再一次性换显式 filter wire） | 已定 |
| **D3** | `apps/worker` | **A：真接线**（补齐生产面，含 CI 冒烟） | 已定 |
| **D4** | `packages/platform-node` | ~~**建**~~ → **2026-11-03 实测否决「直接搬迁」**：POC 不通过，前提（零 import 改写）不成立。现状 **P2（不搬）**；**P1（两个包自建 CJS dist）待拍板** | 已定 → 已否决（共三次修订） |
| **D5** | `db/seed/` EJSON | **B：一次性重建**为 PG 行形态，机械再生成 + 双跑 diff 验收 | 已定 |

---

## 二、逐条依据

### D0 = a（单体内后台）

依据：无任何包设 `publishConfig`；`api-types` 是 `private: true`；全仓无发 npm 的 workflow。
⇒ 「对外发包」这条路今天不存在，抽包的正当性只能来自**本仓自己的复用**。

> 但 D4 的结论说明：**「本仓复用」不等于「必须有多个 app」** —— 只要一个库同时被 api / worker / cli 三个组合根消费，
> 它就已经是「跨部署单元复用」。这是 D3=A 之后成立的新事实。

### D1 = A（删除 @walnut/ui）

- 现状：88 行 / 3 个 Naive 透传组件 / 被 import **0 次** / 模板使用 1 处（在 demo）
- 已造成活缺陷：`componentMap.ts:56` 按「目录名」动态 import，3 个组件搬走后 `Base:Switch`（全仓 73 处，
  含 DevSettings / 我的偏好设置 / 菜单表单）运行时断裂；tsc 与 vite build 都看不见
- **删除的同时必须把 `componentMap` 换成显式注册表** —— 否则下次任何文件移动都会静默重犯

### D2 = A（两段走）

- **P0 段（止血）**：算子按**列类型**选（今天按 `typeof value`）；打开三槽位 `ValidateNested`；clamp `pageSize`
- **P1 段（换契约）**：`filters: [{field, op, value}]`，op 白名单由列类型决定；默认排序追加 `id` 兜底
- 改动面实测：21 个 controller 引用 `CreateWalnutAdminRequestListDTO` + 前端 1 个参数构造点 + 16 个 `.vue`

### D3 = A（worker 真接线）

> **先澄清我上一轮一处表述不准 —— 你说得对：worker 本地能跑。**
> `apps/server/package.json` 有 `start:worker`；`apps/worker/src/main.ts` 是完整 bootstrap
> （`createApplicationContext` + `enableShutdownHooks` + 打出 cron job 数量），前提只有两个：
> cwd = `apps/server`、PG/Redis 在线。你 WSL 里有 pg + redis，直接跑没问题。

我说的「没有部署面」**只指生产编排**，实测依据：
- `build/image/server/Dockerfile` 只有 api 的 CMD，worker 无第二入口
- `deploy/` 与 `.github/` 对 `worker` / `WORKER_STANDALONE` **0 命中**

所以真实风险不是「跑不起来」，而是**生产上没人启动它、且失败是静默的**：cron 与密钥轮换停摆，
api 照常 200，监控不红。**D3=A 的含义因此是「补齐生产面」，不是「让它能跑」**：

1. 镜像第二入口（同镜像不同 CMD）或独立 Dockerfile stage
2. compose / 编排增加 worker service（复用同一镜像）
3. CI 冒烟：启动 worker 上下文，断言 cron jobs 数量 > 0（`main.ts` 已经把这个数字打出来，正好复用）
4. `WORKER_STANDALONE` 语义写进文档（未设置时 api 行为逐字节等价）
5. 「cron 只允许单实例」的约束（ADR 0025）落到编排层注释里

### D4 = 建 packages/platform-node（2026-11-02 修订：从「不建」改为「建」；**2026-11-03 实测否决**）

> **2026-11-03 结论（第三次修订，以此为准）：直接搬迁被实测否决。**
> `const`（27 文件、0 处 Nest、零外部依赖）搬到 `packages/platform-node/base/src/const` 的单库 POC
> 三条失败面都不在构建期暴露：
> ① `@swc/cli` 的 `getDest` 让产物按「源文件相对 cwd 的逐字符镜像」落到 `<root>/apps/packages/...`
>    —— **build 仍 exit 0**、`start:prod` MODULE_NOT_FOUND；
> ② 唯一开关 `stripLeadingPaths` 是全局布尔：开了 `dist/packages` 对了，但
>    `dist/apps/api/src/main.js` 塌成 `dist/api/src/main.js`（Dockerfile CMD 与 `start:prod` 全废）；
> ③ `include` 加跨包路径会连累 assets 校验；补 `rootDir` 能救绿，但那会变成第 10 个注册面，
>    且 `types:check` 跳出解析链爆 TS2307。
> ⇒ **「零 import 改写、只改 5 面」这个前提不成立。**
> **现状 = P2（不搬）**：`apps/server/libs/**` 原样保留，「边界清晰」这一收益今天由 ESLint 六层
> 分层 + 3 个 drift spec 提供。**P1（两个包自建 CJS dist，照 `@walnut/contract` 样板）待用户拍板**。
> 详见 [10](./10-implementation-plan.md) §10.2、[ADR 0007 的 2026-11-03 追记](../../adr/0007-backend-libs-not-workspace.md)、
> `reports/NEEDS-CONFIRMATION.md` 的 C4。
> 下面「目标形态 / 零 import 改写 / 四个顾虑」**保留为当时的依据**（顾虑 2 已被实证）。

你的判断成立，我改结论。理由与我原顾虑的处置如下。

#### 目标形态

    packages/platform-node/
      base/    → @walnut/node-base   ← INFRA 层 8 + exceptions + blpath = 10 个库，约 4.7k 行
      tech/    → @walnut/node-tech   ← TECH_BASE 13 + TECH_ASSEMBLE 5 = 18 个库，约 5.2k 行
    apps/server/libs/              ← 只剩 6 个域/顶层库：identity system auth security guards app-domain，约 28k 行

分层判据直接用仓库自己的（`apps/server/eslint.config.ts:9-25`）：
INFRA_LIBS / EXCEPTION_LIBS / TECH_BASE_LIBS / TECH_ASSEMBLE_LIBS 共 28 个 = 「业务无关基建」，
DOMAIN_LIBS + TOP_LIBS 共 6 个 = 业务域。不需要发明新定义。

#### 为什么「搬」从 L 降到 M：**零 import 改写**

今天 1481 条 import 全靠 `walnut-server/*` → `libs/*/src` 的 tsconfig paths 解析。
搬迁后只改 **paths 的目标**，**所有 import 语句一行都不用动**。
真正要改的只有配置面：tsconfig paths / 3 份 nest projects / 3 份 swcrc / 3 份 tsconfig.app include /
ESLint 的 files 前缀 —— 而这 5 个面正是 D14「注册面生成化」要收的东西。

#### 四个顾虑与处置

| # | 顾虑 | 严重度 | 处置 |
|---|------|--------|------|
| 1 | **门禁会静默失效**（不是「丢失」，是「不报错」）：分层 ESLint 用 `files: ['libs/<x>/**/*.ts']` 路径匹配，lib 搬走而规则没改 ⇒ 该层规则**不再匹配、也不报错** | 高 | **正确顺序是「判据先跟包走，再搬」**：先把 files 改成从 lib 清单生成（D14）并验证 34 条规则仍生效，再搬迁。这就是「搬完再改造」不可行的唯一原因 —— 不是不能改造，是中间会有一段静默无门禁期 |
| 2 | **编译形态与产物路径**：今天 28 个库与 app 一起由 SWC 编译，`start:prod` 依赖 `dist/apps/api/src/main.js`。源码搬到 `apps/server` 之外后，include/rootDir 变化可能改变 dist 布局 | 高（唯一需实测） | **先做 1 个库的 POC**：拿 `const`（27 文件、**0 处 Nest**、0 外部依赖）搬成 `@walnut/node-base/const`，验证 `pnpm build` / `start:prod` / `types:check` / `openapi:export` 四条全过，再批量 |
| 3 | **版本与发布语义**：fixed 版本组从 16 → 18 包；这两个包不可发布 | 中 | 包内标 `private: true`（或写清 publishConfig 缺失是有意的），登记进 release 归属表 |
| 4 | **包内边不再被 turbo boundaries 看见**（turbo 只看包间） | 中 | 包内继续用 ESLint 按目录维护层序（机制不变，只换前缀），并把「包内 0 环」纳入 madge 门禁（D19） |

#### 顺带简化 D13

搬迁后 lib 粒度变成**包内目录**，「小库合并」的收益下降 ⇒ D13 从「8→5」降为只做两件：
删 `delay`（死库，唯一引用是 `shared.module.ts:5` 且服务零注入）、`context` 并入 `als`（今天两套 ALS）。

#### 与 D3 的联动（关键）

D3=A 把 worker 真接起来 ⇒ 出现**第二个 Node 部署单元** ⇒ platform-node 的复用价值从「0」变成「有真实第二消费者」。
**这两条决策互相支撑**：没有 D3，D4 只有「边界清晰」这一个收益；有了 D3，它开始还技术债。

### D5 = B（seed 重建）

现状：8 个 seed 文件 `$oid` 4416 处 / `$date` 4444 处，中间 938 行 `seed-map.ts` 做 _id → uuid5；
`ejson.ts` 是 live 代码。与 ADR 0021 D2「不做 24-hex 兼容伪装」精神相抵。

做法：**不手写**，用 `db:export:pg`（本就输出 uuid 本体）机械再生成行形态 + junction 独立文件；
`ejson.ts` 降级为「仅导入历史导出」的兼容器；`seed-map.ts` 退役。
验收：旧 seed 与 新 seed 各灌一个空库 → 逐表 diff **全等**。

---

## 三、B 档 14 条（按推荐执行，未被否决）

| # | 决策 | 结论 | 备注 |
|---|------|------|------|
| D6 | @walnut/types 归属 | 保留包，walnut.platform 改 web，改 description | 后端实测 0 消费 |
| D7 | @walnut/utils 收缩 | 16 个浏览器专用值下沉 platform-web/client，只留 sign-raw + object-paths | 双端率 13.6% |
| D8 | platform-web 三个桶入口 | 删 src/index.ts，只留子路径；ADR 0013 改为「桶取决于有无仓外消费者」 | 75 导出 0 消费 |
| D9 | api-types 归类 + openapi:check | 挪 packages/generated/api-types；check 拆两段，段②在 fork PR 也硬失败 | |
| D10 | Repository 三模式 | 收敛成两模式；@Global 改用「消费方 ≥2」机械判据 | |
| D11 | 分布式锁 | 端口化 libs/lock，murlock 作适配器，10 处改注入 | |
| D12 | libs/cache 域缓存 | 折中：域缓存改名 + ADR 0022 登记例外 | |
| D13 | 小库合并 | **按 D4 修订**：只删 delay + context 并入 als | 原「8→5」作废 |
| D14 | 注册面生成化 | **前置到搬迁之前**（D4 的 gate） | 加 1 库要改 7 面 9 文件 |
| D15 | 分页稳定性 | 默认排序追加 id 兜底；UUID v7 记 P3 | |
| D16 | 命名遗留 | roles_list/roles_count 永久冻结；/system/locale/list 的 id → groupKey | |
| D17 | zod | 维持现状 + 记触发条件；**订正 adr/zod-evaluation.md**（两条事实已过期） | |
| D18 | 门禁缺口三件 | ① frontend tag 规则 ② barrel 从 knip entry 摘出 ③ **偏差（2026-11-02 R1 裁决）**：admin 不引 vitest，改 @walnut/scripts 的 check-dynamic-imports 门禁（禁新增插值 import）；注册表改静态 import 后缺文件本就是编译期红 | 替代方案零新依赖，覆盖更彻底（静态校验 19ms 跑完 30 个 key） |
| D19 | dependency-cruiser | 不引；把 madge 0 环纳入 prepush | |
| D20 | TinyMCE | 移到 admin，出 server 镜像（-4.08MB） | |

---

## 四、明确不做

- 现在不做：全仓 cursor 分页、contract 承载 zod schema、一次性刷新全部 ADR
- 永远不做：让 @walnut/contract 依赖 zod 运行时、把业务 API 层下放进 @walnut/http
- 待触发：UUID v7、dependency-cruiser、platform-node 的第三个包（若出现第三条产品线）

---

## 五、仍需你确认的一点

D4 的**编译形态**有一个只能靠实测回答的问题（顾虑 2）：28 个库搬到 `apps/server` 之外后，
dist 布局是否变化。我的处置是「先拿 `const` 做 1 库 POC」，POC 通过才批量搬。
**如果 POC 失败**（产物路径变了、start:prod 需要改），备选是：这 2 个包像 @walnut/contract 一样
构建 CJS dist（多一条构建流水线 + peerDeps，成本 M→L）。到时我会带着实测结果再来找你定。
