# 批次执行记录

> 这是第 11 批起的**执行记录摘要**：每批写清楚目标 / 关键发现 / 验收读数 / **复查轮挡下了什么** —— 最后一项最有价值。
> 原始证据（每批的 R1 调研、R2 实施、R3 复查原文，含逐条 `path:line` 与命令输出）在 `reports/batch-*/`，
> 本页只留结论，不抄日志。
>
> 两条口径：① 下文的门禁读数与用例条数都是**各批当时的快照**，不是现状 —— 数字会变，判据不会；
> ② 门禁一律 `cmd /c "pnpm …"` 跑、退出码立刻取 `$LASTEXITCODE`（把管道后的退出码当读数会造出假红）。

## 第 11 批 · 设备身份收尾（B5）

- **目标**：B5 第 2 步之后的收尾 —— 硬切需要的 DDL、90 天留存清理、`deviceName` 退出 Initial 请求面、两个生成物同步。
- **关键发现**：硬切路径下 `device_id` 从不被 UPDATE ⇒ 真正需要的 DDL 只有一条形态 CHECK
  （`apps/server/apps/api/migrations/1793390000000-DeviceIdFormCheck.ts:43-46`）；留存判据不能只用 `stale`，
  且心跳行必须**同事务**删、走 RLS 的 system 通道（`apps/server/libs/system/src/device/repo/device.repo.service.ts:117-136`）。
- **验收读数**：单测 `101 文件 / 833 条` exit 0；`apps/server` 的 `types:check` exit 0；
  `migration:run → revert → run` 两轮实测（约束「在 / 不在」可区分）；integration 分片合计
  `65 文件 / 653 条 = 647 passed · 5 failed · 1 skipped`。
- **R3 挡下的**：`8 文件 / 69 条全绿` 被当成「收尾完成」的依据 —— 其余文件里还有 5 条红：
  `apps/server/apps/api/test/api/platform/throttle.api-spec.ts:34` 与 `apps/server/apps/api/test/api/platform/api-rollback.api-spec.ts:284`
  由本轮改动引入（`deviceName` 从「静默忽略」变成 40099，属**破坏性 wire 变更**）、
  `apps/server/apps/api/test/integration/auth/auth.login-chain.pg.int-spec.ts:632-633` 漏改 fixture 撞上新 CHECK。
  同轮还证伪了一条自述：admin 侧那不是「vue-tsc 机械守卫」—— `Omit<…>` 配 `as` 断言不做多余属性检查，多带字段时 tsc 一声不响。

## 第 12 批 · D 组结构债

- **目标**：撤掉一个共享日志模块的 `@Global`、删一个死模块、给「`@Global` 只在消费方模块数 ≥ 2 时允许」与
  「非 `@Global` 的每个消费方都要能经 imports 看见它」补机械判据、修 `SKIP_DIRS` 的裸名 `logs`。
- **关键发现**：撤 `@Global` 的落点是**拥有者模块** `apps/server/apps/api/src/modules/auth/auth-http.module.ts:64-67`；
  真 bootstrap 三态实验里，「落父模块 `auth.module.ts`」与「不接线」报出的是**逐字相同**的
  `logAuthSharedService` 不可解析错误 —— 注入器确实解析在宿主 controller 所在模块。
  另有一条没被谁预料到的：这条接线也是部分集成套件装配的必需品，拆了爆炸半径是「openapi 导出 + 相关集成套件」。
- **验收读数**：单测 `101 文件 / 836 条` exit 0；`types:check` / `lint` / `boundaries` / `openapi:export`（零 diff）全 exit 0；
  集成分片 `12 文件 / 176 条` exit 0；新判据的 6 个负对照全红，四个「会假绿」的坑逐个确认是**修对**而不是改松。
- **R3 挡下的**：「模块扫描序零变化」不成立 —— 真实容器里那个无 guard 节点的扫描位从 156 提前到 98、其后 48 位整体后移
  （**结论对、证据错**：拿走查器的盲区当成了结论）；一处**未申报的改动**把
  `apps/server/libs/security/src/cap/__tests__/cap.shutdown-order.spec.ts` 的超时从 5s 放宽到 30s
  ——「一个本来在负载下会红的用例现在不会红了」，这属于测试严格度悄悄变松；另外「`types:check` 永久红」这条结论也已过期。

## 第 13 批 · 文档与事实对齐

- **目标**：把 B5 之后的**事实漂移**从活文档里清出去：设备身份语义、计数口径、SKIP ≠ PASS、风控分级入文档。
- **关键发现**：`deviceName` 是**每次 initial 重新生成并覆盖**（新建与复用都覆盖）——
  `apps/server/libs/system/src/device/device.service.ts:94-96` 与
  `apps/server/libs/system/src/device/device.basic.repository.ts:46-52` 两处为证；R1 与旧文档都写成「只在插入时」。
  另一处：`README.md` 的分组计数「加起来等于 15」是**加法验不出来**的假绿 —— 分组本身已经错了。
- **验收读数**：`lint:docs-refs` / `lint:doc-ts` / `lint:doc-budget` / `lint:adr` / `lint:emoji` 全 exit 0，
  `pnpm --filter @walnut/docs build` exit 0（66.52s，死链即失败）。
- **R3 挡下的**：`apps/docs/src/zh-CN/content/shared/device.md:169` 的 mermaid 仍写「deviceName 只在插入时由服务端生成」
  —— 与同文件正文、与代码**自相矛盾**，等于把本批最大的纠错点在同一页上作废；
  `apps/docs/src/zh-CN/content/backend/modules/system-account.md:92-93` 把并发失败侧写成 40605，
  而它自己引用的那份 spec 断言的是 40000 / 42900。

## 第 14 批 · 残余债收口

- **目标**：注释与私有 JSDoc 里的过时断言、`db:seed:verify` 的「到底有没有门禁在跑它」、门禁第四态（跳过）、
  两个死函数、以及配套文档。
- **关键发现**：`lint:workflows` 现在真的退 **3** 并写「未验证（跳过不等于通过）」，prepush 把该段打成 `-` + `[SKIP 未验证]` 单列；
  删那两个死函数**不改**部署契约 —— 变的是 `crypto.deviceIdKey` 成了悬空配置，`DEVICE_ID_ENCRYPTION_KEY` 仍是启动期必填，
  由 `apps/server/libs/system/src/device/__tests__/device-issuance.drift.spec.ts` 的三条断言机械守。
- **验收读数**：`@walnut/server` 单测 `102 文件 / 839 条`、`@walnut/scripts` `545 条`、`@walnut/release` `206 条` 全绿；
  `lint:dts` exit 0；`pnpm prepush` **exit 1**（失败段：lint / test / openapi / dts —— 逐段归因后没有一条是本批引起）。
- **R3 挡下的**：那几段红里大部分是**假红** —— 单段预算到点时调用的是「杀全部活跃子进程」的
  `killActiveChild()`（`packages/tooling/scripts/src/lib/child-run.ts:196-205` →
  `packages/tooling/scripts/src/lib/child-tree.ts:124-137`），把并发的兄弟段一起 taskkill，
  四条失败段的结束时间精确到 0.1s 相同；另有「零代码读者」四处措辞与本批自家 drift spec（配置骨架里的读者）互相打脸。

## 只有计划、还没有原文的批次

本页的门槛是「`reports/batch-<n>/` 里有原文」：读不到原文的批次这里就不写，**不凭计划书编执行记录**。
对应目录出现后，按上面同一套四行格式补。

## 教训：反复出现的三类失效

### 一 · 门禁红着，但没人看见

- 红的常常是**门禁自己**，不是代码：根 `package.json` 少了行尾换行 ⇒ `lint:root` 在干净树上必红，
  而那个文件不在任何一轮的改动面里，于是谁都不认为它和自己有关（第 14 批补上这一行后，该段在 prepush 里跑成了通过）。
- 默认超时也会这样：vitest 默认 5s，四路并发抢 CPU 时必红 —— 第 12 批那次「放宽到 30s」，其实是承认了这一点。
- 判据：如果一条红是「环境 / 预算 / 默认超时」引起的，它**不会被修**，只会被下一个人当成噪声忽略。所以要么修根因，要么让它有独立的读数口径。

### 二 · 跳过与通过同形

- `lint-workflows` 探测不到 actionlint 就 `return`（退出码 0），prepush 只看退出码 ⇒ 打勾、汇总里算进「全部通过」。
- 第 14 批把它改成第四态：退出码 3 + 汇总单列 + 只有 `PREPUSH_STRICT=1` 才判红。关键不是「多一个退出码」，
  而是**让「未验证」在输出里占一行** —— 没有那一行，人类读者和 CI 都只会看到绿色。
- 同一类还有发版电池：`--skip-gates` 跳过的条目原先是算进「真跑通过」的，现在单列并减掉。

### 三 · 文档里写死的数字必然腐烂，而且加法验不出来

- `README.md` 的分组计数里，错误分组 3+3+3+6 与真实分组 3+3+2+1+6 **都等于 15** —— 加法是验不出来的，
  只能按组枚举（枚举出来才发现有一整组漏登）。
- `packages/tooling/release/src/release/steps.ts` 里那句写死的「11 段并行」，在段数变了之后一直在说谎：
  第 13 批只能先登记，第 14 批才改成判据式措辞并加防服用例（现在的写法是「段数以表为准」，表在
  `packages/tooling/scripts/src/ci/prepush.ts`）。
- 判据：写「以某处为判据」而不是写那个数；确实要写数字时，写明它是哪一天 / 哪个 commit 的口径 —— 本页就是这么写的。

> 三条的共同点：**门禁和文档都在回答「谁验过什么」**。一旦它们的输出与实际不同形（跳过像通过、超时像失败、
> 数字像现状），验证本身就失效了 —— 而失效是静默的。所以本轮多数改动的真正产物不是功能，而是**可区分的读数**。
