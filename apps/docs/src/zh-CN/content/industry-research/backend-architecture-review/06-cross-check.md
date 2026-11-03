# 06 · 交叉复核（Lead）

> 这份文件存在的意义是**让结论可以被质疑**。记录：我推翻的、被你纠正的、以及排序裁决。

---

## 一、我推翻的一条结论

### ❌ 「`page` 半传 ⇒ `OFFSET NaN` ⇒ 500」——**不成立**

原 02 报告称：`page` 槽位整体替换默认值不 merge（`common/default.ts:10-20`）+ 无 `Number.isFinite`
⇒ `{"page":{"pageSize":20}}` ⇒ OFFSET NaN ⇒ 500。

代码阅读对，但**漏看了 `object.transformer.ts:30-32`**：`obj !== Object` 时会加 `Type(() => obj)`，
`page` 先被实例化成 `WalnutAdminRequestListPageDTO`，其字段级 `Transform` 默认值会把缺失的 `page` 补成 1。

**实测**（Lead 跑 vitest）：

    PAGE_RESULT     {"page":1,"pageSize":20}
    BUILDER_RESULT  {"match":{},"sort":{"createdAt":"DESC"},"skip":0,"limit":20}

⇒ `skip=0`，**没有 NaN**。该条 P1 降级为「无害」。

---

## 二、你纠正我的一条（已采纳）

### ❌ 「worker 没有部署面能保证它起来」——表述不准

这句话让你合理地质疑「本地不能跑吗」。**你是对的**：

- `apps/server/package.json` 有 `start:worker` / `build:worker`
- `apps/worker/src/main.ts` 是完整 bootstrap（`createApplicationContext` + `enableShutdownHooks` + 打出 cron job 数量）
- 前提只有两个：cwd = `apps/server`、PG/Redis 在线 —— 你 WSL 里就有

**准确的表述**（已写进 07 的 D3）：
> 本地能跑；缺的是**生产编排**。`build/image/server/Dockerfile` 只有 api 的 CMD；
> `deploy/` 与 `.github/` 对 `worker` / `WORKER_STANDALONE` **0 命中**。
> 真实风险是「生产上没人启动它，且失败静默」——cron 与密钥轮换停摆而 api 照常 200。

这也让 D3=A 的语义变清楚：**不是「让它能跑」，而是「补齐生产面 + 让它跑得好」**。

---

## 三、排序裁决：「搬完再补门禁」行不行？

你问的是：搬走会丢 8 层 ESLint + 5 个注册面，**搬完之后再改造不就行了？**

**技术上完全可以，但顺序要反过来。** 依据是 `apps/server/eslint.config.ts:55-68` 的实测结构：

    function layer(name, libs, bannedLibs, layerLabel) {
      return { files: libs.map(lib => 'libs/' + lib + '/**/*.ts'), rules: { ... } }
    }

分层规则是**按路径**匹配的，而且 `libs/**` 还有一条 **fail-closed** 兜底
（未登记分层的 lib 禁止 import 任何 `@walnut-server/*`）。于是：

- lib 搬到 `packages/platform-node/...` 后，`files: libs/x/**` **不再匹配** ⇒ 该层规则**静默失效**
- fail-closed 兜底同样只匹配 `libs/**` ⇒ 一起失效
- **不会报错，不会红**，只是门禁没了 —— 这正是本仓已犯过数次的同一类错误（机制存在，但没人检查它是否生效）

**正确顺序**：先把 `files` 从 lib 清单**生成**（D14），验证 34 条规则仍逐条生效，**再**搬迁。
这样搬迁时门禁跟着走，中间没有静默窗口。代价只是把 D14 从「顺手做」提到「搬迁之前」。

---

## 四、口径差异（不是矛盾）

| 指标 | 数值差异 | 解释 |
|------|---------|------|
| contract 消费面 | 439 处 import 语句 / 252 个消费文件 | 单位不同（语句 vs 文件） |
| platform-web | 202 条导入 / 250 个导出 / 123 被消费 | 符号级；另两份报的是文件级 |
| 死导出 | 10（分母 109）/ 107（分母 250） | 分母不同：any 三包 vs web 四包 |
| libs 库数 | 34 | 我任务书写的 35 是错的，三路独立纠正 |

**交叉验证通过**：三条线对 `@walnut/ui`、`componentMap` P0、api-types 是生成物、
http/client 职责切分正确、`@walnut/types` 后端 0 消费 —— 判断完全一致，且方法各不相同。

---

## 五、没验证到的部分

| 项 | 状态 | 影响 |
|----|------|------|
| `pnpm build:admin` 全量是否通过 | 未跑（耗时 + 会写 dist） | 不影响结论：运行时字符串 import 与 build 成败无关 |
| platform-node 的 dist 布局是否变化 | **已实测（2026-11-03）：变了，且不可控** —— 产物逃出 `dist` / `stripLeadingPaths` 全局塌陷 / assets 连累 | D4 的直接搬迁因此作废，见 [10](./10-implementation-plan.md) §10.2 与 [07](./07-decisions.md) 的 D4 修订记 |
| seed 重建后的字节级等价 | 未验证 | D5 的验收必须含「新旧两套各灌空库、逐表 diff」 |
| admin 无测试 runner | 已确认 | 这是 P0 能漏过去的结构性原因 → D18 第 ③ 条 |
| 六份深度报告 | **已丢失** | 计数需按最终树重采 |

---

## 六、事故记录：reports/ 被删除

- 时间：2026-11-02 15:0x（六份报告写完之后）
- 现象：`reports/` 整棵目录消失
- 原因：未跟踪文件，**极可能是并行线执行了 `git clean -fd` 一类清理**（同期工作区改动数 13 → 218）
- 后果：六份深度报告（约 400KB、每份带 `path:line` 证据）**无法恢复**
- 处置：① 按会话内证据重建 00/06/07/08/09；② `git add` 纳入索引避免再次被清（撤销：`git reset reports`）；
  ③ 六份全文等树稳定后重出
