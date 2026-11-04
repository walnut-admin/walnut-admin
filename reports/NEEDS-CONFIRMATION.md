# 需要你确认的清单

> **本清单已收口（2026-11-04）：§1 只剩两条待拍板**（`C4` 是架构方向、`C5` 是「接不接受改成不做」）——
> `C1` / `C2` / `C3` 都已结案，留在原地只为可追溯；§2 是「已按推荐做掉、留档供你事后否决」的账，
> **不在等你**，看到不认同的随时推翻。架构侧的待办真源是
> `apps/docs/src/zh-CN/content/monorepo/architecture-todo.md`，本文件只记**需要拍板**与**已代拍**。

> 规则（按你今晚定的）：**能给出推荐选项的，我直接做**，不再等你；
> 只有「实在决定不了 / 会改变对外契约或产品行为 / 不可逆」的，才写到这里。
> 每条都给：背景 / 选项 / 我的推荐 / 现在按哪个做的（或为什么没动）。

---

## 1. 现在等着确认的

> 两条待拍板（C4 / C5）+ 三条已结案（C1 / C2 / C3）。

### C1 · `device.ts:97` 的 `as` → `satisfies` —— **已结案**

**状态：已结案（选 B 并做完，`b382a580`）** ｜ 成本 **S** ｜ 原记在架构待办的 P3，已移入「已彻底关闭」

**背景**：B5 把 `deviceName` 从 Initial DTO 摘除后，admin 侧靠 `request.d.ts` 的 `Omit<..., 'deviceName'>` 做类型守卫。
但调用点用的是 `as`，实测**会把这个守卫吞掉**（多带 deviceName 时 tsc 零报错），只能靠服务端 40099 兜住。

**当时为什么没直接改**：换 `satisfies` 会立刻暴露两处**预存在**的类型松动
（`device.ts:83` 的 `unknown→number`、`:86` 的 `deviceInfo` 缺 `type`），要修得动 payload 的构造来源。

**选项**：
- A：保留 `as`，在代码注释里写明代价，记为 P3
- B（**最终按这个做的**）：改成 `satisfies` 并顺手修那两处类型松动

**结案（`b382a580`）**：按 B 做完。顺带查清了「那两处松动为什么会在」——真问题不是断言本身，
而是 **`Initial` 类型取错了面**：原来取的是实体面，改用 wire 面
`components['schemas']['SysDeviceDTOInitialRequest']` 之后，两处松动各按真因修
（`getMemoryGB(): number`；`deviceInfo.type` 可选就不发）。所以这条的真正产物是「一个取错的类型来源」
被消掉，`satisfies` 只是让它显形 —— 只把 `as` 换成 `satisfies` 而不改类型来源，等于换个姿势继续错。

---

### C2 · 删不删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint` —— ✅ **已结案**

**状态：已结案（第 14 批）** ｜ 结论：删了，env 不提

**背景**：B5 之后两者都 0 消费者。R2 的理由是「删了会让 `DEVICE_ID_ENCRYPTION_KEY` 失去唯一引用」——
**R3 实测这个理由是错的**（另有 4 处引用：`validation.ts:213`、`crypto.config.ts:15`、`validation.spec.ts:125`、`process.d.ts:63`；它们的「只允许这三处骨架」由 `device-issuance.drift.spec.ts` 机械守）。
删掉只会让 `crypto.deviceIdKey` 悬空。

**选项**：
- A（**当前按这个做的**）：先不删，等下一批统一清死代码
- B：现在删，同时处理 `crypto.deviceIdKey` 的悬空

**推荐 A**（单独一批做，别和认证链路混）。

**结案（第 14 批）**：已按 A 执行完 —— A 的承诺就是「先不删，等下一批统一清死代码」，第 14 批正是
那一批：`getDeviceIdByFingerprint` + `hashDeviceFingerprint` **已删除**（全仓 0 命中）。
`crypto.deviceIdKey` 与 `DEVICE_ID_ENCRYPTION_KEY` **不动**：它们已是部署契约的一部分，退役要动
dotenvx 密文 + 多处文档 = 改对外契约，另案裁定。删除面与理由见 `reports/batch-14/r1-residuals.md` 的 14-D。

---

### C3 · `concurrency` G6 的既有 flake —— **已结案**

**状态：已结案（测试侧 + 库侧都修：`e2dc612d` / `c7f7e11f`）** ｜ 成本 **M** ｜ 原记在架构待办的 P3，已移入「已彻底关闭」

**背景**：`expected 3 to be 1003`（rotate 没命中自插的高 version 种子行），单跑 6/6 绿、全量偶发。
R3 的可疑方向：应用池上**会话级 RLS GUC 残留**，使造种子的连接与轮换事务的连接看到不同的 `app_key` 行。

**选项**：
- A：记为已知 flake，全量读数偶发 1 failed 不结案
- B：单开一批查 RLS GUC 与会话复用（可能牵出连接池配置改动）
- C：让该 spec 自带隔离（每次用独立连接造种子）

**结案（按 B 做，两条都关）**：

1. **测试侧**（`e2dc612d`）：该 spec 造种子改成**显式提交事务**，不再借连接池上的会话态。偶发因此从
   「随机红」变成可定位的诊断 —— 它现在报的是「看见了几行、哪一行不对」。
2. **库侧**（`c7f7e11f`）：真 bug 在 `apps/server/libs/db/src/tx.interceptor.ts` —— 失败路径的 catch
   **只 release 不 rollback**，而 TypeORM 的 `release()` 并不结束事务，于是连接**带着未提交事务回池**、
   被下一个请求借走（PG 把事务块内的语句全落进那个旧事务）。修法是把失败路径收敛成唯一出口：
   **先 rollback、再 release**。负对照在真实 PG 上读到 `expected 'idle in transaction' to be 'idle'`
   （`apps/server/apps/api/test/integration/tx/tx.pool-pollution.int-spec.ts`）。

**口径（诚实版）**：本机当晚跑全量 16 轮、**0 次复现**，所以不能说「偶发已被证明消失」。能站住的只有两句：
**唯一自洽的机制已经被消掉**（毒连接不再回池），**残余异常会变成可定位的诊断**（种子显式提交、失败可读）。
将来若再看到同一处红，先看它是「机制回来了」还是「另一条路径」—— 前者有负对照拦，后者才需要新判据。

---

### C4 · `platform-node` 走 P1（自建 CJS dist）还是 P2（不搬）

**状态：待拍板**（推荐 A = P2 不搬）｜ 成本 **L**（P1 那一支）｜ 记在架构待办的「未裁决」（P1 那一支另见「待触发」）

**背景**：D4 原定把 28 个「业务无关的后端基建」库下沉到 `packages/platform-node`，前提是
「零 import 改写、只改 5 个配置面」。2026-11-03 的 `const` 单库 POC 实测**不通过**：`@swc/cli` 的
`getDest` 让产物逃出 `dist`（build 仍 exit 0）、`stripLeadingPaths` 是全局布尔（开了就把
`dist/apps/api/src/main.js` 塌成 `dist/api/src/main.js`）、跨包 `include` 连累 assets 校验且
`types:check` 爆 TS2307。证据见 `industry-research/backend-architecture-review/` 的
[10 号报告 §10.2](../apps/docs/src/zh-CN/content/industry-research/backend-architecture-review/10-implementation-plan.md)
与 [ADR 0007 的 2026-11-03 追记](../apps/docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md)。

**为什么没直接定**：两条路都自洽。P1 换回「包边界」这个收益，代价是新增一条构建流水线 +
`peerDeps(@nestjs/*)` + 28 库搬迁，而且第一关必须是「`tsc` 产出的装饰器元数据与 SWC 等价」——
错了的症状是静默的（接口 200 但字段消失）。P2 放弃搬迁，而「边界清晰」今天已由 ESLint 六层
分层 + 3 个 drift spec 提供。

**选项**：
- A（**当前按这个做的**）：**P2 不搬**，保留 `apps/server/libs/**`；`platform-node` 的 turbo tag 规则
  留着（没有 subject、永远空转，属已知冗余）
- B：**P1 自建 CJS dist**（照 `@walnut/contract` 样板），`apps/server` 消费 dist，28 库分批搬

**推荐 A（P2）**。触发条件已写进 ADR 0007：出现**第二个 Node 产品**（不是第二个进程 —— worker
与 api 共用同一份 AppModule 与构建产物，不构成跨包复用），或决定把后端能力对外发布时，再评估 B。

---

### C5 · `D18②`「桶回 knip `entry`」被实测判为物理不可执行 —— 接不接受「改成不做」

**状态：待拍板**（推荐 A = 接受不做）｜ 成本 **A 为 0 / B 为 M** ｜ 记在架构待办的「未裁决」

**背景**：原处方是「把共享包的 barrel 从 knip 的 `entry` 里摘出去，改用一个『0 引用』脚本」。实测判为
**物理不可执行**：knip 会从 `package.json` 的 `exports` 把同一个 barrel **推回 `entry`**，摘了等于没摘。
后果是 `src/index.ts` 作为包入口，它的导出天然算「公共 API」，**barrel 自身的死导出仍是盲区**。
判据与推理写在 `knip.config.ts` 的注释里（不是散落在本清单里）。

**选项**：
- A（**当前按这个做的**）：**接受「改成不做」** —— 这条面不做，只在 `knip.config.ts` 留判据与理由（成本 0）
- B：另立「barrel 符号 0 引用」专用脚本（先报告模式 → 白名单 → 再进 prepush，成本 M）

**推荐 A**：knip 侧的配置问题已经解决不了它，再堆配置只是把盲区写得更好看；B 的收益要等真有第二个
消费方时才兑现。

**编号来由**：这条原来只在架构待办的「未裁决」里、**没有 `C` 号**（那份清单原先只收 C1–C4）。
2026-11-04 给它补上 `C5`，架构待办那边的「未裁决」与「待触发」两处已改成指向本编号。

---

## 2. 已按推荐直接做掉的（留档，供你事后否决）

| 项 | 我做的决定 | 依据 |
|---|---|---|
| `ON UPDATE CASCADE` | **不加** | 全仓 0 处把 `device_id` 改成另一个值；现状 FK 会让真改名 23503 硬失败，CASCADE 会静默改写子表 |
| `fingerprint_hash` 列 | **不加** | 全仓 0 消费者；指纹已在 `app_monitor_user.visitor_id`；加了会把「指纹合法漂移」变成无自愈路径的永久 40099 |
| 双读窗口 60 天 | **不实现**（硬切） | 开发阶段无存量；窗口的唯一价值是保护存量会话连续性 |
| 心跳 visitorId 校验 | 改成「与本设备已存行的 `visitor_id` 比」 | DTO 注释本来就是这么写的；行键已是不可伪造的 deviceId |
| 90 天锚点 | `active=false AND updated_at<90d` | 只用 `stale` 会漏掉「用过再放弃」的那群（永远 stale=false） |
| `banned/locked` 行 | **永久保留** | 删 = 静默解封 |
| `deviceName` | 服务端生成 + 从 Initial DTO 摘除 | 客户端拼的名字会撞 `uq_device_name` ⇒ 23505 ⇒ 设备永久注册不上 |
| CAP 的 40111 | 只在「本地可证 cookie 非 cap.js token 形态」时抛 | `success:false`（已消费/过期）若也抛 40111，等于每 20 分钟踢一次全部在线用户 |
| `otp/send` 的风控分级 | 保持 **fail-open** | 已有独立 throttle；风控抖动时 fail-close 会让全部 OTP 登录不可用 |
| 新业务码 `40667` | 保留独立码，不复用 40666 | 「风险过高」与「风控不可用」必须可区分，否则排查时分不清 |
| `APP:MURLOCK` 键前缀 | **不改** | 改 Redis 键空间要迁移，收益为 0 |
| `roles_list` / `roles_count` | **永久冻结** | 改名的收益（风格纯）远小于动 openapi + 前端 6 处 + 测试 5 处 + i18n |
| prepush 的 SKIP | **改成第四态**（退出码 3 + 汇总单列「跳过（未验证）」+ `PREPUSH_STRICT=1` 才判红）。**已落地**：结果行 `[-]` 且行尾带 `[SKIP 未验证]`，三态 / 汇总 / 严格口径各有回归用例（`packages/tooling/scripts/src/ci/__tests__/prepush.test.ts`） | 现状 SKIP 与 PASS 在输出与退出码上完全同形（门禁脚本探测不到工具就 `return 0`，prepush 又只在失败时回放输出）⇒ 等于把「未验证」说成「通过」；默认不判红是为了不误伤没装工具的机器 |
| `DEVICE_ID_ENCRYPTION_KEY` | **保留 env，只改措辞**（三处注释改写成现状，env / 密文 / 部署说明一概不动） | 它是「部署后不许改的 5 个」之一 = **部署契约**，但 B5 起 **0 个消费者**（指纹不落库、不参与身份派生；3 处读者全是配置骨架，由 `device-issuance.drift.spec.ts` 机械守）。退役要连 env 模板 + dotenvx 密文 + 部署说明一起改 = 改对外契约，另案裁定。改措辞是因为旧注释「used for encrypting device id」是**错的**（它从没加密过任何东西） |
| 门禁预算 | **按段给预算**：`PrepushGate.budgetMs` 优先、缺省回落 `GATE_BUDGET_MS` = 600s（`5dbdb4e8`），lint / test 两段单独用 `SLOW_GATE_BUDGET_MS`（`17450ef5`）；`PREPUSH_BUDGET_MS` 仍是「整台机器都慢」时的全表一处覆盖 | 全表一个默认值会让慢段顶到上限，而「超时被杀」与「真失败」在读数上同形。数值不是拍的：它是**冷跑实测下界**推出来的，实测表就在 `prepush.ts` 的 `SLOW_GATE_BUDGET_MS` 注释里 |
| 一段超时杀掉并发兄弟段 | **改杀本条 gate 的子树**：超时分支调 `killChildTree(child)`，不再是无参的 `killActiveChild()` | 原来超时顺手收掉兄弟段 ⇒ 上一轮实测 4 条失败里 3 条是假红。「被兄弟段的超时连带判死」与「自己失败」在读数上完全同形 —— 那是门禁在伪造证据 |
| `libs/delay` | **整库删除**（`41be94ab`） | 死库：0 import、服务零注入（唯一痕迹是 `shared.module.ts` 的注册）⇒ 留着的唯一效果是让人以为有个延迟能力可用。决策 D13① |
| `libs/context` | **整库并入 `libs/als`**（`add9481b`） | 两套 ALS 并存意味着**两个实例**；合并实例会让 winston 读不到 `requestId`（那是它唯一的取数通道），所以搬的是**模块边界**，实例保持两个。搬完 `rg '@walnut-server/context' apps/server` 只剩别名残留 |
| `C1`（admin 请求体的 `as`） | **改成 `satisfies`（选 B）并修掉两处松动**（`b382a580`） | 断言确实吞掉了 `Omit<...>` 守卫，但真问题是 `Initial` 类型取了实体面而不是 wire 面 —— 改对类型来源之后，两处松动各按真因修（`getMemoryGB(): number`、`deviceInfo.type` 可选就不发） |
| `C3`（`concurrency` 的 G6） | **测试侧 + 库侧都修**（`e2dc612d` / `c7f7e11f`） | 库侧是**真 bug**：失败路径 catch 只 release 不 rollback ⇒ 毒连接带着未提交事务回池，有真实 PG 上的负对照（`expected 'idle in transaction' to be 'idle'`）。测试侧把种子改成显式提交，让残余异常变成可定位诊断。本机 16 轮全量 0 次复现，所以口径是「唯一自洽的机制已被消掉」而不是「偶发已被证明消失」 |
| 测试目录 | **重整成三档**（`9238dcc8`）：单测进同目录 `__tests__/`、接口测试 `test/api/<模块>/`、集成 `test/integration/<领域>/`、e2e `test/e2e/` | 判据写进 `architecture-todo.md` 的「测试目录约定」（写落点规则、不写文件数）。重整**只动位置不动内容**（用例集合不变）—— 「源码与测试分居两棵树」才是真正的成本 |
| `--skip-gates` 的记账 | **不再算「真跑通过」**（`5dbdb4e8`） | 发版电池的汇总原先把「显式 `--skip-gates` 跳过」与「子进程退 3（本机缺工具）」都算进 ranCount ⇒ 带病发版会读成「全都验过」。现在单列「跳过（未验证）」并减 ranCount，判红口径只在真失败上；两条回归用例覆盖（`release/steps.ts` 的记账函数） |
