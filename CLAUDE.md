# CLAUDE.md

本仓的 agent 指引**唯一真源**是 [`AGENTS.md`](./AGENTS.md)。下面这行是**文件导入**（不是让模型
「自己决定去读」的自然语言提示）：

@AGENTS.md

## 为什么这里只有一行导入

Claude Code 在 `CLAUDE.md` 与 `AGENTS.md` 同时存在时**默认只读 `CLAUDE.md`**（`AGENTS.md` 是
「没有 CLAUDE 文件时」的 fallback；原生支持需 v2.1.277+）—— 所以这行导入是 Claude Code 拿到
唯一真源的**唯一路径**，不能删。（想在 Claude Code 里两个都读，可在 `/config` → Project
instructions 选 `claude-md-and-agents-md`；官方文档说明即使那样也**不会重复读取**同一份内容。）

**不要往本文件追加规则** —— 要改指引请改同目录的 `AGENTS.md`；包级指引改各自的
`apps/*/AGENTS.md`（各目录下的 `CLAUDE.md` 同样只有一行导入）。

## 历史去哪了

本文件 2026-09-23 之前是一份 196 行的独立文档，与 `AGENTS.md` 内容重叠且已经漂移过。
它的「Current State」历史清单（2026-07-26 架构清理 / 2026-08-08 工具链加固 / 2026-09-21
CI-CD 重构 / 2026-09-23 发版与工具链拆分）已按「一个事实一个家」拆开：

- **决策与理由** → [`apps/docs/src/zh-CN/content/adr/`](./apps/docs/src/zh-CN/content/adr/)（ADR 0001-0019）
- **架构现状** → [`apps/docs/src/zh-CN/content/monorepo/`](./apps/docs/src/zh-CN/content/monorepo/)（10 篇）
- **逐批执行记录** → [`archive/2026-09-24-architecture-ledger-history.md`](./apps/docs/src/zh-CN/content/archive/2026-09-24-architecture-ledger-history.md)（2026-09-24 从待办页搬出来冻结）
- **仍然是待办的** → [`architecture-todo.md`](./apps/docs/src/zh-CN/content/monorepo/architecture-todo.md) 的 P0–P3 / 搁置 / 未裁决
- 更早的细节仍在 git 历史里（`git log -- CLAUDE.md`）。
