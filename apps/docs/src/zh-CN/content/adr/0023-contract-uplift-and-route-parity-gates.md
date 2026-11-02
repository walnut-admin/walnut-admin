# ADR-0023: 契约上收与路由常量 parity 门禁

**Date:** 2026-11-02
**Status:** Accepted

## Context

跨端契约物此前散落两端：force-quit 策略、user-lock、preference、MFA 类型与 roleMode 各自维护
一份副本；SSE / socket 的 wire 形状只存在于 server，管理端靠手写类型跟随。`@walnut/contract`
新增一个公共模块需要三处手工同步（`src/<x>.ts`、`vite.config.ts` 的 build.lib entries、
`src/index.ts` 具名 barrel；`package.json` exports 为 `./*` 通配，由 entries 门禁机械校验），
漏 entries 曾不报错、只在消费时 404 —— 现由本 ADR 的 entries 门禁在测试期拦下。

路由常量同样停在纸面：`routes.ts` 的 70 个常量中 admin 侧仅消费 32 个，server 侧 47 个
controller 全部写裸字面量、0 处消费，剩余约 37 个全仓无引用 —— 常量与真实路由之间没有对账
手段，改一处前缀不会有人发现。

## Decision 1: 按值迁，不按库迁

跨端消费的值上收 `@walnut/contract`，server 的既有命名空间（`@walnut-server/const` 等）保留并
改为 re-export 壳，调用点 import 面不变。U1 批新增 setting / mfa / user-lock / preference /
sse 五个模块，并扩展 socket（payload map），补齐 RoleMode 与 AppKeyTypeConst；`@walnut-server/*`
仍是内部 lib 命名空间（ADR 0007 的边界不变），只迁「值」，不把后端库提升为 workspace 包。

## Decision 2: entries 一致性 drift 门禁

`packages/platform-any/contract/__tests__/entries.drift.test.ts` 以 `src/` 公共模块为基准，断言
模块 ↔ vite build.lib entries ↔ `src/index.ts` 具名导出 ↔ `package.json` exports 子路径四处
全等，并禁止 barrel 使用 `export *`、禁止公共模块 default export。任何一处漏登记都从静默失败
变成测试红。

## Decision 3: 路由目录 parity 门禁

`apps/server/apps/api/src/common/monorepo/route-catalog.drift.spec.ts` 用纯 fs + 正则扫描
`apps/api/src/**` 与 `libs/<lib>/src/**` 的全部 controller：解析类级 `@Controller` 前缀与方法级
路由，按 Nest `route-path-factory` 的拼接规则算 fullPath，再与 `contract/routes.ts` 对账 ——
每条真实路由被 contract 值覆盖、每个 contract 值被真实路由锚定（反孤儿）、分组域名与全局唯一。
异常形态 fail-loudly，不静默跳过；另有篡改注入自测证明对账不是空转。收口后 `routes.ts`
从 70 个常量增至 123 个（新增 controller 前缀与方法级命名端点）。

## Decision 4: server 方法级路径保留相对字面量

controller 类级前缀全部改引用 contract 常量（47/47）；方法级路径仍写相对字面量（除根
controller 的 3 条绝对路由外）。原因是 Nest
的方法路径相对 controller 前缀解析，contract 中的方法级常量是绝对路径，硬塞会改变真实路由。
最终兜底是
`pnpm openapi:export` 的零 diff 门禁，而不是把常量硬塞进方法装饰器。

## Alternatives considered

- **维持两端各自实现 + 人工同步**：重复定义仍会漂移，entries 漏登记的失败仍是静默的。
- **把后端 lib 提升为 workspace 包统一放契约**：ADR 0007 已否决（CJS + 装饰器元数据 + SWC）。
- **方法级路径也换绝对常量**：会改变路由，openapi 零 diff 直接否决。

## Consequences

- 正面：force-quit 等策略只剩一个家，服务端新增策略时管理端类型检查 / contract 快照显式报红；
  contract 与 controller 的漂移在测试门禁中变红；admin 侧 58 处 API 字面量清零。
- 负面：contract 快照成为显式契约变更面，每次改值都要审 diff；server 方法级路径没有可安全复用
  的相对常量（contract 中的方法级常量均为绝对路径），只能靠相对字面量 + openapi 兜底。
- 中性：3 个常量（KEY_CURRENT / CAP_CHALLENGE / CAP_REDEEM）暂无直接消费，但被 parity 门禁
  锚定，保留不删；门禁有两处已知盲区（前缀常量同源自洽、`Group.KEY` 不校验 import 来源），
  已写在 spec 头注释。
