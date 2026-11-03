# ADR-0013: Barrel Export Policy

**Date:** 2026-07-29
**Status:** Accepted

> 2026-11 修订（批次 4 · 决策 D8）：判据从「包入口一律做选择性桶」改成
> **「桶是否需要，取决于该包有没有真实消费者」**。修订的原因不是桶本身变坏了，
> 而是我们第一次把「桶」和「谁在消费它」分开量了一遍 —— 结果三个桶合计 99 个具名导出、
> 裸包名 import 站点 **0** 个。详见下面「2026-11 审计」。

## Context

The project needed a consistent policy on whether to use barrel files (`index.ts` re-exports). Barrel files are convenient for consumers but have well-documented downsides: they break tree-shaking, inflate bundle sizes by 30-70%, slow Vite dev server cold start by 2-4 seconds, and confuse bundlers' dependency analysis.

2026-11 复盘补上了当时缺的那一半事实：**桶的成本与收益都取决于「有没有人从桶里取东西」**。
当时四个 barrel 里只有一个真的有人走：

- `@walnut/client` / `@walnut/http` / `@walnut/utils` 三个桶的裸包名 import 站点是 **0**
  （`apps/admin` 与 `apps/server` 一律走子路径：`@walnut/client/persistent/storage/sync`、
  `@walnut/http/instance`、`@walnut/utils/sign-raw` …）。它们不是「公共 API 面」，
  而是**没有入口的 API 面**。
- 代价却是真的：`knip` 把桶里的导出一律当「公共 API」⇒ 同一批符号既报不出「谁在用」，
  也不许报「可以删」。批次 2 的 R3 实测把这个账算清了：**+114 条里 87% 落在 3 个 barrel 上，
  而这 3 个包入口的全仓 import 语句数 = 0**；99 个符号里 89 个是经深路径被真实消费的 ——
  不是死代码，是「入口没人走」被拆成 99 行。（数据记录见
  [monorepo/knip.md](../monorepo/knip.md) 与批次 2 报告。）
- 唯一的反例是 `@walnut/api-types`：它是 **78 个文件的唯一入口**（79 处裸包名 import），
  生成物的别名面必须一起演进（`X = components['schemas']['Y'] & { id: string }`）——
  这种「一次改、全体一起对齐」的价值只有桶给得了。同一个决策里它必须留着，
  正好构成判据的两端。

## Decision

**桶的必要性由「有没有真实消费者」决定，不由「这个包是不是库」决定。**

```text
该包有没有本仓之外的消费者（发布出去的包）？
├─ 有  → 必须有桶：那是仓外消费者唯一稳定的公共 API 面（本仓当前没有这种包）
└─ 没有 → 数裸包名 import 站点：
          ├─ > 0 → 保留桶（api-types：78 个文件的唯一入口）
          └─ = 0 → 删掉桶（client / http：桶里的符号一个都没人取）
```

三条配套规则不变：

1. **`export *` 永远不用**（包入口和应用代码都不用）。
2. **删桶要连 `exports["."]` 一起删**，否则 `exports` 指向一个不存在的文件 ——
   这一步由 `pnpm lint:exports`（`exports-target-exists` 不变量）机械拦。
3. **应用代码（`apps/*`）不用桶**（原决策保留，理由见下）。

### 判据是机械的、可重跑的

```bash
# 裸包名 import 站点数（0 = 这个桶没有消费者）
git grep -nE "from '@walnut/client'" -- ':!*.md' ':!pnpm-lock.yaml' | wc -l
```

### Rules

| Location | Barrel files? | Rule |
|----------|--------------|------|
| 包入口（`packages/*/src/index.ts`） | 取决于消费者 | 有仓外消费者 ⇒ 必须；只有仓内消费者 ⇒ 裸包名站点 > 0 才留 |
| 应用代码（`apps/*/`） | ❌ No barrels | Direct deep imports only; component entries follow the ADR-0017 `index.ts` + `index.vue` structure |
| `export *` wildcard | ❌ 永远不用 | Hides exports, breaks tree-shaking; legacy wildcard exports remain in `apps/admin/src` |

### 2026-11 审计（批次 4 · D8 的依据）

| 包 | 桶里的具名导出 | 裸包名 import 站点 | 走子路径的文件 | 裁决 |
|----|--------------|-------------------|--------------|------|
| `@walnut/client` | 54 | 0 | 95 | **删**（`src/index.ts` + `exports["."]`） |
| `@walnut/http` | 15 | 0 | 8 | **删**（同上） |
| `@walnut/api-types` | 58（生成别名） | **79 个文件**（`apps/admin/src` 78 + `apps/admin/types` 1） | 0 | **保留** —— 唯一入口 |
| `@walnut/contract` | 20 条 re-export 语句（`scripts/build-barrel.ts` 生成） | **162** | 122 | 保留 —— 真消费者在桶上 |
| `@walnut/utils` | 30 | 0 | 7 处 / 6 文件 | 未动 —— 不在 D8 清单里；**按本判据它是下一个候选**（见下） |
| `@walnut/types` | 15（四个模块的具名 re-export） | 0 | 39 | 未动 —— 同上，是候选（D6 之后它已是「只给前端」的包，判据与 api-types 不同） |

> **「三桶」的账**：决策书里写的 `client` / `http` / `ui` 是 2026-11 之前的 platform-web 三件套
> （ui 包已于批次 1 按决策 D1 删除）。所以这一批实际删的是剩下两个；`@walnut/utils` 的桶
> 同样 0 站点，但它不在该清单内，**改不改留待裁决** —— 不在本 ADR 里顺手做掉，是因为它
> 与 D7（把 16-30 个浏览器专用值下沉到 client）是同一个包的两处改动，混在一起会让
> 「删桶」这条结论失去单独的可验证性。

## Implementation

2026-07-29：4 个包获得选择性 barrel（`@walnut/contract` / `@walnut/utils` / `@walnut/client` /
`@walnut/axios`［今 `@walnut/http`］）。当时没有量「谁从桶里取东西」。

2026-11（批次 4 · D8）：按上面的判据删掉两个桶。

- `packages/platform-web/client/src/index.ts`（54 导出）删除，`package.json` 的
  `exports["."]` 一并删；子路径 `./*` 与 `./types/*` 保持不变 —— **admin 的 import 一行都不用改**
  （它本来就只走子路径）。
- `packages/platform-web/http/src/index.ts`（15 导出）删除，同上。
- 先决条件被机械核对过：删除前 `git grep -nE "from '@walnut/(client|http)'"` 在两个包上都是 0 站点。
- 副产物：`knip.config.ts` 里这两个包不再声明 `entry: ['src/index.ts']`（指向已删文件是配置错误），
  改为从 `exports` 的 `./*` 通配推导 —— 与 `packages/tooling/*` 同口径。

No app-level barrel files were created or modified.

## Alternatives considered

### 包入口（`packages/*/src/index.ts`）：`export *` 通配重导出

- **包入口改用 `export *` 通配重导出** —— 本文档未展开理由。

### 应用代码（`apps/*/`）：barrel 文件

- **应用代码改用 barrel 文件聚合后再导出** —— 本文档未展开理由。

### 2026-11 新增：三个 0 消费的桶**留着不删**（只登记为「已审计」）

- 保留的好处只有一条：万一将来有人想从桶里取东西，路径是现成的。
- 代价是持续的、而且**恰好落在门禁上**：`knip` 会把 99 个没人走的符号当公共 API（这正是
  「knip 更吵且吵错方向」的根因）；更糟的是**删文件不会报错** —— 一个只被桶引用的文件，
  在桶还活着的时候看起来「有人用」，删掉它 `tsc` 也不响（因为桶里的那一行仍在 import）。
- 判据的另一端（api-types 的 78 个文件）说明：桶的价值来自**消费者集中在它身上**这一事实，
  不是来自「它存在」。没有这个事实时，保留桶等于给死代码发一张长期通行证。

## Consequences

1. **有仓外消费者的包仍然用桶**：`import { ResponseBase } from '@walnut/contract'` 这种写法继续有效；
   本仓当前**没有**这种包（全 private），所以这条是留给将来发布出去的包的。
2. **`@walnut/api-types` 的桶是硬需求**：78 个文件靠它一次对齐生成别名；删了等于要求 78 个文件
   各自维护 `components['schemas'][…]` 的长表达式。
3. **删桶之后「公共 API 面」= 子路径**，所以 `exports` 的 `./*` 通配必须继续覆盖到每一个文件
   （写窄了会变成「文件在、解析不到」，`pnpm lint:exports` 的 `exports-glob-matches` 只能保住下限）。
4. **knip 的噪声面收窄**：三个桶里最吵的两个消失了；剩下 `contract`（生成 barrel）与
   `@walnut/utils`（0 站点、待裁决）两处仍是盲区。
5. **App code stays direct**: No barrel overhead in `apps/admin` or `apps/server`.
6. **`export *` is not fully eliminated:** `apps/admin/src` still contains a handful of `export *` sites
   (component entries like Form/Table/Tree use `index.ts` + `index.vue` per ADR-0017). The policy applies
   to package entries; ESLint can enforce this in app code if needed in the future.

## Related

- [ADR 0004](0004-direct-contract-consumption.md) — direct contract consumption, no wrapper layers
- [ADR 0006](0006-runtime-api-separation.md) — packages organized by runtime API dependency
