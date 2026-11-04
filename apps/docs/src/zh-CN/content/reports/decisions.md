# 需要拍板的

> **这份是给人看的摘要，不是证据本身。** 每条只留「背景一句话 / 选项 / 推荐 / 现在按哪个做的」；
> **逐条证据在 `reports/NEEDS-CONFIRMATION.md`**（仓库路径，不在文档站内）—— 以那份为准，别拿本页替代它。
> 两条待拍板各有一个 `C` 号（`C4` / `C5`）—— `C` 号是那份清单的索引键，摘要与证据用同一个键对得上。
>
> 口径：**能给推荐选项的已经直接做掉了**（见文末的表，随时可以否决）。留在这里的都是另一类 ——
> 会改对外契约、不可逆，或者两条路都自洽。

## 一、还在等你的（两条）

### `C4` · `D4` 之后端基建要不要搬进一个平台包（P1 / P2）

- **背景**：原计划把「业务无关的后端基建」下沉成一个 `platform-node` 包，前提是「零 import 改写、只改几个配置面」。
  2026-11-03 的 `const` 单库 POC 把这个前提判掉了：`@swc/cli` 的 `getDest` 让产物按源文件的逐字符镜像逃出 `dist`，
  而 **build 仍然 exit 0**；唯一开关 `stripLeadingPaths` 是全局布尔，开了就把 `dist/apps/api/src/main.js` 塌成
  `dist/api/src/main.js`；跨包 `include` 连累 assets 校验，补 `rootDir` 能救绿但会让 `types:check` 爆 TS2307。
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

- **背景**：原处方是「把共享包的 barrel 从 knip 的 `entry` 里摘出去，改用一个『0 引用』脚本」。实测判为**物理不可执行**：
  knip 会从 `package.json` 的 `exports` 把同一个 barrel 推回 `entry`，**摘了等于没摘**。
  后果是 `src/index.ts` 作为包入口，它的导出天然算「公共 API」，**barrel 自身的死导出仍是盲区**。
- **选项**
  - **(a) 接受「改成不做」** —— 这条面不做，只在 `knip.config.ts` 留判据与理由（成本 0）；
  - **(b) 另立「barrel 符号 0 引用」专用脚本**（先报告模式 → 白名单 → 再进 prepush，成本 M）。
- **推荐 (a)**：knip 侧的配置问题已经解决不了它，再堆配置只是把盲区写得更好看；(b) 的收益要等真有第二个消费方时才兑现。
- **现在按 (a) 走的**：判据落在 `knip.config.ts`，没有新增脚本。改成 (b) 属于新开一批（成本 M）。
- **编号**：本条原来只在[架构待办事项](/content/monorepo/architecture-todo) 的「未裁决」里、没有 `C` 号，
  2026-11-04 补成 `C5` —— 那份清单按 `C` 编号收条目，没有号就等于挂在两处真源之间。

## 二、已按推荐直接做掉的（留档，供你事后否决）

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
| `DEVICE_ID_ENCRYPTION_KEY` | **保留 env，只改措辞** | 它是「部署后不许改」的部署契约；但身份改造后**零消费者**（只剩配置骨架三处读者）。退役要连 env 模板 + 密文 + 部署说明一起改 = 改对外契约，另案裁定 |
| `libs/delay` | **整库删除** | 死库：零 import、服务零注入；留着的唯一效果是让人以为有个延迟能力可用 |
| `--skip-gates` 的记账 | **不再算「真跑通过」** | 原先把「显式跳过」与「子进程退 3」都算进已跑 ⇒ 带病发版会读成「全都验过」 |
| `C1`（admin 请求体的 `as`） | **改成 `satisfies`（选 B）**，两处松动一起修 | 断言确实吞掉了 `Omit<...>` 守卫；但真问题是 `Initial` 类型取了实体面而不是 wire 面 —— 换对类型来源（`components['schemas']['SysDeviceDTOInitialRequest']`）之后，两处松动各按真因修（`getMemoryGB(): number`、`deviceInfo.type` 可选就不发） |
| `C3`（`concurrency` 的 G6） | **测试侧 + 库侧都修** | 库侧是**真 bug**：失败路径 catch 只 release 不 rollback ⇒ 毒连接带着未提交事务回池（真实 PG 上的负对照读到 `expected 'idle in transaction' to be 'idle'`）；测试侧把种子改成显式提交。本机 16 轮全量 0 次复现，所以口径是「唯一自洽的机制已被消掉 + 残余异常变成可定位诊断」，**不是**「偶发已被证明消失」 |

## 三、看到不认同怎么办

直接推翻即可 —— §二 里的每一条都有对应的落地位置（判据列写了「凭什么」，代码位置在注释里），
推翻时的成本按条目不同：改常量/改配置是一小时级，动 env 与密文是「改对外契约」级别。
