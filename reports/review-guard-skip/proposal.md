# I5 · 接口 × GUARD 矩阵的文档化方案（可行性 + 最小实现路径）

> **配套报告**：[matrix.md](./matrix.md)（穷举矩阵与判定，本文件只讲「怎么自动化」）。
> **约束（来自任务与仓库纪律）**：本轮**只读**，不改源码；方案必须能接进 `pnpm openapi:export`
> 或作为**独立脚本**；不得让 `openapi.json` 的 diff 变成每次提交都抖动的噪声；不得引入新依赖（catalog 纪律）。

---

## 0. 一句话结论

**可行，而且基建已经有一半**：`apps/api/src/common/swagger/swagger.document.ts` 已经在「容器装配完成后遍历全部
controller/handler，用与运行时相同的 `Reflector.getAllAndOverride` 读 guard 元数据，然后写进 OpenAPI」——
它现在只读了 2 个键（JwtFree / JwtOptional），把它扩到 8 个键就是完整矩阵（方案 A）；
但那 6 个键**当前是模块私有 Symbol、导不出来**（见 §2），所以真正的第一步是「导出 6 个 Symbol」这种零行为改动。
若不接受 openapi.json 全量重排，则走方案 B（独立脚本生成文档页，零 diff 风险）。

---

## 1. 三种落点与取舍

| 维度 | A. 写进 OpenAPI（`x-walnut-guards` + description） | B. 独立生成文档页（matrix.md / docs 页） | C. 只做机械门禁（skip allowlist） |
|---|---|---|---|
| 读者 | Scalar / 任何 OpenAPI 消费方 / 代码生成 | 人（review、值班、新人） | CI |
| 机器可读 | ✅（扩展字段） | ✅（同时出 JSON） | — |
| 改动面 | `swagger.document.ts` + 6 个 Symbol 导出；`openapi.json` **全量重排一次** | 新增 `apps/cli/src/export-guard-matrix.ts` + 生成物 | 新增一条 lint/script + 白名单 |
| 漂移风险 | 低（与运行时同源读法） | 中（生成物需 `git diff --exit-code` 守） | 无（直接拦源） |
| 成本 | M（1–2 人日 + 一次 195 op diff 的评审） | S（0.5–1 人日） | S（0.5 人日） |
| 判据（怎么算做完） | 195 op 全带 `x-walnut-guards`；随源码改动而变；`openapi:check` 绿 | 重跑脚本 0 diff；页面上 30 个多 skip 端点逐条可见 | 新增一个未登记 skip ⇒ CI 红 |

**推荐顺序：C → B → A**（C 先防回归；B 补人读；A 才有机器可读契约）。理由：C 是唯一能**防新增裸奔端点**的，
且成本最低；B 无副作用；A 的收益（第三方/生成器能读）在本仓目前没有消费者。

---

## 2. 关键实现障碍（先看清楚再动手）

**6 个 skip 键是模块私有 `const ... = Symbol(...)`，没有 `export`**，所以 swagger 组装点（以及任何独立脚本）
**拿不到**它们，无法 `Reflector.get` 读：

| 键 | 定义处 | 是否导出 |
|---|---|---|
| `WalnutAdminConstDecoratorIpFreeKey` | libs/guards/src/guards/ip.guard.ts:6 | ❌ |
| `WalnutAdminConstDecoratorDeviceFreeKey` | device.guard.ts:18 | ❌ |
| `WalnutAdminConstDecoratorCapFreeKey` | cap.guard.ts:23 | ❌ |
| `WalnutAdminConstDecoratorSignFreeKey` | sign.guard.ts:21 | ❌ |
| `WalnutAdminConstDecoratorLockKey`（`…LOCK_FREE`） | lock.guard.ts:17 | ❌ |
| `WalnutAdminConstDecoratorMFAKey`（`…MFA_FREE`） | mfa.guard.ts:10 | ❌ |
| `WalnutAdminConstDecoratorJwtFreeKey` / `…JwtOptionalKey` | libs/auth/src/modules/jwt/jwt-access.guard.ts:10,20 | ✅（已导出，正因为如此 bearer 注入才做得到） |

⇒ **步骤 0（所有方案共用）**：把上面 6 个 Symbol 改成 `export const`（**纯增量，零行为变化**，不改任何 guard 逻辑），
并在 `libs/guards/src/index.ts` 具名导出。这条改动没有安全影响（Symbol 本身不是凭据），但它是 A/B/C 的前置。

> 备选（不推荐）：通过 `Reflect.getMetadataKeys(handler)` 反查 —— 只能拿到 Symbol 的 `description` 字符串
> （如 `'WALNUT_ADMIN_CONST_DECORATOR_SIGN_FREE'`），再 `Reflect.getMetadata(key)`。可行但**脆弱**（字符串成了隐式契约），
> 只在「绝对不能改 libs」时才用。

---

## 3. 方案 A：扩展现有 swagger 组装点（推荐在 C/B 之后做）

### 3.1 落点

新增 `apps/api/src/common/swagger/swagger.guard-facts.ts`，导出 `applySwaggerGuardFacts(app)`；
在 `createSwaggerDocument()` 里**紧跟** `applySwaggerBearerAuth(app)` 之后调用（swagger.document.ts:124-127）：

```ts
// (1) 事实收集：容器装配完成后，用与运行时同一种读法取出每个 handler 的 guard 事实
//     落点 apps/api/src/common/swagger/swagger.guard-facts.ts
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
// 步骤 0 之后这些 Symbol 才可导入（现在只有 JwtFree/JwtOptional 可导入）
import { WalnutAdminConstDecoratorCapFreeKey, WalnutAdminConstDecoratorDeviceFreeKey,
  WalnutAdminConstDecoratorIpFreeKey, WalnutAdminConstDecoratorLockKey,
  WalnutAdminConstDecoratorMFAKey, WalnutAdminConstDecoratorSignFreeKey } from '@walnut-server/guards'
import { WalnutAdminConstDecoratorJwtFreeKey, WalnutAdminConstDecoratorJwtOptionalKey } from '@walnut-server/auth'

const SKIP = { ip: WalnutAdminConstDecoratorIpFreeKey, device: WalnutAdminConstDecoratorDeviceFreeKey,
  cap: WalnutAdminConstDecoratorCapFreeKey, sign: WalnutAdminConstDecoratorSignFreeKey,
  mfa: WalnutAdminConstDecoratorMFAKey, lock: WalnutAdminConstDecoratorLockKey } as const

/** key = operationId（Nest 默认 `<Class>_<handler>`，本仓实测 195/195 可解析） */
export function collectGuardFacts(app: INestApplication): Map<string, GuardFacts> {
  const reflector = app.get(Reflector)
  const discovery = app.get(DiscoveryService)
  const scanner = app.get(MetadataScanner)
  const facts = new Map<string, GuardFacts>()
  for (const w of discovery.getControllers()) {
    const metatype = w.metatype as Type | null
    if (!metatype?.prototype) continue
    for (const methodKey of scanner.getAllMethodNames(metatype.prototype as object)) {
      const handler = (metatype.prototype as Record<string, unknown>)[methodKey]
      if (typeof handler !== 'function') continue
      // 与守卫完全同一种读法：方法级覆盖类级
      const skip = (k: symbol) => reflector.getAllAndOverride<boolean>(k, [handler, metatype]) === true
      facts.set(`${metatype.name}_${methodKey}`, {
        ip: !skip(SKIP.ip), device: !skip(SKIP.device), cap: !skip(SKIP.cap), sign: !skip(SKIP.sign),
        mfa: !skip(SKIP.mfa), lock: !skip(SKIP.lock), security: true, risk: true, throttle: true,
        jwt: skip(WalnutAdminConstDecoratorJwtFreeKey) ? 'free'
          : skip(WalnutAdminConstDecoratorJwtOptionalKey) ? 'optional' : 'required',
      })
    }
  }
  return facts
}

// (2) 落到文档：createDocument **之后**按 operationId 原地改写（避免算路由前缀/版本）
export function applySwaggerGuardFacts(app: INestApplication, doc: OpenAPIObject): number {
  const facts = collectGuardFacts(app)
  let touched = 0
  for (const pathItem of Object.values(doc.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.includes(method)) continue
      const f = facts.get(op.operationId!)
      if (!f) continue                        // 拿不到就跳过（不猜）
      op['x-walnut-guards'] = { ...f, skips: skippedOf(f) }
      op.description = [op.description, renderLine(f)].filter(Boolean).join('\n\n')
      touched++
    }
  }
  return touched
}

// (3) 唯一组装点（swagger.document.ts:124-128 改成两段式）
export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  applySwaggerBearerAuth(app)                       // 现有：只表达 JWT
  const doc = SwaggerModule.createDocument(app, buildSwaggerDocumentOptions())
  applySwaggerGuardFacts(app, doc)                  // 新增：7 个可跳 guard + 3 个恒在 guard
  return doc
}
```

### 3.2 写什么

1. **扩展字段（给机器）**：`operation['x-walnut-guards'] = {...}`。形状（键名固定、布尔含义统一为「是否强制」）：

```jsonc
{
  "x-walnut-guards": {
    "ip": true, "device": true, "cap": true, "security": true, "risk": true,
    "jwt": "free", "mfa": true, "sign": true, "lock": true, "throttle": true,
    "skips": ["jwt"]
  }
}
```

2. **description 追加一行（给人 / Scalar 直接可见）**：ASCII 单行，避免宽度与 i18n 问题：

```text
Security chain: IP[on] Security[on] Device[on] Risk[on] CAP[on] JWT[on] MFA[on] Sign[on] Lock[on] Throttle[on] — skipped: JWT
Security chain: IP[on] Security[on] Device[off] Risk[on] CAP[on] JWT[off] MFA[on] Sign[off] Lock[on] Throttle[on] — skipped: Device, JWT, Sign
```

3. **不要**动 `security`：它已被 bearer 注入占用且语义是「凭据」，7 个 guard 里有 4 个与凭据无关
   （Device/CAP/Sign/Lock 用的是 Cookie），硬塞进 `security` 会让第三方工具误以为要填 4 个凭据。

### 3.2.1 为什么用 `operationId` 做 join（而不是算路由）

Nest 默认把 operationId 设为 `<ControllerClassName>_<methodName>`，本轮脚本用这个键**解析 195/195 个
operation 全部命中、0 个未解析**（见 matrix.md §3 的统计），所以不需要复算 `APP_API_PREFIX` / 版本前缀 /
controller 前缀拼接 —— 那是 `openapi.json` 里唯一容易算错的部分（本仓 paths 是去掉 `/w/v1` 前缀的形态，
见 api-catalog.md:13-21）。

> ⚠️ 前提：一旦有 controller 方法重名或嵌套控制器，operationId 可能不再是 `Class_method`。本仓当前没有
> 这种情况（195/195 命中即证据）；实施时加一条断言：**未命中的 operation 必须为 0**，否则红。
### 3.3 确定性与门禁

- 遍历顺序沿用 `discoveryService.getControllers()`（与 bearer 注入同一循环），JSON 键序固定 ⇒ 同输入同输出。
- 生成物进 `apps/server/openapi.json`（check-in）⇒ **第一次会全量重排 195 个 operation**（多一个 description 行 +
  一个扩展字段）。之后由 `pnpm openapi:check`（apps/server/package.json:38-40）与 prepush 的 `openapi` 段
  （prepush.ts:162-184）守住。
- 风险：prepush 的 `openapi` 段**会重写工作区**（prepush.ts:181-183）；实施时要单开一条提交，别和其他改动混。

### 3.4 成本

S–M：Symbol 导出（0.5h）+ guard-facts 文件（2–3h）+ 首轮 openapi 重导出与评审（1h）+ 单测（1h，断言「无 Free 的
handler 其 `jwt==='required'`」与「`preference/read` 的 jwt==='optional'`」）。

---

## 4. 方案 B：独立脚本 → 文档页（零 openapi diff）

### 4.1 落点

新增 `apps/server/apps/cli/src/export-guard-matrix.ts`（与 `export-openapi.ts` 同款引导：
`NestFactory.create(AppModule)` → `await app.init()` → 遍历 → 输出），由 `apps/server/package.json` 加一条
`guard:matrix` 脚本；产物两件：

1. `reports/guard-matrix.md`（人读；含 matrix.md §3 那三张表）
2. `reports/guard-matrix.json`（机读；CI 可 diff）

### 4.2 为什么不直接进 docs 站

`apps/docs/src/zh-CN/content/**` 下的页面要过三道闸：sidebar 登记（apps/docs/AGENTS.md 约定 3）、
死链校验（`pnpm build:docs`）、`pnpm lint:docs-refs`。矩阵是**会随代码变**的生成物，放进常驻文档区会持续制造 diff
与门禁噪音；更合适的位置是 `reports/`（本轮 review 的产物就都在这里）或 docs 的 **archive/as-of** 区。
若要进 docs，必须先决定「谁是它的更新责任人」，否则第二次就烂（本仓对此有明确纪律：见 docs/AGENTS.md 约定 8）。

### 4.3 漂移门禁

`pnpm guard:matrix && git diff --exit-code -- reports/guard-matrix.*` —— 与 `openapi:check` 同款二段跳
（生成 → diff）。可选：只在 CI 跑（不阻塞 prepush），因为它是文档不是契约。

### 4.4 成本

S：脚本 2–3h（可选复用方案 A 的 facts 函数，避免两套读法漂移）+ CI 接线 0.5h。

---

## 5. 方案 C：skip allowlist 门禁（最先做）

### 5.1 判据

**每个 handler 上的每个 skip 键，必须在白名单里有一条登记（端点 + 键 + 理由 + 复核人/日期）；未登记 ⇒ 门禁红。**
白名单是数据文件（`packages/tooling/scripts/src/ci/guard-skip-allowlist.ts` 或 `apps/server/guard-skip.allowlist.json`），
不是散文。

### 5.2 为什么它最值

- 它拦的是**新增**的裸奔端点（本次发现的 4 个 6-skip 端点是历史遗留，一次性登记即可；
  但下一次有人图省事加 4 个 Free，就会被迫写理由）。
- 实现可以完全不依赖 Nest 运行时：直接用 TypeScript AST 扫 `*.controller.ts`（本报告用的就是这条路，脚本见 §7），
  不需要引导 AppModule、不需要 PG/Redis。
- 可与 「skip 数 ≥ N 必须登记」组合：**N=3 时只需登记 30 条中真正危险的子集**，维护成本可控。

### 5.3 成本与判据

S（0.5 人日）：AST 扫描 40 行 + 比对 30 行 + 失败信息打印「文件:行 + 端点 + 未登记的键」。
判据：给任意 controller 方法临时加 `WalnutAdminGuardSignFree()` 而不登记 ⇒ 门禁红且报出该行；删掉即绿。

---

## 6. 推荐路线与验收

| 步 | 做什么 | 判据 | 成本 | 依赖 |
|---|---|---|---|---|
| 0 | 导出 6 个 Symbol（§2） | `pnpm types:check` / `lint` 绿；无行为变化 | 0.5h | — |
| 1 | **方案 C**：AST + allowlist 门禁，接进 prepush / CI | 注入测试红、移除即绿 | 0.5d | 0 |
| 2 | **方案 B**：`guard:matrix` 脚本 + `reports/guard-matrix.*` | 重跑 0 diff；30 个多 skip 端点逐条可查 | 0.5–1d | 0 |
| 3 | **方案 A**：`x-walnut-guards` + description 行 | 195/195 op 带扩展；`openapi:check` 绿 | 1–2d | 0 |

> 推荐只做到 **1 + 2**；方案 A 等「有第三方/生成器消费 OpenAPI」的真实需求再开（与本仓「不为假设的需求付成本」的口径一致）。

---

## 7. 附：本报告实际用过的扫描逻辑（可复现，证明 B/C 可行）

```js
const ts = require('typescript')
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const getDecs = (n) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) ?? [] : [])
const nameOf = (d) => { const e = d.expression; const c = ts.isCallExpression(e) ? e.expression : e
  return ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '?' }

sf.forEachChild((node) => {
  if (!ts.isClassDeclaration(node)) return
  const classDecs = getDecs(node).map(nameOf)              // ← 类级 skip（对整类生效）
  for (const m of node.members) {
    const decs = getDecs(m).map(nameOf)                    // ← 方法级 skip
    const http = decs.find((n) => ['Get','Post','Put','Patch','Delete'].includes(n))
    if (!http) continue                                   // CRUD 工厂方法没有 verb 装饰器，但它仍带 HasPermission
    const line = sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1
    // 与 getAllAndOverride 等价：方法级命中即用，否则回落类级
    report.push({ file, line, handler: m.name?.getText(sf), http,
      skips: [...new Set([...decoratorsFilter(classDecs), ...decoratorsFilter(decs)])] })
  }
})
```

> 说明：上面这段是**去掉输出细节**的核心逻辑（本轮实际脚本含 openapi 对账与统计，跑完即删）。
> 它证明：不引导 Nest 容器也能拿到「端点 × skip」全矩阵 —— 所以方案 C 与 B 都不需要 PG/Redis 在线。

---

## 8. 需要 Lead 拍板

**本文件的拍板项与 [matrix.md](./matrix.md) §9 是同一组**，其中与本方案直接相关的是 **Q6（文档化落哪一层）**：

- a) 只做 C（门禁）；b) C + B；c) C + B + A（全量）；
- **推荐 b**：C 防回归、B 给人看；A 的机器可读收益当前没有消费者，且会让 `openapi.json` 全量重排一次。
