# 代码文档（compodoc）

> 后端代码的**结构视图**：模块图、provider 注入关系、类与方法清单、每个方法上挂了哪些装饰器。
> 它是本地的阅读工具，不是门禁，也不进文档站。

## 与另两种文档的分工

| 想回答的问题 | 看哪里 | 真源 |
|---|---|---|
| 某个接口吃什么、吐什么 | 开发模式下的 Scalar（`/api`）与 `apps/server/openapi.json` | controller 上的 Swagger 装饰器 + DTO，漂移由 `openapi:check` 守 |
| 分层怎么分、DTO 怎么写、事务怎么开 | 文档站「后端」各篇（[架构与模块结构](./architecture) 等） | 手写正文 |
| 这个模块由哪些类组成、谁注入了谁、方法上挂了哪些装饰器 | compodoc 产物（本文） | TypeScript AST，由 compodoc 自带的解析器读取 |

一句话：Swagger 是**接口面**，文档站是**规范面**，compodoc 是**代码结构面**。

## 生成与查看

在仓库根执行：

```bash
pnpm walnut gen:doc        # 只生成，产物落在 apps/server/.tmp/compodoc/
cd apps/server && pnpm gen:doc:serve  # 生成后起本地静态服务（常驻，Ctrl+C 退出）
```

在 `apps/server/` 下直接跑 `pnpm gen:doc` / `pnpm gen:doc:serve` 等价 —— 两条脚本定义在
`apps/server/package.json`，`compodoc` 是包 `@compodoc/compodoc` 的 bin 名（包名不能当命令用）。

生成完打开 `apps/server/.tmp/compodoc/index.html`；用 `gen:doc:serve` 时直接访问它打印的地址。
全量生成两三分钟、产物约 60 MB（2026-11-24 在本仓实测的口径，随代码规模增长）。
产物目录已被根 `.gitignore` 忽略，不进版本库，看完删掉即可。

两条脚本刻意分开：`gen:doc:serve` 会起服务并**阻塞**当前终端，所以命令表里只登记了 `gen:doc`。

## 三条已知的坑

1. **路由页是空的（或几乎为空）**。compodoc 只认字面量形式的路由路径；本仓 controller 的
   `@Controller(...)` 前缀全部是对 `@walnut/contract` 路由常量的引用（`Group.KEY`），它解析不了。
   所以产物里的路由栏没有参考价值 —— 路由的真源是 `apps/server/openapi.json` 与
   `apps/server/apps/api/test/architecture/route-catalog.drift.spec.ts`，不是 compodoc。

2. **JSON 导出缺 controllers 与 entities**。`-e json` 产出的文件名是 `documentation.json`，
   但其顶层只有 pipes / interfaces / injectables / guards / interceptors / classes / directives /
   components / modules / miscellaneous（外加 routes 与 coverage）—— controllers 与 entities
   从设计上就不在里面（上游 `export-json.engine.ts` 的实现，2.0.0 仍未修）。别把它当
   「后端结构的机器可读真源」来接工具。

3. **覆盖率统计的是代码注释，不是站点文档**。compodoc 的 coverage 页算的是「有多少成员带
   JSDoc」，而本仓的决策是**文档在文档站、代码里少写注释**，所以那个百分比（实测平均 26.2%，
   2026-11-24）与文档质量无关，不能当门禁口径。

## 为什么不接 CI、不做覆盖率门禁、产物不进文档站

- **覆盖率口径不对**：见坑 3，它衡量的是代码注释密度，不是本仓的文档质量判据；
- **产物太大**：约 60 MB 的静态站，进文档站会让构建时间与发布体积都不必要地膨胀；
- **最大的导航价值不成立**：按接口找 controller 这件事路由页做不了（坑 1），而接口面已有
  openapi + Scalar 覆盖得很好。

因此它只作为**本地的结构性阅读工具**：读一个不熟悉的模块前跑一次，比在几十个文件之间追
import 快得多。
