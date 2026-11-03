# 批次 14 · R1 残余债调研（14-A … 14-E）

> 调研方式：**纯静态**（只用 read / grep / glob / 只读 git log）。全文没有执行过
> pnpm / npx / turbo / vitest / tsc，没有 build / test / lint，没有改任何被跟踪文件。
> 本文件是本次唯一写入。
>
> 工作树状态（实测两次）：调研开始时 HEAD = 534667e1，批次 13 的文档改动仍在工作树里（14 个 M +
> ?? reports/batch-13/）；调研结束时那批改动已被**文档门禁那条线提交为 8115d477**
> （docs(docs): 第 13 批文档对齐——设备身份语义、心跳归属与过时读数校正），工作树**只剩本文件**。
> 所以：本批的 8 个 commit 应该**建在 8115d477 之上**，不要 amend / 不要重排它。
>
> 约定：每条都给「现状证据（path:line）→ 该不该做 → 实施方案（文件+行+改成什么）→
> 验收 → 风险与耦合」。凡是推断而非实测的都标 **[待 R2 实测]** 并写清怎么测。

---

## 0. 一页结论

| 条 | 结论 | 落点数量 | 是否要重跑 openapi |
|----|------|----------|--------------------|
| 14-A | 做。9 处（4 处确凿 + 1 处同源 + 4 处同族的现状断言），全部是**注释 / 私有方法 JSDoc / 测试名** —— 不进 openapi.json | 9 处 + 1 个新 drift spec | **不要**（已实测 openapi.json 零命中） |
| 14-B | 保持「出闸」。**没有任何自动门禁在跑 db:seed:verify**（穷举见 B.1）；check-seed.ts:17 那句「由它兜」是误导，必须改成判据式 | 1 处文案（+ 可选 1 条 best-effort 提示） | 不涉 |
| 14-C | 做。SKIP 与 PASS **现在无法区分**（真实缺口，发版电池同样中招）；段数是**用户可见文案**里的硬编码，改成判据式 + 一条防腐测试 | 6 个源文件 + 2 个用例文件 + 2 处活文档 | 不涉 |
| 14-D | 做（删两个函数）。**零 spec 消费者**（任务书里的「spec 引用」不成立）；crypto.deviceIdKey 会悬空但**保留**；DEVICE_ID_ENCRYPTION_KEY 保留并改三处文档措辞 | 2 个源文件 + 3 处文档 | 不涉 |
| 14-E | 做。报告 5 个 md 文件 12 处 + NEEDS-CONFIRMATION 追加 C4（并把 C2 结案） | 12 处 | 不涉 |

---

## 14-A · 代码注释里的「旧事实」

### A.1 现状证据

**A.1.1 调用点实测：generateDeviceId 在生产路径只有 1 处**

grep -rn generateDeviceId apps/server 的全部命中（9 条）：

| 位置 | 性质 |
|---|---|
| libs/system/src/device/device-id.ts:23 | 定义本体（export function） |
| libs/system/src/device/device.service.ts:108 | **唯一生产调用点**（initial：cookie 合法则复用，否则签发） |
| libs/system/src/device/device-id.spec.ts:6,13 | 单测（形态 / 唯一性） |
| apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts:140,171 | 集成夹具 |
| apps/api/test/integration/device.purge.pg.int-spec.ts:52 | 集成夹具 |

device.service.ts:21 只是 import。所以 device-id.ts:20 的「**只在两处调用**：匿名
POST /system/device/initial 与登录成功时」两个半句都错：数字错（2 实为 1），机制错
（登录不签发 —— 登录复用 cookie 里那枚，见 device.service.ts:103-108）。

**A.1.2 4 处确凿项的定性**

| # | 位置 | 现文 | 定性 | 依据 |
|---|---|---|---|---|
| 1 | libs/system/src/device/device-id.ts:18-22 | 「**只在两处调用**……登录成功时」 | **现状断言**（错） | A.1.1 |
| 2 | apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:69 | 「deviceId 是服务端对指纹做 HMAC 得到的 64 位 hex（getDeviceIdByFingerprint）」 | **现状断言**（错，且是安全论证的前提） | 判据 libs/const/src/app/device.ts:16 的 ^d1_[0-9a-f]{32}$ + device-id.ts:24 的 randomBytes(16) |
| 3 | .../gitee/gitee.controller.ts:69 | 同上（逐字相同） | 同上 | 同上 |
| 4 | libs/auth/src/modules/oauth/shared/oauth-state.service.ts:37 | 「deviceId 是服务端对指纹做 HMAC 的稳定设备标识（客户端 cookie 里就带着）」 | **现状断言**（错） | 同上 |
| 5 | libs/app-domain/src/monitor/user/dto/user.dto.ts:21-29 | 「而 deviceId = HMAC(指纹, 服务端 key)，指纹一旦下发……」 | **历史解释写成现在时**（见 A.2） | 该段解释的是 P0-2 为什么摘 visitorId |

补充：apps/api/src/modules/app/monitor/user/dto/user.dto.ts:65-68 有同一句的孪生
（deviceId = HMAC(指纹, 服务端 key)（实测 MATCH）），但它已经落在「**P0-2 之前**它是
AppMonitorUserDTOBase 的字段」这个历史语境里 —— 属于 A.2 判据下的「历史解释」，只需加
一个时间锚（见 A.4.6）。

### A.2 判据：历史解释该留 / 现状断言该改

这三问按顺序问，**第一问肯定就不要看后两问**：

1. **有没有时间锚？** 句子里有没有「改造前 / B5 之前 / P0-2 之前 / 2026-10-28 修复后 /
   review 实测」这类**指向过去**的标记？
   - 有 → 它是历史记录，**留**，但要求它不冒充现状（动词用过去时，或带「当时」）。
   - 没有 → 读者只能按现状读 → 它**就是**现状断言，**改**。
2. **删掉它会不会让代码行为的理由失去支撑？**（「为什么这里要这么写 / 为什么不再那样写」）
   - 会 → 理由**必须留**，但等式改成过去时，并补一句现状去哪儿看（指判据文件，不指人）。
   - 不会 → 它只是转述实现 → 改成现状，或删掉、指向判据文件。
3. **它是不是机器可校验的事实**（正则 / 常量名 / 函数名 / 调用点数）？
   - 是 → 要么**改成引用判据源**（「判据见 libs/const/src/app/device.ts」），要么
     **加一条机械断言把它钉住**（14-A / 14-D 各有一条，见 A.4.2、D.6）。只留数字或函数名、
     不留判据也不留门禁的，一律按「会腐烂」处理。

按这条判据，**保留不动**的历史叙述（本批明确不碰，逐条已核）：

| 位置 | 为什么是历史解释 |
|---|---|
| device-id.ts:11-13 | 「**改造前** device_id = HMAC_SHA256(...)」—— 有时间锚，解释「为什么不再由指纹派生」 |
| libs/guards/src/guards/device.guard.ts:88 | 「**旧形态**（64 hex，= HMAC(指纹)）与任何伪造/畸形值都在这里被拒」 |
| libs/app-domain/src/monitor/user/user.service.ts:52 | 「**旧判据** HMAC(指纹) === deviceId 对真实客户端恒假」 |
| libs/app-domain/src/monitor/user/repo/user.repo.service.ts:50 | 「**批次 11 / B5 收尾**：判据从……改成……」 |
| libs/system/src/device/device-id.spec.ts:17-18 | 「**改造前的真实形态**」（负对照用例的注释） |
| apps/admin/src/views/app/monitor/user/index.vue:147 | 「deviceId = HMAC(指纹)（**当时**）……这里改用设备名定位」 |
| apps/api/test/api/monitor-user.api-spec.ts:163,227 | 说明「为什么这条等式**曾经**能算、现在恒假」 |
| docs/.../industry-research/backend-architecture-review/10-implementation-plan.md:419,424 | 报告里的**带日期**结论（B5 的处置裁定） |
| reports/**（batch-8/9/11/13、review-device） | 冻结历史（唯一例外见 E.3：NEEDS-CONFIRMATION 是活清单） |

### A.3 装饰器 vs 注释：对 openapi.json 的影响（结论：不用重导）

**结论：github.controller.ts:69 / gitee.controller.ts:69 是私有方法的 JSDoc，不进 openapi.json。**
四条证据：

1. **位置**：两句都在 /** ... */ 块里，紧跟着的下一行是
   private getSseClientId(deviceId: string): string（github.controller.ts:72、gitee.controller.ts:72）——
   私有方法没有路由装饰器，Swagger 的 DocumentBuilder 扫不到它。
2. **实测 apps/server/openapi.json**：指纹 **0 命中**；getDeviceIdByFingerprint **0 命中**；
   HMAC **3 命中**全部与设备无关（:22816 「JWT / HMAC Secret」、:22817 同段说明、
   :30587 「HMAC-SHA256 hash for quick lookup without decryption」）。
3. **没有 JSDoc 进 schema 的通道**：apps/server 下没有任何 nest-cli.json（构建走 SWC +
   infra/nest/*.json），也**没有** @nestjs/swagger/plugin 的配置（全仓唯一相关命中是
   libs/decorators/src/field/enum.decorator.ts:10 的一句 exports-map 注释）。swagger 的
   description 全靠显式 swaggerOptions / @ApiProperty / @ApiOkResponse 参数。
4. **对照组**：同一个文件里 github.controller.ts:114 的 @ApiOkResponse({ description: ... })
   **是**装饰器参数，实测出现在 openapi.json:4097（gitee 的 callback；github 的在 :4257 ——
   两者同句，只有 provider 名不同）。同理 {fp} 段落在 :4114（gitee）/ :4274（github）。

**所以 14-A 的 9 处改动一条都不改生成物。** 这条必须写进验收（A.6）：谁要是顺手跑了
openapi:export，就会把本批变成「改生成物」批，还会和文档门禁那条线搅在同一个工作树里。

**顺带发现（本批不做，记 P3）**：github.controller.ts:114 / gitee.controller.ts:114 的
@ApiOkResponse description 里写「on the per-device SSE channel GET /auth/oauth/github/sse/{fp}」——
路径段字面确实还是 {fp}（github.controller.ts:243 是 @Sse('sse/:fp')，且 :210 已注明
「URL 段不再参与任何键。历史 URL sse/:fp 保留只为前端兼容」），**所以它不是事实错误**，
只是把「按指纹订阅」的旧读法留在公开文档里。改它要重跑 openapi:export + schema.d.ts，
与本批「纯静态」的约束冲突。

### A.4 逐处实施方案（可直接粘）

#### A.4.1 apps/server/libs/system/src/device/device-id.ts:18-22（整块 JSDoc 替换）

真实调用点数（1）+「为什么只有一处更安全」+ **数调用点的方法**（让数字不腐）：

~~~ts
/**
 * 签发一个新的设备 id。
 *
 * 生产调用点**只有 1 处**：device.service.ts 的 initial（匿名 POST /system/device/initial）。
 * 登录**不**签发 —— 登录复用 cookie 里那枚已签发的 id（见 initial 里
 * isValidDeviceId(cookieDeviceId) ? cookieDeviceId : generateDeviceId()）。
 * 其余命中全是单测 / 集成夹具（device-id.spec.ts、device.*.pg.int-spec.ts），不是签发路径。
 *
 * 为什么只有一处更安全：签发点越少，「谁能决定一个设备身份」这个面就越小 —— 一处就等于
 * 「请求带不带合法 cookie」，没有第二条腿要单独审计。B5 之前恰好相反：身份是客户端自报
 * 指纹的确定性函数，签发权实际在客户端（知道指纹就能铸出同一身份）。
 *
 * 「1 处」这件事由 device-issuance.drift.spec.ts 机械守（见 A.4.2），不是靠这段注释自觉。
 */
~~~

#### A.4.2 新增 apps/server/libs/system/src/device/device-issuance.drift.spec.ts（防腐机制）

照 libs/lock/src/murlock-isolation.drift.spec.ts:1-40 的样板（SERVER_ROOT = process.cwd()，
因为 pnpm --filter @walnut/server test 的 cwd 是 apps/server），三条断言：

1. 生产源码（apps/api/src + libs，排除 *.spec.ts / *.int-spec.ts / *.e2e-spec.ts /
   apps/api/migrations/）里 generateDeviceId( 的**调用点 = 1**，且文件 =
   libs/system/src/device/device.service.ts；
2. 同一范围里 getDeviceIdByFingerprint / hashDeviceFingerprint **= 0**（防 14-D 删掉后被「恢复」）；
3. DEVICE_ID_ENCRYPTION_KEY 在 libs/** 的读者只允许 config/src/validation.ts、
   config/src/modules/crypto.config.ts、types/src/process.d.ts 三个（防它再被当身份根用）。

实现要点：逐文件拼接内容后再匹配（同 murlock 那份的做法），且**锚调用形态**而不是锚名字 ——
14-A / 14-D 改完之后，device-id.ts 与报告里仍会有说明性提及，只 grep 名字会假红：

~~~ts
const ISSUE_CALL_RE = /(?:^|[^.\w])generateDeviceId\s*\(/m
// 允许：'... = generateDeviceId()'、'? cookieDeviceId : generateDeviceId()'、'return generateDeviceId()'
// 排除：definition 'export function generateDeviceId('、注释里的名字（行首锚 + 去注释）
~~~

> 这条是本条的「数字不腐」机制：1 不再是散在注释里的常数，而是被断言钉住的判据。

#### A.4.3 github.controller.ts:69-70 与 gitee.controller.ts:69-70（两处逐字同改，两行换三行）

~~~ts
   * deviceId 来自**服务端签发的签名 cookie**：形态 d1_ + 32 位小写 hex（判据唯一真源是
   * libs/const/src/app/device.ts 的 isValidDeviceId），B5 起由服务端 randomBytes(16) 随机签发，
   * 与客户端指纹**无关**；cookie 另带 cookie-parser 签名，改一个字符就解签失败。
~~~

删掉「无密钥不可预测」时要一起想清楚：现在的不可预测性来自**随机 + 签名**，不是来自密钥。

#### A.4.4 oauth-state.service.ts:36-39

现文第 37-38 行：

~~~text
 * deviceId 是服务端对指纹做 HMAC 的稳定设备标识
 * （客户端 cookie 里就带着），没有理由外发给 IdP。
~~~

改成：

~~~text
 * deviceId 是服务端签发、写在**签名 cookie** 里的设备身份（B5 起 d1_ + 32 hex、随机、
 * 与指纹无关），没有理由外发给 IdP。
~~~

#### A.4.5 libs/app-domain/src/monitor/user/dto/user.dto.ts:23-24（历史解释 → 加时间锚，不删理由）

~~~ts
  // 而**当时**的 deviceId = HMAC(指纹, 服务端 key)：指纹一旦下发，「拿到指纹 → 铸出该设备的
  // 合法 cookie → 订阅它的 OAuth 结果流」就是一条可复现的账号接管链（review §8.4）。
  // （B5 起该等式已不成立 —— device_id 由服务端随机签发、指纹不再派生身份，判据见
  //  libs/const/src/app/device.ts；但「为什么把 visitorId 从响应面摘掉」与它无关，结论仍成立。）
~~~

#### A.4.6 apps/api/src/modules/app/monitor/user/dto/user.dto.ts:66（孪生，最小改动）

在「（实测 MATCH）」后补半句：「（B5 起不成立，见 libs/app-domain 同名基座的注释）」。

#### A.4.7 apps/api/test/api/device.api-spec.ts:20-23 + 两个 it 标题（109 / 123）

文件头 :21-22 现文：「initial 按 X-Fingerprint 派生业务键 device_id 幂等 upsert —— 同指纹重复
initial 回同一 deviceId（覆盖更新路径），新指纹产出新行」。**机制已换成 cookie**：这两个用例
之所以还是绿的，是因为 WalnutApiClient 自带 cookie jar（第二台设备那段 :123-129 反而要
显式用裸 supertest 绕开 jar）。改成：

~~~text
 * - initial **服务端签发**（B5）：cookie 里有合法 deviceId 就复用（这就是幂等性），否则新签一枚；
 *   指纹只作请求头存在，不再派生业务键。同一浏览器重放回同一 deviceId 是**因为 cookie** ——
 *   换一个没有 cookie 的客户端（哪怕指纹相同）会拿到新设备。
~~~

it 标题：
- :109 → 'initial 重放（带合法 DEVICE_ID cookie）→ 幂等回同一 deviceId + cookie 重签（B5：幂等键是 cookie，不是指纹）'
- :123 → 'initial（无设备 cookie、自带 X-Fingerprint）→ 服务端新签一台设备；read 出参 sr/vp 组装回嵌套对象'

**不要动断言**（它们断言的是「回同一 id」/「新 id 不同」，与机制无关，仍是正确的钉子）。

### A.5 验收

| 项 | 命令 / 判据 | 期望 |
|---|---|---|
| 类型与用例 | pnpm --filter @walnut/server test（R2 跑，裸命令必须在 apps/server 下） | 全绿；新增 drift spec 3 条绿 |
| 生成物未被碰 | git diff --name-only | **不含** apps/server/openapi.json 与 packages/generated/api-types/src/schema.d.ts（若出现 = 有人误跑了导出，回退） |
| 生成物一致（可选，需 env） | pnpm openapi:check | 与 HEAD 逐字节一致（本批只改注释，理应无 diff） |
| 注释规范 | pnpm lint:emoji / pnpm lint | 绿（新增注释里不许有 emoji） |
| 旧结论不再出现 | grep -rn 'HMAC 得到的 64 位 hex' apps/server；grep -rn '只在两处调用' apps/server | 0 命中 |

### A.6 风险与耦合

- **与 14-D 同文件族**：device.repo.service.ts:38-49 的 JSDoc 与 crypto.service.ts:126-129
  是 14-A 的「同族现状断言」，但它们的处置是**整段删除**（14-D）。**先做 D 再做 A**，
  否则要在同一段文字上改两遍（顺序论证见 D.5）。
- **不要顺手改 {fp}**（A.3 末尾那条），它要生成物重跑。
- device.api-spec.ts 的标题改动会改变 vitest 日志里的用例名 —— 历史报告里有人拿旧标题当锚，
  但改名在本仓有先例（批次 11 也改过），可接受。

---

## 14-B · db:seed:verify 的门禁归属

### B.1 谁在跑：**没有任何自动门禁**（穷举）

| 候选 | 证据 | 结论 |
|---|---|---|
| 根 package.json | :72 定义 "db:seed:verify": "walnut-db-verify-seed"（只有定义，没有被任何脚本引用） | 手动命令 |
| apps/server/package.json | grep seed **0 命中** | 不存在 |
| .github/workflows/** | grep 'db:seed:verify' 与 'verify-seed' **0 命中**；grep seed 的 45 处全是 lint:seed（ci.yml:167）、release 的 seed 资产打包（release.yml:307-324）、deploy 的 db:seed:pg（deploy.yml:323-406） | 不进 CI |
| lefthook.yml | 只有 pre-commit（lint-staged）/ commit-msg（commitlint）/ pre-push（pnpm --silent prepush） | 不进钩子 |
| packages/tooling/scripts/src/ci/prepush.ts | PREPUSH_GATES 26 段 id 全表（prepush.test.ts:129-156 是判据）**无** seed-verify；只有 seed（= lint:seed，纯静态） | 不进 prepush |
| 发版电池 packages/tooling/release/src/release/steps.ts:57-139 | 无 seed-verify id；暂缓项只有 build / dist-secrets | 不进发版 |

**唯一提到它的三处都是散文**：postgresql.md:83-84（「它**不进** prepush/CI：需要真实 PG 实例」——
**这句是准确的**）、seed-verify.ts:20-21（「改了就手动跑一次。**不进** prepush / CI」——准确）、
check-seed.ts:17（「由 pnpm db:seed:verify（两库对拍）**兜**」——**误导**，见 B.3）。

### B.2 推荐：保持「出闸」+ 把不可机检的部分写成判据（方案 A）

| 方案 | 内容 | 代价 | 判断 |
|---|---|---|---|
| **A（推荐）** | 不进任何门禁。改 check-seed.ts:16-18 的措辞（B.3），可选加一条 best-effort 提示（B.4） | 改 seed 输入面时仍靠人；补偿 = 一句判据 + 一条提示 | **推荐** |
| B | 进 prepush | 每次 push 分钟级；**会 DROP walnut_seed_a / walnut_seed_b 两个固定库名**（两个开发者 / 两个 worktree / 同时开两条线会互删 —— 同一类事故本仓在集成库上实测过一次：「整轮 639 条读数作废」，见 apps/server/AGENTS.md 的测试段）；且把「删库」放进**每次** push 的路径 | 不推荐 |
| C | 进发版电池但默认 skip（同 build / dist-secrets） | 多一条永久暂缓行，稀释「暂缓必响」这个信号；且电池表与 release.md 有对账用例，改它必须同步文档 | 可选，非必需 |

补充一条**反对 B 的事实**：prepush 已经有一处环境依赖（openapi 段要 PG/Redis，
prepush.ts:202），所以「prepush 不许依赖环境」这个理由站不住 —— 真正站得住的是
**破坏性**（DROP 两个库）+ **分钟级** + **每次 push**，这三条对 openapi 段都不成立
（它只读、秒级，失败语义是「重新导出后 diff」）。

### B.3 check-seed.ts:16-18 现在是否误导：**是**，改成判据式

现文（:16-18）：

~~~text
 * 判据全部落在**数据本身**（不需要数据库），所以它能进 prepush 与 CI。
 * 「与 db:export:pg 往返一致」那一条需要真实库，由 pnpm db:seed:verify（两库对拍）兜 ——
 * 不放进这里，否则门禁会依赖环境。
~~~

问题不在「不放进这里」（对），在「**由……兜**」：兜承诺了一个不存在的东西 —— 没有任何自动
路径会调用它。读者（尤其 agent）会以为那条判据已被某个门禁覆盖。

改成（判据式：谁跑、凭什么跑、什么时候必须跑）：

~~~text
 * 判据全部落在**数据本身**（不需要数据库），所以它能进 prepush 与 CI。
 *
 * **本门禁查不到的那一面**：「与 db:export:pg 往返一致」需要真实库，而仓里**没有任何
 * 自动门禁**会跑它 —— pnpm db:seed:verify（两库对拍）是**手动命令**，不进 prepush /
 * CI / 发版电池（它要真实 PG，且会 DROP walnut_seed_a / walnut_seed_b；理由见
 * src/db/seed-verify.ts 文件头）。
 * **什么时候必须手动跑**：改动触到 seed 输入面 —— apps/server/db/seed/**、
 * src/db/seed-reshape.ts、src/db/policy.ts、src/db/seed-pg.ts 任一有 diff 时。
 * 这条判据由本文件在成功分支上打一行提示（best effort，见 seedInputsTouched）；
 * 提示不是门禁：它只提醒，不判红。
~~~

### B.4（可选）「可机检的提示」的实现

在 packages/tooling/scripts/src/ci/check-seed.ts 里：

1) 新增纯函数（可单测，加在现有 __tests__/check-seed.test.ts）：

~~~ts
/** seed 的**输入面**：动到其中任一个，双库对拍就必须手动跑一次（判据，不是清单装饰） */
export const SEED_INPUT_PATTERNS = [
  'apps/server/db/seed/',
  'packages/tooling/scripts/src/db/seed-reshape.ts',
  'packages/tooling/scripts/src/db/policy.ts',
  'packages/tooling/scripts/src/db/seed-pg.ts',
] as const

/** 从 git diff --name-only 的输出里挑出 seed 输入面（纯函数，便于用例） */
export function seedInputsTouched(changedPaths: readonly string[]): string[]
~~~

2) main() 的**成功分支**（:368-371 的 line('ok', ...) 之后）追加 best-effort 提示：
   git diff --name-only @{upstream}...HEAD → 失败则退 git diff --name-only HEAD~1 HEAD →
   再失败**静默跳过**（CI 是 shallow clone，这里必然失败，属预期）。命中时
   line('warning', 'seed 输入面变了：本门禁只查形态；「与 db:export:pg 往返一致」要真库，请手动跑 pnpm db:seed:verify')。

3) **硬规矩**：这段**永远不抛、永远不判红**（它的失败模式必须是「少一条提示」，不能是
   「本地/CI 假红」）—— 与本仓「一个开始误报的门禁等于没有门禁」同源。

不做的替代方案：把提示挂进 prepush（新加一段只打印、不改退出码的段）—— 那是「一段永远绿的
门禁」，会拉长每次 push 的段数却不拦任何东西，比没有更糟。

### B.5 验收与风险

- 验收：pnpm --filter @walnut/scripts test（check-seed.test.ts 新 3 条）；pnpm lint:seed 在
  「没有 seed 改动」时输出只多一行提示（可接受差异，R2 记录）；且
  grep -rn 'db:seed:verify' packages/ apps/ --include=*.ts 的每一条都能回答「谁跑它」——
  这是本条真正的验收判据。
- 风险：提示依赖 git 与 upstream 存在性；R2 先在本机验一次 upstream 形态
  （git rev-parse --abbrev-ref @{upstream}）。
- 耦合：seed-verify.ts:20-21 的「不进 prepush / CI」已经是对的，**不改**；只把
  check-seed.ts 的「兜」改掉，两处措辞**必须一致**（都指向「手动命令 + 判据」）。

---

## 14-C · prepush 的 SKIP 三态 + 段数措辞

### C.1 现状：SKIP 在输出与退出码上与 PASS **无法区分**（真实缺口）

证据链（四段，都是静态可核的）：

1. lint-workflows.ts:21-27：探测不到 actionlint → lineErr('warning', '未检测到 actionlint，跳过 workflow 校验')
   + return → **退出码 0**。
2. check-workflow-shell.ts:134-139：没找到 bash → line('skipped', '没找到 bash，跳过…跳过**不等于**通过。')
   + return → **退出码 0**（脚本自己已经喊了「不等于通过」，但没人看得见）。
3. prepush.ts:294-313：runArgs(pnpmBin, argv, { output: { write: text => chunks.push(text) } }) ——
   子进程输出**全部进缓冲**；prepush.ts:344-349 只在**失败**时回放。
4. prepush.ts:324-328（formatLine 只看 ok）、:335（onDone 即打行）、:339-341（汇总只说「全部通过」）。

所以：**SKIP 段打的是 ✓（绿），汇总说的是「N 段全部通过」，脚本里那两行「跳过」文案被吞进
缓冲区永不显示。** 推送者看到的是 —— ✓ 3.1s workflow 校验（actionlint）+「26 段全部通过」。
这不是「文档没写清」，是机器侧把未验证说成了通过。

**同一个洞在发版电池里也存在**：steps.ts:186-201 只看 runPnpmStep 是否抛，最后打
「发版前全量电池全绿（N 条）」—— 没装 actionlint 的发版机同样把 SKIP 当绿。

### C.2 推荐形态（方案 B：SKIP 变成**第四种退出码**，输出三态化，默认不误伤）

为什么是四态而不是三态：本仓已有 lib/errors.ts + lib/cli.ts 的「0 通过 / 1 违规 /
2 前置条件」契约，而 SKIP 的语义与这三者都不同（既不是通过也不是失败，是「环境缺失、
未验证」）。塞进 0 会说谎，塞进 1/2 会让人去改代码/修一个没坏的环境。

具体改动（6 个源文件 + 2 个用例文件）：

1）packages/tooling/scripts/src/lib/errors.ts（文件头「三态」→「四态」），新增：

~~~ts
/** 环境缺失导致**未验证**（不是通过，也不是违规）→ 退出码 3 */
export class SkippedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkippedError'
  }
}
~~~

2）packages/tooling/scripts/src/lib/cli.ts：runCli 的映射表加一行 —— SkippedError ⇒
line('skipped', message)（走 **stdout**，属正常叙述）+ process.exitCode = 3；同时更新
:11-16 那张表与 :5-8 的说明（「哪一类失败 → 哪个退出码」现在四行）。

3）packages/tooling/scripts/src/ci/lint-workflows.ts:23-27：

~~~ts
  if (probe.error || probe.status !== 0) {
    throw new SkippedError(
      '未检测到 actionlint：本机**未验证** workflow（不等于通过）。权威闸门是 CI 的 '
      + '.github/workflows/workflow-lint.yml；安装方式见 https://github.com/rhysd/actionlint#download',
    )
  }
~~~

4）packages/tooling/scripts/src/ci/check-workflow-shell.ts:134-139：同样抛 SkippedError，
   文案保留「设 BASH_PATH 指向 bash 即可启用」+「CI 的 ubuntu runner 自带 /bin/bash」。

5）packages/tooling/scripts/src/ci/prepush.ts：
   - GateResult 加 status: 'ok' | 'failed' | 'skipped'（**不要**在保留 ok 的同时加 skipped，
     那会造出两个真源）；
   - runGates 的 catch（:307-310）先判 error instanceof ChildRunError && error.exitCode === 3
     ⇒ status = 'skipped'（ChildRunError 已经带 exitCode，见 lib/child-run.ts:67-73）；
   - formatLine（:324-328）三态：✓ / ✗ / -（**继续用 ASCII**，理由在同仓 lib/log.ts:56-57：
     emoji 是双宽字符，混进 padStart 对齐的表格会歪），跳过行在 label 后追加 '  [SKIP 未验证]'；
   - main() 汇总（:339-341）改三段，并**单列跳过**：

~~~ts
  const skipped = results.filter(r => r.status === 'skipped')
  const passed = results.length - failed.length - skipped.length
  line('ok', '' + results.length + ' 段：' + passed + ' 段真跑通过 / '
    + skipped.length + ' 段跳过（未验证） / ' + failed.length + ' 段失败（总 ' + total + 's）')
  if (skipped.length > 0)
    line('skipped', '未验证的段：' + skipped.map(r => r.gate.id).join(', ') + '（权威闸门见 .github/workflows/）')
~~~
   - **严格开关**：PREPUSH_STRICT=1（与既有 PREPUSH_CONCURRENCY 同族环境变量；不加 argv 解析，
     lefthook 传不了参数）⇒ 有 skipped 就 throw new ViolationError。默认**关**。

6）packages/tooling/release/src/release/steps.ts:190-199（**最容易漏的一步**）：
   电池的 catch 里先判 exitCode === 3 ⇒ ui.log('跳过（未验证）：…') + continue，**不进 failures**；
   末尾 :201 的「全绿（N 条）」改成「N 条：M 真跑通过、K 跳过未验证」。
   **不改这里 = 没装 actionlint 的发版机会因退出码 3 直接失败**（回归）。

7）用例同步（必改，否则必红）：
   - packages/tooling/scripts/src/ci/__tests__/prepush.test.ts:167-176 的 formatLine 逐字断言
     （'  ✓    1.2s  某段门禁'）—— 三态化后新增一条 skipped 的断言，保留 ASCII 对齐那条；
   - prepush.test.ts:127-157 的 id 全表**不动**（本批不加段）；
   - 新增 runGates 的 skip 分支单测。**[待 R2 实测]**：runGates 现在把 runArgs 硬编码在
     函数体里（prepush.ts:295），要注入「退出码 3」得把执行器抽成可选参数（+~10 行）。
     测法：先看现有 prepush.test.ts 是否覆盖 runGates（只覆盖 formatLine 与表本身），
     若否，抽 executor 参数再写用例。

### C.3 会不会误伤开发机

| 场景 | 改后行为 | 误伤 |
|---|---|---|
| 没装 actionlint 的 Windows 开发机 push | 该段 '-' + 汇总「1 段跳过（未验证）」，退出码 **0** | 不误伤（推送照旧成功，但不再谎报通过） |
| 同上，开发者主动 PREPUSH_STRICT=1 pnpm prepush | 红（exit 1），提示「未验证」 | 有意为之 |
| 直接跑 pnpm lint:workflows | 退出码 **3**（以前 0），打一行标记 + 原因 | 轻微行为变更；已核仓内只有 prepush.ts 与 steps.ts 调它，两处都认 3；workflow-lint.yml 只跑 lint:workflows-shell（ubuntu 有 bash，不会 SKIP） |
| CI（ubuntu，bash 与 actionlint 都在） | 两段都真跑（exit 0），行为不变 | 不误伤 |
| 发版机没装 actionlint | 「跳过（未验证）」并继续（C.2 第 6 条） | 不误伤（但不再谎报全绿） |

### C.4 段数措辞：packages/tooling/release/src/release/steps.ts:405

> 注意：任务书写的 packages/tooling/scripts/src/ci/steps.ts **不存在**；真正的文件是
> packages/tooling/release/src/release/steps.ts（@walnut/release）。

现文（:404-406，是**打到用户屏幕上**的 push 提示）：

~~~text
    hint: '远端 pre-receive 之前会先跑本仓的 pre-push 门禁（pnpm --silent prepush：'
      + 'src/ci/prepush.ts 那张表，11 段并行、每段报耗时），冷缓存数分钟属预期；'
      + '心跳会告诉你是「在跑」还是「卡住了」。',
~~~

实测 PREPUSH_GATES 的 id 有 **26** 个（prepush.test.ts:129-156 的黄金序列表就是判据）。

**改法：写死数字 → 判据式措辞**（不推导、不导入）：

~~~text
    hint: '远端 pre-receive 之前会先跑本仓的 pre-push 门禁（pnpm --silent prepush：'
      + '段表在 packages/tooling/scripts/src/ci/prepush.ts，并行执行、每段报耗时、'
      + '跳过与通过分开报），冷缓存数分钟属预期；心跳会告诉你是「在跑」还是「卡住了」。',
~~~

**为什么不用「从 PREPUSH_GATES.length 推导」**：@walnut/release 与 @walnut/scripts 刻意
互不依赖（电池只按**脚本名**调 pnpm，见 steps.ts:44-56 的说明）。加一条跨包 import 会把
两包耦死、让 release 的构建面变大 —— 为一句提示不值。**判据式措辞就是最强的防腐：没有数字，
就没有东西会腐烂。**

**「让它不再腐烂」的机械机制**（一条小测试，放 packages/tooling/release/src/release/__tests__/）：

~~~ts
it('推送提示里不许出现会腐烂的段数（段数以 prepush.ts 的表为准）', () => {
  const src = readFileSync(join(REPO_ROOT, 'packages/tooling/release/src/release/steps.ts'), 'utf8')
  const hintLines = src.split('\n').filter(l => l.includes('prepush'))
  expect(hintLines.length).toBeGreaterThan(0) // 负对照：找得到才有意义
  for (const l of hintLines)
    expect(l, '这句里写死了段数：' + l).not.toMatch(/\d+\s*段/)
})
~~~

### C.5 别处同类的「段数」硬编码（逐条判定）

| 位置 | 现文 | 判定 |
|---|---|---|
| release/src/release/steps.ts:405 | 11 段并行 | **改**（C.4） |
| docs/.../plans/data-scope-remediation-plan.md:220 | 「pnpm prepush（23 段门禁表）」 | **改**（活文档）→「段数以 prepush.ts 的表为准」 |
| docs/.../plans/data-scope-phase2-3-plan.md:108 | 「prepush 23 段」 | **改**，同上 |
| scripts/src/ci/__tests__/gate-wiring.test.ts:276 | 「「11 段门禁写成一条 300+ 字符 a && b && …」的**历史**（第 16 批拆掉的）」 | **留**。它锚在「第 16 批拆掉的」上，是可被 git 历史证伪的**历史叙述**，不是对当前段数的断言；且它支撑的是「根脚本值里不许出现连接子」这条判据 —— 删了理由就没了。可选：句末加「（当前段数见 prepush.ts）」 |
| prepush.ts:87 / :114 | 「当时 18 段全绿」「prepush 当时 25 段里没有它」 | **留**（带「当时」） |
| prepush.ts:114 之外的历史段数：docs/.../monorepo/reference-repo-comparison.md:180、monorepo/ci-cd.md:149、scripts/src/ci/check-source-secrets.ts:8、adr/0020-remove-unplugin-auto-import.md:125（17/17 段）、plans/libs-decoupling-residuals.md（批次 13 已改判据式）、review/backend/index.md:397（批次 13 已改） | 事故叙述里的历史数字 | **留** |
| docs/.../industry-research/backend-architecture-review/10-implementation-plan.md:277,315,316 | 「madge 进 prepush（25 段）」 | **留**（报告是带日期的执行记录） |

### C.6 验收

- pnpm --filter @walnut/scripts test（prepush 三态 + formatLine）；
  pnpm --filter @walnut/release test（电池 skip 分支 + 提示防腐测试）。
- **负对照（必须有）**：临时把 lint-workflows.ts 的 SkippedError 改回 return ⇒ pnpm prepush
  应出现「1 段跳过」而不是「全部通过」；再加 PREPUSH_STRICT=1 ⇒ 应变红。做完还原。
- 真跑一次 pnpm prepush：汇总行必须三段式，SKIP 段打 '-'（本机没装 actionlint 时正好现成）。
- pnpm lint:emoji（新增的行里不许有 emoji）。

### C.7 风险

- **退出码 3 是一个新契约**：任何外部脚本 / CI step 若「非 0 即失败」，pnpm lint:workflows
  在无 actionlint 的机器上就变红。已核仓内只有 prepush.ts 与 steps.ts 调它（两处都认 3）；
  workflow-lint.yml 只跑 lint:workflows-shell（ubuntu 有 bash，不会 SKIP）。
- **runGates 的可测性**：runArgs 现在是硬编码依赖（prepush.ts:295），skip 分支不好注入 ——
  见 C.2 第 7 条的 [待 R2 实测]，必要时把执行器抽成可选参数（+10 行，但让三态有真用例）。
- 与 14-E 的文档改动**不要同 commit**：两者都在 apps/docs/** 下，但重跑一遍 pnpm build:docs 的代价
  （分钟级）不该被两条改动分摊 —— 而且 8115d477 刚动过 release.md / ci-cd 这类同族文件，
  分开提交才好定位回归。

---

## 14-D · getDeviceIdByFingerprint / hashDeviceFingerprint 的删除面

### D.1 精确删除面（含连带项）

| # | 文件 | 行 | 动作 |
|---|---|---|---|
| 1 | apps/server/libs/system/src/device/repo/device.repo.service.ts | 38-49 | 删整个 JSDoc + 方法（getDeviceIdByFingerprint） |
| 2 | 同上 | 5 | 删 import { AppTechCryptoService } from '@walnut-server/crypto' |
| 3 | 同上 | 29-31 | 删构造器参数 private readonly cryptoService: AppTechCryptoService, |
| 4 | apps/server/libs/crypto/src/crypto.service.ts | 126-138 | 删 JSDoc + hashDeviceFingerprint（configService **保留**：encrypt/decrypt 仍在用，见 :24） |
| 5 | 模块接线 | — | **不用改**：AppTechCryptoModule 是 @Global()（libs/crypto/src/crypto.module.ts:4），device.repo.module.ts:16-18 只 import TypeOrmModule.forFeature |
| 6 | knip 基线 | — | **不用改**：本仓没有基线文件，knip 是「红且有意维持、不在任何门禁里」（knip.config.ts:3-17）；删两个符号只会让读数下降 |

**spec 用例：没有。** 任务书说「只有彼此与 spec 引用」，实测**不成立**：
grep -rn 'getDeviceIdByFingerprint|hashDeviceFingerprint' apps/server 全仓 5 条命中 ——
2 条是注释（github/gitee.controller.ts:69），2 条是定义（device.repo.service.ts:47、
crypto.service.ts:130），1 条是它们之间的互相调用（device.repo.service.ts:48）。
另外 libs/crypto/src/ 下**没有** crypto.service.spec.ts，也没有 device.repo.service 的同名 spec。
⇒ **删除面比预期小，没有用例要一起删**。
**[待 R2 实测]**：跑 pnpm --filter @walnut/server test 确认无隐性按名引用（vi.spyOn(db, 'getDeviceIdByFingerprint')
这类写法在 grep 里也会命中，已排除）。

### D.2 crypto.deviceIdKey 删完是否悬空：**是**，但**保留**

- 删前唯一读者：crypto.service.ts:133（configService.get('crypto.deviceIdKey')）—— 全仓
  crypto.deviceIdKey 的消费者**只有这一处**（grep deviceIdKey 命中 17 条，除本条外全是报告）。
- 删后它变成 crypto.config.ts:10 里**写了但没人读**的属性。
- **保留的理由**（不是懒得删）：它与 DEVICE_ID_ENCRYPTION_KEY 的 env 契约绑在一起 ——
  删属性而留 env 校验，会造出「env 必填但无人使用」的更糟形态；要退役就两者一起退（D.4）。
  处理方式：在 crypto.config.ts:9 的注释上写清状态：

~~~ts
  /* 历史：指纹 -> deviceId 的 HMAC 盐（B5 起 device_id 由服务端随机签发，**0 读者**）。
     保留理由：这个 env 是「部署后不许改的 5 个」之一（apps/server/AGENTS.md），
     摘它与摘 env 必须同一批做（见 reports/batch-14/r1-residuals.md 14-D）。*/
  deviceIdKey: process.env.DEVICE_ID_ENCRYPTION_KEY,
~~~

### D.3 DEVICE_ID_ENCRYPTION_KEY 还有没有真实用途

**结论：没有任何加解密 / 派生消费者了；但它仍是「部署契约」的一部分，本批保留，只改文档措辞。**

判据（三条，都是静态可核的）：

1. **不是加密根**：crypto.encrypt/decrypt 的 key 名是**参数**（crypto.service.ts:24），全仓传的是
   'crypto.mfaKey' / 'crypto.rtKey' / 'crypto.userIdentityKey' —— **没有一处传 crypto.deviceIdKey**
   （grep "'crypto." apps/server 共 11 条，逐条已看）。它历史上只被 hash(...)（HMAC，单向）用过，
   **从来没有加密过任何数据**。
2. **历史数据也不需要它**：B5 的 migration 1793390000000-DeviceIdFormCheck.ts:25-32 的 pre-step
   **要求先 DELETE 掉所有非 d1_ 形态的行**（连 app_monitor_user 一起），所以「旧 64-hex device_id
   还能用它复算指纹映射」这条路在 B5 收尾时就被**主动关掉**了 —— 库里不存在需要它的历史行。
3. **它仍有 4 个活引用，但都是「契约骨架」**：validation.ts:208-211（必填 + 长度门禁）、
   process.d.ts:60（类型）、crypto.config.ts:10（注册）、validation.spec.ts:125（门禁用例）。
   三份 env 文件里都有它（env-encrypted/.env.{development,stage,production} 第 55 行附近；
   env-local 对应行）—— **删它要动 dotenvx 密文 + 5 处文档 + 部署说明**。

**所以：保留 env，改三处半「设备 ID 加密」的措辞**（这条 = 不动部署契约）：

| 位置 | 现文 | 改后 |
|---|---|---|
| apps/server/AGENTS.md:109 | DEVICE_ID_ENCRYPTION_KEY（设备 ID） | DEVICE_ID_ENCRYPTION_KEY（历史指纹盐；B5 起设备 ID 由服务端随机签发，已无代码读者，仍按契约保留）—— **注意 doc-budget**：本行会涨字数，改前先看预算余量 |
| apps/docs/.../backend/configuration.md:41 | DEVICE_ID_ENCRYPTION_KEY ｜ 设备 ID | 历史指纹盐（B5 起无消费者；部署后仍不许改） |
| apps/docs/.../monorepo/env-management.md:104 | DEVICE_ID_ENCRYPTION_KEY — 设备 ID 加密 | — 历史设备指纹盐（B5 起无消费者，契约保留） |
| （英文）apps/server/libs/config/README.md:82 | Critical env vars … DEVICE_ID_ENCRYPTION_KEY | 清单保留，加半句 (legacy fingerprint salt; no code reader since B5) |

> 这些文件里有几个刚被 8115d477 改过（AGENTS.md / configuration.md / env-management.md 同族的那批
> 设备身份措辞）。实施前先 git show 8115d477 -- <path> 看现状，**不要按本报告的「现文」列硬套** ——
> 那一列是按 534667e1 之前的口径抄的，措辞可能已经被改成「历史指纹盐」之类。

### D.4 「连同文档一起摘」的代价（为什么本批不做）

- 要改：validation.ts:208-211、process.d.ts:60、crypto.config.ts:9-10、validation.spec.ts:125、
  AGENTS.md:109、configuration.md:41、env-management.md:104、config/README.md:82、三份
  env-encrypted/*（要重新 encrypt-env）+ 部署文档 —— 而且它**改变对外契约**（老部署继续带这个
  env 无害，但「5 个不许改的密钥」这条纪律要从 5 变 4）。
- 因此按本仓规矩（NEEDS-CONFIRMATION.md 的入单判据：会改变对外契约 / 不可逆）**这条不该由本批
  自己定**。本批选**可逆**的那个（保留 + 改措辞），并把「要不要退役」记进 NEEDS-CONFIRMATION.md
  §2「已按推荐直接做掉的」表（供事后否决），**不占 §1 的待确认位**。

### D.5 与 14-A 的耦合与顺序

同一个「HMAC 指纹派生」叙事，涉及 4 个文件的重叠：

| 文件 | 14-A 的动作 | 14-D 的动作 | 顺序 |
|---|---|---|---|
| device.repo.service.ts:38-49 | （不碰） | **整段删** | D 先 |
| crypto.service.ts:126-129 | 同族旧注释 | **整段删** | D 先 |
| github/gitee.controller.ts:69 | 改（现文点名将被删的函数） | — | D 之后改，**新文案不许再点名已删函数** |
| oauth-state.service.ts:37 | 改 | — | 无依赖 |

**实施顺序**：先 D（删代码）→ 跑 pnpm --filter @walnut/server test（确认没有隐性引用）→ 再 A
（改文案 + 加 drift spec）。反过来做的话，A 刚写好的「已 0 消费」这句马上被 D 删掉，同一段
diff 里会出现被改两次。

### D.6 验收

| 项 | 判据 |
|---|---|
| 删干净 | grep -rn 'getDeviceIdByFingerprint|hashDeviceFingerprint' apps/server ⇒ **0 命中**（含注释） |
| 无悬空注入 | grep -n 'AppTechCryptoService' apps/server/libs/system ⇒ 0 命中 |
| 类型 | pnpm --filter @walnut/server types:check（strict） |
| 用例 | pnpm --filter @walnut/server test；新增 device-issuance.drift.spec.ts 的第 2 条断言（两个名字 0 命中） |
| env 仍在 | grep -c DEVICE_ID_ENCRYPTION_KEY apps/server/libs/config/src/validation.ts ⇒ 1；启动不报缺 env |
| 生成物 | git diff --name-only 不含 openapi.json / schema.d.ts |

### D.7 风险

- 删 getDeviceIdByFingerprint 会让 SysDeviceRepositoryService 的构造器从 3 参变 2 参。它的
  替身只在 spec 里 —— 已核无 device.repo.service.spec.ts；但 device.service.spec.ts:7,52 用到了
  SysDeviceRepositoryService 类型，需 pnpm --filter @walnut/server test 实测 **[待 R2 实测]**。
- DEVICE_ID_ENCRYPTION_KEY 的措辞改动会碰 apps/server/AGENTS.md（doc-budget 有预算；该文件在
  8115d477 里刚被 +/-24 行改过）—— 改完必须跑 pnpm lint:doc-budget；若余量紧张，**只改三处
  docs、AGENTS 那行留给下一批**。

---

## 14-E · 报告自洽性 + reports/NEEDS-CONFIRMATION.md

### E.1 矛盾清单（12 处，逐处给新措辞）

目录：apps/docs/src/zh-CN/content/industry-research/backend-architecture-review/（下称 R/）

> **写法原则**（用户明确要求）：不假装当初没决定建。所有修订都写成「带时间线的决策记录」：
> 2026-11-02 决定建 → 2026-11-03 实测否决直接搬迁 → 现状 P2（不搬），P1（自建 CJS dist）待拍板。

#### E.1.1 R/index.md:3-5（顶部更新行 → 加修订记录）

现文 :3：「> 更新：**2026-11-02** ｜ 基线 commit 3aa32f1f…」

改为四行：

~~~text
> 更新：**2026-11-02** 初版 ｜ 基线 commit 3aa32f1f，工作区有并行线在改（见 §六）
> **2026-11-03 修订：D4（建 packages/platform-node）的「直接搬迁」分支被实测否决** ——
> const 单库 POC 不通过，现状 = 不搬（P2）。详见 [10](./10-implementation-plan.md) §10.2 与
> [07](./07-decisions.md) 的 D4 修订记。**本页与 07/08 里凡写「建 platform-node」的地方都按这条读。**
~~~

#### E.1.2 R/index.md:15（Q3 的答案格）

现文尾句：「**后端基建可以下沉 —— 已定为建 packages/platform-node**（D4）」

改为：「**后端基建当时定为下沉、建 packages/platform-node（D4，2026-11-02）；2026-11-03 的
const 单库 POC 实测不通过，直接搬迁被否决 —— 现状 = 不搬（P2）；要恢复包边界只能走 P1
（两个包自建 CJS dist，待拍板）**」

#### E.1.3 R/index.md:28（决策表 D4 行）

~~~text
| D4 | ~~建 packages/platform-node~~ → **2026-11-03 实测否决直接搬迁**（POC 不通过）；现状 P2 = 不搬，P1 = 自建 CJS dist（待拍板） |
~~~

#### E.1.4 R/index.md:57-62（目标态目录树）

:61 那行改成（**保留占位**，不删行 —— 删了读者就不知道 D4 曾经要什么）：

~~~text
      platform-node/    base · tech     ← 后端基建（28 库）**未建**：D4 的直接搬迁已于 2026-11-03 实测否决
~~~

并把 :57 的小节标题「## 四、目标态」改成「## 四、目标态（2026-11-03 修订：platform-node 未建）」。

#### E.1.5 R/index.md:69（依赖方向）

现文：「apps/server → platform-node → platform-any」

改为：「apps/server/libs/* →（tsconfig paths @walnut-server/*）→ platform-any（platform-node 未建；
若走 P1，则改为 apps/server → platform-node(dist) → platform-any）」

#### E.1.6 R/index.md:80（文件清单里对 07 的描述）

「**6 条已定决策 + 14 条 B 档**，含 platform-node 设计与 4 个顾虑处置」→
「**6 条已定决策 + 14 条 B 档**；D4 的 platform-node 设计与 4 个顾虑**保留为当时依据**，
其中「dist 布局不变」这条已被 2026-11-03 实测证伪」

#### E.1.7 R/07-decisions.md:18（决策表 D4 行）

现文：「**建**。两包、28 库下沉、零 import 改写；先做门禁判据生成化 + 1 库 POC ｜ 已定（修订）」

~~~text
| **D4** | packages/platform-node | ~~**建**~~ → **2026-11-03 实测否决「直接搬迁」**：POC 不通过，前提（零 import 改写）不成立。现状 **P2（不搬）**；**P1（自建 CJS dist）待拍板** | 已定 → 已否决（共三次修订） |
~~~

#### E.1.8 R/07-decisions.md:66（D4 正文的小节标题 + 紧跟一段「结论先行」）

标题改为：
「### D4 = 建 packages/platform-node（2026-11-02 修订：从「不建」改为「建」；**2026-11-03 实测否决**）」

标题下面、:68 那句「你的判断成立，我改结论」**之前**插入：

~~~text
> **2026-11-03 结论（第三次修订，以此为准）：直接搬迁被实测否决。**
> const（27 文件、0 处 Nest、零外部依赖）搬到 packages/platform-node/base/src/const 的单库 POC
> 三条失败面都不在构建期暴露：
> ① @swc/cli 的 getDest 让产物按「源文件相对 cwd 的逐字符镜像」落到 <root>/apps/packages/... ——
>    **build 仍 exit 0**、start:prod MODULE_NOT_FOUND；
> ② 唯一开关 stripLeadingPaths 是全局布尔：开了 dist/packages 对了，但 dist/apps/api/src/main.js
>    塌成 dist/api/src/main.js（Dockerfile CMD 与 start:prod 全废）；
> ③ include 加跨包路径会连累 assets 校验；补 rootDir 能救绿，但那会变成第 10 个注册面，且
>    types:check 跳出解析链爆 TS2307。
> ⇒ **「零 import 改写、只改 5 面」这个前提不成立。**
> **现状 = P2（不搬）**：apps/server/libs/** 原样保留，「边界清晰」这一收益今天由 ESLint 六层
> 分层 + 3 个 drift spec 提供。**P1（两个包自建 CJS dist，照 @walnut/contract 样板）待用户拍板**。
> 详见 [10](./10-implementation-plan.md) §10.2、[ADR 0007 的 2026-11-03 追记](../../adr/0007-backend-libs-not-workspace.md)、
> reports/NEEDS-CONFIRMATION.md 的 C4。
> 下面「目标形态 / 零 import 改写 / 四个顾虑」**保留为当时的依据**（顾虑 2 已被实证）。
~~~

（:90-95 的顾虑表**不动**：那是当时的风险清单，现在它的价值恰恰是「第 2 条被证实了」。）

#### E.1.9 R/08-recommended-plan.md:15（阶段总览的 P2 行）

~~~text
| **P2** | ~~建 platform-node（POC → 批量）~~ **已否决（2026-11-03 实测）**；现状 = 不搬 | D4（→ P2 分支）、D13 | 0（搬迁）/ P1 待拍板 |
~~~

:22「P0–P1（5–7 人日）完成之前不要动 P2」→ 追加「（P2 的「建包」分支已作废，只剩 D13 的两件小事）」。

#### E.1.10 R/08-recommended-plan.md:91-119（P2 整节）

标题：「## P2 · 建 platform-node（D4）」→「## P2 · ~~建 platform-node~~（2026-11-03 实测否决，保留为过程记录）」（只换这一行标题，节内正文先别动）

节首插入：

~~~text
> **结论先行：本节不再执行。** 2026-11-03 的 const 单库 POC 不通过（dist 布局不可控，见
> [10](./10-implementation-plan.md) §10.2）；D4 的「直接搬迁」分支作废。剩余两条路：
> P1（两个包自建 CJS dist，待拍板）或 P2（不搬 = 现状）。
~~~

:104 那句「**若第 2 条失败**（dist 布局变了）→ 停下来找我」后追加：
「**这条已经发生**（2026-11-03 实测第 2 条失败），即上面那条「停」的处置。」

:106-119（P2-B 批量下沉）在标题下加一行「**不执行**（前置 POC 未通过）」，正文保留。

#### E.1.11 R/06-cross-check.md:86（「没验证到的部分」表）

现文：「platform-node 的 dist 布局是否变化 ｜ **未验证 —— 这是 D4 唯一的真风险** ｜ 已定为「先拿 const 做 1 库 POC」」

改为：「｜ platform-node 的 dist 布局是否变化 ｜ **已实测（2026-11-03）：变了，且不可控**（产物逃出 dist /
stripLeadingPaths 全局塌陷 / assets 连累） ｜ D4 的直接搬迁因此作废，见 [10](./10-implementation-plan.md) §10.2 ｜」

#### E.1.12 R/09-research-summaries.md:81-83（「已被决策推翻」那段）

现文：「**本报告原推荐「不建 platform-node」已被决策推翻**（见 07 D4）……」

改为（三次转折，读者才不会晕）：

~~~text
> **这条结论转过三次，按时间线读**：
> ① 本报告原推荐「不建」；② 2026-11-02 用户指出该下沉的是「业务无关的后端基建」，决策改为
> 「建」（见 07 的 D4）；③ **2026-11-03 实测否决「直接搬迁」**（const 单库 POC 的三条失败面见
> 10 §10.2）—— 结论回到「不搬」，但**理由与 ① 不同**：不是「不需要」，而是「现有 SWC 构建下
> 搬不动」。若要恢复包边界只剩 P1（自建 CJS dist，待拍板）。本节保留当时的证据与 4 个顾虑清单。
~~~

#### E.1.13 顺带发现（低优先，可留待下一批）

R/09-research-summaries.md:74「frontend 没有任何规则 ⇒ 将来建 Node 包时 admin 可偷 import 且不会红
（修 3 行）」—— 批次 2 已经补了 platform-web deny platform-node（10-implementation-plan.md:315 有记账），
这句是**当时的缺口描述**（有「将来」锚），保留可，但读起来像待办。建议加「（2026-11-02 批次 2 已补规则）」。

### E.2 验收

| 项 | 命令 | 期望 |
|---|---|---|
| 没有残留的「要建」断言 | grep -rn '已定为建' apps/docs/src/zh-CN/content/industry-research/ | 命中全部带「否决 / 作废 / 未建 / 删除线」 |
| 文档构建（死链） | pnpm build:docs（由文档门禁那条线或 R2 跑） | 0 死链（industry-research/ 在 ignoreDeadLinks 白名单里，但相对链接仍应正确） |
| 代码块可解析 | pnpm lint:doc-ts | 绿（新增块别把 JSON 标成 ts；本文件用的是 ~~~text / ~~~ts 之外的报告文件不受此门禁约束） |
| 引用真实 | pnpm lint:docs-refs | 绿 |
| 表格没被竖线打断 | 构建 + 人眼 | 新增表格行里若含竖线必须转义 |
| 不许写原始插值 | grep -rn '\${{' apps/docs/src/zh-CN/content/industry-research/ | 0 命中 |

### E.3 reports/NEEDS-CONFIRMATION.md：追加 C4 + 给 C2 结案

**问题确认**：platform-node 走 P1 还是 P2 **不在**这份清单里
（grep platform-node reports/NEEDS-CONFIRMATION.md = 0 命中），而它正是用户说的「实在决定不了的
留到这个 MD」那一类（10-implementation-plan.md:362 也写着「等用户拍板」）。

#### E.3.1 在「## 1. 现在等着确认的」末尾（:54 之后）追加 C4

~~~markdown
### C4 · platform-node 走 P1（自建 CJS dist）还是 P2（不搬）

**背景**：D4 原定把 28 个「业务无关的后端基建」库下沉到 packages/platform-node，前提是
「零 import 改写、只改 5 个配置面」。2026-11-03 的 const 单库 POC 实测**不通过**：@swc/cli 的
getDest 让产物逃出 dist（build 仍 exit 0）、stripLeadingPaths 是全局布尔（开了就把
dist/apps/api/src/main.js 塌成 dist/api/src/main.js）、跨包 include 连累 assets 校验且
types:check 爆 TS2307。证据：10-implementation-plan.md §10.2、
adr/0007-backend-libs-not-workspace.md 的 2026-11-03 追记。

**为什么没直接定**：两条路都自洽。P1 换回「包边界」这个收益，代价是新增一条构建流水线 +
peerDeps(@nestjs/*) + 28 库搬迁，而且第一关必须是「tsc 产出的装饰器元数据与 SWC 等价」——
错了的症状是静默的（接口 200 但字段消失）。P2 放弃搬迁，而「边界清晰」今天已由 ESLint 六层
分层 + 3 个 drift spec 提供。

**选项**：
- A（**当前按这个做的**）：**P2 不搬**，保留 apps/server/libs/**；platform-node 的 turbo tag 规则
  留着（没有 subject、永远空转，属已知冗余）
- B：**P1 自建 CJS dist**（照 @walnut/contract 样板），apps/server 消费 dist，28 库分批搬

**推荐 A（P2）**。触发条件已写进 ADR 0007：出现**第二个 Node 产品**（不是第二个进程 —— worker
与 api 共用同一份 AppModule 与构建产物，不构成跨包复用），或决定把后端能力对外发布时，再评估 B。
~~~

#### E.3.2 给 C2 加「结案」（14-D 的答案）

在 C2 的「**推荐 A**（单独一批做，别和认证链路混）」后面追加一行：

~~~markdown
**结案（批次 14）**：按 B 执行 —— 删 getDeviceIdByFingerprint + hashDeviceFingerprint，
**不动** DEVICE_ID_ENCRYPTION_KEY 与 crypto.deviceIdKey（删它们 = 改部署契约，另案）。
理由与删除面见 reports/batch-14/r1-residuals.md 的 14-D。
~~~

#### E.3.3 在「## 2. 已按推荐直接做掉的」表格末尾加两行

~~~markdown
| DEVICE_ID_ENCRYPTION_KEY | **保留**（env / validation / 5-key 名单全不动），只把三处文档措辞从「设备 ID 加密」改成「历史指纹盐、B5 起无代码读者」 | B5 起它已无加解密消费者（从未加密过任何数据，只做过单向 HMAC 盐）；但三份 env 里有它、validation.ts:211 必填，退役一次要动 dotenvx 密文 + 5 处文档 = 改部署契约，该单独裁定 |
| prepush 的 SKIP | **改成第四态**（退出码 3 + 汇总单列「跳过（未验证）」+ PREPUSH_STRICT=1 才判红） | 现状 SKIP 与 PASS 在输出与退出码上完全同形（lint-workflows.ts:23-27 返回 0 + prepush 只回放失败输出），等于把未验证说成通过；默认不判红是为了不误伤没装 actionlint 的开发机 |
~~~

### E.4 风险

- 07 / 08 改动量较大（各 3 处 + 2 个结论块），**一次改完再跑 pnpm build:docs**，避免中间态被
  构建门禁抓到死链。
- index.md:59-64 的目标态目录树是**四空格缩进块**，改它别顺手换成围栏（会触发 lint:doc-ts 的
  语言标注要求）。
- 本批**不碰** apps/docs/.../adr/0007 正文（追记已完整）；也不碰 backend/modules/*、
  shared/device.md、monorepo/*、review/*、plans/* —— 那是 8115d477 刚改过的一批，本批再改同一批文件
  会让「哪一笔引入的问题」难以定位（data-scope 两处计划的段数除外，见 C.5）。

---

## 1. 明确不做（含理由）

| 不做 | 理由 |
|---|---|
| 不改 github/gitee.controller.ts:114 的 @ApiOkResponse description（sse/{fp}） | 它是**装饰器**（实测进 openapi.json:4097/4257），改它必须重跑 openapi:export + schema.d.ts；而且它没有事实错误（路由段字面就是 sse/:fp，见 github.controller.ts:243，:210 已注明 URL 段不参与键）。记 P3 |
| 不重跑 openapi:export / 不重生成 schema.d.ts | 本批所有改动都是注释 / 私有方法 JSDoc / 测试名 / 文档（A.3 已证 openapi.json 里「指纹」与 getDeviceIdByFingerprint 均 0 命中） |
| 不动 DEVICE_ID_ENCRYPTION_KEY（env / validation / process.d.ts / 5-key 名单） | 部署契约；B5 后虽无代码读者，但退役要动 dotenvx 密文 + 5 处文档 + 把「5 个」变「4 个」，属可逆性差的一类 → 记入确认单 §2 留档（D.3 / D.4） |
| 不把 db:seed:verify 塞进 prepush / CI / 发版电池 | 会 DROP 两个固定库名 + 分钟级 + 每次 push（B.2） |
| 不删 reports/** 的历史报告、不改它们的旧语义 | 冻结语料。唯一例外：NEEDS-CONFIRMATION.md 是**活清单**，本批要改（E.3） |
| 不改 adr/0007 正文 | 2026-11-03 追记已经完整写了「搬迁被实测否决 + 触发条件」；只在 07 的修订记里**指向**它 |
| 不改 gate-wiring.test.ts:276 的「11 段」 | 历史叙述（「有过一次……的历史（第 16 批拆掉的）」），可被 git 历史证伪，且它支撑「根脚本不许出现连接子」这条判据（C.5） |
| 不改 reference-repo-comparison.md:180 / ci-cd.md:149 / check-source-secrets.ts:8 / adr/0020:125 / 10-implementation-plan.md:277,315,316 里的段数 | 全是**带日期的事故 / 执行记录**，不是当前断言 |
| 不把 sse/:fp 路由改成 sse/:deviceId | apps/admin 仍按设备 id 拼这一段（github.controller.ts:210），改名是 wire 契约变更 |
| 不删 X-Fingerprint 请求头链路 | 指纹仍是风控特征（device.service.ts 与 risk 采集都在用），只是不再派生身份 |
| 不在本批做 platform-node 的 P1 实施 | 28 库搬迁 + 新构建流水线 = L，且它正是 C4 要用户拍板的东西 |

---

## 2. 提交切分（scope 合法性：packages/tooling/commitlint-config/index.ts:2-27 的白名单）

合法 scope 只有：admin / server / docs / utils / contract / types / client / http / eslint-config /
commitlint-config / tooling / docker / deploy / pnpm / release。
注意 release **只给发版记账**（chore(release): vX.Y.Z）；改 packages/tooling/release/** 的代码走
**tooling**（该文件 :23-26 的注释明确写了这条）。

| # | 提交 | 含哪些改动 | scope | 为什么同一批 |
|---|---|---|---|---|
| 1 | refactor(server): 删设备指纹派生的死代码（getDeviceIdByFingerprint / hashDeviceFingerprint） | D.1 的 2 个源文件 3 处 | server | 单一意图「删死代码」，且必须在 14-A 之前（D.5） |
| 2 | fix(server): 设备身份注释对齐 B5 —— 签发点唯一、指纹不再派生 | A.4.1 / A.4.3 / A.4.4 / A.4.5 / A.4.6 / A.4.7 + 新增 device-issuance.drift.spec.ts | server | 全是文案 + 一条防腐断言；**不含生成物**，不需要 openapi 段一起跑 |
| 3 | chore(tooling): prepush 把 SKIP 变成第四态，并去掉推送提示里会腐烂的段数 | C.2 的 6 个源文件 + 2 个用例文件；C.4 的 steps.ts:405 + 防腐测试 | tooling | 两件事都改 steps.ts 与「推送者看到什么」；拆两个 commit 会让同一文件被连着改两次（若 Lead 要拆：**先措辞、后语义**） |
| 4 | chore(tooling): check-seed 的「由 db:seed:verify 兜」改成判据式 | B.3（+ 可选 B.4 的 seedInputsTouched 与单测） | tooling | 只碰 packages/tooling/scripts/** |
| 5 | docs(docs): 报告自洽 —— D4 的实测否决写进 index/06/07/08/09 | E.1 的 12 处（5 个 md） | docs | 报告是一份交付物，读者顺着 index 读；半改比不改更糟 |
| 6 | docs(docs): 去掉两处会腐烂的 prepush 段数（data-scope 计划） | C.5 的两处活文档 | docs | 与 #3 同一判据，但不同目录，分开放便于回滚 |
| 7 | docs(docs): 确认单追加 C4（platform-node P1/P2）+ C2 结案 | E.3 | docs | NEEDS-CONFIRMATION.md 是活清单；历史提交都走 docs(docs)（bf3c1c1d、dfdaf4e7） |
| 8 | docs(docs): 归档批次 14 R1 调研报告 | 本文件 | docs | 与历史一致 |

**基线**：全部建在 8115d477 之上（批次 13 的文档对齐已在那里）。本报告是最新未跟踪文件，
落到 #8 那个 commit 里。提交前先 git status 对一遍清单，**用路径显式 git add**，不要 git add -A。

---

## 3. 给 Lead 的摘要（每条一句 + 最容易被做错的一处）

1. **14-A**：9 处注释类旧事实要改（4 确凿 + 1 同源 + 4 同族）；generateDeviceId 生产调用点**实测 1 处**
   （device.service.ts:108），其余全是 spec/夹具。github/gitee.controller.ts:69 确认是**私有方法
   JSDoc**，openapi.json 里「指纹」/getDeviceIdByFingerprint **零命中** ⇒ **不用重跑
   openapi:export**。判据：有时间锚＝历史解释（留），没锚＝现状断言（改）。顺手发现两处同族：
   device.api-spec.ts:21 与两个 it 标题仍在讲「按指纹幂等」。
2. **14-B**：db:seed:verify **没有任何自动门禁在跑**（workflow / lefthook / prepush / 发版电池
   四处全空）。推荐保持出闸；check-seed.ts:17 的「由它兜」是误导，必须改成「手动命令 + 什么时候
   必须跑」的判据式。不推荐进 prepush：它会 DROP 两个固定库名、分钟级、每次 push。
3. **14-C**：SKIP 现在**与 PASS 完全同形**（子进程 exit 0 + prepush 只在失败时回放输出）⇒
   推送者与发版者都会以为验过了。推荐第四态：退出码 3 + 汇总单列「跳过（未验证）」+
   PREPUSH_STRICT=1 才判红。段数「11 段」（实为 26）改成判据式 + 一条防腐测试；
   gate-wiring.test.ts:276 的「11 段」是历史叙述，**留**。
4. **14-D**：两函数**零 spec 消费者**（任务书的「spec 引用」不成立），删除面 = 2 文件 3 处 +
   构造器 1 参；knip 无基线不用动。crypto.deviceIdKey 会悬空但保留（与 env 绑定）。
   DEVICE_ID_ENCRYPTION_KEY **已无加解密消费者**（从没加密过数据，只做过单向 HMAC 盐；
   migration 的 pre-step 又把旧 64-hex 行全删了）—— 但它是部署契约，本批**保留 + 改三处文档
   措辞**，退役另案。
5. **14-E**：报告 12 处自相矛盾（index 6 处 / 07 两处 / 08 两处 / 06 一处 / 09 一处），全部按
   「2026-11-02 决定建 → 2026-11-03 实测否决 → 现状 P2、P1 待拍板」的时间线改写；
   NEEDS-CONFIRMATION.md 追加 **C4**（platform-node P1/P2，推荐 P2）并给 C2 结案。
6. **顺序**：先 14-D（删代码）→ 再 14-A（改文案 + drift spec）。反了会在同一段文字上改两遍。
7. **最容易被做错的一处**：14-C 的退出码 3 —— 只改 prepush 而**漏改发版电池**
   （packages/tooling/release/src/release/steps.ts:190-199），会让没装 actionlint 的发版机
   因为退出码 3 直接失败。这是本批唯一「改对了功能、却引入回归」的路径。
8. 次容易错两处：14-E 把 D4 写成「当初没决定建」（用户明确要求保留决策的历史性）；
   14-A 顺手改了 @ApiOkResponse 的 description（那会把本批变成「改生成物」批）。
