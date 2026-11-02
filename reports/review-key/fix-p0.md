# P0 止血实施报告（I3 报告的 ①②③）

> **轮次**：R2 实施轮（唯一授权范围：三件事）｜ **任务板**：task-3 后续（I3 调研轮 → 本轮实施）
> **基线**：HEAD `c8bea21a`，工作树里只有我的 4 个文件（其余 `reports/*` 是他人在途产出，未触碰）。
> **纪律**：未 `git commit`；未扩大范围（Q1/Q2/Q3/Q4/Q5/Q7 一律没动）；临时探针用完已删（仓库根曾落一个
> `.r2-keycheck.mjs`，跑完立即删除，`git status` 已确认无残留）。

---

## 0. 结论：**可以提交**

| # | 任务 | 状态 | 一句话证据 |
|---|------|------|-----------|
| ① | 补 `await` + 回归测试（改回旧写法必红） | ✅ | 旧写法 → `1 failed: expected null to be an instance of WalnutAdminExceptionRsaPubKeyNotFound`；还原 → 3/3 绿 |
| ② | 响应加密前显式判空 → 40012（不落 50000） | ✅ | `rsa.service.ts:47-49` 显式判空抛 `WalnutAdminExceptionRsaPubKeyNotFound`；全仓 `publicEncrypt` 只有 1 个调用点，已覆盖 |
| ③ | 错误屏加「重置本机密钥并重试」 | ✅ | `bootstrap.ts:203-229`（只在 `step === 'sign'` 出现）；复用 `@walnut/client` 的 `removeStorageItemsContaining`，实测只删两把密钥、不动其它 key |
| 门槛 | 验收门禁 | ✅ | 全仓 `types:check` 15/15、`lint` 15/15、server 单测 **80 文件 / 674 用例**、`boundaries` 无违规 |

---

## 1. 改动清单（3 改 + 1 新增，`git diff --stat` 实测 +48 / -3）

| 文件 | 位置 | 改了什么 | 为什么 |
|------|------|---------|--------|
| `apps/server/libs/cache/src/service/cache.rsa.ts` | `:20-26` | `const cached = **await** this.cacheService.get<string>(…)` + 6 行说明 | 缺 `await` 时 `cached` 是 Promise，`isNil(Promise)` 恒 false ⇒ 40012 永不触发；async 会把 Promise 采纳成返回值 ⇒ 缓存缺失时调用方拿到 `null` |
| `apps/server/libs/cache/src/service/cache.rsa.spec.ts`（新增 96 行） | 全文 | 3 条用例：缺失抛 40012 / 命中返回原 PEM 字符串 / 写入走 AUTH+30d TTL | 把「必须 await」变成可执行判据 |
| `apps/server/libs/rsa/src/rsa.service.ts` | `:44-49` | 取到客户端公钥后显式判空（空串也拦），抛 `WalnutAdminExceptionRsaPubKeyNotFound`；连带去掉 `:67` 的 `!` 断言 | 原来 `publicEncrypt({key:null})` 抛 TypeError → 全局兜底 **50000**，客户端没有 50000 分支 ⇒ 不能自愈。全仓 `publicEncrypt` 仅此 1 处（`git grep -n publicEncrypt` 只命中 import 行与方法内 1 行） |
| `apps/admin/src/App/src/bootstrap.ts` | `:2-3`（import）+ `:203-229`（按钮） | sign 步失败时错误屏多一个「重置本机密钥并重试」：清 `WA__RSA_PUBLIC_KEY`/`WA__RSA_PRIVATE_KEY` 后 `location.reload()` | `setupSign` 是 blocking 步，且只在「本地无密钥对」时才向服务端登记（`app-security.ts:114-122`）⇒ Redis 丢公钥后刷新永远重演同一幕 |

> 前端**没有**碰 Pinia store：`renderBootstrapFailure` 的设计原则是「纯 DOM、不碰 Vue」（文件内 `:150-155` 已写明），
> 而 reset 只需要删两个 localStorage key —— 直接复用 `@walnut/client` 已导出的
> `removeStorageItemsContaining(storage, substring)`（`packages/platform-web/client/src/persistent/shared.ts:13`），
> 不新造抽象。

---

## 2. 回归证明：「改回旧写法就红」的实测输出

判据设计：用例断言的是**异常类型 + 40012**，而旧写法下该方法**正常 resolve 出 `null`** ⇒ 必红。

### 2.1 新代码（绿）

```
$ cmd /c "pnpm --filter @walnut/server exec vitest run --config ./apps/api/vitest.config.ts libs/cache/src/service/cache.rsa.spec.ts"
 ✓ libs/cache/src/service/cache.rsa.spec.ts (3 tests) 6ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
### exit = 0
```

### 2.2 临时改回旧写法（红）

把 `cache.rsa.ts:26` 的 `await` 去掉后重跑（**这就是修复前的代码**）：

```
 ❯ libs/cache/src/service/cache.rsa.spec.ts (3 tests | 1 failed) 11ms
     × 缓存缺失 ⇒ 抛 40012（把 await 去掉本用例必红） 8ms
     ✓ 缓存命中 ⇒ 原样返回 PEM 字符串（不是 Promise 包装） 1ms
     ✓ 写入：AUTH 分类 + 30 天 TTL，键与读取同一形状 1ms

 FAIL  libs/cache/src/service/cache.rsa.spec.ts > … > 缓存缺失 ⇒ 抛 40012（把 await 去掉本用例必红）
AssertionError: expected null to be an instance of WalnutAdminExceptionRsaPubKeyNotFound
 ❯ libs/cache/src/service/cache.rsa.spec.ts:50:20
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
### exit = 1
```

> 注意失败信息正是 P0 的**原始症状**：`expected null` —— 调用方拿到 null 而不是异常。
> 另两条用例在旧写法下仍绿，说明用例集不是"全红兜底"，而是**精确钉住了 await 这一处**。

### 2.3 还原后（绿，与 2.1 一致）

```
 ✓ libs/cache/src/service/cache.rsa.spec.ts (3 tests) 7ms
 Test Files  1 passed (1) / Tests  3 passed (3)
### exit = 0
```

---

## 3. 前端「重置本机密钥」按钮：真实键名匹配实证

reset 走的是「按子串删 key」，因此必须证明**真实存储键**包含这个子串。用 Node 直跑
`@walnut/client` 的真实 `getStorageKey` + `removeStorageItemsContaining`（Node 24 原生类型剥离，无编译）：

```
$ node .r2-keycheck.mjs          # 临时探针，跑完已删
keys before: WA__RSA_PUBLIC_KEY, WA__RSA_PRIVATE_KEY, WA__LOCALE, WA__AUTH_SESSION_KEY
removed: WA__RSA_PUBLIC_KEY, WA__RSA_PRIVATE_KEY
keys after: WA__LOCALE, WA__AUTH_SESSION_KEY
### exit = 0
```

⇒ 前端的 `useAppStorageAsync` 用的是 `getStorageKey` 加 `WA__` 前缀（`persistent/shared.ts:3-5`），
按钮拿 `AppConstPersistKey.RSA_PUBLIC_KEY` / `AppConstPersistKey.RSA_PRIVATE_KEY` 两个子串去匹配，正好命中这两把，**不误伤** LOCALE / AUTH_SESSION_KEY。

生效链路：清 key → `location.reload()` → 下次启动 `setupSign` 发现本地无密钥对 → 重新生成并
`POST /security/sign/initial`（服务端此时已无缓存，会真写入）→ 之后 `aes-key` 正常。
按钮带 `data-walnut-error-action="reset-rsa-keys"`，便于将来冒烟脚本定位（与文件里既有的
`data-walnut-error-screen` 标记同风格）。

---

## 4. 门禁输出（全部本轮实跑）

| 门禁 | 命令 | 结果 |
|------|------|------|
| server 单测 | `cmd /c "pnpm --filter @walnut/server test"` | ✅ **80 文件 / 674 用例** 全过，54.91s（含新增 3 条） |
| server 类型 | `cmd /c "pnpm --filter @walnut/server types:check"` | ✅ exit 0（`tsc --noEmit --pretty`） |
| server lint | `cmd /c "pnpm --filter @walnut/server lint"` | ✅ exit 0 |
| 全仓类型 | `cmd /c "pnpm types:check"` | ✅ **15/15 successful**，24.1s（admin 走 `vue-tsc`） |
| 全仓 lint | `cmd /c "pnpm lint"` | ✅ **15/15 successful**，1m6s（13 cached） |
| admin 类型 | `cmd /c "pnpm --filter @walnut/admin types:check"` | ✅ exit 0（`pretypes:check` 重生成的 `components.d.ts`/`settings-dev.schema.json` **无 diff**） |
| admin lint | `cmd /c "pnpm --filter @walnut/admin lint"` | ✅ exit 0 |
| 架构边界 | `cmd /c "pnpm boundaries"` | ✅ `Checked 4646 files in 15 packages, no issues found` |

> 途中红过两次、都在我自己的新测试里，已修：① 直接跑 `vitest` 没带 server 的 config ⇒
> `@walnut-server/*` 解析不到（应带 `--config ./apps/api/vitest.config.ts`）；
> ② `vi.fn` 少声明第三个参数 ⇒ `mock.calls[0]` 是 2 元组，`tsc` 报 TS2352；
> ③ 修好后 `eslint` 报 `ts/no-unnecessary-type-assertion`（`setCalls[0]!` 的 `!` 多余）。

---

## 5. P0-2 的闭环：修完后那台"起不来"的机器怎么自己好

（静态推演，**未做端到端联调** —— 本机没有该场景所需的 PG/Redis 空库环境，见 §6）

1. `setupSign` → `POST /security/sign/aes-key`（sign-free）→ 服务端
   `SecuritySignService.getAesKey` 第一行现在会**真的** `await getRsaPubKeyCache`；
2. 服务端 Redis 无该 deviceId 的公钥 ⇒ 抛 40012（**修复前**：静默返回 null，继续走，直到
   `publicEncrypt(null)` → TypeError → **50000**）；
3. 全局过滤器把异常转成 **HTTP 200 + body.code = 40012**；
4. 客户端 `responseInterceptors` 命中 40012 分支（`interceptors/response/interceptor.ts:88-91`）
   → `SingletonPromiseRsaPubKeyNotFound` → `sendRsaPubKeyToServer(false)` 重新登记 → 重放原请求；
5. 重放时服务端已有公钥 ⇒ `aes-key` 正常返回信封 ⇒ 启动继续。

⇒ ① 把「不可识别的 50000」变成「可识别的 40012」，③ 给了一条**不依赖运气**的人工兜底
（万一自动链路还有别的岔子，用户点一下也能恢复）。② 是纵深：即使将来有人绕过 cache 层直接塞空串，
也不会再落 50000。

> **一处有意的行为变化（需要知道）**：sign guard `:102` 的 `await getRsaPubKeyCache` 现在对
> 「设备未登记公钥」的**已签名请求**会返回 40012（修复前会继续走到 40112/40113）。
> 正常流量不受影响：SPA 的第一条请求就是 `initial`（sign-free）先登记；e2e 的
> `api-client.ts:162` 也是先 `initial` 再 `aes-key`。受影响面只有"手工/第三方客户端跳过握手直接签名"。

---

## 6. 明确没做（等 Lead/用户拍板，本轮刻意不扩大）

Q1 请求体加密腿死活（删/接/标注）· Q2 `RSA_PAIR` 私钥明文落库 · Q3 掩码 URL 与轮换解耦 ·
Q4 轮换 grace · Q5 公钥响应元数据 · Q7 40112 拆码 —— 一处未动。

## 7. 回滚方式（如需）

`git checkout -- apps/server/libs/cache/src/service/cache.rsa.ts apps/server/libs/rsa/src/rsa.service.ts apps/admin/src/App/src/bootstrap.ts`
+ 删除 `apps/server/libs/cache/src/service/cache.rsa.spec.ts`（新增文件，无引用）。三处改动彼此独立，也可单独回滚。

## 8. 遗留与建议（不阻塞提交）

1. **端到端未跑**：本轮只跑了单测/类型/lint/边界。若要钉死 §5 的闭环，需要一条
   「清 Redis 的 `SECURITY_RSA_PUB_KEY:*` → 用已持密钥对的客户端启动 → 断言 40012 → 自动重登记成功」的 e2e，
   需要 PG + Redis（本轮环境没有）。
2. **sign guard / sign.service 的注释**现在与行为一致了（"确保已完成握手"/"should have rsa pubkey"），
   不必再改；但建议在下一次触碰这两个文件时，把注释里的「空转」历史补一句（避免读者以为它们还是 no-op）。
3. 错误屏里那句「后端没起、或 **Mongo** 是空库」（`bootstrap.ts:191`）是陈旧文案（PG 迁移后），
   属 I3 报告的 P3-7，本轮按"只做三件"未动。
