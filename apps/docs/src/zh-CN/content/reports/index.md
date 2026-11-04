# 工程记录

> **本区是「本轮（2026-11）架构收尾」的结论索引，不是流水账。**
> 每页只回答三件事：结论是什么、证据在哪、还差你拍什么板。过程日志不进文档站 ——
> 逐批原始报告在 `reports/batch-*/`，逐条证据在 `reports/NEEDS-CONFIRMATION.md`。

## 三页的分工

| 页 | 回答什么 |
|----|---------|
| 本页（总览） | 四个原始问题各自的答案落在哪一篇 |
| [需要拍板的](./decisions.md) | 只有你能定的那几条：背景 / 选项 / 推荐 / **现在按哪个做的** |
| [批次执行记录](./batches.md) | 每批的目标与读数，以及**复查轮挡下了什么**（最有价值的部分） |

## 四个原始问题 → 答案在哪

这轮是从四个问题起的。答案在实施途中被改过两次口径（一次是你纠正的「worker 没有部署面」表述，
一次是 `const` 单库 POC 把「后端基建下沉成平台包」判掉），所以下表给的是**现在生效的那一版**。
来源页都在 `content/industry-research/` 下 —— 那是**冻结语料**，记的是 2026-11-02 的口径，
本区不复制它们，只做索引。

| # | 原始问题 | 一句话结论 | 答案落在 |
|---|---------|-----------|---------|
| 1 | platform-any 的导出是不是都被消费了 | 三个包命运不同：`@walnut/contract` 站得住（运行时值双端率高）；`@walnut/utils` 实质是**浏览器密码学工具包**、`@walnut/types` 后端零消费 —— 后两个是负资产 | [09 的 01 篇重建](../industry-research/backend-architecture-review/09-research-summaries.md) · [index §一](../industry-research/backend-architecture-review/index.md) |
| 2 | 还有没有 mongo / mongoose 遗留 | 可执行代码已清零；但 list 入参仍是 Mongo `find(filter)` 的直系后代 —— 算子由值的 JS 类型隐式决定，可选槽位校验不生效，seed 真源还是 Mongo EJSON | [09 的 02 篇](../industry-research/backend-architecture-review/09-research-summaries.md) · [07 的 D2 / D5](../industry-research/backend-architecture-review/07-decisions.md) · [index §一](../industry-research/backend-architecture-review/index.md) |
| 3 | 只抽 platform-any / platform-web 有必要吗；后端基建能不能下沉 | 前者有必要（4 个 web 包差一个量级）；后者**被实测否决**：「零 import 改写」这个前提不成立，现状是不搬，恢复包边界只剩「两个包自建 CJS dist」一条路 —— 见 [需要拍板的](./decisions.md) | [07 的 D4](../industry-research/backend-architecture-review/07-decisions.md) · [10 §10.2](../industry-research/backend-architecture-review/10-implementation-plan.md) · [index §一](../industry-research/backend-architecture-review/index.md) |
| 4 | server libs 与 apps 三包还有优化空间吗 | 分层是真的（无向上层边、madge 无环、注册面与磁盘 `libs/` 全集由 drift spec 对账）；空间不在分层，而在结构债：注册面成本、cache 住域缓存、锁两套、worker 无生产面 | [index §一](../industry-research/backend-architecture-review/index.md) · [08 的阶段表](../industry-research/backend-architecture-review/08-recommended-plan.md) · [06 交叉复核](../industry-research/backend-architecture-review/06-cross-check.md) |

> 06 值得单独读一遍：它记的是**结论怎么被质疑、哪一条被推翻**（「`page` 半传必 500」不成立）、
> 以及哪一条被你纠正。没有这一页，其余几页看起来像是没经过反驳的。

> **「答案落在」那一列全是冻结语料**（2026-11-02 的口径），本区既不改写也不复制它们。结论在这之后被改过的
> 地方，以这三处为准：**待拍板**看 [需要拍板的](./decisions.md)，**逐批读数**看 [批次执行记录](./batches.md)，
> **还没关的架构债与位置判据**（测试目录怎么分、注册面由谁对账）看
> [架构待办事项](/content/monorepo/architecture-todo)。

**现状（2026-11-04）**：本晚最后一轮把 `C1` / `C3` 与两个 P2/P3（两套 ALS 并存、剩余注册面与孤儿模块守卫）
都做掉了，同时也把 `libs/delay`、门禁四态与按段预算收进「已彻底关闭」。**剩余的待拍板只有两条**
（`C4` / `C5`），仍开着的条目、判据与「测试目录约定」见
[架构待办事项](/content/monorepo/architecture-todo)。

## 与另外两处真源的关系

- **架构侧待办**（P0–P3 / 搁置 / 未裁决）的真源是 [架构待办事项](/content/monorepo/architecture-todo)；本区不复制条目，只写结论。
- **需要拍板的逐条证据**在 `reports/NEEDS-CONFIRMATION.md`（仓库路径，不在文档站内）；本区只给摘要 —— 见 [需要拍板的](./decisions.md)。
- **逐批原始证据**在 `reports/batch-*/`（含每轮的 R1 调研、R2 实施、R3 复查原文）；摘要见 [批次执行记录](./batches.md)。
