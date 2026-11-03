# 批次 13 · R2 实施：文档与事实对齐（13-A/B/C/D）

> 只改文档。**未改任何源码、未改 `openapi.json`、未改 `schema.d.ts`、未 commit**。
> 基线：`534667e1`，工作树原本 clean（唯一未跟踪项是 `reports/batch-13/`）。
> 取证方式：**改之前先读代码**（`device.service.ts` / `device.guard.ts` / `device-id.ts` /
> `device.basic.repository.ts` / `risk.guard.ts` / `risk.sensitivity.ts` / `cap.guard.ts` /
> `exception.filter.ts` / `cookie.service.ts` / `user.service.ts` …），不转述 R1。
> 门禁：四个 doc 门禁 + `pnpm --filter @walnut/docs build` 全绿（原文见 §5）。

---

## 0. 结论摘要

| 块 | 做了什么 | 状态 |
|----|---------|------|
| **13-A** | `shared/device.md` **整篇重写**（288 → 285 行，结构按「身份形态 / 自愈 / 续期留存」重组，两张 mermaid 重画）；另 5 篇同错修正（`sign.md` 2 处、`security.md` §4.1/§4.2、`system-account.md` 6 处、`auth.md` 1 处、`plans/postgres-migration-phase2.md` 2 处 + 名字归属注） | 完成 |
| **13-B** | `README.md`（分组计数 → 判据式、test 包数 → 判据式）、`release.md` 14→15、`reference-repo-comparison.md` 14→12（**顺带修正同句另外两个旧读数**：`main+exports` 与无 `private` 的包数）、`AGENTS.md:78` 幽灵包 `ui`、`knip.md` 两处旧读数 | 完成 |
| **13-C** | actionlint **SKIP ≠ PASS** 统一口径落到 `review/backend/index.md` 与 `plans/libs-decoupling-residuals.md`（:71 / :133）；根 `AGENTS.md` 96%→87%、`apps/server/AGENTS.md` 97%→88%（纯删重复） | 完成（`steps.ts` 一处**按约束未改**，理由见 §3.3） |
| **13-D** | `security.md` §4.3 新增「风控降级分级」小节（40667 / 清单真源 / `meta.riskDegraded` 首次入文档）+ §3 CAP 触发条件按分级重写 + §4.1/§4.2 同步；`apps/server/AGENTS.md`（不在本批范围但同源）不动；`app-shared.md` 心跳行键 3 处同步批次 8 / B6 | 完成 |

**一条重要偏差（必须记）**：R1 和我最初都把「`deviceName` 只在插入时写入」当事实写进了三篇文档，
**读代码后确认是错的** —— `upsertByDeviceId` 命中已有行时 `Object.assign(existing, deviceData)`
（`device.basic.repository.ts:46-52`），而 `deviceData` 里**每次都带** `deviceName`
（`device.service.ts:126`）⇒ 服务端**每次 initial 都重新生成并覆盖设备名**。三篇文档已按真实语义
改写（见 §1.1 / §1.3 / §1.4）。这正是本批要求「不照抄 R1」的价值所在。

---

## 1. 13-A 设备身份文档

### 1.1 `apps/docs/src/zh-CN/content/shared/device.md` —— 整篇重写

保留：首页语、`:::warning 由claude生成`、"相关链接"、`:::tabs` 两张流程图、"与其他系统的协作"、
"补充说明"四个小节的骨架（读者导航不变）。删掉/重写了全部与代码不符的事实陈述。

新结构（与代码对齐后的章节）：

1. **介绍** —— 一句话改成「服务端随机签发，指纹只作风控特征、不参与身份派生」；6 条核心设计
   全部换成判据（形态判据唯一 / cookie 承载身份 / 滑动续期 + 留存清理 / Redis 关联 / 状态管理）。
2. **关键影响维度说明**
   - §1 Visitor ID：**不参与身份派生**、只作风控特征、心跳里只作归属校验。
   - §2 Device ID：形态 `d1_`+32 hex、`generateDeviceId()` 只调 `randomBytes(16)`、**签发点只有
     initial 一处**、cookie + localStorage、30 天 + 滑动续期、90 天留存。
   - §3 设备信息：设备名**每次 initial 服务端重新生成**且客户端不可传（带即 40099）；IP/位置两段
     历史「上限写在各 `arrayOptions.maxSize` 里，`updateIpAndLocation` 按同一条规则裁剪 ——
     改一处就得改两处」（**不写「10 条」「5 条」这类会腐烂的计数**）。
   - §4 设备状态管理：新增一张表（`active`/`locked`/`banned`/`stale` 各自谁写、什么效果），
     明确 `banned` 先于 `locked`、封禁 = 踢下线、`stale` 不参与鉴权。
3. **身份形态与自愈**（新）—— 故障表：40605（两种成因）/ 40606 / 40607 / 40099 各自服务端与客户端
   行为；点明「**错误码是业务码，统一响应壳是 HTTP 200 + `body.code`**，别按 401/403/406 写分支」；
   判据落点 4 条（`const/app/device.ts`、migration CHECK、自愈链、错误码形态）。
4. **有效期、滑动续期与留存**（新）—— 三层寿命分开讲（cookie / 续期窗口闸 / 设备行），
   留存清理写「四条同时满足 + 锚点是 `updated_at` + banned/locked 永久保留 + 天数由 cron 传入」。
5. **流程图**（两张 mermaid 重画）—— 图 1：initial（localStorage 短路 → 采集指纹 → `{private,sr,vp,
   hardwareInfo,deviceInfo}` → 读 cookie 形态判复用/新签 → GeoIP → 按业务键 upsert → 回写缓存 →
   `Set-Cookie`(30 天/httpOnly/secure/signed) → 拍平响应）；图 2：Device guard（豁免 → 形态判 40605 →
   缓存/回源 → IP 变更 → banned 40607 / locked 40606 / 通过 → 80% 窗口续期）。
   DB 参与者从 `MongoDB` 改为 `PostgreSQL`，Crypto 参与者（HMAC 派生）整段删除。
6. **与其他系统的协作** —— 会话键 `AUTH:SESSIONS:{userId}:{deviceId}:{sessionId}`、权限缓存
   `userId+deviceId`、MFA、用户锁定；签名侧 `SECURITY:RSA:PUB_KEY` / `SECURITY:SIGN:AES_KEY`。
7. **补充说明** —— 安全特性 8 条（服务端签发 / 形态判据唯一 / HttpOnly / **Secure + SameSite
   `None`(prod)·`Lax`(dev/stage)** / 状态控制 / IP 追踪 / MurLock / 自愈）、存储策略表（PostgreSQL
   那行改成「长期；`active=false` 且 90 天无写活动的行会被清理」）、性能 6 条、局限性 6 条
   （指纹解耦、**指纹漂移的症状是 40099 而不是重新初始化**、Cookie 依赖、**重新初始化的真实触发条件
   是清 cookie/换浏览器而非「30 天到期」**、单设备维度、封禁是设备级）。

对照 R1 的 29 处清单：逐条落地（含 R1 未列的 `SameSite: Strict` 也是错的 —— 代码是 dev/stage
`lax`、prod `none`，见 §6 第 12 条）。

### 1.2 `shared/sign.md`（2 处）

| 位置 | 改后 |
|---|---|
| :41 | 「由**服务端随机签发**（`d1_` + 32 位小写 hex，`generateDeviceId`）；「客户端无法伪造」的来源是**签发权在服务端**，不是哈希 —— 指纹不参与身份派生」 |
| :285 | 局限 2 从「设备指纹简单 / 未结合浏览器指纹」改为「设备身份与指纹解耦 ⇒ 同一指纹的多台设备之间**没有任何关联判据**（有意的产品口径，不是缺口）」 |

### 1.3 `backend/modules/security.md`（§4.1 / §4.2）

- §4.1 标题「设备注册与**指纹**」→「设备注册与**身份签发**」。
- `device_id` 段整段替换：服务端随机签发（`device-id.ts`）+ 形态判据唯一 + DB CHECK；
  删掉「`hash(X-Fingerprint, crypto.deviceIdKey)`」「自证 + 服务端加盐」两个失效结论。
- 幂等语义改成「**幂等键是 cookie**」；设备名独立成一条：**每次 initial 服务端重新生成并覆盖**、
  客户端传即 40099、冲突仍 40000。
- 响应形状改成 wire 事实 `{ deviceId, latitude?, longitude?, countryCode? }`（原文写的是
  service 内部返回的 `{ deviceId, locationInfo }`，不是 wire）；缓存键由 `SYS_DEVICE:` 更正为
  `SYSTEM:DEVICE:`。
- §4.2 第 1 步补「**缺失或形态不是** `d1_`+32hex（旧裸 64 hex / 伪造 / 空）→ 40605」+ 判据真源；
  第 2 步缓存键更正；第 3 步「最多 5 条」→「按 `arrayOptions.maxSize` 等长裁剪」；
  第 5 步补「封禁 = 踢下线（同事务撤 RT + 提交后清会话键/断 WS，解禁不踢）」；
  **新增第 6 步**：校验全通过后按 80% 窗口滑动续期。

### 1.4 `backend/modules/system-account.md`（6 处 + §2.2 顺带）

- :57 `sys_device.device_id` 语义（指纹加盐哈希 → 服务端随机签发 + UNIQUE + CHECK）。
- :72 小节标题「指纹派生业务键」→「服务端签发业务键（幂等键是 cookie）」。
- :78-81 派生段整段替换：点名 `generateDeviceId()`，并写明 `getDeviceIdByFingerprint` /
  `hashDeviceFingerprint` **已不在身份路径上**（读 `device.repo.service.ts:38-47` 后的原话）。
- 覆盖集：删掉「覆盖集包含 `deviceName`」，另起一条写「每次 initial 重新生成、客户端不可传」。
- 并发语义：「并发**同指纹**，败者 40605」→「并发**同 cookie**，`uq_device_id` 决出胜者，失败侧是
  受控拒绝（40605 或 42900 限流），语义见 `concurrency.api-spec.ts` 的 G3」。
- :403 端点表：请求体删 `deviceName` 并写明「body 带 `deviceName` ⇒ 40099」；响应改拍平形态。
- §2.2 Device guard：第 2 步补形态校验、缓存键更正、第 3 步历史条数改判据、**新增第 6 步**
  （滑动续期）。这几行 R1 未列，但与 §2.1 同源、不改就会在同一个文件里自相矛盾。

### 1.5 `backend/modules/auth.md`（1 处 + 相邻 2 行）

:46-48 整段替换：服务端随机签发 / 幂等键是 cookie / `device_name` 服务端生成且唯一且客户端不可传。
同段 :50-51 的「回填 `SYS_DEVICE:` 缓存；响应 `{ deviceId, locationInfo }`」也一并更正为
`SYSTEM:DEVICE:` 与拍平响应，并补「cookie 缺失或形态非法一律 40605，前端自愈」（与 :85 的
fail-close 说明不冲突）。

### 1.6 `plans/postgres-migration-phase2.md`（2 处 + 1 条注）

- §4.8 `device_id` 列说明：「UNIQUE（客户端指纹…）」→「UNIQUE（服务端随机签发的 `d1_` + 32 位小写
  hex；另有 CHECK `ck_device_device_id_form`）」。
- §4.8 索引行后补 CHECK 说明（migration `1793390000000-DeviceIdFormCheck`）。
- §4.8 表头加一条注：**`sys_device.device_name` 是服务端生成的，`sys_user_device.device_name` 才是
  用户可改的显示名**（R1 提的「邻近行容易混」按「加一句」处理，不改 §4.9 那行本身）。

> 说明：R1 把这篇记作 `backend/postgres-migration-phase2.md`，实际路径是
> `apps/docs/src/zh-CN/content/plans/postgres-migration-phase2.md`（`backend/` 下没有此文件），
> 改的是真实位置。

---

## 2. 13-B 计数与旧读数

| 位置 | 原来 | 改后 | 依据 |
|---|---|---|---|
| `README.md:22` | 「15 个 workspace 包（3 app + 3 platform-any + **3** platform-web + 6 tooling）」 | 「15 个 workspace 包，按**目录组**分成 apps / platform-any / platform-web / generated / tooling 五组（**包数以 `pnpm-workspace.yaml` 的 `packages` 字段为判据**）… 这里刻意不写每组的个数」 | 枚举 15 个 `package.json`：3 + 3 + **2** + **1** + 6；原式 3+3+3+6 恰好也 = 15，所以「加起来验一下」验不出来 |
| `README.md:81` | 「（当前 7 个包有 test 任务，清单以各包 package.json 为准）」 | 「（哪些包有 test 任务以各包 package.json 为准）」 | 7 目前是对的，但属会腐烂的计数（`apps/docs/AGENTS.md` 约定 8） |
| `monorepo/release.md:13` | 「**14 个包**的版本号」 | 「**15 个包**的版本号（判据：`versioning.fixed` 组成员 = 有 `version` 的 workspace 包）」 | workspace 包 15 |
| `monorepo/reference-repo-comparison.md:210` | 「`walnut` 自定义字段（**14 个包**在写…）、`contract` 与 `utils-core` 同时有 `main` 与 `exports`、**9 个包**无 `private`」 | 「`walnut` 自定义字段（`packages/**` 的包都在写，**12 个**；三个 app 没有…）、`main` 与 `exports` 并存（`@walnut/contract` / `@walnut/utils` / `@walnut/api-types`）、**8 个包**无 `private`（判据 `private !== true`）」 | 逐包解析 JSON：walnut 12、main+exports 3（原文漏了 `api-types`）、无 private 8（原文 9） |
| `AGENTS.md:78` | 「（admin/docs/**ui** 用 vue-tsc…）」 | 「（admin/docs 用 vue-tsc…）」 | `apps/ui` 已删；这条**门禁抓不到**（裸 `ui` 不是 `@walnut/<slug>`，也不是顶层目录路径） |
| `monorepo/knip.md:199-201` | 「三处 barrel 一次报出 **82 条**」（未标日期、且 `platform-web/http` 的 barrel 已删） | 保留「不是所有包都报」的结论，删掉数字，另加一段「**别引用那个数字**：2026-11-02 快照，其中两处 barrel 批次 4 已删、`utils-core` 已收缩；要看现状跑 `pnpm knip`」 | 同文件 :95 / :105-106 自己写了入口已删 |
| `monorepo/knip.md:226-236` | `text` 代码块长得像「现在的输出」 | 代码块首行加 `# 2026-08-08 快照，仅示输出形态：括号里是当时的读数，别当现状引用（现状跑 pnpm knip）` | 那个 `40+` 与 2026-11-02 的 139 差一个量级 |

### 2.1 `@walnut/ui` 豁免能不能摘：**不能摘**（有证据）

`packages/tooling/scripts/src/ci/check-doc-refs.ts:113` 的
`'@walnut/ui': '已删除（2026-11，批次 1…）'` **必须留着**：

- 判据在 `check-doc-refs.ts:409-412`：一条包名引用**只有**「是真实 workspace 包」或「在
  `ALLOWED_MISSING_PACKAGES` 里」两种方式能过；没有第三种逃生口。
- 我按门禁自己的正则（`@walnut/([a-z0-9][a-z0-9-]*)`，排除 `content/{archive,industry-research}/`）
  复扫了一遍**活文档**：**仍有引用**（以 `check-doc-refs` 的豁免表 + 上面这条正则复扫为判据；
  数量随报告增加而变，**摘豁免前必须重扫**），其中
  `content/adr/{0001,0012,0014,0017}.md`、`content/plans/package-sinking-proposal.md`、
  `content/monorepo/{architecture,architecture-todo,glossary}.md`、`content/frontend/base/plugin.md`、
  `packages/platform-web/client/README.md`、`apps/admin/CHANGELOG.md`，以及
  `reports/batch-1/**`（4 篇）+`reports/batch-2/r1-verification.md`。
- 两条路都堵着：ADR 是「当时的决策记录」（`check-doc-refs.ts:38-44` 只对**路径**给了 ADR 豁免，
  **包名照查**）；`reports/` 的包名豁免在 2026-11 R3 被**明确拒绝**过
  （`check-doc-refs.ts:49-54`：报告要给人当结论读，写错包名最该被抓）。
- 结论：摘掉它会立刻红，且只能靠改 ADR 历史或放宽 `reports/` —— 两者都比「留一条带理由的豁免」更糟。
  **维持原状，并把这条评估结论记在此处**（R1 说它是「幽灵包名长期存活的机制」，准确说它是
  「历史叙述的合法出口」，而 `AGENTS.md:78` 那种**裸 `ui`** 才是真幽灵，已改）。

---

## 3. 13-C 流水线口径 + AGENTS.md 压缩

### 3.1 统一口径（一句话，落进两篇）

> `pnpm lint:workflows` 在**没有 actionlint 的机器上是 SKIP**（退出码 0，但一行 workflow 都没校验）；
> 权威闸门是 `.github/workflows/workflow-lint.yml`。报告与文档里**必须**写「**本机跳过，CI 侧由
> `workflow-lint.yml` 跑，不计入全绿**」，**不许**把它计入「全绿 / 全部通过 / N 段无失败」。

改的两处 + 依据：

| 位置 | 改后 |
|---|---|
| `review/backend/index.md:397` | 「`pnpm prepush`：**全部段未报错**（段数以 `prepush.ts` 的表为准，别按数字读）」，并从「通过」清单里**摘掉 actionlint**，补一条独立的「`actionlint` 那一段不算通过」说明（本机 SKIP / CI 权威 / `lint:workflows-shell` 同理） |
| `plans/libs-decoupling-residuals.md:71` | 标题「✅ **本机已装**」→「⚠️ **本机 SKIP ≠ 通过**」，正文写统一口径 + 机制（`lint-workflows.ts` 探测不到就 `return`，退出码 0；prepush 执行器只看退出码 ⇒ SKIP 与 PASS 同形） |
| `plans/libs-decoupling-residuals.md:133` | 「23 段全绿（actionlint 段本机 SKIP）」→「全部段未报错（段数以表为准）；其中 actionlint 段本机 SKIP —— 本机跳过，CI 侧由 `workflow-lint.yml` 跑，不计入全绿」 |

依据（我自己读的代码，不引 R1）：
`packages/tooling/scripts/src/ci/lint-workflows.ts:20-27`（探测失败 → warning + `return`）、
`packages/tooling/scripts/src/ci/prepush.ts:291-311`（`ok = true`，只有抛错才置 false）、
`:324-328`（`ok` 打 ✓）、`:339-341`（汇总「N 段全部通过」）。
段数实测：`PREPUSH_GATES` 有 **26** 个 `id`（不是 23，也不是 11）。

### 3.2 AGENTS.md 压缩（纯删重复，规则一条没丢）

| 文件 | 前 | 后 | 省 |
|---|---|---|---|
| `AGENTS.md`（根） | 96%　8312 / 8700 | **87%　7579 / 8700** | 733 字符 |
| `apps/server/AGENTS.md` | 97%　6687 / 6900 | **88%　6038 / 6900** | 649 字符 |

根 `AGENTS.md` 删的都是**同一事实的第二份**：

1. **「各 app 专属指引」整节**（与「包级指引」表重复）—— 删整节；把表里没有的那半句
   （Repository / Shared Service、DTO 规则、Guard 顺序）**并入表的 server 行**，并在表后加一句
   「各 app 的具体规则只在对应那份文件里，本文件**不重复**」。
2. **「仓库结构」代码块里的 apps 三行**（与「技术栈与版本」表同一包名 + 同一串技术栈 + 同一端口）——
   换成一行指向表的注释，代码块只留 `packages/**` 四组。
3. **`ENV_KEYS` 段**（原 4 行）—— 压成 3 行：留「CI 用 `ENV_KEYS` 解密 + 禁止把 `secrets` 写进
   `if`」两条结论，细节指向 `monorepo/env-management.md`。该规则另有三处权威落点：
   `.github/workflows/ci.yml:3`（文件头）、`:245`、`:329`；`env-management.md:78-79`。
4. **头部 blockquote 的两句**（「包级指引见下表」= 下一节标题；「架构决策在 docs」= 表格与
   纪律 11 里已有指针）—— 只留 CLAUDE.md 那条（`:6-7` 必须留，否则有人会删 `CLAUDE.md` 的导入行）。
5. 另外三处同源重复：`资源` 里那行技术栈（与「技术栈与版本」表逐项重复）、
   `apps/admin/build/` 那条（`apps/admin/AGENTS.md` 有逐字同款）、
   后端 lib 的 scope/构建形态半句（`apps/server/AGENTS.md` 有）。
6. `pnpm test` 的注释从「7 个包的清单」改为判据式（同一处纪律）。

`apps/server/AGENTS.md` 删的：
1. 「这个包是什么」里的 `为什么这样：ADR 0007 … ADR 0022 …`（表的「架构决策」行已给同一批 ADR）。
2. 命令段的两个**脚本枚举**（表里自己写着「其余脚本见 `apps/server/package.json`」）→ 压成一句
   「**全部脚本以 `apps/server/package.json` 为判据**（这里不抄清单）+ 常用几个」。
3. 「环境文件 `env-local/`」与「Node/pnpm 门槛见根 AGENTS.md」两条（前者在根「环境配置」+
   `configuration.md` 各有一份，后者表的「全仓结构、命令、提交纪律」行已是指针）。
4. 「历史一句话」段（纯历史、且带 14 行 / 14 条 / 537 行三个会腐烂的计数）。
5. 「主要能力」清单压一行（条目一个没删，只并了行）。

**没删**：5 个部署后不许改的 env key（`configuration.md:44-45` **明确写了**「这几个 key 的名字也
抄在常驻指引 `apps/server/AGENTS.md` 里」—— 删它会同时丢规则并让那句文档变成假话）、
Guard 顺序、Repository 判据、DTO 两条、测试并发纪律、全部引用路径。

### 3.3 `packages/tooling/release/src/release/steps.ts:405` 的「11 段」——**按约束未改**，需要另一批

任务正文点名要改它，但本批的硬约束是「**不改源码**」+ 验收「`git diff --stat` **不许出现 .ts/.json**」。
两条冲突时我按验收走（改它这一批就无法交付「只含 md」）。另外**那个 12 也不成立**：
`PREPUSH_GATES` 实测 **26** 段（见 §3.1），任务写的「11 → 12」是又一处旧读数。
建议并入 13-G（prepush 三态 / 措辞那批），改法是判据式，例如
「`src/ci/prepush.ts` 那张表（并行、每段报耗时；**段数以表为准**）」。

---

## 4. 13-D 风控分级 + 心跳行键

### 4.1 `backend/modules/security.md`

- **§4.3 新增「#### 风控降级分级（敏感端点 fail-close · 批次 8 / B2）」**（这是 `meta.riskDegraded`
  第一次进 `apps/docs/**`）：
  - 一张两行表：**敏感端点** → fail-close **40667**（`NOT_ACCEPTABLE_RISK_UNAVAILABLE`，`_devMsg` =
    `<reason> @ <METHOD path>`；请求已被拒所以不进响应壳）；**其余端点** → fail-open + 响应壳
    `meta.riskDegraded` = `no-device-id` / `risk-evaluation-failed` / `risk-recommendation-missing`。
  - 清单唯一真源 `libs/guards/src/guards/risk.sensitivity.ts`，它把 `/auth/**` 与 `/security/**` 的
    **每一个**路由显式归类（各带归类理由，含两条 `fail-open` 的鉴权内端点），默认 fail-open；
    新增这两家族的路由不同步清单 ⇒ `risk.sensitivity.spec.ts` 红。**全量登记的理由**：漏登记是
    静默的，默认 fail-open 会替新端点兜底。
  - 40667 与 40666 分开的理由（「算出来了分数太高」vs「压根没算出来」）+ 不做全局 fail-close 的理由
    （无 SLA，全关等于全站单点）+ `meta.riskDegraded` 是**可选**字段、缺省不传 ⇒ 既有响应零 diff。
- **P1-13 那句改回正确口径**：原「风险只触发 CAP 升级，不做阻塞 … 其 catch 只吞未知异常」→
  「**不因「风险分高」阻塞**（`shouldBlock` 已摘除）+ 受控 `HttpException` 原样放行」。把
  「风险分」与「风控可用性」明确拆成两件事。
- **§3 CAP 触发条件按分级重写**：`recommendation` 存在时行为不变（40116/40117）；
  **不存在时按端点分级** —— 敏感端点 40667，其余放行并 `request.riskDegraded ??= 'risk-recommendation-missing'`；
  并点明这是「守卫链第三腿」（Risk guard 被挪走时凭据面仍不裸奔）。
- 与 `auth.md:85` 收敛：`auth.md:85` 那句本来就是对的（「风控 fail-close 清单：风控不可用 / 无 deviceId
  时直接 40667」），现在 `security.md` 是**讲口径**的那一处，`auth.md` 说的是自己那两个端点，两篇不再打架
  （`auth.md:85` 不动）。

依据：`risk.guard.ts:57-70`（`degradeOrReject`）、`:102-107`/`:157-161`（两处无 deviceId）、
`:182-194`（未知异常）；`cap.guard.ts:93-105`（`recommendation === undefined` 的三态处理）；
`risk.sensitivity.ts:27-42`（口径）/ `:67-70`（家族）/ `:75-280`（全量清单）/ `:345-347`（判据入口）；
`contract/src/response-code.ts:116`（40667）；`exceptions/base/406.ts:118-125`；
`interceptors/response/success.interceptor.ts:52-56`（只在非 undefined 时带 meta）。

### 4.2 `backend/modules/app-shared.md`（心跳行键 3 处）

| 位置 | 改后 |
|---|---|
| :206 列清单后 | 新增一段「**行键是 `device_id`**（`idx_monitor_device`）—— 服务端从签名 cookie 解析的那个值；`visitor_id` 的唯一约束只保证『一个指纹只落一行』，它**不是**行键（批次 8 / B6 起）」 |
| :214 端点表 | 「按 `visitor_id` upsert」→「**行键 = 服务端从签名 cookie 解析的 deviceId**；body 的 `visitorId` 只作归属校验（与本设备已存行比，不一致 40099 且**不写库**，首写登记）」 |
| :404 请求体 | `{ visitorId, deviceId, userId?, auth, focus, left, currentRouter? }` → 删 `deviceId`，并 note「body 带 `deviceId` ⇒ 40099（行键取 cookie，`userId` 取验签 AT，body 里那两个字段不作数）」 |

依据：`libs/app-domain/src/monitor/user/user.service.ts:93-104`（visitorId 与已存行比、不一致抛 40099、
不写库；首写放行）、`:108-113`（行键 `deviceId`）、`:89-91`（显式 `delete updatePayload.deviceId`）；
`apps/api/src/modules/app/monitor/user/dto/user.dto.ts:98-110`（deviceId 从白名单摘除）；
`migrations/1792922206018-InitSchema.ts:177-179`（`uq_monitor_visitor` + `idx_monitor_device`）。

---

## 5. 门禁输出（原文）

### 5.1 四个 doc 门禁（最终状态下跑，全部 exit 0）

```text
$ walnut-check-doc-refs
文档引用校验：353 篇活文档；包名豁免 17 条、路径豁免 8 条
✅ 没有引用不存在的包名或路径
EXIT_REFS=0
$ walnut-check-doc-ts
文档代码块校验：230 篇活文档里的 124 个 ts 块 + 3 个 json 块
✅ ts 块都能按 TypeScript 解析、json 块都是合法 JSON（没有截断/乱码/标错语言）
EXIT_DOCTS=0
$ walnut-check-doc-budgets
文档字数预算：6 个常驻文件
   87%    7579 / 8700    AGENTS.md
   89%    1250 / 1400    CLAUDE.md
   89%    1789 / 2000    apps/docs/src/zh-CN/content/monorepo/index.md
   88%    2189 / 2500    apps/admin/AGENTS.md
   87%    4024 / 4600    apps/docs/AGENTS.md
   88%    6038 / 6900    apps/server/AGENTS.md
✅ 都在预算内，且没有哪个预算已经失效
EXIT_BUDGET=0
$ walnut-check-adr
ADR 形态校验：27 篇 ADR（状态枚举 Proposed / Accepted / Rejected / Superseded by ADR-NNNN）
✅ 编号连续、状态在枚举内、四个必需小节齐备、index.md 双向对齐
EXIT_ADR=0
```

另：`pnpm lint:emoji` 也跑了一遍（本批新增文本要过它）：
`emoji 检查：1218 个被跟踪的文本文件（其中常驻上下文文档 6 个走严格档）✅ exit 0`。

> 活文档数 351（R1 读数）→ **353** = 加上 `reports/batch-13/r1-docs.md` 与**本报告**（这两篇也是「活
> 文档」，包名照查）。上面这轮是**本报告写完之后**跑的，所以是 353。

### 5.2 `pnpm --filter @walnut/docs build`（死链门禁）

改完后跑过**两次**（第一次在 `deviceName` 语义修正之后 = 83.77s，最后一次在**本报告写完之后的最终
工作树**上 = 58.39s），两次都 exit 0。最后一次输出：

```text
$ vitepress build
  vitepress v1.6.3
- building client + server bundles...
✓ building client + server bundles...
- rendering pages...
✓ rendering pages...
- generating sitemap...
✓ generating sitemap...
=== pagefind: https://pagefind.app/ ===
Found 254 files matching **/*.{html}
Indexed 247 pages / 14184 words
✓ generating pagefind Indexing...
build complete in 58.39s.
```

### 5.3 `git diff --stat`（**只含 md**；`reports/batch-13/` 是本批新增的未跟踪目录）

```text
 AGENTS.md                                          |  39 +--
 README.md                                          |   4 +-
 .../zh-CN/content/backend/modules/app-shared.md    |   7 +-
 .../docs/src/zh-CN/content/backend/modules/auth.md |  13 +-
 .../src/zh-CN/content/backend/modules/security.md  |  72 +++-
 .../content/backend/modules/system-account.md      |  51 +--
 apps/docs/src/zh-CN/content/monorepo/knip.md       |  10 +-
 .../content/monorepo/reference-repo-comparison.md  |   2 +-
 .../content/monorepo/release.md                    |   2 +-
 .../content/plans/libs-decoupling-residuals.md     |  12 +-
 .../content/plans/postgres-migration-phase2.md     |   8 +-
 .../docs/src/zh-CN/content/review/backend/index.md |  11 +-
 apps/docs/src/zh-CN/content/shared/device.md       | 390 ++++++++++-----------
 apps/docs/src/zh-CN/content/shared/sign.md         |   4 +-
 apps/server/AGENTS.md                              |  24 +-
 15 files changed, 346 insertions(+), 303 deletions(-)
```

机械断言：`git status --porcelain` 的 15 个变更路径 + 1 个未跟踪目录里，
**非 `.md` 的改动数 = 0**。**没有 .ts / .json / openapi.json / schema.d.ts 改动**，未 commit。

---

## 6. 自查：我核了哪几条事实、依据是什么

每一条都是**改前读代码**得到的，不是从 R1 转述。行号是改前的工作树（`534667e1`）。

| # | 我核的事实 | 依据（path:line） | 落在了哪 |
|---|---|---|---|
| 1 | 设备 id 形态 = `d1_` + 32 位小写 hex（`/^d1_[0-9a-f]{32}$/`），前缀常量 `d1_` | `apps/server/libs/const/src/app/device.ts:16,19,26-28` | device.md §2 / 自愈表；security.md §4.1/§4.2；system-account.md §2.1/§2.2；auth.md §2.1；sign.md:41 |
| 2 | 签发只调 `randomBytes(16)`，**不碰任何密钥** | `libs/system/src/device/device-id.ts:23-25` | device.md §2；security.md §4.1 |
| 3 | 生产代码里 `generateDeviceId()` **只有一个调用点**（initial） | `device.service.ts:108`；全仓 grep `generateDeviceId` 的其它命中都是 spec/int-spec/注释 | device.md §2（写「签发点只有一处」；`device-id.ts:20` 注释里「两处（initial + 登录成功）」已过期，属 13-E 的源码注释批） |
| 4 | initial 的幂等键 = 已有合法 cookie | `device.service.ts:107-108`（`isValidDeviceId(cookieDeviceId) ? cookie : generate`） | device.md / security.md / system-account.md / auth.md |
| 5 | **设备名每次 initial 服务端重新生成并覆盖**（不是「只在插入时」） | `device.service.ts:94-96,126` + `device.basic.repository.ts:46-52`（`Object.assign(existing, deviceData)`，deviceData 里带 deviceName） | device.md §3；security.md §4.1；system-account.md §2.1（**修正了 R1 的转述**） |
| 6 | initial 载荷 = `{ private, sr, vp, hardwareInfo, deviceInfo }`；带 `deviceName`/`visitorId` ⇒ 40099 | `libs/system/src/device/dto/device.dto.ts:211`；`apps/api/src/main.ts:136-149`（whitelist + forbidNonWhitelisted + exceptionFactory）；`exceptions/src/base/400.ts:20-26` → `contract/src/response-code.ts:30`（40099）；前端实发 `apps/admin/src/api/system/device.ts:67-98` | device.md 自愈表 + 图 1；security.md §4.1；system-account.md §2.1/:403 |
| 7 | initial 响应是**拍平**形态 `{ deviceId, latitude?, longitude?, countryCode? }` | `apps/api/src/modules/system/device/device.controller.ts:73-88`；DTO `device.dto.ts:225-260`（注释明说「旧版声明了从未下发的字段」） | device.md 图 1 + §2；security.md §4.1；system-account.md §2.1；auth.md §2.1 |
| 8 | guard 只认形态，否则 40605；缓存 miss 回源仍查无 → 40605 | `libs/guards/src/guards/device.guard.ts:94-99,109-124` | device.md 自愈表 + 图 2；security.md §4.2；system-account.md §2.2 |
| 9 | `banned`→40607、`locked`→40606，**先判 banned**；**没有** `DEVICE_INACTIVE` 分支 | `device.guard.ts:150-158`；码值 `contract/src/response-code.ts:102-106`；异常类 `exceptions/src/base/406.ts:50-72` | device.md §4 + 图 2 |
| 10 | **错误码是业务码：全局异常过滤器恒以 HTTP 200 落盘**（旧文档的 401/403 是错的） | `libs/exceptions/src/exception.filter.ts:93`（`response.status(HttpStatus.OK).json(...)`） | device.md「身份形态与自愈」 |
| 11 | cookie 30 天 + **80% 窗口滑动续期**，两个值同源；续期闸键 `SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`；只在**校验全通过**后重发 | `libs/const/src/app/cookie.ts:39-42`；`libs/cache/src/service/device.cache.ts:64`；`device.guard.ts:53-71,160-161` | device.md 图 1/图 2 + 续期表；security.md §4.2 第 6 步；system-account.md §2.2 第 6 步；auth.md §2.1 |
| 12 | cookie 属性：`httpOnly` + `secure` + `signed`；SameSite **dev/stage `lax`、prod `none`**（旧文档写的 `Strict` 是错的） | `libs/cookie/src/cookie.service.ts:12-59` | device.md「安全特性」4 |
| 13 | IP / 位置历史两段等长、上限 = DTO `arrayOptions.maxSize` + repo 按同一规则裁剪（写死在两处） | `libs/system/src/device/dto/device.dto.ts:60-70,93-105`；`libs/system/src/device/repo/device.repo.service.ts:236-260` | device.md §3；security.md §4.2 第 3 步；system-account.md §2.2 第 4 步（**一律不写「5 条」这类计数**） |
| 14 | 90 天留存四条判据 + 锚点 `updated_at` + banned/locked 永久保留 + 天数由 cron 传入 | `device.repo.service.ts:91-148`（SQL 与注释）；`device.pg.purge.service.ts:12-13,74` | device.md「有效期、滑动续期与留存」 |
| 15 | `stale` 不参与鉴权、不再物理删行 | `device.repo.service.ts:58-89`；`device.service.ts:152-155` | device.md §4 |
| 16 | **封禁 = 踢下线**：同事务撤该设备全部 RT，提交后清会话键 + 断 WS；解禁不踢 | `device.service.ts:251-280`（`kickDevice` 在 `patch.banned === true` 分支） | device.md §4；security.md §4.2 第 5 步 |
| 17 | 前端 40605 自愈：清本地缓存 → initial → 重放，`SingletonPromise` 收敛并发、只自愈一次 | `apps/admin/src/utils/axios/interceptors/response/device.ts:1-24`；`store/modules/app/app-geo-ip.ts:49-83` | device.md 自愈表 + 图 2 |
| 18 | 心跳行键 = `deviceId`（服务端从签名 cookie 解析）；`visitorId` 只与**本设备已存行**比，不一致 40099 且**不写库**，首写登记 | `libs/app-domain/src/monitor/user/user.service.ts:89-113` | app-shared.md :206/:214；device.md §1 |
| 19 | 心跳 body 的 `deviceId` 已从 wire 白名单摘除；`userId` 只采信验签 AT | `apps/api/src/modules/app/monitor/user/dto/user.dto.ts:91-110` | app-shared.md :404 |
| 20 | 风控分级：敏感端点 fail-close → **40667**；其余 fail-open + `request.riskDegraded` | `libs/guards/src/guards/risk.guard.ts:57-70,102-107,157-161,182-194`；`contract/src/response-code.ts:116`；`exceptions/src/base/406.ts:106-125` | security.md §4.3 新增小节 |
| 21 | `/auth/**` 与 `/security/**` **全量显式归类**，默认 fail-open，漏登记由 spec 拦 | `libs/guards/src/guards/risk.sensitivity.ts:27-42,67-70,75-280,345-347` | security.md §4.3 |
| 22 | CAP guard 在「没有 recommendation」时也按分级（40667 / 放行 + `??= 'risk-recommendation-missing'`） | `libs/guards/src/guards/cap.guard.ts:87-105` | security.md §3 CAP 段 |
| 23 | `meta.riskDegraded` 只在非 `undefined` 时透出（缺省零 diff），三值原因 | `libs/guards/src/interceptors/response/success.interceptor.ts:47-56`；`risk.sensitivity.ts:47-51` | security.md §4.3 |
| 24 | actionlint 缺失 = **SKIP 但退出码 0**；prepush 执行器只看退出码 ⇒ SKIP 与 PASS 同形 | `packages/tooling/scripts/src/ci/lint-workflows.ts:20-27`；`src/ci/prepush.ts:291-311,324-328,339-341` | review/backend/index.md；libs-decoupling-residuals.md:71/:133 |
| 25 | prepush 段数实测 **26**（`PREPUSH_GATES` 的 `id` 计数） | `src/ci/prepush.ts:68-...`（26 个 `id`） | 两篇口径改成「以表为准」（不写数字） |
| 26 | workspace 包 **15**（3 apps + 3 platform-any + 2 platform-web + 1 generated + 6 tooling） | 枚举 `apps/*/package.json` 与 `packages/*/*/package.json` = 15；`pnpm-workspace.yaml` 的 `packages` 为判据 | README.md:22；release.md:13 |
| 27 | `walnut` 字段 **12** 个包；有 `test` 脚本 **7** 个；无 `private` **8** 个；`main`+`exports` 并存 **3** 个 | 逐包 `JSON.parse` 机械计数（见 §2 表） | reference-repo-comparison.md:210；README.md:81；AGENTS.md 常用命令 |
| 28 | 活文档里**仍有** `@walnut/ui` 引用（数量随报告增加而变，摘豁免前必须重扫）⇒ 豁免摘不掉 | 按 `check-doc-refs.ts:146-151` 的正则复扫；判据在 `:409-412`；`reports/` 只免路径不免包名（`:49-54`） | §2.1 + 保持豁免原样 |
| 29 | DB 侧 `ck_device_device_id_form` 存在，且加在「旧 64 hex 数据清空之后」 | `apps/api/migrations/1793390000000-DeviceIdFormCheck.ts:28-43` | device.md 自愈表；security.md §4.1；phase2 §4.8 |
| 30 | `ipHistory` 上限**不写 5**：上限在 DTO `maxSize` 与 repo 裁剪各写一次 | `device.dto.ts:93-105`；`device.repo.service.ts:255-259` | device.md §3；security.md；system-account.md |

> 没有核到、因此**没写**的：cap.js token 本体寿命 20 分钟与 `min(ttl,20min)`（`security.md` 第 3 节原有，
> 本批没动它）、`shared/capjs.md` 的可发现性补充（R1 的 B3 建议，**不在本批 4 块范围内**）。

---

## 7. 未做 / 遗留（需要 Lead 或下一批决定）

| # | 事项 | 为什么本批没做 |
|---|---|---|
| 1 | `packages/tooling/release/src/release/steps.ts:405` 的「11 段」 | **改它就是改源码**，与本批「只改文档 / diff 只含 md」的硬约束冲突；且任务给的「12 段」本身不成立（实测 26）。建议并入 13-G，改成「段数以表为准」 |
| 2 | 13-E 全部（`device.dto.ts` 两处 swagger title、两个 OAuth controller 注释、`crypto.service.ts` 2 处、心跳 `user.dto.ts:66/:80-82` 两处、`device-id.ts:20` 的「只在两处调用」） | 按任务划分属 13-E（改 swagger 必然触发 `openapi.json` + `schema.d.ts` 生成物 diff）。**注意 `device-id.ts:20` 的注释也已过期**（实测只有一个调用点），13-E 时一并改 |
| 3 | R1 的 B3：给 `shared/capjs.md` 补「配置单位是秒 / 缓存窗口 `min(ttl,20min)` / token 本体 20 分钟」3 行 | 不在本批 4 块范围（且需先读 `const/app/cap.ts` 复核，不能照抄） |
| 4 | R1 的 A11 可选项：`backend/postgresql.md:97` 的「设备**指纹** / 用户设备」 | 不在 13-A 点名的 5 篇里；一改就跑出范围 |
| 5 | `reports/NEEDS-CONFIRMATION.md:27` 的 C2 结案（删不删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint`） | R1 也判它属「决策归档」= 13-H，不是文档漂移 |
| 6 | **13-C 的机器侧**：prepush 汇总行「N 段全部通过」措辞 / 执行器三态 | 属 13-G（改执行器契约，会影响全部 26 段） |
| 7 | `industry-research/**`、`archive/**`、`reports/batch-*` 里的旧设备语义 | 冻结语料，按约束不动 |

### 7.1 两处「文档现在正确、但机制仍会漂」的风险（登记，不改）

1. **`ipHistory` 的上限写在两个地方**（DTO `arrayOptions.maxSize` 与 `updateIpAndLocation` 的
   `length > 5`）。文档现在写的是「两处同一条规则 —— 改一处就得改两处」，但**没有门禁**能把它们绑在一起。
2. **`deviceName` 的语义**（每次 initial 重新生成、覆盖已有行）没有任何 spec 断言守着 ——
   我只在文档里写清了；若将来有人把 deviceName 从 `deviceData` 摘掉，文档会静默变错。
   建议（下一批）在 `device.service.spec.ts` 里加一条「复用已有 cookie 时 deviceName 会变」的断言。

---

## 8. 一句话给下一位

`shared/device.md` 已经从「按旧语义整篇编」变成「按当前代码写的三件事：怎么签发、坏掉怎么自愈、
活多久」。**下次动设备身份相关代码，请先改 `const/app/device.ts` 的判据，再回头改这三段文档** ——
本批抓到的最大偏差（`deviceName` 覆盖语义、HTTP 200 与业务码、SameSite）全都是「文档写得比机制更
自信」造成的。
