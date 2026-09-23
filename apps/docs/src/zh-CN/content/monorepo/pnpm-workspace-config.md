# pnpm-workspace.yaml 配置详解

> 本文档逐项解释 `pnpm-workspace.yaml` 中的每一个配置项——它是什么、为什么这么配、改了会怎样。

---

## pnpm-workspace.yaml

### `catalogMode: strict`

```yaml
catalogMode: strict
```

`package.json` 中的依赖必须用 `"catalog:"` 引用，不能直接写版本号。违反则在 `pnpm install` 时报错。

**为什么**：阻止 `pnpm add` 不加 `--save-catalog` 引入依赖，防止版本漂移。

### `packages`

```yaml
packages:
  - 'apps/*'
  - 'packages/platform-any/*'
  - 'packages/platform-web/*'
  - 'packages/tooling/*'
```

声明哪些目录是 pnpm workspace 成员。`apps/` 下 3 个应用 + `packages/` 下按平台分组的 11 个包（`platform-any` 3 个纯逻辑包、`platform-web` 3 个前端包、`tooling` 5 个工具链包），共 14 个 workspace 包。

### `versioning`

```yaml
versioning:
  changelog:
    storage: registry        # changelog 由 git-cliff 逐包写，pnpm 不落文件
  fixed:                     # 单一组：全部 14 个 workspace 包永远同版本
    -
      - '@walnut/admin'
      # … 其余 13 个（apps 3 + platform-any 3 + platform-web 3 + tooling 5）
```

**本段是版本策略的唯一真源**——取代原来的 `.changeset/config.json`（已删除）。意图文件仍是 changesets 格式（`.changeset/*.md`）：由 `pnpm change` 写、`pnpm version -r` 消费、消费结果记进 `.changeset/ledger.yaml`；发版编排在 `packages/tooling/release/src/release/`。详见 [发布 & 发版指南](./release.md)。

为什么是**一个** fixed 组（而不是历史上的 Apps 3 + Packages 9 两组）：pnpm 的 fixed 组各自独立，只动共享包的发版会只 bump Packages 组、`apps/admin` 版本不变 ⇒ 编排命中"版本号未变更，跳过发版"而退出 0，留下"已被 bump 却永远不会打 tag"的脏工作区。单组从结构上消灭这条路径，发布 tag `vX.Y.Z` 因此永远只有唯一来源。

> ⚠️ 新增 workspace 包时**必须**把它加进 `fixed`，否则 `pnpm change check`（CI 与 pre-push 都会跑）报锁步失败。

> 本次发版迁移对 catalog 的增删：新增 `git-cliff@2.13.1`、`lefthook@2.1.14`、`yaml@2.9.0`；移除 `@changesets/cli`、`@changesets/changelog-github`、`simple-git-hooks`。

> 2026-09-23 工具链拆分对 catalog 的增删：新增 `jiti@2.7.0`（ESLint 加载 `eslint.config.ts` 的官方 TS 加载器，根 devDependency）；`yaml@2.9.0` 与 `git-cliff@2.13.1` 的所有权从根/`@walnut/tooling` 下沉——`yaml` 变为 `@walnut/release` 的 dependency（同时是 `@walnut/scripts` 的 devDependency，只给 lefthook 配置的审计用例用），`git-cliff` 变为 `@walnut/release` 的 dependency；`@dotenvx/dotenvx@2.19.0` 变为 `@walnut/scripts` 的 dependency；**移除 `tsx@4.21.0`**（仓内最后一个使用者是 `apps/admin` 的 `predev` / `types:check:log`，两个脚本改由 Node 24 原生类型剥离执行后已无任何直接依赖）。改动后 catalog 共 242 条。

### `hoist: false`

```yaml
hoist: false
```

关闭 pnpm 的依赖提升。默认（`hoist: true`）时依赖会被提升到 `node_modules/.pnpm/node_modules/`，从该目录下的任意位置都能解析到；`node_modules/.pnpm/` 本身是 pnpm 的**虚拟 store**，存放各精确版本副本。设为 `false` 后不再提升，每个包只能解析自己 `package.json` 中声明的依赖。

**为什么**：严格的依赖隔离。不会出现"包 A 没声明 `lodash` 却能 import 到"的幻影依赖（phantom dependency）问题。

> **键名注意**：官方键名是 `hoist`，不是 `hoisting`。写成 `hoisting` 会被 pnpm 忽略——pnpm 11 静默忽略，pnpm 12 在项目有 `packageManager` pin 时会直接以 `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS` 失败。

**判定是否生效**：`node_modules/.pnpm/node_modules/` 的条目数。隔离生效时应为 **0**（或仅剩 workspace 内部链接）。

### `strictPeerDependencies`

```yaml
strictPeerDependencies: false
```

为 `false` 时 peer 版本错位只告警、不阻断安装；错位情况可用 `pnpm peers check` 查看。

**为什么是 false**：本仓多处刻意选用新于上游 peer 声明范围的版本——`vite@8`、`typescript@6`、`class-validator@0.15`、`@swc/cli@0.8`、`chokidar@4`。上游 peer 范围尚未跟进，严格模式与这个策略不兼容。

### `engineStrict`

```yaml
engineStrict: true
```

`package.json` 中 `engines` 不满足时拒绝安装。

> pnpm 12 起它**沿依赖边**生效：即使整个子树挂在 `optionalDependencies` 下，只要是通过常规 `dependencies` 依赖到 engine 不兼容的包，安装同样失败（pnpm 11 只打警告）。

### `saveExact`

```yaml
saveExact: true
```

`pnpm add` 默认保存精确版本（不用 `^` 前缀）。配合 catalog 使用。

### `publicHoistPattern`

```yaml
publicHoistPattern:
  - '@types/sortablejs'
  - '@typescript-eslint/types'
  - '@chevrotain/regexp-to-ast'
  - 'vscode-jsonrpc'
  - 'vscode-languageserver-protocol'
  - 'vscode-languageserver-types'
  - 'vue'
```

把匹配的包从 `node_modules/.pnpm/` 提升到根 `node_modules/`，使它们能从依赖树的任意位置解析到——这是 `hoist: false` 下唯一的放行通道，只用于确有必要的例外。

| 模式 | 提升的包 | 原因 |
|------|---------|------|
| `@types/sortablejs` | `@types/sortablejs` | 见下 |
| `@typescript-eslint/types` | `@typescript-eslint/types` | `@unocss/eslint-plugin` 的产物 import 它但未声明 |
| `@chevrotain/regexp-to-ast` | `@chevrotain/regexp-to-ast` | `langium` 源码 import 了未声明的包（仅经 chevrotain 传递） |
| `vscode-jsonrpc` · `vscode-languageserver-protocol` · `vscode-languageserver-types` | 同左（3 条） | 同上，`langium` 经 `vscode-languageserver` 传递 |
| `vue` | `vue` | `vue-command-palette` 产物 import `'vue'`，其 `package.json` 既无 dependencies 也无 peer |

**用精确包名而不是 glob**：每一条都是第三方包自身的缺陷（knip 对本仓自有源码报 0 条未声明依赖），逐条实测得出，写精确名字才能让"为什么放行"可审计；glob 会顺手放行一堆无关包。

**`@types/sortablejs` 例外说明**：`@vueuse/integrations` 把 `sortablejs` 列为**可选 peer**，其类型声明需要从自身所在位置解析到 `@types/sortablejs`。`hoist: false` 会切断这条解析链，导致 `useSortable` 的选项类型退化（丢失 `animation` 等属性），`apps/admin` 的 Table 与 Tab 两处类型检查报错。放行这一个类型包，而不是重新打开全局提升。

### 依赖构建脚本：`strictDepBuilds` 与 `allowBuilds`

pnpm 10+ 默认禁止依赖执行 `postinstall` 等构建脚本（供应链防护）。`allowBuilds` 逐包放行。

```yaml
strictDepBuilds: false
allowBuilds:
  '@sentry/cli': true
  lefthook: true          # 它的 postinstall 就是 `lefthook install`（装 git 钩子）
  # 以下全部显式 false
  '@alicloud/openapi-core': false
  '@compodoc/compodoc': false
  '@nestjs/core': false
  '@parcel/watcher': false
  '@scarf/scarf': false
  '@swc/core': false
  core-js: false
  esbuild: false
  json-editor-vue: false
  msgpackr-extract: false
  rs-module-lexer: false
  sharp: false
  vue-demi: false
```

**为什么放行项只有两条**：原配置放行 16 条，逐条实测后确认绝大多数不需要构建脚本：

- `@swc/core`、`esbuild`、`sharp`、`@parcel/watcher`、`msgpackr-extract`、`rs-module-lexer` 等原生模块都通过 `optionalDependencies` 分发**预编译产物**（如 `@swc/core-win32-x64-msvc`），不需要编译；`git-cliff` 同理（平台二进制同样走 `optionalDependencies`，所以它**没有** `allowBuilds` 条目）；
- `@nestjs/core`、`core-js`、`@scarf/scarf` 的脚本只是 funding / 遥测提示。

验证方式：在构建脚本全部禁止的状态下跑通 `types:check`、`lint`、`test`、`boundaries`、server 构建（SWC 编译 711 文件）与 admin 完整生产构建（含依赖 `sharp` 的 image-optimizer）。

**`@sentry/cli` 为何保留**：其二进制实际由 `@sentry/cli-<platform>` 提供，实测同样不需要 postinstall；但 Sentry 上传路径本地无法验证（缺真实 DSN / org / project / token），保留其构建脚本作为低成本保险。

**`lefthook` 为何必须放行**：它的 postinstall **就是装 git 钩子那一步**（`lefthook install`）。不放行时本仓 `strictDepBuilds: false` 只会**告警**、不阻断安装 ⇒ pre-commit / commit-msg / pre-push 门禁全部静默消失。装没装上用 `pnpm hooks:check` 机械核对（见 [ADR 0018](/content/adr/0018-git-hooks-lefthook)）。

**`strictDepBuilds: false` 的作用**：pnpm 12 默认在存在被忽略的构建脚本时以 `ERR_PNPM_IGNORED_BUILDS` **阻断安装**。设为 `false` 后只告警，便于逐步确认。新增依赖若确实需要构建脚本，pnpm 会列出包名，照此加入 `allowBuilds` 并置 `true`。

**每条都显式写 `true`/`false`**：若留空或缺失，pnpm 会向本文件写入 `set this to true or false` 占位模板。

### 供应链防护

```yaml
minimumReleaseAge: 1440
trustPolicy: no-downgrade
trustPolicyExclude:
  - chokidar@4.0.3
  - langium@3.3.1
  - semver@5.7.2
  - semver@6.3.1
  - undici-types@6.21.0
blockExoticSubdeps: true
```

| 设置 | 作用 |
|------|------|
| `minimumReleaseAge: 1440` | 新发布的版本需存放满 1440 分钟（1 天）才允许解析安装。恶意版本通常在数小时内被发现并下架，冷却期可避开这个窗口 |
| `trustPolicy: no-downgrade` | 某包此前由可信发布者发布、现在只剩 provenance 或无可信证据时，拒绝安装 |
| `blockExoticSubdeps: true` | 阻止**传递依赖**走 git 仓库、直连 tarball 等异源，只允许从 registry 解析 |

`minimumReleaseAge` 显式写出是为了避免默认值变化时策略无声失效。

**`trustPolicyExclude` 的 5 条例外**：均为 2019–2024 年间发布的历史版本，发布时 provenance 机制尚未普及，因而被 `no-downgrade` 判为"可信度下降"。这些版本已冻结且被广泛使用，逐条豁免而非整体关闭策略。

**成本**：pnpm 12 会在安装路径上校验 lockfile 是否满足上述策略（约 2870 条目）。冷缓存实测 11–35 秒（受 registry 网络影响），热缓存约 0.2 秒。

> **`.npmrc` 不存在于本仓库**。pnpm 只从 `.npmrc` 读取 auth 与 registry 设置，其余设置写在 `.npmrc` 中不会生效——因此上述所有配置项都位于 `pnpm-workspace.yaml`。

---

## 相关文档

- [pnpm Catalog](./pnpm-catalog.md) — catalog 详细用法
- [ADR-0012: Toolchain Divergence](../adr/0012-toolchain-divergence.md) — hoisting 和 public-hoist-pattern 的决策背景
- [ADR-0011: Dependency Governance](../adr/0011-dependency-governance-release.md) — catalogMode strict 的决策背景
- [ADR-0019: 共享 tsconfig 预设包与「无 `.mjs`」约束](../adr/0019-tsconfig-presets-and-no-mjs.md) — `versioning.fixed` 12 → 14、catalog 增删的决策背景
- [供应链安全（pnpm 官方）](https://pnpm.io/supply-chain-security)
