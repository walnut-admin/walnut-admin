# 测试基建 Rust 化：调研与判定

> **定位**：回答「vitest / playwright / node:test 这一层，2026 年底的 Rust 生态（Oxc / Rolldown / VoidZero 栈 /
> 其他）有没有**可平替**或**可提速**的基建」。本篇只做**判定与证据**，不做排期；
> 怎么落地见[测试基建 Rust 化：实施计划](../plans/testing-infrastructure-rust-plan.md)。
> **读者**：要决定「换不换、升不升」的仓库所有者；按计划执行各阶段的 agent。
> **权威边界**：本篇是 **2026-11-28 的 as-of 快照**。外部世界的版本与能力以当日查到的官方页面为准
> （链接见第 11 节），仓库侧事实以代码与当日实测为准 —— 两者冲突时以代码为准。
> **与相邻文档的边界**：`lint` / 格式 / 类型检查 / 打包的 Rust 化判定在
> [Rust 化工具链迁移：考量与风险评估](./rust-toolchain-migration-assessment.md)（下称「评估」），本篇不重复；
> 本篇只覆盖**测试**这一层。

## 1. 元信息

| 项 | 值 |
|----|----|
| 调研日期 | 2026-11-28 |
| 分支 | `feat/rust-toolchain-migration` |
| 调研方法 | ① 仓库盘点（读各包的 vitest 配置、共享预设、turbo 编排、server 的 SWC 插件）② 外部查证（官方文档 / 迁移指南 / 博客 / issue，逐条标日期）③ **本机实测**（4.1.2 与 5.1.2 的同机对照、`deps.optimizer`、`isolate: false`、`pool: threads`，见第 9 节） |
| 口径 | 版本号一律是**当日快照**；「上游没有明确支持」写成「未支持」而不是「不能」；实测数字带方差，引用时看判据不看绝对值 |

## 2. 结论速览

**总判定：测试层的「Rust 平替」目前只存在于 **transform** 一格，而且这一格本仓**已经走完了**
（Vite 8 用 Oxc 取代 esbuild，vitest 的 transform 管线跟着换）。测试**框架**本身没有被 Rust 重写；
被 Rust 重写的是它脚下的编译层。因此本轮真正的可落地项不是「换框架」，而是**升级到与 Oxc 管线对齐的
vitest 5**，其余都是观望或不可行。**

| 候选 | 判定 | 一句话理由 |
|------|------|------------|
| Vitest 4.1.2 → 5.1.2 | **可落地（已验证全绿）** | 官方 bench 对「forks + isolated」这一档是 ±3%~−19%；本机实测中位数约 −6%、方差大。价值不在提速，而在**与 Oxc/Vite 8 同一条维护线**、依赖收敛、默认开 `fsModuleCache` |
| `deps.optimizer`（预打包提速） | **不可行** | 实测 −4%，且 10 个文件 13 条用例红（DI / 装饰器元数据走样）。收益与风险倒挂 |
| Oxc transform 取代 `unplugin-swc` | **观望（硬约束未解）** | Vite 8 的 Oxc transform **不降级 legacy 装饰器**；`oxc-transform` 虽有 `emitDecoratorMetadata`，但与 `tsc` 有已登记的偏差（[#21922](https://github.com/oxc-project/oxc/issues/21922)）。server 的 DI 靠元数据，不能拿「看起来能跑」换 |
| node:test + 类型剥离替换 tooling 小包 | **不可行（现阶段）** | Node 24 的类型剥离**不读 tsconfig**（无 `paths`）、不支持 enum / 参数属性 / 装饰器；`node:test` 的模块 mock 仍是 experimental，没有 `vi.mock` 的 hoist 语义。改造面是**重写 800+ 条断言**，换来的只有启动开销 |
| Rust e2e（chromiumoxide / fantoccini / playwright-rust） | **不可行** | 没有官方 Rust 绑定；两个活跃项目是 CDP / WebDriver 的**裸客户端**，Playwright 的 trace / 自动等待 / webServer / project 分层要么没有、要么自己造。本仓 e2e 的价值在编排与基线，不在驱动层 |
| Playwright 1.59 → 1.65.1 | **需拍板** | 6 个 minor 的差距里有 4 条会打到本仓（`inert` 等待、cookie RFC 6265、`useDefineForClassFields`、空 shard 失败）。必须整栈验收，本机无法完成 |
| `turbo-test`（Rust + V8 + Oxc 的 vitest 替身） | **观望** | 0.8.x、单人项目、bench 自报且方法有瑕；**自己承认装饰器元数据要回落到 `ts.transpileModule`**，Node 内建模块是部分 shim。对 Nest 后端是明确不适配 |
| Oxc minifier 进测试链 | **不适用** | 压缩只影响产物，不影响测试执行；本仓测试不跑 minify |
| coverage（v8）Rust 化 | **无对象** | v8 coverage 走 Node inspector，与 transform 引擎无关；Oxc 只在 istanbul 侧的**解析**上被用（vitest 5.1 的 `@vitest/istanbuljs` 去掉了 Babel） |

## 3. 现状盘点（仓库侧事实）

- **有 `test` 脚本的包以各包 `package.json` 为准**（判据是脚本本身，不是这份清单）：server 与 e2e 之外，
  共享包与 tooling 包各有自己的 vitest 配置。
  发现规则与覆盖率范围收敛在 `tooling/vitest-config` 的共享预设里（`defineWalnutVitestConfig`），
  `plugins` / `root` / `globals` 由各包显式传入。
- **server 是唯一需要 transform 插件的包**：`unplugin-swc` + `vite-tsconfig-paths`，因为 Nest 强依赖
  `emitDecoratorMetadata`。其余包走 Vite 8 的默认管线（Oxc）。
- **Vite 已是 8.4.0、Rolldown 1.3.x**：测试的 transform 与构建的打包**同一条 Rust 管线**
  （Vite 8 迁移指南：Oxc 取代 esbuild 处理 JS 变换与压缩）。
- **既有 Rust 基建**：`tsrs`（TS 7.1 checker，`types:check`）、TNB（`typescript` 包面 = tsgo 7.0.2 引擎 + classic 外壳）、
  oxlint / oxfmt、tsdown（rolldown）。测试层**唯一**还停在非 Rust 引擎的是 server 的 SWC transform。
- **Windows 是主开发机**：`tsrs --watch` 不可用（退出码 5），本地 watch 只能留给 tsc；
  Node 24.15+ 在 Windows 有原生崩溃回归带（偶发 `0xC0000005`），任何「提高并发」的方案都要先过这道约束。
- **e2e 是 Playwright 1.59.0**，6 个 stack profile（`default` / `smoke` / `risk` / `network` / `pages` / `journey`）、
  基线机制与隔离名单齐备。编排入口只有 `apps/e2e/scripts/run.ts`，顺序是硬约束。

## 4. Vitest 的 Rust 化现状

### 4.1 换掉的是编译层，不是框架

Vitest 的 transform 委托给 Vite 的管线。Vite 8 把 esbuild 换成 Rolldown + Oxc（transform 用 Oxc、
依赖预打包用 Rolldown、JS 压缩用 Oxc Minifier），所以**只要项目在 Vite 8 上，vitest 的 transform 就
已经是 Rust 的** —— 不需要任何 `--experimental.oxc` 之类的开关，这个开关在 2026-11 的 vitest 里
**不存在**（`experimental` 下与缓存有关的是 `fsModuleCache`，与 transform 引擎无关）。

本仓因此属于「已经吃到了 transform 提速」的那一类；继续找提速空间，只剩**框架自身的调度**
（worker 生命周期、模块图复用、IPC）这一层，而那一层是 JS/TS 写的。

一条可以当场复核的证据：在 server 的测试里，Vite 8 会打印
「`esbuild` option is set to false, but `oxc` option was not set to false … esbuild: false does not
have effect any more」，并提示默认转换已由 Oxc 接管 —— 这条警告本身就说明**默认转换引擎已经是 Oxc**，
配置里残留的 `esbuild` 相关开关全部失效（谁再想用 `esbuild: false` 关掉转换，必须改写 `oxc: false`）。

### 4.2 Vitest 5.0 / 5.1 带来了什么（官方口径）

官方 bench（`vitest-dev/benchmarks`，4.1.10 → 5.0，Apple M4 / 10 核 / Node 24，取 3 次中位数）：

| 场景 | 4.1 | 5.0 | 变化 |
|------|-----|-----|------|
| micro-utils（5 文件，vmThreads+jsdom） | 0.61s | 0.56s | −8% |
| node-library（40 文件，forks+isolated） | 0.86s | 0.75s | −13% |
| deps-heavy（vmThreads） | 1.59s | 0.74s | −53% |
| barrel-hell（817 模块，forks+isolated+fsModuleCache） | 1.33s | 1.08s | −18% |
| enterprise-monolith（1,280 模块，forks+isolated） | 7.24s | 5.83s | −19% |
| long-haul（80 文件，vmForks+happy-dom） | 5.43s | 4.06s | −25% |
| cpu-bound（30 文件，threads 满 worker） | 0.91s | 0.83s | −8% |

官方同时写明：**以环境初始化为主的格子（forks + jsdom + isolation）落在 ±3%**。
本仓 server 正是「forks + isolated + node」，所以对它的预期应当保守 —— 第 9 节的实测结果
（中位数约 −6%、单次最好 −21%、最差 +2%）与这条口径一致。

5.1 的性能数字（500 文件 / 962 模块 / 1,883 个 mock）：无 mock 31.7s→26.6s（−16%）、
有 mock 56.4s→27.2s（−52%）、混合 44.0s→27.1s（−38%）；istanbul 插桩快 5–10 倍。
后两条与本仓无关（本仓不用 istanbul，mock 密度也低）。

**5.0 的 breaking 里与本仓相关的**（逐条对照过代码）：

| breaking | 本仓是否受影响 | 依据 |
|----------|----------------|------|
| `clearMocks` 默认 `true` | **受影响，但全绿** | server 有大量 `vi.spyOn`；全量跑绿说明没有用例依赖「跨用例累积调用」 |
| `test.sequential` / `describe.sequential` 移除 | 不受影响 | 全仓无此用法 |
| `vitest/coverage`、`vitest/reporters` 等入口移除 | 不受影响 | 无引用；覆盖率走 `@vitest/coverage-v8` |
| `vi.mock` 嵌在函数/块内改为抛错 | 不受影响 | 现有 mock 都在模块顶层 |
| `-t` 的匹配串改为 `' > '` 连接 | 不受影响 | 仓内没有按名字过滤的固定写法 |
| `coverage.include` 语义改为「相对项目根、无通配符按目录」 | 不受影响 | 预设的 `include: ['src']` / server 的 `apps/api/src` 都是目录形态 |
| Vite 变 peer 依赖 | 不受影响 | 本仓直接依赖 `vite` 8.4.0 |
| bench API 重写 | 不受影响 | 不用 `bench` |

### 4.3 与 tsrs / TNB 的关系

三者**不在一条栈上**：`tsrs` 与 TNB 是**类型检查**引擎，vitest 的 transform 走 Oxc/SWC，
运行时类型信息来自装饰器元数据。因此「vitest 与 tsrs 的兼容性」这个问题本身不成立 ——
它们唯一的接触点是 `types:check` 会不会去读测试文件（会，`.spec.ts` 也在 tsconfig 范围内），
而那是类型检查的门禁，不是测试运行。本仓 `types:check` 全绿（验证记录见第 9 节）。

## 5. node:test + 类型剥离这条路

### 5.1 Node 24 的类型剥离能做/不能做

| 能力 | 状态 |
|------|------|
| 直接 `node --test` 跑 `*.test.ts` | **可以**，默认就会匹配 TS 测试文件 |
| 类型剥离稳定性 | **stable**（v24.12.0 起；v23.6 起默认开启） |
| 读 tsconfig / `paths` 别名 | **不支持**，明确不读 tsconfig。替代只有 `#` 开头的 subpath imports |
| enum / 带运行时代码的 namespace / 参数属性 / import alias | **不支持**（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，要 `--experimental-transform-types`） |
| legacy 装饰器 | **不转换**，解析即报错 |
| `node_modules` 里的 TS | **拒绝处理** |
| 导入说明符 | **必须带扩展名**（`./file.ts`） |

最后两条对本仓是结构性的：workspace 内部是 `workspace:*` 源码直消费（`@walnut/utils` 等），
类型剥离**不会替你解析包名到源码**；而 server 的装饰器是硬需求。

**顺带澄清一条常被混进来的名字**：`tsrs` 是**类型检查器**（TS 7.1 的 Rust 移植，本仓拿它做
`types:check`），它**不是** test runner，也不提供断言 / mock / 环境隔离。所以「node:test + tsrs」
不是一个组合方案，而是两件不相干的事：`node:test` 负责跑，`tsrs` 只可能负责「给 `.ts` 测试文件做类型检查」——
而后者本仓的 `tsrs --noEmit` 已经覆盖了（`.spec.ts` 在 tsconfig 范围内）。

### 5.2 node:test 与 vitest 的功能差距

| 面 | node:test | vitest | 对本仓的含义 |
|----|-----------|--------|--------------|
| 断言 | `node:assert`（+ `assert.register` 自定义） | `expect`（jest 兼容、快照、`expect.poll`） | 迁移=重写断言；本仓断言面很宽 |
| 模块 mock | `mock.module` 仍是 experimental（`--experimental-test-module-mocks`），且**同步 loader 下异步 customisation 被忽略** | `vi.mock` 静态 hoist、成熟的模块图 | server 的 `vi.mock('@serenity-kit/opaque')` 这类用法没有等价物 |
| 定时器 | `mock.timers`（stable），但**解构导入的 `setTimeout` 不支持** | `vi.useFakeTimers` 覆盖更全 | 影响面取决于被测代码写法 |
| 快照 | stable（v23.4+），`JSON.stringify` 序列化 | `toMatchSnapshot` + 交互式审阅（5.1） | 本仓几乎不用快照 |
| 覆盖率 | `--experimental-test-coverage`（Stability 1，**experimental**） | v8 provider（stable） | 门禁不能用 experimental 的东西 |
| watch / 过滤 / 报告 | watch experimental；tag filter、`--test-rerun-failures` 等新 | 成熟 | 本仓 `test:watch` 是日常入口 |
| 环境 | 无 jsdom / happy-dom 集成 | 一等公民 | `packages/platform-web/client` 需要 |
| 并发模型 | 进程隔离（`--test-isolation`） | pool：forks / threads / vm | —— |

### 5.3 对 tooling 小包值不值

tooling 小包的耗时结构是「启动开销 > 用例本身」：`tooling/scripts` 有 48 个文件 / 829 条用例，
单跑约 12–20s，其中真正跑用例的份额在 5.1 的报告里是 82%，但那些用例大量是**起子进程 / 扫全仓**
（`check-workflow-shell` 一条就 10s）。换成 node:test，省下的是 vitest 的启动与 transform
（对纯逻辑文件是毫秒级），**省不掉**子进程与扫盘；而代价是重写断言 + 失去 `vi` 的全部能力。
结论：**不值得**。真要压这一段的耗时，杠杆在「把串行的重型用例挪到单独的 task / 用并发度控制」，
不在换 runner。

## 6. Playwright 的替代面

### 6.1 Rust 侧有什么

| 项目 | 协议 | 成熟度（2026-11） | 为什么不能平替 Playwright |
|------|------|-------------------|---------------------------|
| `chromiumoxide` | CDP | 活跃、~1.4k star、0.7.x | 只支持 Chromium；无 trace viewer、无 `expect` 自动重试体系、无 webServer 编排、无 project/profile 分层；CI 需要自己装浏览器 |
| `fantoccini` | W3C WebDriver | 最成熟（~2k star、0.22.x） | 需要外部 driver 进程；无 CDP 深度能力（WebSocket 帧、网络拦截）；同样没有测试运行器 |
| `playwright-rust` / `playwright-rs` | 包 Node driver | **最不成熟**，官方**没有** Rust 绑定 | 只是别人对 Node driver 的封装；等于把 Node 又装回来 |
| `headless_chrome` / `thirtyfour` | CDP / WebDriver | 低层客户端 | 同上，是「驱动」不是「测试框架」 |

第三方交叉 bench 的结论也值得记一笔：Rust 侧相对 Python-Playwright 的**确定性**优势主要来自
「去掉了 Node driver 这一层」，不是「Rust 更快」；浏览器启动 ~75ms vs ~250ms、内存 10–25MB/run vs
150–350MB/run 是真的，但**测试框架能力**（trace、自动等待、多浏览器、报告、shard、fixture）
要自己重建。本仓 e2e 的资产恰恰全在那一层：6 个 profile、基线机制、隔离名单、UA/XFF/Redis 三条安全闸。

**判定：不可行。** 保留 Playwright 不是因为「没有 Rust 版」，而是因为要换的是一整套**测试运行器语义**，
而 Rust 侧提供的是**浏览器驱动** —— 换过去等于自研一个 Playwright。

### 6.2 版本差距：1.59.0 → 1.65.1

时间线：1.59.0（2026-04-01）→ 1.65.1（2026-11-13）。6 个 minor 的距离，与本仓相关的 breaking：

| 变化 | 风险 | 说明 |
|------|------|------|
| 动作等待元素**非 inert**（click/check/tap/fill/clear/selectOption） | 中 | 覆盖层/锁屏类用例可能从「能点」变成「超时」；本仓有锁屏闭环（J1–J4） |
| cookie 匹配改按 **RFC 6265**（host-only / path） | 中 | 设备身份与 session cookie 的断言面要复核 |
| `useDefineForClassFields` 生效 | 低 | 会打断「字段初始化器里引用别的字段」的 page object 写法；本仓 e2e **没有** page object 类（用例直接拿 `page`），风险低但要在升级时确认 |
| 空 shard 运行失败（要 `--pass-with-no-tests`） | 低 | 本仓不用 shard |
| `params` 字符串改为**追加**到已有 query | 低 | 本仓 e2e 不走 `params` |
| 代理凭据不再发给站点 | 低 | 不用代理认证 |
| Bun 运行器 / `failures` reporter / `onlyFailures` / `lock: '-exclusive-'` / `locator.normalize()` | 收益 | `onlyFailures` 对 CI 报告有用；`-exclusive-` 与「单 worker」现状重叠 |

**判定：需拍板。** 升级本身是常规动作，但本仓的验收必须整栈（PG + Redis + dist-stage 前后端），
本机不具备条件；且改动面横跨「编排脚本 + 6 个 profile 的基线」，不适合与其它变量一起动。

## 7. 其他测试相关 Rust 基建

| 方向 | 现状 | 判定 |
|------|------|------|
| **Oxc minifier 用于测试提速** | oxc-minify 0.159 在 `minification-benchmarks` 里对 terser 快约 20–30 倍、体积相当 | **不适用**：测试不压缩代码；本仓 `build.minify` 的取舍属于构建轨道 |
| **`turbo-test`（Rust + V8 + Oxc 的 vitest 替身）** | 0.8.x（2026-11-27 仍在发版）、单作者、自报 bench（与 jsdom 比 5–12×、干净对比约 2.4×）；**不支持** TLS server / 原生模块 / 完整 ICU，Vue SFC 默认关闭，插件数组不执行；装饰器元数据「先 esbuild，失败再回落 `ts.transpileModule`」 | **观望**：对 Nest 后端明确不适配；除非将来它把「元数据」与「Node 内建模块」两件事做实，否则不进评估 |
| **coverage** | v8 coverage 走 Node inspector（`c8` 同源）；vitest 5.1 的 v8 provider 换成分块合并、`coverage.ignoreNode` 走 AST；istanbul 侧改用 Oxc 解析（不再用 Babel） | **无 Rust 化对象**：采集在 V8 里，插桩在 JS 里；Rust 只影响「解析源码找分支点」这一小步 |
| **mock / fixture 工具链** | `@vitest/mocker`、`msw` 等都是 JS；没有 Rust 等价物，也没有必要 | **无对象** |
| **Storybook / 组件测试的 Rust 工具** | Storybook 不在本仓依赖里；Vue 组件测试走 `@vitejs/plugin-vue` + jsdom，transform 已是 Oxc | **无对象** |
| **`oxc-parser`（napi 解析器）** | 已在 ecosystem 稳定 | 可选项：`tooling/scripts` 里几个手写正则扫描器（`check-dynamic-imports`）可以改用它，但那是**脚本实现**的改进，与测试提速无关 |

## 8. swc → Oxc：server 测试栈的硬约束

### 8.1 约束是什么

Nest 的 DI 靠 `emitDecoratorMetadata` 写出的 `design:paramtypes` / `design:type`。server 的 126 个
测试文件全部通过 `unplugin-swc` 走 SWC transform，就是为了这份元数据。

### 8.2 Oxc 侧的真实状态（2026-11）

- **Vite 8 的 Oxc transform 明确「不降级 native 装饰器」**（迁移指南给的两条出路是 Babel 插件或
  `@rollup/plugin-swc`）。也就是说**在 Vite 管线里**用 Oxc 替 SWC 这条路，官方自己写着走不通。
- **`oxc-transform`（napi 包）有 `experimentalDecorators` + `emitDecoratorMetadata`**，并且有专门的
  `DecoratorMode::ExperimentalWithMetadata`。但它与 `tsc` 有**已登记**的偏差（issue #21922）：
  类型别名引用退化成 `Object`、`strictNullChecks: false` 时的可空联合不退、跨文件 enum 退化成 `Object`、
  前向/循环类引用静默给 `Object`（`tsc` 会抛 TDZ）。
- 这些偏差恰好打在 Nest 的三处要害：DI 参数类型、TypeORM 列类型推断、Swagger schema。

### 8.3 本仓的实测证据

在本轮里做过一次「把依赖预打包引入测试链」的对照（`deps.optimizer.ssr` 开 `@nestjs/*` 等 10 个包）：
耗时 85.4s vs 基线 88.7s（**−4%**，在噪声内），但 **10 个文件 / 13 条用例红、30 条被跳过**，
症状是 DI 拿不到 provider、i18n 读不到 `t`。这不是「Oxc 元数据」的直接实验，但足以说明：
**把 server 测试的模块图换一种装配方式，第一个坏的就是装饰器元数据与 DI。**

**判定：观望。** 若将来要动，验收门只有一个 —— 拿一个**带 method 装饰器 + DTO + `@Inject`** 的真实
server 测试文件，在候选 transform 下跑通并**断言 `Reflect.getMetadata('design:paramtypes')` 的具体值**，
再拿至少一个 TypeORM 实体与一个 Swagger 装饰器做同样断言；否则不换。

## 9. 本机实测（2026-11-28，Windows / 12 核 / Node 24.21.0）

### 9.1 基线（vitest 4.1.2）

`turbo run test --force`（冷缓存，15 个 task）：**136.4s**（turbo 报的总时长），其中
server 100.3s、scripts 59.3s、contract 26.6s、vite-config 22.8s、eslint-config 18.2s、
utils 14.0s、e2e 10.1s、release 9.6s、client 9.5s（这些是**并发下的 task 时长**，会互相抢 CPU）。

server 单跑（独占机器）：85.7s / 88.6s / 88.7s，报 `transform 60–78s, import 784–828s`
（import 是**各 worker 累计值**，「1,025 个模块被求值 10,571 次」）。

### 9.2 vitest 5.1.2 同机对照

| 观测 | 4.1.2 | 5.1.2 | 备注 |
|------|-------|-------|------|
| server 单跑 | 85.7 / 88.6 / 88.7s | 69.2 / 83.4 / 90.0s | 中位数 88.6 → 83.4s（**−6%**），方差覆盖了差异 |
| `tooling/scripts` 单跑 | 27.6 / 20.5 / 14.4s | 19.3 / 16.1 / 18.1s | 中位数 20.5 → 18.1s，同属噪声区间 |
| 全量 `turbo test --force` | 136.4s | 94.6s | **不可直接引用**：同一轮里 `build` 类 task 也快了 55–63%，说明机器负载不同 |
| 全量用例数 | 126 文件 / 1023 条 | 126 文件 / 1023 条 | 全绿 |

**怎么读这组数**：单跑的中位数（−6%）与官方「forks + isolated 这一档 ±3%~−19%」的口径一致；
`turbo` 的总时长受机器负载影响太大，只能用来看「没有回归」，不能当提速证据。
这一条不是推测：同一套 5.1.2 的配置后来又跑过一次全量，server 的 task 时长从 79.4s 变成 128.9s
（同一台机器、同一份代码），而 `build` 类 task 同时在两个方向上大幅波动 —— 变量只有一个：当时机器上
还有别的重任务。

### 9.3 顺带测掉的三条路（全部否决）

| 实验 | 结果 | 判定 |
|------|------|------|
| `deps.optimizer.ssr.enabled` + 10 个 Nest/工具包 | 85.4s（−4%），**10 文件 / 13 条红** | 否决：收益与破坏面倒挂 |
| `--no-isolate` | **25.1s（−72%）**，但 3 文件 / 7 条红 | 否决（本轮）：红的是全局状态（`cookie` 的 env、i18n 的 `t`、`@serenity-kit/opaque` 的文件级 mock）。**这是最大的单点提速**，但它是「共享模块图」换来的，前提是把那 3 个文件的隐式全局状态改成显式注入 —— 属于独立议题，见计划 |
| `--pool=threads` | 80.4s（−9%），全绿 | 观望：本仓 Windows 上有 Node 原生崩溃回归带的先例，threads + 原生 SWC 的组合要更多轮次才敢上车 |

### 9.4 一个计划外的发现（已修）

冷缓存 `--force` 下命中过一次 `@walnut/contract#test` 的假红：
`ENOENT ... scandir '...\contract\dist'`。原因是 `contract` 的 `test` 脚本自己 `pnpm run build`，
而**别的包**的 `^build` 同时触发 `contract#build`，两条 task 在同一份 `dist/` 上并发写
（tsdown 的 `Cleaning 38 files` 落在对方 `build-barrel.ts` 的 `readdir` 之间）。
处置：在 `packages/platform-any/contract/turbo.json` 给 `test` 显式挂上自家的 `build`
（`dependsOn: ["^build", "build"]`，数组是整键替换所以 `^build` 必须一起写），
`turbo --dry=json` 已确认依赖边成立。

### 9.5 第二个计划外的发现（已修）

`apps/server` 的 `test:debug` 脚本带着 `--threads=false` —— 这个参数在 vitest 里早已移除（现在只剩
`--pool` / `--isolate` / `--no-file-parallelism`），实测会以 CAC 的 unknown option 直接退出 1，
也就是**这个脚本按不下去**。处置：改成 `--no-file-parallelism`（保留 `--inspect-brk` 与
`--logHeapUsage` 的原意：单进程、断点起步、看堆），启动后确实进到 `Debugger listening on ws://…`。

## 10. 判定表

| 项 | 判定 | 落地条件 | 依据 |
|----|------|----------|------|
| vitest 5.1.2 | **可落地** | 已全绿（15 task / 1023 用例 / lint / types） | §4.2 / §9.2 |
| contract `test` 挂自家 `build` | **可落地** | 已改，依赖边经 dry-run 确认 | §9.4 |
| `deps.optimizer` | **不可行** | —— | §9.3 |
| `isolate: false` | **观望（需拍板）** | 先修 3 个文件的隐式全局状态，再谈 | §9.3 |
| `pool: threads` | **观望** | 需要多轮无崩溃证据（Windows 原生崩溃带） | §9.3 |
| Oxc 替 `unplugin-swc` | **观望（硬约束）** | 元数据实证门（§8.3） | §8 |
| node:test 替换 | **不可行** | 除非出现「读 tsconfig + 装饰器 + stable mock」的组合 | §5 |
| Rust e2e | **不可行** | —— | §6.1 |
| Playwright 1.65.1 | **需拍板** | 整栈验收 | §6.2 |
| `turbo-test` | **观望** | 上游补齐元数据与 Node 内建模块 | §7 |

## 11. 参考资料

访问日期均为 2026-11-28。

| 主题 | 链接 |
|------|------|
| Vite 8 迁移指南（Oxc 取代 esbuild；装饰器不降级的说明） | [vite.dev/guide/migration](https://vite.dev/guide/migration) |
| Vitest 5.0 公告（bench 方法与本表数字） | [vitest.dev/blog/vitest-5](https://vitest.dev/blog/vitest-5.html) |
| Vitest 5.1 公告（mock / istanbul / `--last-failed` / `--since-last-run`） | [vitest.dev/blog/vitest-5-1](https://vitest.dev/blog/vitest-5-1.html) |
| Vitest 迁移指南（5.0 breaking 全表） | [vitest.dev/guide/migration](https://vitest.dev/guide/migration.html) |
| Vitest `deps.optimizer` | [vitest.dev/config/deps](https://vitest.dev/config/deps.html) |
| Vitest releases / dist-tags（5.1.2 于 2026-11-25 发布） | [npm vitest](https://www.npmjs.com/package/vitest) |
| Oxc transformer：TypeScript 装饰器与 `emitDecoratorMetadata` | [oxc.rs transformer/typescript](https://oxc.rs/docs/guide/usage/transformer/typescript) |
| Oxc `emitDecoratorMetadata` 与 tsc 的偏差（跟踪 issue） | [oxc-project/oxc#21922](https://github.com/oxc-project/oxc/issues/21922) |
| Oxc 对 `accessor` 元数据的修复 | [oxc-project/oxc#21966](https://github.com/oxc-project/oxc/pull/21966) |
| legacy 装饰器在 `accessor` 上的问题 | [oxc-project/oxc#20133](https://github.com/oxc-project/oxc/issues/20133) |
| Stage 3 装饰器尚未落地 | [oxc-project/oxc#9170](https://github.com/oxc-project/oxc/issues/9170) |
| Oxc Transformer Alpha（3–5× vs SWC 的口径） | [transformer-alpha](https://github.com/oxc-project/website/blob/34e31e4ee1f1403c67356c3d13088ec27457ccb7/src/blog/2024-09-29-transformer-alpha.md) |
| Oxc minifier 对比 terser / esbuild | [privatenumber/minification-benchmarks](https://github.com/privatenumber/minification-benchmarks) |
| Node 类型剥离（Node 24 文档） | [nodejs.org/docs/latest-v24.x/api/typescript](https://nodejs.org/docs/latest-v24.x/api/typescript.html) |
| Node test runner（mock / snapshot / coverage / watch 的稳定性） | [nodejs.org/api/test](https://nodejs.org/api/test.html) |
| Playwright 1.65 release notes | [playwright.dev/release-notes](https://playwright.dev/docs/release-notes) |
| Playwright releases（1.65.1 于 2026-11-13 发布） | [npm @playwright/test](https://www.npmjs.com/package/@playwright/test) |
| `turbo-test`（Rust + V8 + Oxc 的 vitest 替身） | [miaskiewicz/turbo-test](https://github.com/miaskiewicz/turbo-test) |
| chromiumoxide | [crates.io chromiumoxide](https://crates.io/crates/chromiumoxide) |
| fantoccini | [crates.io fantoccini](https://crates.io/crates/fantoccini) |
| unplugin-swc 2.0.0（仅 Node 下限变化） | [npm unplugin-swc](https://www.npmjs.com/package/unplugin-swc) |
