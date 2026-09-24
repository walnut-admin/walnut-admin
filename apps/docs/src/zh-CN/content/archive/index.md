# 归档：设计 / 计划 / 评审

> 这里存放**带日期的过程文档**：某次重构的设计稿、实施计划、评审报告。
> 它们的价值是"当时怎么判断、怎么做的"，**其中的文件路径与结论可能已被后续演进取代** ——
> 读当前实现请走 [架构](/content/monorepo/) 与各专题文档。

## 已归档文档

**「归宿」列是本表的重点** —— 它回答「这篇里的结论现在还算数吗、该看哪篇」。
没有这一列时，**「未执行」与「已执行完毕」在表里长得一模一样**。

| 文档 | 类型 | 说明 | 归宿 |
|------|------|------|------|
| [2026-07-26 内部 lib 抽取建议](./2026-07-26-lib-extraction-recommendations.md) | 计划 | 从 `apps/api/src/{modules,common,decorators}` 向 `apps/server/libs/`（**内部 lib，不是 workspace 包**）抽取的 24 个候选、三档分级与推荐顺序 | ⏳ **未执行**，也无排期 → 结论仍有效，已登记为 [架构待办 A12](/content/monorepo/architecture-todo) |
| [2026-08-08 全容器化部署设计](./2026-08-08-dockerized-deployment-design.md) | 设计 | 前端/后端/Nginx 全容器化 + TCR + compose 的目标架构 | 🔀 **部分取代**：CI 章节看 [CI/CD 与容器构建](/content/monorepo/ci-cd)；镜像仓库 / compose / 证书 / 服务器初始化仍以本篇为准 |
| [2026-08-08 全容器化部署实施计划](./2026-08-08-dockerized-deployment-plan.md) | 计划 | 上述设计的 task-by-task 执行方案（含当时的本地验证与上线步骤） | ✅ **已执行**；操作细节已并入 [CI/CD 与容器构建](/content/monorepo/ci-cd) 与 `deploy/` |
| [2026-09-21 CI/CD 重构实施记录](./2026-09-21-ci-cd-pipeline-plan.md) | 计划 | 修复 5 周静默失效的 CI + 拆分流水线 + 薄镜像 + bake 缓存 scope 的完整改动清单、验证结果、回退方式 | ✅ **已执行**；现行口径见 [CI/CD 与容器构建](/content/monorepo/ci-cd) |
| [2026-09-21 架构 Review](./2026-09-21-architecture-review.md) | 评审 | 行业调研 × 工程实践的融合分析：机制提炼、边界与治理问题、优化建议，以及文档层级方案 | 🔀 **大部分已落地**（F 项已清零），未做的进 [架构待办](/content/monorepo/architecture-todo) 的未裁决段 |
| [2026-09-21 行业调研审计](./2026-09-21-industry-research-audit.md) | 评审 | 本地 20 篇调研/架构文档的逐篇审计、29 条第三方链接核实、55 条决策清单 | 🔀 **B 部分（时效性核实）大多已处理**；结论并入各 ADR 与专题页，别再单独引本篇 |
| [2026-09-24 架构待办的历史](./2026-09-24-architecture-ledger-history.md) | 记录 | 从待办页搬出来的三块：逐批执行记录、已移出待办项的核实记录、一份已决的调研结论（原待办页 116 KB 里约九成是这些历史） | ✅ **历史文献，不再更新**；「还剩什么」看 [架构待办事项](/content/monorepo/architecture-todo)，现状看 [架构地图](/content/monorepo/architecture) |
| [2026-09-21 pnpm 12 迁移计划](./2026-09-21-pnpm12-and-hoist-migration-plan.md) | 计划 | pnpm 11 → 12.5.1 升级 + 依赖隔离/供应链防护设置的分阶段方案 | ✅ **已执行完毕**；现行配置见 [pnpm-workspace.yaml 详解](/content/monorepo/pnpm-workspace-config) |

## 归档约定

### 什么能进这里

- **已闭环**的过程文档：设计已实现、计划已执行、评审已有结论并且**结论已落到现行文档里**。
- ⚠️ **未闭环事项禁止只靠归档了事**：如果一篇里还有**开着的**待办，必须先把它们抽到
  [架构待办事项](/content/monorepo/architecture-todo) 或对应的现行文档，**才**能归档进这里。
  判据很直接 —— 归档区的读者不会去追一个「还在开着」的事项，那条待办就等于消失了。
  （本表「归宿」列标 ⏳ 的那一篇就是按这条处理的：**未执行**，所以它同时登记在待办表里。）

### 怎么写

- 文件名带日期，正文保留当时的写法（不追改），但**顶部加一段归档说明**，指出哪些结论已被取代、
  当前该看哪篇；**并且在本表登记「归宿」**。
- 新增过程文档时直接写在 `content/archive/`，并在
  [执行记录归档页](/content/archive/2026-09-24-architecture-ledger-history) 里登记一行。

### 历史落脚点（都已迁到本站）

- 仓库根 `docs/superpowers/` 与 `docs/reviews/`：2026-09-23 统一迁入本站，根 `docs/` 目录已移除。
- `apps/server/docs/`：只放过 `lib-extraction-recommendations.md` 一份，随归档迁入后该目录已空。
