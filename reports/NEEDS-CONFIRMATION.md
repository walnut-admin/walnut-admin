# 需要你确认的清单

> **本清单已收口（2026-11-04）：下面 §1 是仍需你拍板的三条**（`C1` 是 P3 技术债、`C3` 是测试隔离、
> `C4` 是架构方向）—— `C2` 已结案，留在原地只为可追溯；§2 是「已按推荐做掉、留档供你事后否决」的账，
> **不在等你**，看到不认同的随时推翻。架构侧的待办真源是
> `apps/docs/src/zh-CN/content/monorepo/architecture-todo.md`，本文件只记**需要拍板**与**已代拍**。

> 规则（按你今晚定的）：**能给出推荐选项的，我直接做**，不再等你；
> 只有「实在决定不了 / 会改变对外契约或产品行为 / 不可逆」的，才写到这里。
> 每条都给：背景 / 选项 / 我的推荐 / 现在按哪个做的（或为什么没动）。

---

## 1. 现在等着确认的

> 三条待拍板（C1 / C3 / C4）+ 一条已结案（C2）。

### C1 · `device.ts:97` 的 `as` → `satisfies`

**状态：待拍板** ｜ 成本 **S** ｜ 记在架构待办的 P3

**背景**：B5 把 `deviceName` 从 Initial DTO 摘除后，admin 侧靠 `request.d.ts` 的 `Omit<..., 'deviceName'>` 做类型守卫。
但调用点用的是 `as`，实测**会把这个守卫吞掉**（多带 deviceName 时 tsc 零报错），只能靠服务端 40099 兜住。

**为什么没直接改**：换 `satisfies` 会立刻暴露两处**预存在**的类型松动
（`device.ts:83` 的 `unknown→number`、`:86` 的 `deviceInfo` 缺 `type`），要修得动 payload 的构造来源。

**选项**：
- A（**当前按这个做的**）：保留 `as`，在代码注释里写明代价，记为 P3
- B：改成 `satisfies` 并顺手修那两处类型松动（约半天，会碰 payload 构造）

**推荐 B，但排在 D 组之后。**

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

### C3 · `concurrency` G6 的既有 flake

**状态：待拍板**（推荐 B）｜ 成本 **M** ｜ 记在架构待办的 P3

**背景**：`expected 3 to be 1003`（rotate 没命中自插的高 version 种子行），单跑 6/6 绿、全量偶发。
R3 的可疑方向：应用池上**会话级 RLS GUC 残留**，使造种子的连接与轮换事务的连接看到不同的 `app_key` 行。

**为什么没修**：这是**既有 flake**，且根因未证实；盲改 RLS 连接池风险很高。

**选项**：
- A（**当前按这个做的**）：记为已知 flake，全量读数偶发 1 failed 不结案
- B：单开一批查 RLS GUC 与会话复用（可能牵出连接池配置改动）
- C：让该 spec 自带隔离（每次用独立连接造种子）

**推荐 B**，但需要真实复现窗口；C 是低风险兜底。

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
| 门禁预算 300s → 600s | **默认提到 600s + 加覆盖变量** `PREPUSH_BUDGET_MS` | 实测慢段（集成 / 构建类）会顶到 300s，而「超时被杀」与「真失败」在读数上同形（再叠加一条段的超时会杀掉并发兄弟段 ⇒ 假红）。按段区分仍待做，见架构待办 P2 `batch15-b` |
| `libs/delay` | **整库删除** | 死库：0 import、服务零注入（唯一痕迹是 `shared.module.ts` 的注册）⇒ 留着的唯一效果是让人以为有个延迟能力可用。决策 D13① |
| `--skip-gates` 的记账 | **不再算「真跑通过」** | 发版电池的汇总原先把「显式 `--skip-gates` 跳过」与「子进程退 3（本机缺工具）」都算进 ranCount ⇒ 带病发版会读成「全都验过」。现在单列「跳过（未验证）」并减 ranCount，判红口径只在真失败上；两条回归用例覆盖（`release/steps.ts` 的记账函数） |
