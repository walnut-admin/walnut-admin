# ADR-0018: Git Hooks — lefthook 取代 simple-git-hooks

**Date:** 2026-09-23
**Status:** Accepted

## Context

三层门禁的第一层（pre-commit）与第二层（pre-push）由 git 钩子承担，见 [ADR-0009](/content/adr/0009-ci-quality-gates)。
此前用 `simple-git-hooks`：钩子命令写在根 `package.json` 的 `simple-git-hooks` 块里，
由根 `postinstall: "npx simple-git-hooks"` 生成 `.git/hooks/*`。

两个反复出现的问题：

1. **钩子内容不在跟踪面里被校验**。真正执行的是 `postinstall` 非原子写出的 `.git/hooks/*` 文件；
   它被截断时呈「语法合法但少跑几项」的静默弱化形态，而仓库里没有任何机器判据能发现。
   2026-09-21 的 pnpm 12 迁移计划（archive）把这条记为 R3：
   `simple-git-hooks` 的 postinstall 不执行时，pre-commit / pre-push 门禁**全部失效，且不报错**。
2. **pre-push 是四条命令的 shell 串**（`pnpm boundaries && pnpm types:check && pnpm syncpack:lint && pnpm lint:workflows`）。
   串中任何一段被改动/截断，退化的形态不可预测。

同时引入 lefthook 的两个具体收益：

- 钩子内容进仓库（`lefthook.yml`），成为**可被单测审计**的真源；
- `assert_lefthook_installed: true` 让「找不到 lefthook 二进制」从「生成一个只 echo 的 shim、门禁静默消失」
  变成**响亮失败**。

## Decision

**用 lefthook 取代 simple-git-hooks，钩子内容的唯一真源是根 [`lefthook.yml`](/lefthook.yml)。**

```yaml
min_version: 2.1.14
assert_lefthook_installed: true

pre-commit:  # lint-staged（ESLint fix on staged files）
commit-msg:  # commitlint --edit {1}
pre-push:    # 单条：pnpm --silent prepush
```

四条配套约束：

1. **pre-push 只调一条命令**。钩子文件里唯一的一行是 `lefthook run "pre-push"`，而它调的
   `pnpm --silent prepush` 跑**一张门禁表**（`packages/tooling/scripts/src/ci/prepush.ts`，
   并行跑、每段报耗时）。
   （最初是五段；`lint:root` / `types:check:root` / `lint:docs-refs` 于 2026-09-23 陆续补入，
   `lint:adr` / `lint:doc-ts` / `lint:doc-budget` 同日随 F6 / F2③ / F7 补入 ——
   根级配置文件此前既不被 prepush / CI 覆盖、也没有任何脚本对它做类型检查，而文档正文里的包名与
   仓库路径引用、以及 ADR 的形态更是完全没人管。）

   > ⚠️ **2026-09-23 修正本段原先的理由**。原文写的是「收敛成单条命令后，**被截断只会退化成
   > 「命令不存在」，响亮报错**」。迁到 lefthook 之后这句话**已经不成立**，而且方向是反的：
   >
   > ① 生成的 `.git/hooks/pre-push` 里**一条门禁命令都没有** —— 实测它是一段 lefthook 启动器
   >    （找二进制 → `call_lefthook run "pre-push"`）。那条理由针对的是**旧 simple-git-hooks
   >    把命令链写进 `.git/hooks`** 的形态，链早就不在那里了。
   > ② 更要紧的是：`a && b && c` **恰好就是**「语法合法但少跑几项」的形态 —— 截断成 `a && b`
   >    照样退出 0。单条命令并没有消灭那个失败模式，只是把它从钩子文件挪进了 `package.json`。
   >
   > 真正立得住的理由是**另外两条**：单条命令让钩子文件里没有可截断的命令链（只剩启动器）；
   > 而门禁清单进跟踪面（现在是 `prepush.ts`，一张**带 `why` 的表**）之后，改动会在 diff 里
   > 看得见。**清单的完整性由单测机械拦** —— `prepush.test.ts` 断言表里每一段的 `argv` 都能
   > 落到真实存在的根脚本上（打错一个脚本名 = 一整段门禁静默消失，这是集中到一张表之后的新失败模式）。
2. **安装路径必须有构建脚本放行**。lefthook 自己的 postinstall 就是 `lefthook install`，
   因此 `pnpm-workspace.yaml` 的 `allowBuilds` 必须 `lefthook: true`。
   本仓 `strictDepBuilds: false`，漏了只会**告警**、不阻断安装 —— 正是要防的那个形态。
3. **安装结果可观测**：新增 `pnpm hooks:check`（`@walnut/scripts` 的 `src/ci/check-git-hooks.ts`），
   断言三个钩子文件存在且含 lefthook 托管标记，缺失则 exit 1。
4. **Windows 上 `run` 值禁止双引号**。lefthook 2.1.14 在 Windows 上用
   `cmdLine = "\"" + sh + "\" -c \"" + cmdstr + "\""` 拼命令行，内层引号未转义 ⇒
   带引号的命令**静默丢参、还照样报 ✓**（上游 PR #1464 未合并）。
   由 `packages/tooling/scripts/src/ci/__tests__/lefthook-config.test.ts` 机械拦下。

## Alternatives considered

- **保留 `simple-git-hooks`，钩子命令继续写在根 `package.json` 的 `simple-git-hooks` 块里、由 `postinstall: "npx simple-git-hooks"` 生成 `.git/hooks/*`** —— 钩子内容不在跟踪面里被校验，非原子写出的 `.git/hooks/*` 被截断时呈「语法合法但少跑几项」的静默弱化形态，仓库里没有任何机器判据能发现；2026-09-21 的 pnpm 12 迁移计划（archive）把这条记为 R3：postinstall 不执行时，pre-commit / pre-push 门禁全部失效且不报错。
- **pre-push 继续用 shell 串（`pnpm boundaries && pnpm types:check && …`）** —— 串里任何一段被改动或截断，退化的形态不可预测：**截断成前几段照样退出 0**，也就是本 ADR 最想消灭的那种静默弱化。当年（四段时）的处置是「收敛成单条 `pnpm --silent prepush`」；2026-09-23 长到十一段后又走了一步 —— 清单搬进 `packages/tooling/scripts/src/ci/prepush.ts` 的一张表（每段带 `why`、并行执行、每段报耗时），根脚本只剩 `prepush: "walnut-prepush"` 一个词。**为什么不干脆写成 `lefthook.yml` 的 11 个 job**：`pnpm prepush` 这个名字被发版工具链引用（`release/src/release/env.ts` 与 `lib/child-run.ts` 要在发版流程里剥掉 `LEFTHOOK*`，否则发版时的 `git push` 会递归触发它自己），搬走等于让发版代码去认识一个钩子配置。

## Consequences

**变得更好：**

- 钩子内容在跟踪面里，可被单测审计；`lefthook.yml` 改了就生效，不需要重装钩子。
- 门禁缺失从「静默」变成「响亮」：二进制缺失时 lefthook 直接报错，
  安装失败由 `pnpm hooks:check` 抓出来。
- pre-push 的门禁表有一条可见、可单独运行的聚合命令（`pnpm prepush`）。

**代价：**

- 多一个依赖（`lefthook`，走 catalog）并需要在 `allowBuilds` 里放行。
- 从 `postinstall` 生成的文件切到 lefthook 托管时，`lefthook install` 会把已有钩子重命名为 `*.old`
  再写入新的 —— 一次性迁移动作，需要删掉那些 `.old`。
- `LEFTHOOK=0` / `SKIP_SIMPLE_GIT_HOOKS=1` 的跳过环境变量名变了（前者）。

**被取代：**

- 根 `package.json` 的 `simple-git-hooks` 块与其 `postinstall` 脚本删除；
- `allowBuilds` 里的 `simple-git-hooks: false` 删除；
- [ADR-0009](/content/adr/0009-ci-quality-gates) 的 pre-push 一行、[ADR-0012](/content/adr/0012-toolchain-divergence)
  的 `*simple-git-hooks*` hoist 例外条目随之更新。

## References

- [`lefthook.yml`](/lefthook.yml) — 钩子唯一真源
- `packages/tooling/scripts/src/ci/check-git-hooks.ts` — 安装结果的可观测判据（`@walnut/scripts`）
- `packages/tooling/scripts/src/ci/__tests__/lefthook-config.test.ts` — Windows 引号坑的机械判据
- [ADR 0019](/content/adr/0019-tsconfig-presets-and-no-mjs) — 工具链拆包（`@walnut/tooling` → `@walnut/scripts` + `@walnut/release`）与 `prepush` 增段
- [lefthook 上游 PR #1464](https://github.com/evilmartians/lefthook/pull/1464)
