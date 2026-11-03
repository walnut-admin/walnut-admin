# 第 14 批「残余债收口」· R3 独立复核

> 复核对象：工作树里那份**未提交**的第 14 批成果（40 M + 2 未跟踪）。
> 复核者：R3（独立于两个 R2 worker）；复核时间：2026-11-03 23:41–23:59（本机时区 +08）。
> 环境：Windows / pwsh 7 / Node 24 / pnpm 12.5.1；**PostgreSQL 5432 与 Redis 6379 没有监听**；本机无 actionlint，有 Git bash。
> 写入面：**只写了本文件**（外加一个临时探针，用完已 `Move-Item` 到 `%TEMP%`，仓库无残留）。
> 读数以我自己的重跑为准；与 R2 自述不一致处见 §6。

---

## 0. 裁决（先看这里）

**可提交** —— 但有 **5 条文本级瑕疵建议在本批内修**（§5.A），另有 3 条结构性问题留到下一批（§5.B）。

判据：

1. 本批的**逻辑**全部独立验证通过：发版电池 206/206；drift spec 3/3 且在探针下**真会红**；`pnpm lint:workflows` 真退出 **3** 且写「未验证」；prepush 的 `workflows` 段真以 `-` + `[SKIP 未验证]` 出现并单列；服务端单测 839/839；`@walnut/scripts` 545/545；`lint:dts` 绿。
2. 但**一次全量 `pnpm prepush` 在我这台机器上没有全绿**（exit 1，4/26 段失败：lint / test / openapi / dts）。逐段归因后，**没有一条是本批改动引起的**（证据见 §3.2）：lint 是**门禁 5 分钟预算超时**（冷缓存 + 4 路并发），test/openapi/dts 是**同一次超时触发的「全局杀子进程」连带**（预存在 bug），openapi 还叠加了 PG/Redis 离线。
3. 因此：**「本批改动可提交」成立，「prepush 全绿」不成立**。Lead 不要把这次 prepush 说成绿的；要么修 §5.B-1/B-2 后重跑，要么在提交说明里如实写「本机 PG/Redis 离线 + 冷缓存 lint 超时」。

---

## 1. 机械核验

### 1.1 `git status --porcelain=v1`

**40 M + 2 `??`，与 Lead 的描述逐字一致**；其中 `??` = `apps/server/libs/system/src/device/device-issuance.drift.spec.ts` 与 `reports/batch-14/`（目录里目前只有 `r1-residuals.md`，加上本文件是第 2 个）。

- 没有 `zz-*` / `__*` 探针残留；
- `.github/**` **0 改动**（`git status -- .github` 为空）；
- `git ls-files --others --exclude-standard` = 上面两条，没有别的未跟踪文件。

40 个 M 的分类（逐条核对，全部落在本批 6 条债的范围内）：

| 类别 | 文件 |
|---|---|
| 14-A 注释（server） | `apps/server/AGENTS.md`、`libs/system/src/device/device-id.ts`、`libs/auth/.../oauth-state.service.ts`、`apps/api/.../gitee.controller.ts`、`apps/api/.../github.controller.ts`、`libs/app-domain/.../user.dto.ts`、`apps/api/.../user.dto.ts`、`apps/api/test/api/device.api-spec.ts`、`apps/api/test/api/monitor-user.api-spec.ts` |
| 14-D 删除面 | `libs/crypto/src/crypto.service.ts`、`libs/system/src/device/repo/device.repo.service.ts`、`libs/config/src/modules/crypto.config.ts`、`libs/config/README.md` |
| 14-C 四态 | `packages/tooling/scripts/src/lib/{cli,errors,log}.ts`、`src/ci/{prepush,lint-workflows,check-workflow-shell}.ts`、`src/ci/__tests__/{prepush,check-package-exports,check-source-secrets}.test.ts`、`src/lib/__tests__/cli.test.ts`、`packages/tooling/release/src/release/{steps.ts,__tests__/steps.test.ts}` |
| 14-B | `packages/tooling/scripts/src/ci/check-seed.ts`、`src/ci/__tests__/check-seed.test.ts` |
| 14-E 文档 | `apps/docs/.../industry-research/backend-architecture-review/{06,07,08,09,index}.md`、`apps/docs/.../monorepo/{release,env-management}.md`、`apps/docs/.../backend/{configuration,modules/system-account}.md`、`apps/docs/.../plans/data-scope-*.md`、`reports/NEEDS-CONFIRMATION.md` |
| 预存在红 | `package.json`（行尾换行） |

### 1.2 `git diff --stat`

```
40 files changed, 726 insertions(+), 156 deletions(-)
```

### 1.3 `git diff -- package.json`

**只有 1 行变化**（`\ No newline at end of file` 被去掉），没有别的键值改动。`lint-root` 在本次 prepush 里 **✓ 68.0s**（冷跑），这条预存在红已修。

### 1.4 生成物

`git diff --name-only -- apps/server/openapi.json packages/generated/api-types` → **空**。本批「纯注释/纯工具链/纯文档，不重导 OpenAPI」的前提成立。

---

## 2. 三条负对照（我独立重跑，不接受转述）

### 2.1 SKIP 四态（live）

```
$ cmd /c "pnpm lint:workflows"; "EXIT=$LASTEXITCODE"
⏭️ 未检测到 actionlint：workflow **未验证**（跳过不等于通过）。权威闸门是 CI 的 .github/workflows/workflow-lint.yml；安装方式见 https://github.com/rhysd/actionlint#download
EXIT=3
（stderr）[ELIFECYCLE] Command failed with exit code 3.
```

- 退出码 **3**（不是 0，也不是 1），输出明确写「**未验证**（跳过不等于通过）」，走 **stdout**（`cli.ts:63-68` 的设计：跳过是正常叙述，不是诊断）。
- `check-workflow-shell` 的同一行为：**本机有 `C:/Program Files/Git/bin/bash.exe`，skip 分支无法现场触发**，实跑是 `EXIT=0`（`workflow shell 语法：4 个文件、75 段 shell 块，bash -n 全部通过`）。它「同一行为」由三条静态证据保证：① `check-workflow-shell.ts:135-141` 在 `findBash() === null` 时抛的也是 `SkippedError`；② 两个 bin 都只写 `await runCli(main)`（`bin/lint-workflows.ts:10`、`bin/check-workflow-shell.ts:10`）；③ `cli.test.ts` 把 `SkippedError → 3` 钉死了。要现场验它，得在**没有 bash 的机器**上跑，或临时改代码注入 `findBash` —— 两种都不适合 R3（前者没有环境，后者要改被跟踪文件）。

**发版电池不回归**：`cmd /c "pnpm --filter @walnut/release test"` → **12 files / 206 tests 全绿**（`steps.test.ts` 17 条含「电池表 ↔ release.md 对账」与「段数防腐」）。读实现确认：

- `steps.ts:212-221`：`catch` 里 `exitCode === SKIPPED_EXIT_CODE` ⇒ 记 `unverified` + 打一行「跳过（未验证）」，**`continue`，不进 `failures`**；
- `steps.ts:232-235`：收尾用 `releaseBatterySummary(releaseBatteryCount() - unverified.length, unverified)`；`steps.ts:168-179` 在有未验证项时输出「N 条真跑通过 / K 条跳过（未验证）」+ 一条警告，**任何分支都不再出现「全绿」**（单测 `steps.test.ts:131-139` 逐字断言 `not.toContain('全绿')`）。

### 2.2 drift spec 会红（负对照）+ 删探针后 3/3 绿

探针（临时文件 `apps/server/libs/system/src/device/zz-r3-probe.ts`）：

```ts
import { generateDeviceId } from './device-id'
export function r3ProbeIssue(): string { return generateDeviceId() }
```

`workdir: apps/server`，`pnpm exec vitest run --config ./apps/api/vitest.config.ts libs/system/src/device/device-issuance.drift.spec.ts`：

```
❯ libs/system/src/device/device-issuance.drift.spec.ts (3 tests | 1 failed)
  × 生产源码里 generateDeviceId( 的调用点恰好 1 处，且在 device.service.ts 的 initial
  ✓ 指纹派生函数（14-D 已删）在 apps/api 与 libs 里零命中，注释也算命中
  ✓ 环境变量 DEVICE_ID_ENCRYPTION_KEY 的代码读者只有 config 骨架三处（它不是身份根，是部署契约）
Tests  1 failed | 2 passed (3)
EXIT=1
```

`Move-Item` 到 `%TEMP%\zz-r3-probe-bbf0ccf9bdd041e9831240f36cd75a04.ts.txt` 后同一命令：

```
✓ libs/system/src/device/device-issuance.drift.spec.ts (3 tests) 576ms
Tests  3 passed (3)
EXIT=0
```

删探针后的 `git status`：`M=40  ??=2`，两个 `??` 是 drift spec 与 `reports/batch-14/`；探针 `Test-Path = False`，仓库没有 `zz-*` 残留。

---

## 3. 端到端：一次全量 `pnpm prepush`

命令：`cmd /c "pnpm prepush"`（`timeoutMs=600000`，实际 **313.9s**）。**exit code = 1**。

### 3.1 汇总块原文（去 ANSI 色）

```
推送前门禁：26 段，最多并行 4 路（表在 packages/tooling/scripts/src/ci/prepush.ts）
  ✓    3.4s  架构边界（turbo boundaries）
  ✓   54.4s  循环依赖（madge，apps/server 的 apps + libs）
  ✓   68.0s  lint 根级配置（turbo run //#lint:root）
  ✓   17.4s  根级配置类型检查（pnpm types:check:root）
  ✓    3.6s  依赖一致性（syncpack）
  -    2.8s  workflow 校验（actionlint）  [SKIP 未验证]
  ✓  154.7s  类型检查（不排任何包）
  ✓   85.8s  workflow shell 语法（逐块 bash -n）
  ✓   14.0s  动态 import 说明符必须是字面量（apps/**）
  ✓   11.2s  ADR 形态校验（编号 / 状态 / 小节）
  ✓    7.4s  文档代码块校验（ts 块必须能解析）
  ✓   29.2s  文档引用校验（包名 / 仓库路径）
  ✓    3.8s  文档字数预算（常驻文件不许膨胀）
  ✓    8.3s  注释与常驻文档里不许有 emoji（跨所有被跟踪文本文件）
  ✓    7.4s  初始化数据形态（必需集合 / 禁入集合 / 体积 / 凭据形状 / 引用完整性）
  ✗  107.6s  OpenAPI 一致性（导出 → 生成 → git diff + git diff --cached）
  ✗  241.5s  测试（turbo run test，不排任何包）
  ✗  107.6s  手写 .d.ts 检查（关掉 skipLibCheck，只报仓库内文件）
  ✗  309.5s  lint 各包（turbo run lint，不排任何包）
  ✓    1.2s  入口 nginx 安全响应头（conf.d）
  ✓    1.6s  catalog 与锁文件锁步（catalog ↔ pnpm-lock）
  ✓    1.5s  脚本前置钩子（vite / vue-tsc 前必须先跑生成）
  ✓    0.2s  workspace 版本锁步（pnpm change check）
  ✓    3.5s  包 exports 形态（目标存在 / types 在前 / 与 main 一致）
  ✓    2.5s  源码密钥形态（凭据形状不许进仓库）
  ✓    4.9s  turbo 配置不变量（缓存边界 + tags）
4/26 段失败：lint, test, openapi, dts（总 313.9s）
未验证的段：workflows（本机环境缺失，跳过不等于通过；权威闸门见 .github/workflows/）
✖ 4 段推送前门禁失败（明细见上）
[ELIFECYCLE] Command failed with exit code 1.
```

**`workflows` 段**：`-` + `[SKIP 未验证]`，并且在「未验证的段」里单列，**没有**混进通过数（失败路径的报数是 `4/26 段失败`，跳过单独一行）。成功路径那句三分式汇总这次没有打印（因为有失败）：

```
（用真实模块 summarizeRun 跑 25 ok + 1 skipped）
26 段：25 段真跑通过 / 1 段跳过（未验证）（总 313.9s）
未验证的段：workflows（本机环境缺失，跳过不等于通过；权威闸门见 .github/workflows/）
PREPUSH_STRICT=1：有 1 段跳过（未验证）—— workflows。…
```

### 3.2 逐段归因（哪条是本批引起？**没有**）

| 段 | 读数 | 归因 | 判据 |
|---|---|---|---|
| **lint** | ✗ 309.5s | **预存在：门禁 5 分钟预算 + 冷缓存**（不是 lint 违规） | 日志原文 `超时（>300s）：… pnpm.exe exec turbo run lint`（预算 `GATE_BUDGET_MS = 5 * 60_000`，`prepush.ts:268`）。15 个包**全部 cache miss**（冷缓存；根 `package.json` 的换行改动很可能改了全局 hash，但这一点我没单独验证 —— 关键是这次确实是冷跑）；`types:check` 同时在跑。单独跑 `@walnut/server lint` = **0 errors / 3 pre-existing warnings**（`pg-list.builder.spec.ts`，本批没碰），`@walnut/scripts`、`@walnut/release` lint 也 exit 0 —— **本批没有 lint 违规**。 |
| **test** | ✗ 241.5s | **连带被杀**（预存在 bug） | 见 §3.3。单独跑 `pnpm --filter @walnut/server test` = **102 files / 839 tests 全绿，103s**。 |
| **dts** | ✗ 107.6s | **连带被杀** | 输出只有一行 `$ walnut-check-dts` 就没了（没报任何诊断）；单独跑 `pnpm lint:dts` = **14 个文件、零错误**。 |
| **openapi** | ✗ 107.6s | **连带被杀 + 环境** | 日志停在 `AuthHttpModule dependencies initialized` 后直接 exit 1，没有自己的错误信息（典型被杀）；且 **5432/6379 都没有监听**，本机本来就跑不了这一段（该段 `why` 自己写着「环境不在时这一段必然失败」）。 |
| **workflows** | `-` skip | **符合设计** | 本机无 actionlint；exit 3 → `skipped` → 单列。 |
| 其余 21 段 | ✓ | 与本批改动一致 | 含 `lint-root`（package.json 换行修复）、`seed`、`docs-refs`、`emoji`、`types`、`types-root`。 |

### 3.3 三条「同一毫秒死掉」的根因（预存在 bug，**不是本批**）

四条失败段的**结束时间完全一致**（23:46:31.5）：

- lint：23:41:22 起 + 309.5s = 23:46:31.5（超时点）
- test：241.5s ⇒ 23:42:30 起、23:46:31.5 止
- openapi / dts：各 107.6s ⇒ 23:44:43.9 起、23:46:31.5 止

代码路径唯一：

```
runArgs() 的 per-gate 预算到点
  → child-run.ts:196-200  killActiveChild()
  → child-tree.ts:124-131  for (const child of [...active.keys()]) terminateTree(child)   // 杀**全部**活跃子进程
```

`killActiveChild()` 的注释自己写着「中止路径用：收掉**全部**活跃子进程」。它本来是给 Ctrl+C / 整次中止用的，却被 per-gate 超时复用了；prepush 又是 4 路并发 ⇒ **一段超时会把另外三段的子进程一起 taskkill**，那三段随后各自以「exitCode null ⇒ 2/1」被记成 failed。这也解释了为什么 test 的 vitest 摘要根本没打出来、dts 一个字都没输出。

**结论（强推断，未插桩复现）**：这 3 条红最可能是**预存在的基础设施 bug** —— 判据是「四条结束时间精确到 0.1s 相同」+「三条被杀者都没有自己的错误输出」+「代码路径上 `killActiveChild()` 确实杀全部」。本批没有改 `child-run.ts` / `child-tree.ts`；触发条件是 lint 冷跑超过 5 分钟预算。要 100% 坐实，下一批给 `runArgs` 加一行「本次超时只杀自己」的日志即可复现。

---

## 4. 事实抽查（44 条，带 `path:line`）

判定：✅ = 与现状一致且有判据；⚠️ = 表述不精确/有残留；❌ = 错。

| # | 位置 | 断言 | 我的读数 | 判 |
|---|---|---|---|---|
| 1 | `apps/server/libs/system/src/device/device-id.ts:21-24` | 生产签发点只有 1 处；登录不签发 | 全仓 `generateDeviceId` 生产调用只有 `device.service.ts:108`；其余是 `device-id.ts:32` 定义、`device-id.spec.ts`、两个 `*.pg.int-spec.ts` 夹具 | ✅ |
| 2 | `apps/server/libs/system/src/device/device.service.ts:107-108` | cookie 合法则复用，否则新签 | 代码原样；登录链路不调用它 | ✅ |
| 3 | `.../oauth/github/github.controller.ts:69-71` | d1_+32hex、randomBytes(16)、与指纹无关、cookie 签名 | `libs/const/src/app/device.ts` 的 `^d1_[0-9a-f]{32}$` + `device-id.ts:33` | ✅ |
| 4 | `.../oauth/gitee/gitee.controller.ts:69-71` | 同上（逐字同改） | 同上 | ✅ |
| 5 | `libs/auth/.../oauth-state.service.ts:37-39` | 同上 + 不外发给 IdP | 同上 | ✅ |
| 6 | `libs/app-domain/.../monitor/user/dto/user.dto.ts:23-27` | 保留「为什么摘 visitorId」，等式改成「**当时**的」+ B5 现状 | 时间锚在，理由仍成立 | ✅ |
| 7 | `apps/api/.../monitor/user/dto/user.dto.ts:66-67` | 「实测 MATCH」后补 B5 半句 | 原文有 | ✅ |
| 8 | `apps/api/test/api/device.api-spec.ts:21-25,110,124` | 幂等键是 cookie 不是指纹；无 cookie 会新签 | 与 `device.service.ts:107-108` 一致 | ✅ |
| 9 | `apps/api/test/api/monitor-user.api-spec.ts:227-230` | 指纹不再派生身份，但仍不该下发 | 与现状一致 | ✅ |
| 10 | `libs/app-domain/.../monitor/user/repo/user.repo.service.ts:70` | 「visitorId 由 service 校过 **HMAC** 后落库」 | **现状没有任何 HMAC**：`user.service.ts:49-57` 是「与本设备已存行的 visitor_id 比」 | ❌ 漏改 |
| 11 | `libs/crypto/src/crypto.service.ts:90` | `hash()`「用于不可逆数据，如 **deviceId**、**fingerprint**」 | 两者都已不 hash：`.hash(` 现在只剩 `user_identity.shared.service.ts:64`（valueHash）与 `verifyHash`；`fingerprint_hash` 列都不存在（`migrations/...DeviceIdFormCheck.ts:38` 写明 0 消费者） | ❌ 漏改 |
| 12 | `apps/api/.../monitor/user/dto/user.dto.spec.ts:13` | 「背景：`deviceId = HMAC(指纹)`（实测 MATCH）…crypto 之前…」 | 有「crypto 之前」的历史框架，但等式本身没「当时」 | ⚠️ 建议加锚 |
| 13 | `libs/system/src/device/repo/device.repo.service.ts`（方法整段） | `getDeviceIdByFingerprint` 已删、构造器不再注入 crypto | 文件里 0 命中；构造器只剩 3 个依赖 | ✅ |
| 14 | `libs/crypto/src/crypto.service.ts`（方法整段） | `hashDeviceFingerprint` 已删 | 文件里 0 命中；`hash`/`verifyHash` 保留 | ✅ |
| 15 | `libs/config/src/modules/crypto.config.ts:9-12` | 历史 HMAC 盐、摘属性与摘 env 必须同批 | 原文有这条，且给了批次出处 | ✅（措辞见 #17） |
| 16 | 全仓 grep 两个函数名 | 生产源码 0，允许 spec/reports 命中 | `apps/server` 只有 `device-issuance.drift.spec.ts:16,174`；`apps/docs/.../system-account.md:82` 是「已删除」的历史陈述；其余全在 `reports/**` | ✅ |
| 17 | `AGENTS.md:111` / `crypto.config.ts:9` / `configuration.md:45` / `config/README.md:82` | 「零代码读者 / 0 读者 / 没有任何代码读者 / no code reader」 | **与自家 drift spec 第 3 条自相矛盾**（那边刚断言有 3 处读者：`crypto.config.ts:12`、`validation.ts:211`、`process.d.ts:60`）。准确说法应是「**0 个消费者**（`crypto.deviceIdKey` 摘掉后无人悬空）；env 仍被 config 注册与启动校验读取」 | ❌ 措辞错 |
| 18 | `DEVICE_ID_ENCRYPTION_KEY` 的代码读者 | 只允许 config 三处骨架 | 实测 = `crypto.config.ts:12`、`validation.ts:211`、`process.d.ts:60`；`validation.spec.ts` 是 spec 被排除 | ✅ |
| 19 | `device-issuance.drift.spec.ts:38` | `TEST_DIR_PREFIXES` 含 `apps/api/test/` | 原文有；注释解释了「只按后缀排除会漏 `*.api-spec.ts`」 | ✅ |
| 20 | `device-issuance.drift.spec.ts:161-170` 断言 1 | 调用点恰好 1 处且在 `device.service.ts` | 3/3 绿；探针注入后**真红** | ✅ |
| 21 | `device-issuance.drift.spec.ts:172-178` 断言 2 | 两个函数名 0 命中（含注释） | 用 `rawOf`（不剥注释），绿 | ✅ |
| 22 | `device-issuance.drift.spec.ts:180-191` 断言 3 | 3 个读者 | 绿 | ✅ |
| 23 | `packages/tooling/scripts/src/lib/errors.ts:41-49` | `SkippedError` + `SKIPPED_EXIT_CODE=3` 是唯一真源 | 原文；无字面量 3 散落（`steps.ts` 也 import 它） | ✅ |
| 24 | `packages/tooling/scripts/src/lib/cli.ts:63-68` | `SkippedError` → 3，走 stdout | 单测 `cli.test.ts:70-79`；live `lint:workflows` EXIT=3 | ✅ |
| 25 | `src/ci/lint-workflows.ts:25-30` | 无 actionlint ⇒ 抛 `SkippedError` | live 验证 | ✅ |
| 26 | `src/ci/check-workflow-shell.ts:135-141` | 无 bash ⇒ 抛 `SkippedError` | 代码同构；本机有 bash 故 live 走的是 exit 0 分支（见 §2.1） | ✅（结构） |
| 27 | `src/ci/prepush.ts:271-283` | `GateResult.status` 是唯一真源，**没有残留 `ok: boolean`** | 全文件 grep 无 `ok` 字段；`ok:` 命中都在别的模块 | ✅ |
| 28 | `prepush.ts:372-377` | 跳过打 `-` + `[SKIP 未验证]` | live 行原文见 §3.1 | ✅ |
| 29 | `prepush.ts:386-404,425-445` | `PREPUSH_STRICT=1` 才判红；汇总单列 | 单测 4 条；live 三分式汇总见 §3.1 | ✅ |
| 30 | `packages/tooling/release/src/release/steps.ts:212-221` | exit 3 ⇒ `unverified`、不进 `failures` | 读实现；release 206 测试绿 | ✅ |
| 31 | `steps.ts:168-179` + `steps.test.ts:124-139` | 有未验证就**不说全绿** | 单测逐字断言；实现自洽 | ✅ |
| 32 | `steps.ts:441-444` + `steps.test.ts:229-254` | 段数判据式 + 防腐测试**真测**（不是空转） | 我把「11 段」注入内存副本：当前 `badLines=0`，注入后 `badLines=1` 且命中 700 字符窗口 ⇒ 真会红。**边界**：只覆盖「含 `prepush` 的行」与「提示起 700 字符」，别处写死段数不拦 | ✅（有边界） |
| 33 | `apps/docs/.../monorepo/release.md:165-166,190-198` | 电池表与实现一致（exit 3 语义） | `steps.test.ts` 的「doc 表 ↔ `RELEASE_BATTERY` 逐 id/顺序对账」17 条全绿；两行描述与 `steps.ts:217-221` 一致 | ✅ |
| 34 | `src/ci/check-seed.ts:20-29,78-89,427-432` | 没有任何自动门禁跑 `db:seed:verify`；提示**永不判红** | 全仓 grep：只有 `package.json:72` 脚本、README、`seed-verify.ts` 自身与测试；prepush 表/发版电池/.github 都没有。`changedPathsBestEffort` 任何一步失败返回 `null`（`runSync` 用 `status ?? 1`，**不抛**），`touched` 只走 `line('warning')` | ✅ |
| 35 | `src/ci/__tests__/check-seed.test.ts:239-281` | 判据正反用例 | 545 条 `@walnut/scripts` 测试绿 | ✅ |
| 36 | `reports/NEEDS-CONFIRMATION.md:39-42` | C2 结案指向本批删除 | 事实对；但「**全仓 0 命中**」不准确（docs 与 reports 仍有字样） | ⚠️ |
| 37 | `reports/NEEDS-CONFIRMATION.md:62-85` | C4 有背景/选项 A·B/推荐 A/现状 | 读原文；链接 `../apps/docs/.../10-implementation-plan.md` 与 ADR 0007 都真实存在 | ✅ |
| 38 | `apps/docs/.../backend-architecture-review/index.md:3-6,60-64,69` | 保留 2026-11-02 决定 + 2026-11-03 否决；目录树标「未建」 | 原文有；时间线完整 | ✅ |
| 39 | `.../07-decisions.md:66-82` | 不许写成「当初没决定建」 | 标题写「2026-11-02 修订：从『不建』改为『建』；2026-11-03 实测否决」，下面保留原论证 | ✅ |
| 40 | `.../09-research-summaries.md:81-87` | 三次转折 | ① 原推荐不建 → ② 2026-11-02 改为建 → ③ 2026-11-03 实测否决 | ✅ |
| 41 | `.../08-recommended-plan.md:22` | 「合计 ≈ 27–30 人日」 | P2 已改 0 人日，合计没跟着减（5–6 人日的账仍在） | ⚠️ |
| 42 | `packages/tooling/scripts/bin/lint-workflows.ts:5`、`bin/check-workflow-shell.ts:5` | 「退出码…（0 通过 / 1 查出违规 / 2 前置条件未满足）」 | 这两个 bin **现在真的会 exit 3**；头注释仍是三态 | ❌ |
| 43 | `packages/tooling/eslint-config/script-rules.ts:17,19,33,100,108` + `base.ts:65` + `apps/docs/.../eslint.md:58` | 「退出码只能 0/1/2」「`process.exit(3)` 非法」 | 与新的四态契约冲突（`cli.ts` 已把 3 设为合法结论）。代码本身不违规（`runCli` 用常量赋 `process.exitCode`，规则刻意不查该形态），但**文档/报错文案在说谎** | ❌ 契约文档未同步 |
| 44 | `src/ci/__tests__/check-source-secrets.test.ts:107,121`、`check-package-exports.test.ts:145` | 5s → 30s | 原文有；prepush 里 `@walnut/scripts` 545/545（含这两条）在负载下没再超时 | ✅ |

**抽查合计 44 条：✅ 35 条，⚠️ 3 条，❌ 6 条**（#10/#11/#17/#42/#43 与本批题目直接相关；#12/#36/#41 是精度问题）。

---

## 5. 必须改的具体条目

### A. 建议本批内修（文本级，都在本批题目上）

1. **`apps/server/libs/app-domain/src/monitor/user/repo/user.repo.service.ts:70`**
   现文「visitorId 由 service 校过 **HMAC** 后随 update 一起落库」。
   改成：「visitorId 由 service **与本设备已存行比对**后随 update 一起落库（判据见 `user.service.ts` 的 updateState）」。
   理由：14-A 的题目就是「HMAC 指纹派生」的过时现状断言；这是漏掉的第 10 处。

2. **`apps/server/libs/crypto/src/crypto.service.ts:90`**
   现文「生成 HMAC 哈希（用于不可逆数据，如 **deviceId、fingerprint**）」。
   改成：「生成 HMAC 哈希（现用于 `user_identity.valueHash` 一类不可逆查找键；设备身份 B5 起不再走 HMAC）」。
   理由：14-D 删掉 `hashDeviceFingerprint` 后，deviceId/fingerprint 都已不是 `hash()` 的用例。

3. **「零代码读者 / 0 读者 / 没有任何代码读者」四处**（`apps/server/AGENTS.md:111`、`libs/config/src/modules/crypto.config.ts:9`、`apps/docs/.../backend/configuration.md:45`、`libs/config/README.md:82`）
   统一改成「**0 个消费者**（`crypto.deviceIdKey` 摘掉后无人悬空）；env 仍被 config 注册 + 启动校验读取（`crypto.config.ts:12` / `validation.ts:211` / `process.d.ts:60`）」。
   理由：否则与本批自家 drift spec 第 3 条（3 处读者）**互相打脸**。

4. **`packages/tooling/scripts/bin/lint-workflows.ts:5` 与 `bin/check-workflow-shell.ts:5`**
   把「（0 通过 / 1 查出违规 / 2 前置条件未满足）」改成「（0 通过 / 1 查出违规 / 2 前置未满足 / **3 未验证**）」。
   理由：这两个 bin 是本批新增的「会 exit 3」的入口，头注释却还写着三态。
   （其余 21 个 bin 的同一句是模板，可留到下一批一次性换。）

5. **`packages/tooling/eslint-config/script-rules.ts:17,19,33,100,108` / `base.ts:65` / `apps/docs/.../monorepo/eslint.md:58`**
   规则「3 非法」的语料与文案要么允许 3，要么明确写成「**脚本入口不许写 `process.exit(3)`；第 4 态只能经 `SkippedError` 表达**」并解释为什么。现在是「规则说 3 非法，`cli.ts` 说 3 = 跳过」，读者只能二选一信。
   （最小改动：改 `script-rules.ts:19,108` 的文案 + `eslint.md:58`；`script-rules.test.ts:71` 的 invalid 语料保持不动，因为规则的真实判据是「字面量退出码只能 0/1/2」。）

### B. 留到下一批（结构性问题，本批不要顺手改）

1. **`child-run.ts:196-200` × `child-tree.ts:124-131`：per-gate 超时调用了「杀全部」的 `killActiveChild()`**。
   修法：给 `runArgs` 一个只杀自己那棵树的出口（导出 `terminateTree` / 新增 `killChild(child)`），把「整次中止」与「单段超时」分开。否则 prepush 永远会在「某段超时」时把别的段一起打红（本次 3 条假红就是它）。
2. **`prepush.ts:268` 的 `GATE_BUDGET_MS = 5 分钟` 对冷缓存不够**：本次 lint 冷跑 309.5s（15 包全 cache miss）。建议 10 分钟，或给 lint 段单独预算。
3. **`releaseBatterySummary()` 在 `--skip-gates` 时会把被显式跳过的条目算进「真跑通过」**（`steps.ts:232` 只减 `unverified`）。建议把 `skippedIds` 也传进去单列。
4. **`steps.test.ts` 的段数防腐只覆盖「含 prepush 的行 + 700 字符窗口」**：可加一条「全文件不许出现 `\d+\s*段`」把它变成整文件判据。

### C. 不建议改的

- `reports/**` 里旧语义（batch-8/9/11/13）：冻结历史，本批不动是对的。
- `device.guard.ts:88`、`user.service.ts:52`、`user.repo.service.ts:50`、`device-id.spec.ts:17-18` 等：都有「旧形态 / 改造前 / 批次 8 / B5」时间锚，保留正确。

---

## 6. 与 R2 自述的差异 / 未覆盖项

**差异**：

1. **prepush 读数**：Lead 转述的口径是「约 290s」且倾向于绿；我实测 **313.9s、exit 1、4/26 段红**。红的原因见 §3.2/§3.3，**没有一条是本批逻辑引起**，但「全绿」这个结论不成立。
2. **14-A 的「9 处」**：我核对到的是 **8 个文件、10 处改动**（device-id、github、gitee、oauth-state、app-domain dto、api dto、device.api-spec 的 3 处、monitor-user.api-spec），**外加 2 处同族漏改**（§5.A-1/A-2）。如果 R2 的「9」是另一个口径，请以本表的 `path:line` 为准。
3. **4 条红的归属**：R2 若把 openapi 的失败只归因于「环境」，那只对了一半 —— 本次它是**先被连带杀掉**（107.6s 处无自己的错误），即使 PG/Redis 在线也测不出它到底绿不绿。
4. `reports/batch-14/` 里只有 `r1-residuals.md`（R1 调研），**没有两个 R2 worker 的书面自述**；我无法逐条比对其原始措辞，只能以我的重跑为准。

**未覆盖（明确声明）**：

- 没有单独重跑**全量** `pnpm lint`（只跑了改动涉及的 `@walnut/server` / `@walnut/scripts` / `@walnut/release`，全绿）；没有重跑 `pnpm build` / `build:docs`。
- 没有启动 PG/Redis（按指令不动服务），所以 `openapi` 段与 `db:seed:verify` 的真实往返**未验证**。
- 没有真跑发版电池（会改工作区/打 tag）；只跑了它的单测 206 条 + 读实现。
- `check-workflow-shell` 的 skip 分支**没有 live 触发**（本机有 bash），只有代码路径 + 单测 + 同构 bin 三条静态证据。

---

## 附录：本次用到的命令

```
git status --porcelain=v1 / git diff --stat / git diff -- package.json
git diff --name-only -- apps/server/openapi.json packages/generated/api-types
cmd /c "pnpm lint:workflows"; "EXIT=$LASTEXITCODE"          # 3
cmd /c "pnpm lint:workflows-shell"; "EXIT=$LASTEXITCODE"    # 0（有 bash）
cmd /c "pnpm --filter @walnut/release test"                  # 206 passed
cmd /c "pnpm --filter @walnut/server test"                   # 839 passed（单独跑）
cmd /c "pnpm lint:dts"                                       # 0
cmd /c "pnpm --filter @walnut/server lint"                   # 0 errors / 3 warnings
cmd /c "pnpm prepush"                                        # exit 1，313.9s
（apps/server）pnpm exec vitest run --config ./apps/api/vitest.config.ts libs/system/src/device/device-issuance.drift.spec.ts
```
