# 需要拍板的

> **本页是自足的真源，不是摘要。** 每条都给：背景 / 选项 / 推荐 / 现在按哪个做的 / 状态。
> 原先另有一份仓库内的拍板清单，已随 2026-11-04 收尾**归档至 git 历史** —— 它的内容已**全量并入本页**，
> 看这里就够，不必再去找那份文件。
>
> 口径（按你定的规则）：**能给出推荐选项的，我直接做**，不再等你；只有「实在决定不了 / 会改变对外契约
> 或产品行为 / 不可逆」的才摆在这里。所以本页三段：
> **一**、还在等你的（`C4` / `C5`）；**二**、已结案留档（`C1` / `C2` / `C3`，留着只为一句话能回到原处）；
> **三**、已按推荐直接做掉的整表（**不在等你**，看到不认同的随时推翻）。
>
> `C` 号是索引键：**架构待办**、ADR 与提交信息里引用的编号对得上本页，换了位置不换号。

## 一、还在等你的（两条）

### `C4` · `D4` 之后端基建要不要搬进一个平台包（P1 / P2）

**状态：待拍板**（推荐 A = **P2 不搬**）｜ 成本 **L**（只算 P1 那一支）｜ 记在架构待办的「未裁决」

- **背景**：原计划把 28 个「业务无关的后端基建」库下沉成一个 `platform-node` 包，前提是「零 import 改写、只改几个配置面」。
  2026-11-03 的 `const` 单库 POC 把这个前提判掉了：`@swc/cli` 的 `getDest` 让产物按源文件的逐字符镜像逃出 `dist`，
  而 **build 仍然 exit 0**；唯一开关 `stripLeadingPaths` 是全局布尔，开了就把 `dist/apps/api/src/main.js` 塌成
  `dist/api/src/main.js`；跨包 `include` 连累 assets 校验，补 `rootDir` 能救绿但会让 `types:check` 爆 TS2307。
- **为什么没直接定**：两条路都自洽。见下面选项各自的代价 —— 这一条不是「哪个便宜」，是「要不要为边界再养一条构建流水线」。
- **选项**
  - **A · P2 不搬** —— `apps/server/libs/**` 原样保留。「边界清晰」这个收益今天已由 ESLint 六层分层 + 三个 drift spec 提供；
    代价是 `turbo.json` 里那条 `platform-node` tag 没有 subject、永远空转（属已知冗余，不是遗漏）。
  - **B · P1 自建 CJS dist**（照 `@walnut/contract` 的样板）—— 换回「包边界」，代价是新增一条构建流水线、
    `peerDeps(@nestjs/*)` 与分批搬迁；第一关必须是「`tsc` 产出的装饰器元数据与 SWC 等价」，
    错了的症状是**静默的**（接口 200 但字段消失）。
- **推荐 A（P2）**。触发条件已写进 ADR 0007：出现**第二个 Node 产品**（不是第二个进程 —— worker 与 api 共用同一份
  `AppModule` 与产物），或决定把后端能力对外发布时，再评估 B。
- **现在按 A 做的。**
- 证据：[07 · D4](../industry-research/backend-architecture-review/07-decisions.md) ·
  [10 §10.2](../industry-research/backend-architecture-review/10-implementation-plan.md) ·
  [ADR 0007 的 2026-11-03 追记](../adr/0007-backend-libs-not-workspace.md)

### `C5` · `D18②` 之 barrel 死导出的原处方被判「物理不可执行」，接不接受「改成不做」

**状态：待拍板**（推荐 A = **接受不做**）｜ 成本 **A 为 0 / B 为 M**｜ 记在架构待办的「未裁决」

- **背景**：原处方是「把共享包的 barrel 从 knip 的 `entry` 里摘出去，改用一个『0 引用』脚本」。实测判为**物理不可执行**：
  knip 会从 `package.json` 的 `exports` 把同一个 barrel 推回 `entry`，**摘了等于没摘**。
  后果是 `src/index.ts` 作为包入口，它的导出天然算「公共 API」，**barrel 自身的死导出仍是盲区**。
- **选项**
  - **(a) 接受「改成不做」** —— 这条面不做，只在 `knip.config.ts` 留判据与理由（成本 0）；
  - **(b) 另立「barrel 符号 0 引用」专用脚本**（先报告模式 → 白名单 → 再进 prepush，成本 M）。
- **推荐 (a)**：knip 侧的配置问题已经解决不了它，再堆配置只是把盲区写得更好看；(b) 的收益要等真有第二个消费方时才兑现。
- **现在按 (a) 走的**：判据落在 `knip.config.ts`，没有新增脚本。改成 (b) 属于新开一批（成本 M）。
- **编号**：本条原来只在[架构待办事项](/content/monorepo/architecture-todo) 的「未裁决」里、没有 `C` 号，
  2026-11-04 补成 `C5` —— 索引按 `C` 编号收条目，没有号就等于挂在两处真源之间。

## 二、已结案留档（`C1` / `C2` / `C3`）

> 这三条**不在等你**。留着是因为「当时为什么没直接做」和「最后怎么做的」本身就是判据 ——
> 尤其 `C1` / `C3` 两条的结论都**推翻了最初的判断**，删掉等于把那两个假结论的教训一起删了。

### `C1` · admin 请求体的 `as` → `satisfies`

**状态：已结案（选 B 并做完）** ｜ 成本 **S** ｜ 原记在架构待办的 P3，已移入「已彻底关闭」

- **背景**：B5 把 `deviceName` 从 Initial DTO 摘除后，admin 侧靠 `request.d.ts` 的 `Omit<..., 'deviceName'>` 做类型守卫。
  但调用点用的是 `as`，实测**会把这个守卫吞掉**（多带 `deviceName` 时 tsc 零报错），只能靠服务端 40099 兜住。
- **当时为什么没直接改**：换 `satisfies` 会立刻暴露两处**预存在**的类型松动
  （`device.ts` 的 `unknown→number`、`deviceInfo` 缺 `type`），要修得动 payload 的构造来源。
- **选项**：A 保留 `as`、在代码注释里写明代价，记为 P3；**B（最终按这个做的）** 改成 `satisfies` 并顺手修那两处类型松动。
- **结案（按 B）**：顺带查清了「那两处松动为什么会在」——**真问题不是断言本身**，而是 `Initial` 类型**取错了面**：
  原来取的是实体面，改用 wire 面 `components['schemas']['SysDeviceDTOInitialRequest']` 之后，两处松动各按真因修
  （`getMemoryGB(): number`；`deviceInfo.type` 可选就不发）。所以这条的真正产物是「一个取错的类型来源」被消掉，
  `satisfies` 只是让它显形 —— 只把 `as` 换成 `satisfies` 而不改类型来源，等于换个姿势继续错。

### `C2` · 删不删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint`

**状态：已结案** ｜ 结论：**删了**，env 不提

- **背景**：B5 之后两者都 0 消费者。当时的理由曾是「删了会让 `DEVICE_ID_ENCRYPTION_KEY` 失去唯一引用」——
  **这个理由是错的**（另有 4 处引用：`validation.ts`、`crypto.config.ts`、`validation.spec.ts`、`process.d.ts`；
  它们的「只允许这几处骨架」由 `device-issuance.drift.spec.ts` 机械守）。删掉只会让 `crypto.deviceIdKey` 悬空。
- **选项**：**A（当时按这个做的）** 先不删，等下一批统一清死代码；B 现在删，同时处理 `crypto.deviceIdKey` 的悬空。
- **推荐 A**（单独一批做，别和认证链路混）。
- **结案**：A 的承诺就是「先不删，等下一批统一清死代码」，第 14 批正是那一批 —— 两个函数**已删除**（全仓 0 命中）。
  `crypto.deviceIdKey` 与 `DEVICE_ID_ENCRYPTION_KEY` **不动**：它们已是部署契约的一部分，
  退役要动 dotenvx 密文 + 多处文档 = 改对外契约，另案裁定。

### `C3` · `concurrency` G6 的既有 flake

**状态：已结案（测试侧 + 库侧都修）** ｜ 成本 **M** ｜ 原记在架构待办的 P3，已移入「已彻底关闭」

- **背景**：`expected 3 to be 1003`（rotate 没命中自插的高 version 种子行），单跑 6/6 绿、全量偶发。
  当时最可疑的方向：应用池上**会话级 RLS GUC 残留**，使造种子的连接与轮换事务的连接看到不同的 `app_key` 行。
- **选项**：A 记为已知 flake，全量读数偶发 1 failed 不结案；B 单开一批查 RLS GUC 与会话复用（可能牵出连接池配置改动）；
  C 让该 spec 自带隔离（每次用独立连接造种子）。
- **结案（按 B 做，两条都关）**
  1. **测试侧**：该 spec 造种子改成**显式提交事务**，不再借连接池上的会话态。偶发因此从「随机红」变成可定位的诊断 ——
     它现在报的是「看见了几行、哪一行不对」。
  2. **库侧**：真 bug 在 `apps/server/libs/db/src/tx.interceptor.ts` —— 失败路径的 catch **只 release 不 rollback**，
     而 TypeORM 的 `release()` 并不结束事务，于是连接**带着未提交事务回池**、被下一个请求借走
     （PG 把事务块内的语句全落进那个旧事务）。修法是把失败路径收敛成唯一出口：**先 rollback、再 release**。
     负对照在真实 PG 上读到 `expected 'idle in transaction' to be 'idle'`
     （`apps/server/apps/api/test/integration/tx/tx.pool-pollution.int-spec.ts`）。
- **口径（诚实版）**：本机当晚跑全量 16 轮、**0 次复现**，所以不能说「偶发已被证明消失」。能站住的只有两句：
  **唯一自洽的机制已经被消掉**（毒连接不再回池），**残余异常会变成可定位的诊断**（种子显式提交、失败可读）。
  将来若再看到同一处红，先看它是「机制回来了」还是「另一条路径」—— 前者有负对照拦，后者才需要新判据。

## 三、已按推荐直接做掉的（留档，供你事后否决）

只留**有判据**的行；纯记账的日志不搬过来。判据指的是「凭什么这么定」，不是「谁在什么时候改的」。

| 项 | 做的决定 | 判据 |
|----|---------|------|
| `ON UPDATE CASCADE` | **不加** | 全仓没有一处把 `device_id` 改成另一个值；现状 FK 会让真改名 23503 硬失败，而 CASCADE 会静默改写子表 |
| `fingerprint_hash` 列 | **不加** | 零消费者，指纹已在心跳表里；加了会把「指纹的合法漂移」变成无自愈路径的永久 40099 |
| 双读窗口 | **不实现（硬切）** | 开发阶段无存量；窗口的唯一价值是保护存量会话的连续性 |
| 90 天留存锚点 | `active=false AND updated_at<90d` | 只用 `stale` 会漏掉「用过之后再放弃」的那群 —— 它们的 `stale` 永远是 false |
| `banned` / `locked` 的行 | **永久保留** | 删了等于静默解封 |
| 心跳 `visitorId` 校验 | 改成「与本设备**已存行**比」 | 行键已经是不可伪造的 `deviceId`；HMAC 派生这条身份路径已撤 |
| `deviceName` | 服务端生成 + 从 Initial DTO 摘除 | 客户端自己拼的名字会撞唯一约束 ⇒ 23505 ⇒ 设备永久注册不上 |
| CAP 的 40111 | 只在「本地可证 cookie 不是 cap.js token 形态」时抛 | 已消费/过期的 token 也抛，等于每 20 分钟踢一次全部在线用户 |
| `otp/send` 的风控分级 | 保持 **fail-open** | 已有独立 throttle；风控抖动时 fail-close 会让全部 OTP 登录不可用 |
| 新业务码 40667 | 保留独立码，不复用「风险过高」那个 | 「风险过高」与「风控不可用」必须可区分，否则排查时分不清 |
| `APP:MURLOCK` 键前缀 | **不改** | 改 Redis 键空间要迁移，收益为 0 |
| `roles_list` / `roles_count` | **永久冻结** | 改名的收益（风格纯）远小于动 openapi + 前端 + 测试 + i18n 的代价 |
| prepush 的 SKIP | **改成第四态**：退出码 3 + 汇总单列「跳过（未验证）」+ `PREPUSH_STRICT=1` 才判红 | 现状 SKIP 与 PASS 在**输出与退出码上完全同形** ⇒ 等于把「未验证」说成「通过」；默认不判红是为了不误伤没装工具的机器 |
| 门禁预算 | **按段给预算**（慢段单独放开）+ `PREPUSH_BUDGET_MS` 覆盖 | 「超时被杀」与「真失败」读数同形，且一段超时会连带杀掉并发兄弟段 ⇒ 一次超时伪造出一片假红（判据与实测表在 `packages/tooling/scripts/src/ci/prepush.ts:80-96`） |
| 一段超时杀掉并发兄弟段 | **改杀本条 gate 的子树**：超时分支调 `killChildTree(child)`，不再是无参的 `killActiveChild()` | 原来超时顺手收掉兄弟段 ⇒ 上一轮实测 4 条失败里 3 条是假红；「被兄弟段的超时连带判死」与「自己失败」在读数上完全同形 |
| `DEVICE_ID_ENCRYPTION_KEY` | **保留 env，只改措辞** | 它是「部署后不许改」的部署契约；但身份改造后**零消费者**（只剩配置骨架三处读者）。退役要连 env 模板 + 密文 + 部署说明一起改 = 改对外契约，另案裁定 |
| `libs/delay` | **整库删除** | 死库：零 import、服务零注入；留着的唯一效果是让人以为有个延迟能力可用 |
| `libs/context` | **整库并入 `libs/als`** | 两套 ALS 并存意味着**两个实例**；合并实例会让 winston 读不到 `requestId`（那是它唯一的取数通道），所以搬的是**模块边界**，实例保持两个 |
| 测试目录 | **重整成三档**：单测进同目录 `__tests__/`、接口测试 `test/api/<模块>/`、集成 `test/integration/<领域>/`、e2e `test/e2e/` | 判据写进[架构待办事项](/content/monorepo/architecture-todo) 的「测试目录约定」（写落点规则、不写文件数）。重整**只动位置不动内容**（用例集合不变）——「源码与测试分居两棵树」才是真正的成本 |
| `--skip-gates` 的记账 | **不再算「真跑通过」** | 原先把「显式跳过」与「子进程退 3」都算进已跑 ⇒ 带病发版会读成「全都验过」 |
| `C1`（admin 请求体的 `as`） | **改成 `satisfies`（选 B）**，两处松动一起修 | 断言确实吞掉了 `Omit<...>` 守卫；但真问题是 `Initial` 类型取了实体面而不是 wire 面 —— 换对类型来源（`components['schemas']['SysDeviceDTOInitialRequest']`）之后，两处松动各按真因修（`getMemoryGB(): number`、`deviceInfo.type` 可选就不发） |
| `C3`（`concurrency` 的 G6） | **测试侧 + 库侧都修** | 库侧是**真 bug**：失败路径 catch 只 release 不 rollback ⇒ 毒连接带着未提交事务回池（真实 PG 上的负对照读到 `expected 'idle in transaction' to be 'idle'`）；测试侧把种子改成显式提交。本机 16 轮全量 0 次复现，所以口径是「唯一自洽的机制已被消掉 + 残余异常变成可定位诊断」，**不是**「偶发已被证明消失」 |

## 四、看到不认同怎么办

直接推翻即可 —— 上面每一条都有对应的落地位置（判据列写了「凭什么」，代码位置在注释里），
推翻时的成本按条目不同：改常量/改配置是一小时级，动 env 与密文是「改对外契约」级别。
