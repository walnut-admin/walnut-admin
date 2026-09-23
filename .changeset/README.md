# `.changeset/` —— 变更意图与消费台账

本目录由 **pnpm 原生 release management**（`pnpm change` / `pnpm version -r`）驱动，
**不是** `@changesets/cli`。版本策略的唯一真源是根 `pnpm-workspace.yaml` 的 `versioning` 段。

## 目录里有什么

| 文件 | 提交？ | 谁写 | 说明 |
|------|--------|------|------|
| `*.md`（意图） | ✅ 是 | `pnpm change`（由 `pnpm release` 经 `packages/tooling/release/src/release/generate.ts` 调用；也可以手写） | 一条变更意图：点名哪些包、各升哪一档、一句摘要 |
| `ledger.yaml` | ✅ 是 | `pnpm version -r` | **append-only 消费台账**：「哪些意图被哪个版本消费了」的唯一判据 |
| `README.md` | ✅ 是 | 人 | 本文件 |
| `.release-state.json` | ❌ 否（gitignored） | `pnpm release` | 续跑写前日志。只影响提示，丢了也不影响正确性 |
| `changelogs/` | ❌ 否（gitignored） | pnpm | changelog 寄存区，**只有 publish 时才有人读**，本仓不用；发版脚本消费完连目录一起清掉 |

## 意图格式

frontmatter 里是「包名: 档位」，档位取 `major` / `minor` / `patch` / `none`；`---` 之后是摘要。
一个意图可以点名多个包；**多包取最高档**。

```markdown
---
"@walnut/admin": minor
"@walnut/utils": patch
---

1a82770 ::: feat ::: admin: 支持记住登录状态
```

正文第一段的 `hash` 是**幂等键**：`pnpm release` 重跑时靠它认出「这条提交已经生成过意图」，
不会把同一个 commit 算两遍。

### 手写一个意图

```bash
pnpm change                                  # 交互式
pnpm change --bump patch --summary "修了 xx" @walnut/admin   # 非交互（脚本用）
pnpm change status                           # 看当前意图会产出什么发布计划
```

## 为什么 `ledger.yaml` 是判据而不是「文件还在不在」

`pnpm-workspace.yaml` 里 `versioning.changelog.storage: registry`（changelog 由 git-cliff 逐包写）。
在这个模式下 pnpm **不回收**已消费的意图文件 —— 回收要等 registry 确认该版本已带 changelog 发布，
而本仓的包全是 private、从不 publish ⇒ **永不回收**。

所以「文件还在」既可能是没消费、也可能是消费了但没删干净，**只有 ledger 能分辨**。
发版脚本消费完会主动收走已记账的意图文件（`packages/tooling/release/src/release/workspace.ts` 的 `deleteConsumedIntents()`），
不收的话每次发版都会堆一批并随 release commit 进仓库。

## 版本锁步

`pnpm-workspace.yaml` 的 `versioning.fixed` 是**单一组、全部 14 个包**：任何一条意图提及任何一个包，
整组就一起升到同一个新版本号，发布 tag `vX.Y.Z` 因此永远有唯一来源。

新增 workspace 包时**必须**把它加进 `versioning.fixed`，否则：

- `pnpm change check`（CI 与 pre-push 会跑）报锁步失败；
- `pnpm release` 第 1 步的 fixed 组审计（`packages/tooling/release/src/release/attribution.ts`）直接拒绝发版。
