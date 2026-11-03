# 批次 3 · R1 复核轮实测报告（platform-node 搬迁可行性 + worker 生产面）

> 任务：`b3-r1-worker`（R1 复核，只读）｜执行者：全新调研 Agent｜唯一写入本文件。
> 仓库 HEAD `0e152d36`｜工作树：**起步非 clean**（见 §0.2，改动全部来自并发同伴，本轮未碰任何源码）。
> 任务 A 的 POC 全部在 `$env:TEMP` 沙盘跑（`C:\Users\tron\AppData\Local\Temp\walnut-poc-const`），
> **用完已删**（脚本末尾实测 `sandbox removed: True`）；跑完核对 `git status` / `pnpm-lock.yaml` 哈希未变。

---

## 0. 环境与前提

### 0.1 命令通道

```
POST 提示：pnpm / npx 在 pwsh 下直接跑会失败 → 全程 `cmd /c "..."`
更省事的一条（本轮实际用的）：直接 node_modules\.bin\nest.cmd，绕开 pnpm，
  既避开「pnpm 自动 install 并改写 lockfile」（批次 2 §0 已发现），也让 NODE_ENV 只对本进程生效
```

### 0.2 本轮期间工作树不是干净的（必须记录）

起步 `git status --porcelain` 就有 ` M apps/server/libs/cache/src/token-ttl.port.ts`，收尾时变成 15 个
modified + 5 个 untracked（CAP 相关：`libs/{cache,guards,security}/**`、`apps/admin/src/utils/axios/**`、
`apps/docs/**/*.md`，以及 **`?? apps/server/libs/const/src/app/cap.ts` / `cap.spec.ts`**）。

- 这些都是**并发同伴**的改动，不是本轮的；本轮没有对仓库内任何文件做写入（唯一写的是本报告 + `$env:TEMP` 沙盘）。
- **对结论的影响**：`libs/const` 正在被别人加文件（`cap.ts` 是新增的），所以下面「const 27 个 ts 文件」
  是本轮实测时的快照；沙盘是从工作树**当前内容**拷的（含那两个新文件的影响见 §1.2 控制组）。

### 0.3 与任务书的两处口径修正

| 项 | 任务书 | 实测 | 说明 |
|----|--------|------|------|
| `nest-cli` | 「nest-cli 的 `projects`」 | **仓库里没有 `nest-cli.json`** | 配置是三份按环境拆的文件：`apps/server/infra/nest/{dev,prod,stage}.json`，由 `nest build api -c infra/nest/prod.json` 显式指定（`apps/server/package.json:24`） |
| `.swcrc` | 「`.swcrc`」 | 同样是三份：`apps/server/infra/swc/{dev,prod,stage}.swcrc`，由 `prod.json:13` 的 `swcrcPath` 指过去 | 仓库根/包根都没有 `.swcrc` |

---

## 1. 任务 A：`const` 单库搬迁 POC 的可行性

### 1.1 现状：`pnpm --filter @walnut/server build` 的产物布局（实测）

先看真实构建（**在真仓库里跑的**，dist 是 gitignored）：

```
$ cd apps/server && $env:NODE_ENV='production'; node_modules\.bin\nest.cmd build api -c infra/nest/prod.json
Successfully compiled: 954 files with swc (615.68ms)                        ← build exit 0
$ node infra/scripts/verify-build-assets.ts dist
[verify-build-assets] dist 资产校验通过（4 项）                              ← exit 0

dist 顶层:   apps  libs
dist 文件数: 997
dist/apps:   dist/apps/api  dist/apps/worker     ← 没有 dist/apps/cli
关键项:      dist/apps/api/src/main.js          True
             dist/apps/worker/src/main.js       True
             dist/libs/const/src/app/env.js     True
             dist/apps/api/src/i18n/en_US/index.json  True
dist 里残留的 @walnut-server/* / @/* 别名 require: 0 处   ← 别名全被重写成相对路径
```

**所以「`dist/apps/api/src/main.js` 是否存在」= 是**，且它是 `start:prod`（`apps/server/package.json:30`）
和镜像 CMD（`build/image/server/Dockerfile:36`）共同依赖的路径。

顺带两个实测事实，后面会用到：

- **`dist/apps/worker/src/main.js` 也在同一份 dist 里**，虽然 `apps/api/tsconfig.app.json` 的 `include`
  里**根本没有** `apps/worker`（该文件 6–42 行只列了 `src/**/*` + 35 个 `../../libs/*/src/**/*`）。
  ⇒ **`include` 不是编译边界**。
- **`dist/apps/cli` 不存在**，尽管 `prod.json:51` 的 `filenames` 里有 `apps/cli/src`。
  原因在 `apps/api/tsconfig.app.json:48` 的 `exclude` 里有 `"../../apps/cli/**/*"`。
  ⇒ **`exclude` 才是真正的剪裁面**。

### 1.2 四个配置各自决定了什么（读源码 + 实测交叉验证）

| 面 | 文件:行 | 决定什么 | 证据 |
|----|---------|----------|------|
| `projects` | `infra/nest/prod.json:57-430` | 只是**项目登记表**：`api`/34 个 lib/`cli`/`worker`。`nest build api` 只取 `projects.api` 的 `tsConfigPath`/`entryFile`/`assets`；**「编译哪些目录」不在 project 块里** | `apps/server/actions/build.action.js:64-84`（`getTscConfigPath` + `copyAssets`）；实测把 `projects.const` 整块留在原地不动，构建照样过（§1.3 变体 A） |
| `filenames` | `infra/nest/prod.json:15-53`（**顶层** `compilerOptions.builder.options`，不是 project 块） | **真正的编译输入清单**。默认值是 `[sourceRoot]`，被这里整份覆盖 | `@nestjs/cli/lib/compiler/defaults/swc-defaults.js:52-64`：`filenames: [sourceRoot]` → `...builderOptions` 覆盖 |
| `.swcrc` 的 `paths` | `infra/swc/prod.swcrc:16-86` | **运行期 require 的最终形态**：`@walnut-server/x` 被改写成相对路径。`jsc.baseUrl: "."`（`prod.swcrc:15`）被 nest 拼成 `process.cwd()`（= `apps/server`） | `swc-compiler.js:136-141`（相对 baseUrl 用 cwd 解析）+ `deepMerge`（`swc-compiler.js:237-262`，数组按下标由 swcrc 覆盖 tsconfig）；实测「dist 里 0 处别名 require」 |
| `outDir` + `stripLeadingPaths` | `tsconfig.json:15`（`./dist`）+ `prod.json:14`（`"stripLeadingPaths": false`） | **产物落点的唯一公式**（见下） | `@swc/cli/lib/swc/util.js:154-163` |
| `include` / `exclude` / `rootDir` | `apps/api/tsconfig.app.json:6-50` | `exclude` → swc 的 `ignore`（真的剪裁）；`include`+算出来的`rootDir` → **只影响 assets 拷贝的 strip root**（和 tsc 类型检查的范围），对 SWC 编译不生效 | `swc-defaults.js:59`（`ignore: tsConfigExclude`）、`assets-manager.js:45`（`stripRoot = rootDir ?? sourceRoot`）、`helpers/get-effective-root-dir.js:17-43` |

**产物落点公式**（这是整个任务 A 的钥匙）：

```js
// @swc/cli/lib/swc/util.js:154-163（node_modules 里的一手源码）
function getDest(filename, outDir, stripLeadingPaths, ext) {
    let base = slash(path.relative(cwd, filename));   // cwd = 运行 nest 的目录 = apps/server
    if (stripLeadingPaths) base = stripComponents(base);
    return path.join(outDir, base);
}
```

配合 nest 侧的判定（`swc-defaults.js:109-122`）：`sourceRoot` 含 `/`（`apps/api/src`）→ `stripLeadingPaths` 必为
`false`，且 `prod.json:14` 又显式钉成 `false`。于是：

```
dest = <apps/server>/dist  +  <相对 apps/server 的源文件路径>
⇒ dist/apps/api/src/main.js           ← 来自 filenames 的 "apps/api/src"
⇒ dist/libs/const/src/app/env.js      ← 来自 filenames 的 "libs/const/src"
```

**即：dist 布局 = `filenames` 字符串的逐字符镜像。** 源文件在哪、`include` 写了什么都不参与这个公式。

### 1.3 POC 实测（沙盘 + 控制组）

**沙盘构造**（`$env:TEMP\walnut-poc-const`）：把 `apps/server` 的 `package.json / tsconfig*.json / infra / apps / libs`
拷进去，`node_modules` 用 `mklink /J` 指向真仓库（`C:\Users\tron\AppData\Local\Temp\walnut-poc-const\apps\server\node_modules` ←→ 真 `apps/server/node_modules`），
然后按目标形态造 `<沙盘>/packages/platform-node/base/src/const`（相对关系与真仓库一致：都是 `apps/server` 的兄弟目录）。

**控制组（未做任何搬迁，验证沙盘保真）**：

```
Successfully compiled: 954 files with swc (905.38ms)
[verify-build-assets] dist 资产校验通过（4 项）
dist 文件数: 997          ← 与真仓库逐项一致（954 / 997 / 两个入口都在）
```

控制组一致 ⇒ 下面所有差异都来自配置改动，不是沙盘失真。

#### 变体矩阵（全部实测，每条都是「改配置 → 重跑 nest build」）

| # | `filenames` 里的 const 项 | `tsconfig.app.json` | assets `stripLeadingPaths` | 编译文件数 | `dist/apps/api/src/main.js` | const 产物落在哪 | `verify-build-assets` |
|---|---|---|---|---|---|---|---|
| 控制 | `libs/const/src` | 原样 | false | 954 | ✅ | `dist/libs/const/src` | ✅ 通过 |
| **A** | `packages/platform-node/base/src/const`（少两级 `..`） | 原样（include 仍是旧的 `../../libs/const/src/**/*`） | false | **927**（-27） | ✅ | **哪都没有** | ✅ 通过（**静默**） |
| **A2** | `../../packages/platform-node/base/src/const`（正确相对深度） | 原样 | false | 954 | ✅ | **`<沙盘>/apps/packages/platform-node/base/src/const/*.js`——逃出 dist** | ✅ 通过（**静默**） |
| B | 回退成 `libs/const/src`（已不存在） | include += `../../packages/.../const/**/*`（少两级） | false | 927 | ✅ | 无 | ✅ 通过（include 匹配 0 文件，不报错） |
| **B2** | 同上 | include += **`../../../../packages/.../const/**/*`**（深度写对） | false | 927 | ✅ | 无 | ❌ **红：`dist 缺少 4 个必需资产`** |
| **C** | 同上 | B2 + `"rootDir": "../../"` | false | 927 | ✅ | 无 | ✅ **通过**（`dist/apps/api/src/i18n` 回到正确位置） |
| **D** | `../../packages/.../const` | 原样 | **true** | 954 | ❌ **变成 `dist/api/src/main.js`** | `dist/packages/platform-node/base/src/const/*.js` ✅ | 未跑到（`dist/apps/` 已塌） |

**逐条要点（都带实测输出）**：

**变体 A：`filenames` 写错 → 静默漏编 + 运行期炸**

```
Successfully compiled: 927 files with swc (405.7ms)      ← 少 27 个（const 全没编）
[verify-build-assets] dist 资产校验通过（4 项）           ← 绿
dist/packages/...: False     dist/libs/const/src/index.js: False
dist 里残留的别名 require: 0 处                          ← 但 const 的 require 已被改写成相对路径！
样本（dist/apps/api/src/modules/app/monitor/user/shared/user.shared.service.js）：
  require("../../../../../../../../../../packages/platform-node/base/src/const/app/setting")
```

**@swc/cli 对不存在的 `filenames` 项不报错也不警告** ⇒「配置写错」与「配置写对但产物逃逸」在构建期**完全同形**。

**变体 A2：写对了相对深度 → 产物逃出 dist，构建仍然绿**

```
Successfully compiled: 954 files with swc (293.59ms)      ← 27 个回来了
dist/packages exists: False
最近 15 分钟被写入的 .js（排除 dist）：\apps\packages\platform-node\base\src\const\index.js
                                     \apps\packages\...\const\app\env.js  ...（27 个）
$ node dist/apps/api/src/main.js
Error: Cannot find module '@walnut/contract/setting'
Require stack:
- C:\Users\tron\AppData\Local\Temp\walnut-poc-const\apps\packages\platform-node\base\src\const\app\setting.js
- ...\apps\server\dist\libs\cache\src\service\cache.appSettings.js
- ...\apps\server\dist\apps\api\src\main.js
--- exit: -1
```

三个后果同时发生：① 产物写到 `dist` 的**上一级**（`<沙盘>/apps/packages/...`，在真仓库就是
`D:\walnut-admin\walnut-admin\apps\packages\...` —— 一个既不在 dist、也不被 .gitignore 覆盖的新目录）；
② `dist/packages` 根本不存在；③ 逃出去的那份 .js 连 `@walnut/contract` 都解析不到（它已经不在
`apps/server/node_modules` 的解析链上）。**而 `nest build` exit 0、`verify-build-assets` 绿。**

**变体 B2 / C：`include` 加跨包路径的副作用（任务 A 第 4 问）**

```
B2: 成功编译 927 个（include 写对后 `tsc --showConfig` 里 platform-node 命中 30 处 = 27 个文件 + 3 处配置行）
    dist 下同时出现两份资产路径：
      dist\apps\api\src\i18n\...                     ← 旧位置
      dist\apps\server\apps\api\src\i18n\...        ← 新位置（多一级 apps/server）
    [verify-build-assets] dist 缺少 4 个必需资产：         ← 红
    verify exit: 1

C（B2 + "rootDir": "../../"）:
    [verify-build-assets] dist 资产校验通过（4 项）        ← 绿
    dist 文件数 970，dist/apps/api/src/main.js: True       ← 布局回到原样
```

机制：`assets-manager.js:45` 的 `stripRoot = tsRootDir ?? sourceRoot`，而 `tsRootDir` 是
`getEffectiveRootDir(rootDir, tsFileNames)`（`build.action.js:73`）。`tsconfig.app.json` 里**没有 `rootDir`**
⇒ 用「所有 include 文件的公共父目录」。加上 `packages/...` 之后公共父目录从 `apps/server` 上提到**工作区根**，
assets 就多拷一层 `apps/server/`。这正是 `infra/scripts/verify-build-assets.ts:1-10` 那段注释预警过的形态。

**变体 D：把现成的 `stripLeadingPaths` 翻成 true → 跨包那份对了，其余全塌**

```
Successfully compiled: 954 files with swc (447.84ms)
dist/packages: True                                     ← 跨包库这次落对了
dist 顶层（37 项）：als api app-domain apps auth blpath cache config context cookie crud
                    crypto db decorators delay exceptions guards identity ip list lock
                    mailer packages pipes queue repository rsa scope-resolver security
                    sms sse system throttle token types utils worker
main.js 位置：dist\api\src\main.js 、 dist\worker\src\main.js
```

`dist/libs/config/src` 塌成 `dist/config`、`dist/apps/api/src/main.js` 消失。原因是 `stripComponents`
（`util.js:143-152`）**只削掉第一段**（`apps/api/src/main.ts` → `api/src/main.ts`），这正是
`swc-defaults.js:104-107` 那段注释说的「嵌套 sourceRoot 无法被扁平化」。

### 1.4 结论：搬完之后 dist 布局会不会变？

**会变，而且没有一种 `filenames` 写法能保持不变。** 一句话判据：

> `dist` 布局是 `path.relative(apps/server, 源文件)` 的镜像；源文件一旦在 `apps/server` 之外，
> 这个相对路径必须以 `..` 开头，而 `path.join(outDir, '../../…')` 必然**钻出 outDir**。
> 唯一的补偿开关 `stripLeadingPaths` 是**全局布尔**，翻成 true 会把所有 `apps/**` / `libs/**` 同时削掉一层。

三条独立的失败面（任一成立就足以否掉当前路线）：

1. **产物逃逸（变体 A2）**：`dist/packages` 不存在，`.js` 被写回源码树旁边；`start:prod` MODULE_NOT_FOUND。
   构建与资产校验**全绿**——失败是静默的。
2. **assets strip root 上提（变体 B2）**：`include` 里出现跨包路径 ⇒ 公共父目录上提到工作区根 ⇒
   `verify-build-assets` 红（`pnpm build` 的尾巴，`package.json:24`）。补 `rootDir: "../../"` 能救（变体 C），
   但那是**搬迁时新增的第 10 个注册面**（D14 原本谈的是 9 文件）。
3. **依赖解析断链**：变体 C 的 `tsc --noEmit`（= `pnpm types:check`，`package.json:41`）实测 **12 条 TS2307**：

```
../../packages/platform-node/base/src/const/app/setting.ts(1,30): error TS2307: Cannot find module 'easy-fns-ts' …
../../packages/platform-node/base/src/const/app/mfa.ts(12,8): error TS2307: Cannot find module '@walnut/contract/mfa' …
../../packages/platform-node/base/src/const/decorator/permissions.ts(1,30): error TS2307: Cannot find module 'easy-fns-ts' …
tsc exit: 2  elapsed: 14.8s
```

`easy-fns-ts` 是 `apps/server/package.json:97` 的依赖，`@walnut/contract` 是 `:84` 的 workspace 依赖，
两者的 `node_modules` 都只挂在 `apps/server/` 下（实测仓库根 `node_modules/easy-fns-ts`=False、
`node_modules/@walnut/contract`=False，pnpm 不做根提升）。文件搬到 `packages/` 后就**跳出了这条解析链**。
⇒ D4 `07-decisions.md:83-86` 那句「**零 import 改写**、只改 5 个配置面」的前提**不成立**：
搬到包外必须给包一份 `package.json` + 依赖清单（就像 `packages/platform-any/contract/package.json:40-52` 那样）。

**综合判定：`const` 单库 POC 在当前架构下不通过。** 不是「某一步会失败」，而是「失败点全部落在构建期看不见的地方」。

### 1.5 若要继续：POC 的确切步骤 + 4 条验收 + 失败预案

#### 步骤（沙盘版，仓库零污染；本轮实际执行的就是这套）

```powershell
# 0) 沙盘：拷构建所需文件 + node_modules 用 junction（拷 junction 会跟进去，别拷）
$T = Join-Path $env:TEMP 'walnut-poc-const'; $S = "$T\apps\server"
New-Item -ItemType Directory $S -Force | Out-Null
foreach ($i in 'package.json','tsconfig.json','tsconfig.lib.base.json','infra','apps','libs') {
  Copy-Item -Recurse -Force "D:\walnut-admin\walnut-admin\apps\server\$i" "$S\$i" }
cmd /c "mklink /J \"$S\node_modules\" \"D:\walnut-admin\walnut-admin\apps\server\node_modules\""

# 1) 控制组（必须先跑）：改任何东西之前，确认沙盘能复现 954 / 997 / verify 绿
# 2) 搬：libs/const/src -> $T\packages\platform-node\base\src\const（注意目标是 apps/server 的"兄弟"）
# 3) 改 3 个面（只改这 3 个）：
#    infra/nest/prod.json  filenames: "libs/const/src" -> "../../packages/platform-node/base/src/const"
#    infra/swc/prod.swcrc  paths:     "./libs/const/src[/*]" -> "../../packages/platform-node/base/src/const[/*]"
#    tsconfig.json         paths:     "./libs/const/src[/*]" -> "../../packages/platform-node/base/src/const[/*]"
# 4) 按 §1.5 的 4 条验收跑（沙盘 cwd = $S）
```

#### 4 条验收命令（与任务书一致，都是 `apps/server` 下的 script）

| # | 命令 | 本轮实测结果（变体 A2，即「改对了 3 个面」） |
|---|------|---------------------------------------------|
| 1 | `cmd /c "pnpm build"`（= `nest build api -c infra/nest/prod.json && node infra/scripts/verify-build-assets.ts dist`，`package.json:24`） | ✅ 绿（954 files）——**但这是假绿** |
| 2 | `cmd /c "pnpm start:prod"`（`node dist/apps/api/src/main.js`，`:30`） | ❌ **MODULE_NOT_FOUND**（`Cannot find module '@walnut/contract/setting'`，栈顶就是逃逸出去的 `apps/packages/.../const/app/setting.js`） |
| 3 | `cmd /c "pnpm types:check"`（`tsc --noEmit`，`:41`） | ❌ **12 条 TS2307**（`easy-fns-ts` / `@walnut/contract/*` 解析不到，见变体 C） |
| 4 | `cmd /c "pnpm openapi:export"`（`:38`，`nest build cli` + `export-openapi.js`） | ⏹ **没跑到**（第 2 条已崩；且它需要 PG/Redis + 解密后的 `env-local`，沙盘里没接。真仓库里这条本身是绿的，见批次 2 的 24 段 prepush） |

#### 最可能失败的那一步 = **第 2 条 `start:prod`**，但真正的坑是「第 1 条先绿」

- 第 1 条绿是因为 `nest build` 只做 SWC 语法转换（`ci.yml:262` 注释也这么说：「编译不需要环境变量」），
  **它不解析 require 目标是否存在**。所以构建期没有任何信号。
- 若按「补 `include` 让 tsc 看得见」的直觉改（变体 B2），失败会**前移到第 1 条的尾巴**
  （`verify-build-assets` 4 项缺失）——这是本轮唯一「构建期能红」的路径，代价是要顺手加 `rootDir`（变体 C）。

#### 失败预案（按代价升序）

| 方案 | 做法 | 代价 | 实测/推断依据 |
|------|------|------|---------------|
| **P1（推荐）：走 D4 原文的备选——platform-node 自己出 CJS dist** | 两个包各带 `package.json`（`main`/`exports.require` 指 `./dist/*.cjs`）+ 自带依赖清单；`apps/server` 侧**从 `filenames`/`swcrc paths` 里彻底摘掉**这些库，靠 node_modules 解析（与 `@walnut/contract` 完全同形） | M→L（多一条构建流水线，turbo 里加 `^build`） | `packages/platform-any/contract/package.json:7-24` 就是现成模板；`apps/server/infra/swc/prod.swcrc:16-86` 里**没有** `@walnut/contract` 的 paths 项，说明「消费已构建的 workspace 包」这条路今天就在跑 |
| **P2：留在 `apps/server` 内，不动搬迁** | D4 降级为「只做分层判据生成化（D14）+ 包内 0 环（madge）」，平台分离收益放弃 | S | 本轮实测：任何跨出 `apps/server` 的源码都会撞上面三条失败面 |
| **P3：junction 骗过 `relative()`** | 在 `apps/server/` 下建目录联接 `packages -> ../../packages`，`filenames` 写 `packages/platform-node/base/src/const`（无 `..` ⇒ 落进 `dist/packages/...`） | S（但要 Linux CI 同步建符号链接；Docker 构建上下文里也要有） | `util.js:155` 用的是**词法** `path.relative`，不 realpath ⇒ 理论上成立；本轮**未实测**，属推断 |
| **P4：改 nest/swc 的落点规则** | fork 一份 @swc/cli 或改用 `nest build` 的 tsc builder | L | 升级 @nestjs/cli 时必然踩回来 |

### 1.6 如果一定要在 `apps/server` 的 tsconfig `include` 里写跨包路径

**结论先说：`include` 不是编译边界，加了不会让 packages 源码「被编进 `dist/apps`」；它只动 assets 的 strip root。**

- **为什么不会编进 `dist/apps`**：落点公式里没有 `include`（§1.2）。跨包源码的落点由 `filenames` 决定，
  且实测三态：`..` 写少 → 谁都不编（变体 A）；`..` 写对 → 写到 `dist` 之外（变体 A2）；
  `stripLeadingPaths: true` → `dist/packages/...`（变体 D，但别的全塌）。**没有任何一态是 `dist/apps/...`。**
- **该怎么写**（深度按 `tsconfig.app.json` 自己所在目录算，即 `apps/server/apps/api/`）：

```jsonc
// apps/server/apps/api/tsconfig.app.json
"include": [
  "src/**/*",
  "../../libs/config/src/**/*",
  // ……
  "../../../../packages/platform-node/base/src/const/**/*",   // 4 级：api → apps → server → 工作区根
  "../../../../packages/platform-node/tech/src/**/*"           // 批量搬迁时逐个加
]
```

  注意这里与 `tsconfig.json` 的 `paths` **深度不同**（后者从 `apps/server/` 起算，只需 `../../packages/...`），
  同一个目标两个写法的坑，本轮实测踩到过一次（变体 B：`../../packages/...` 在 include 里匹配 0 个文件，**不报错**）。
- **必须同时做的两件事**：
  1. `"rootDir": "../../"`（相对 `apps/api/` ⇒ `apps/server`）写进 `tsconfig.app.json` 的 `compilerOptions`，
     否则 assets strip root 上提（变体 B2 红 / 变体 C 绿）。它**不影响 SWC 落点**（`shouldStripLeadingPaths`
     对含 `/` 的 sourceRoot 恒 false，且 `prod.json:14` 已钉死 false）。
  2. `apps/worker/tsconfig.app.json:8-45` 是同一份 include 的副本（54 行），**必须同步**，否则
     `build:worker` 的 assets strip root 与 `build` 不一致 —— 这一面目前**没有 drift spec 守**
     （`lib-registration.drift.spec.ts` 只守 libs，不守这种跨包条目）。

---

## 2. 任务 B：worker 生产面缺口

### 2.1 「同镜像不同 CMD」可行吗？——**可行，前提只有一条：cwd 必须是 `/app`**

| 判定项 | 实测 | 依据 |
|--------|------|------|
| worker 入口文件在不在镜像的 `dist/` 里 | **在**。`nest build api` 一次就同时产出 `dist/apps/api/src/main.js` 与 `dist/apps/worker/src/main.js` | `prod.json:15-53` 的 `filenames` 里就有 `apps/worker/src`（`:52`）；本轮真仓库构建后两个文件都实测存在，且**直接跑起来了**（见下） |
| worker 需要额外文件吗 | **不需要**。它要的 i18n / views 由 api 与 worker 两个 project 的 `assets` 各自拷到同一份 `dist`（`prod.json:66-82` 与 `:416-427` 的 `include` 都指 `../../api/src/{i18n,views}`） | + `verify-build-assets.ts:23-31` 的 4 项必需资产本轮全绿 |
| `WORKER_STANDALONE` 的读取点 | **两处，语义不同**：① `apps/api/src/app/schedule.composition.ts:24-26`（`isWorkerStandalone()`，在**模块定义期**求值 —— 该文件 `:20-22` 注释明说「早于 Nest DI 容器建立」）② `apps/api/src/modules/techniques/task/bootstrap-task.module.ts:20`（函数内，晚一点） | ① 决定了 **env 必须是进程级（容器 `environment`），不能只写在 `.env.production` 文件里**——Compose 的 bind mount 那份 `/app/env-local/.env.production` 是 ConfigModule 之后才加载的，赶不上模块定义期 |
| 优雅退出 | `apps/worker/src/main.ts:26` 有 `app.enableShutdownHooks()` ⇒ Linux 下 `docker stop`（SIGTERM）能正常退出。**Windows 实测：`Stop-Process` 是硬杀，钩子不跑** | 本轮 `Stop-Process -Force` 收尾 |
| 镜像怎么来 | 单 target `backend`（`docker-bake.hcl:98-104`）、单 Dockerfile `build/image/server/Dockerfile`、CMD 写死在 `:36` | 只需在 compose 里覆盖 `command`，不用改 Dockerfile |

**一次真跑的 worker 启动日志**（本仓库 `dist`，`NODE_ENV=development`、`WORKER_STANDALONE=true`、
`WALNUT_ADMIN_BOOTSTRAP_TASKS=off`，cwd=`apps/server`）：

```
[WorkerModule] dependencies initialized +404ms
[WorkerBootstrap] worker process started (no HTTP listener); cron jobs: 7 \
  [AppInitSettingsTask, SystemInitLocaleMessageTask, AppAuthDeleteRefreshTask, AppRotateKeyTask, \
   SystemUpdateDeviceActiveStatusTask, AppAuthMfaSetupTask, AppAuthDeleteRefreshPgPurgeTask] +50ms
[WorkerBootstrap] worker consumes Bull queues and runs cron while the api process serves HTTP +1ms
```

**两条要先解决的约束**：

1. **api 服务也必须设 `WORKER_STANDALONE=true`**，否则 api 照旧注册 `ScheduleModule`，
   cron 与 worker **双跑**。`apps/server/apps/worker/README.md:56` 已经把这条写成部署契约
   （「api 侧没有任何脚本代注入（Dockerfile CMD 固定）」），`schedule.composition.ts:39-48` 提供了启动期 warn。
   `deploy/docker-compose.yml:25-33` 的 backend **今天没有这个 env** —— 这是同镜像不同 CMD 的**唯一必要改动**。
2. `pnpm deploy --prod` 的产物要包含 `dist/`（`build/image/server/Dockerfile:20` 的注释如此宣称，
   生产流程今天也这么跑），而 `dist/` 在 `.gitignore:91` 里。**本轮没有重跑 `pnpm deploy`**，
   所以「deploy 是否按 npm-pack 语义过滤掉 gitignored 的 dist」这一点**未实测**，属遗留待验项（§3）。

### 2.2 `deploy/docker-compose.yml` 加 worker service 的清单

现状：`backend`（`:25-49`）有 volumes（env bind mount + logs）、depends_on（pg/redis healthy）、
healthcheck（`/health/ready`，`:41-49`）。`deploy/` 与 `.github/` 里 `worker` / `WORKER_STANDALONE` **0 命中**（与 D3 记述一致）。

推荐片段（与既有风格同形；**两处改动**，不是一处）：

```yaml
  backend:
    image: ccr.ccs.tencentyun.com/tron1997/backend:${IMG_TAG}
    # …既有内容不动…
    environment:
      # 必须：container env（不能只写 .env.production —— 见 §2.1，模块定义期就要读到）
      # 不加这条 = api 与 worker 双跑 cron（apps/worker/README.md:56）
      - WORKER_STANDALONE=true

  # 与 backend 同一镜像、只换 command。cron 单实例约束见 ADR 0025（1 个 api + 0 或 1 个 worker）
  worker:
    image: ccr.ccs.tencentyun.com/tron1997/backend:${IMG_TAG}
    restart: always
    container_name: walnut-worker
    command: ['node', 'dist/apps/worker/src/main.js']   # cwd 由镜像 WORKDIR /app 提供（Dockerfile:18）
    environment:
      - WORKER_STANDALONE=true
    volumes:
      - ./env/.env.production:/app/env-local/.env.production:ro   # 与 backend 同一份；缺失会在启动时立刻暴露
      - ./logs/worker:/app/logs                                    # 见下面「日志」那条
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    # 无 healthcheck：worker 没有 HTTP 监听（main.ts 是 createApplicationContext）
```

逐项理由：

| 项 | 取值 | 为什么 |
|----|------|--------|
| `image` | 同一个 `backend:${IMG_TAG}` | 同镜像不同 CMD；不需要新 target（`docker-bake.hcl:98-104` 只有一个 backend target） |
| `command` | `node dist/apps/worker/src/main.js` | 覆盖 Dockerfile `:36` 的 CMD；**不要**改成 `npm run start:worker`（镜像里 `cross-env` 是 devDep，`--prod` 装不进来；而且 NODE_ENV 已由 Dockerfile `:17` 的 `ENV NODE_ENV=production` 给） |
| `environment.WORKER_STANDALONE` | `true` | 模块定义期求值 ⇒ 必须是进程 env（`schedule.composition.ts:20-22`） |
| `depends_on` | pg + redis `service_healthy` | worker 启动即连 PG（TypeORM）与 Redis（Bull + 缓存），与 backend 同口径 |
| `restart` | `always` | 与 backend 一致；worker 崩了没有 HTTP 探针能发现它，只能靠重启 |
| `healthcheck` | **不写** | 无监听端口。若一定要有，最低成本是证明「进程还活着」：`test: ['CMD-SHELL','grep -q main.js /proc/1/cmdline']`（只能证明进程在，**不能**证明 cron 挂上了；真要证明 cron 需让 worker 写心跳文件 = 改代码） |
| `volumes.logs` | **建议单独目录** | backend 与 worker 都会用 winston-daily-rotate 写 `/app/logs`（`docker-compose.yml:33` 已把 `./logs` 挂给 backend）。两个进程写同一批按天轮转文件会有轮转竞争；给 worker 一个独立宿主目录（`./logs/worker`）最省事 |
| `depends_on`（nginx 侧） | **不用加** | nginx 只转发 HTTP，worker 不接流量 |

### 2.3 CI 冒烟：最省的做法 + 三个坑

**先回答「能不能 启动 3 秒 → 断言日志 → 退出」：不能按 3 秒来。** 实测（Node harness，`spawn` + 监听
stdout 里的 `/cron jobs: (\d+)/`，两次）：

```
{"ok":true,"jobs":7,"ms":9258}
{"ok":true,"jobs":7,"ms":9084}
```

PowerShell + 重定向文件测出来更飘（`17.16s / 9.95s / 12.4s`）。而进程内部 Nest 启动只用了 ~1s
（日志时间戳 `09:30:40` → `09:30:41`）——**9 秒里绝大部分是 require 整张依赖图的时间**（minified dist）。

⇒ 正确形态是**轮询 + 超时兜底**，不是固定 sleep。

**三个坑（全部实测）**：

1. **`NODE_ENV=production` 直接拒绝启动**（这是最坑的一个）：

```
$ NODE_ENV=production WORKER_STANDALONE=true node dist/apps/worker/src/main.js
ERROR [ExceptionHandler] [config] DATABASE_PG_APP_PASS 仍是开发引导密码（walnut_app_dev_only），
NODE_ENV=production 拒绝启动。…
    at assertWalnutPgAppBootstrapPassword (dist/libs/config/src/utils/pg-app-password.js:1:748)
--- 进程自己退出了（12s 后 HasExited=True），日志里没有 cron jobs
```

   guarded 在 `apps/server/libs/config/src/utils/pg-app-password.ts:45`（`assertWalnutPgAppBootstrapPassword`，
   口令常量在 `:14`；调用点 `validation.ts:333` 与 `modules/pg.config.ts:29`）。
   CI 里照 `openapi:export`（`package.json:38`）的口径用 **`NODE_ENV=development`** 才跑得起来。
2. **需要 PG + Redis，而且要有迁移过的库**：`ci.yml` 里**只有 `openapi` job 有 PG/Redis service**
   （`:327-353`）+ 解密 env（`:375-379`）+ 跑迁移（`:381-384`）。`build` job（`:239-306`）**没有 services**。
   ⇒ 想「最省」，就把冒烟塞进 **`openapi` job**，别新开 job 再起一套 service。
3. **进程不会自己退出**（实测：40s 内 `HasExited=False`），而 Windows 下 `Stop-Process` 是硬杀、
   跑不到 `enableShutdownHooks`。CI 在 ubuntu 上要用 SIGTERM + `wait`，或直接 `timeout` 包一层。

**推荐写法（挂在 `ci.yml` 的 `openapi` job 末尾，约 +25s）**：

```yaml
      # worker 的失败是静默的：cron 没挂上，api 照常 200。断言 main.ts:34 打出的 cron 数量 > 0。
      # 坑：① NODE_ENV 必须 development（prod 会因 dev 引导密码拒绝启动）② 无 services 的 job 跑不了
      # ③ 进程不自己退（SIGTERM + wait）④ 冷 require ~9s（2026-11 实测 9.1/9.3s）⇒ 轮询 40s 兜底
      - name: Worker smoke (cron registered)
        if: env.DOTENVX_KEYS != ''
        working-directory: apps/server
        run: |
          set -euo pipefail
          pnpm build:worker                      # deleteOutDir:false，复用 openapi 步骤已建的 dist
          log=$(mktemp)
          NODE_ENV=development WORKER_STANDALONE=true WALNUT_ADMIN_BOOTSTRAP_TASKS=off \
            node dist/apps/worker/src/main.js >"$log" 2>&1 &
          pid=$!
          for _ in $(seq 1 40); do
            grep -qE 'cron jobs: [1-9][0-9]*' "$log" && break
            kill -0 "$pid" 2>/dev/null || break   # 进程提前死了就别再等
            sleep 1
          done
          kill -TERM "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
          grep -E 'cron jobs: [1-9][0-9]*' "$log"   # 断言：grep 不到 ⇒ exit 1 ⇒ step 红
```

关键点：

- **`WALNUT_ADMIN_BOOTSTRAP_TASKS=off` 必须加**：否则 worker 启动即跑 6 个 bootstrap 任务（含 `rotateAppKey()`，
  `apps/worker/README.md:59-62`），CI 里是副作用；而它**只隔离 bootstrap、不影响 cron 注册**
  （`adr/0025-cron-single-instance-lock-and-bootstrap-ownership.md:24` 明说），所以 cron 计数断言依旧有效。
- 断言用 `[1-9]`：`cron jobs: 0` 是「不红但没 cron」的真缺陷形态，不能放过。
- **`apps/worker/src/main.ts:34` 那行日志是唯一现成的探针**，不用改代码；若要更严，可再断言
  `[WorkerStandalone]` 让位 warn 出现在 **api** 侧（`schedule.composition.ts:43-47`）—— 但那要起 api，成本翻倍。

---

## 3. 本轮没验证的 / 边界

1. **`pnpm deploy --prod` 是否把 gitignored 的 `dist/` 带进镜像上下文**：未实测（会真跑一次安装，且会写
   `build/image/`）。Dockerfile:20 的注释与既有生产流程都断言「带」，但这是任务 B1 的**唯一**未闭环点。
   最小验证：`pnpm deploy --legacy --filter=@walnut/server --prod build/image/server` 后 `Test-Path build/image/server/dist/apps/worker/src/main.js`。
2. **变体 B2 里 `dist` 下同时出现两份资产路径**的精确机制（为何旧位置也留了目录）未逐文件核对；
   只核对了 `verify-build-assets` 的结果（红/绿），以及变体 C 加 `rootDir` 后转绿。
3. **`openapi:export`（验收 4）**没在沙盘跑：它要 PG/Redis + 解密 env，而第 2 条验收已经崩了，跑它不会改变结论。
4. **P3（junction 骗 `path.relative`）** 只是读源码推出的方案，未实测；Linux CI 上的符号链接行为也未验。
5. worker 冒烟**在本机（Windows）**实测 9.1–9.3s；GitHub ubuntu runner 上大概率更快，但**没有**实测数据，
   所以 CI 里别写成固定 `sleep 3`。
6. 本轮**没有**跑 `pnpm build` 的 `--filter` 全链路、`pnpm types:check` 全仓、`pnpm prepush`（会与并发同伴的改动互相干扰）。

---

## 需要 Lead 拍板

1. **D4 的编译形态走哪条？** 本轮实测否掉了「源码留在 swc `filenames` 里」这条路（§1.4 三条独立失败面：
   产物逃逸 / assets strip root 上提 / 依赖解析断链，且**失败不体现在构建期**）。三选一：
   (a) **走 D4 原文备选 P1**：`packages/platform-node/*` 各自构建 CJS dist，`apps/server` 侧与 `@walnut/contract` 同形消费
   （代价 M→L，但今天已有一条在跑的样板）；
   (b) **P2：放弃搬迁**，D4 降级为「D14 生成化 + madge 0 环」；
   (c) 先做 **P3 junction 试验**（S，半小时，但会引入「构建依赖目录联接」这种隐式前提）。
   我倾向 (a)，并把 (b) 作为这次批次 3 的兜底。
2. **D14 的注册面要不要按本轮结果重写**：实测面数不是 7 面 9 文件——`include` 与 `rootDir` 是**两个不同的面**
   （前者管 assets strip root、后者管 tsc 语义），且 `apps/worker/tsconfig.app.json` 是 `apps/api` 那份的**全量副本**
   （54 行，无 drift spec 守）。若确定搬迁，D14 的清单要变成 10 面 10 文件。
3. **worker 生产面做到哪一档**：只补 compose service + `WORKER_STANDALONE`（小），还是连 CI 冒烟一起（中，
   挂在已有 services 的 `openapi` job，+25s）？我倾向「compose 与 CI 一起做」——只加 compose 的话，
   「cron 没挂上」仍然是静默的。
4. **`WORKER_STANDALONE=true` 的落点**：容器 `environment`（两个服务各写一遍）还是让镜像 `ENV` 默认带？
   前者显式但不 DRY；后者会让「单跑 api」的人也拿到让位语义（危险）。我倾向 compose 里两处显式写 + 注释说明双跑后果。
5. **日志目录**：worker 与 backend 共挂 `./logs`（轮转竞争）还是给 `./logs/worker`（部署脚本 `deploy/post-verify.sh` 无需改）？我倾向后者。
6. **`pnpm deploy` 是否带 `dist` 的遗留验证**（§3.1）由谁在什么时候补跑？这是 B1 唯一的未闭环点。
