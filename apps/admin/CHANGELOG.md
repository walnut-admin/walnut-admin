# @walnut/admin

## 0.1.10

### 修复

- [`d561a1f`](https://github.com/walnut-admin/walnut-admin/commit/d561a1fe0cddc419cc36c653e7d6d05b27def7ed) **deploy** post-verify 的失败原因转成 annotation（否则只能靠翻日志）

## 0.1.9

### 修复

- [`2e25cbb`](https://github.com/walnut-admin/walnut-admin/commit/2e25cbb61f5cecefa064b7a134c0271219582fe4) **deploy** post-verify 不再把空库首启的已捕获噪声当致命错误

## 0.1.8

### 修复

- [`99b6bb8`](https://github.com/walnut-admin/walnut-admin/commit/99b6bb8b97f271e4a5671850fc7100f71bf5f164) by @Zhaocl1997 **deploy** digest 核对取错对象（image inspect 不认容器名）+ 取不到就不判

## 0.1.7

### 修复

- [`75030f0`](https://github.com/walnut-admin/walnut-admin/commit/75030f0e29fe2c1dbe81bd822b3f401c9658aa4f) **release** ci / build 类型改为 patch（会随发版交付，放宽前发不出去）

### 基建（CI / 构建 / 部署）

- [`c11b5ee`](https://github.com/walnut-admin/walnut-admin/commit/c11b5ee5df6e8ee178adc8cba08bd97b9a118006) by @Zhaocl1997 **release** 镜像作业超时 45 分钟抬到 90（bake 波动大，慢也能跑完）
- [`5ee3a50`](https://github.com/walnut-admin/walnut-admin/commit/5ee3a5048ddc8d1033c15d8d12b2934225bc0678) by @Zhaocl1997 **tooling** 新增 workflow shell 语法门禁（逐块 bash -n）+ 五处接线
- [`1c0599a`](https://github.com/walnut-admin/walnut-admin/commit/1c0599ae21adafa1e7860c64ec3ca5ff9f31f7ff) by @Zhaocl1997 **release** 把 bake 整体耗时写进 run summary（P2 的数据来源）
- [`6be9d81`](https://github.com/walnut-admin/walnut-admin/commit/6be9d81d21b4bfaec20c217af935e4debda07131) by @Zhaocl1997 **tooling** CI 的 admin 构建改为 --force（缓存掩盖过一次发版事故）
- [`e029231`](https://github.com/walnut-admin/walnut-admin/commit/e029231918eb44905b4434830270c7779b2f97e0) by @Zhaocl1997 **release** 发版产出 digests.json 并随 Release 发布（digest 固定的前半）
- [`dfa3b82`](https://github.com/walnut-admin/walnut-admin/commit/dfa3b826c9fe2d6ac1dedb526a5fdc5a2a92e304) by @Zhaocl1997 **deploy** 按 Release 记录的 digest 核对线上镜像（tag 被重打也躲不过）

## 0.1.6

### 修复

- [`6531261`](https://github.com/walnut-admin/walnut-admin/commit/65312610b28973619d43713de495cdf706b3f067) by @Zhaocl1997 **deploy** 注入步骤改用带引号 heredoc（去掉三层嵌套引号）+ 阶段标记

## 0.1.5

### 新功能

- [`4495a1b`](https://github.com/walnut-admin/walnut-admin/commit/4495a1bd17f2aefc4a034e7f18a3966b2814287c) **admin** 组件声明纳入 git 跟踪并删掉 stub 生成器（换机器开箱可用）

## 0.1.4

### 修复

- [`c13082a`](https://github.com/walnut-admin/walnut-admin/commit/c13082a632dcd65580417931e746ffc982353ae5) by @Zhaocl1997 **deploy** 参考数据注入改为每次部署都跑（tag 自动发版够不到那个开关）
- [`9a198c1`](https://github.com/walnut-admin/walnut-admin/commit/9a198c1291e363c976d504b6d47e354e64a9db42) by @Zhaocl1997 **deploy** nginx 镜像自带 nginx.conf —— Alpine 那份把 vhost 包含在 http 之外，容器起不来

## 0.1.3

### 修复

- [`96572f5`](https://github.com/walnut-admin/walnut-admin/commit/96572f5cff802e11f35aab1c66aaa2750d7a99e7) by @Zhaocl1997 **deploy** 先把容器起起来、注入参考数据，再等健康（空库首次部署必挂的顺序错误）

### 性能

- [`f22de5c`](https://github.com/walnut-admin/walnut-admin/commit/f22de5c94a9748fb73d0d6c4a8521807daf843fd) by @Zhaocl1997 **release** bake 的 cache-to 去掉 mode=max（冷缓存下最慢的一段）

## 0.1.2

### 修复

- [`e15ac8c`](https://github.com/walnut-admin/walnut-admin/commit/e15ac8c9ff45e3c1b212ecf7eacbf36870d48902) **release** bake 改用 Path context（`source: .`）—— v0.1.0 / v0.1.1 连挂两次的真因

## 0.1.1

### 修复

- [`b53611e`](https://github.com/walnut-admin/walnut-admin/commit/b53611e07bc81833f013d08b07479a9b202f521b) **release** bake 的 dockerfile 改成相对 context 根的路径（v0.1.0 首次发版构建失败）
- [`6d4598b`](https://github.com/walnut-admin/walnut-admin/commit/6d4598b7d9c7f3a02b3a11b486ed3c28fe7bca45) **release** 只改基建的提交不再被当成噪声丢弃 —— 归到 `infra` 桶并按 type 参与发版
- [`d26566b`](https://github.com/walnut-admin/walnut-admin/commit/d26566bd5bc831c2ce4baafdef969f4d5ec8dc9b) **release** 载体包改成真实包名 `@walnut/scripts`（上一版自造的 `infra` 被 pnpm 拒了）

## 0.1.0

### 新功能

- [`b63ec42`](https://github.com/walnut-admin/walnut-admin/commit/b63ec42ad270db58522cf0d1385a432fb94b4175) by @Zhaocl1997 three-repo monorepo merge — Phase 1 complete
- [`5c8fbd8`](https://github.com/walnut-admin/walnut-admin/commit/5c8fbd8eb9f49c7265103d2e5eab2b3ca7046c76) by @Zhaocl1997 **contract** create @walnut/contract, consolidate shared types/constants across frontend and backend
- [`b4db0d2`](https://github.com/walnut-admin/walnut-admin/commit/b4db0d2b34015e55e6dda6a04b88ebdc66a718f9) by @Zhaocl1997 dotenvx encrypted env management + staging->stage unification
- [`11d39f2`](https://github.com/walnut-admin/walnut-admin/commit/11d39f26eff12e32427eea90a85781d397f77841) by @Zhaocl1997 add ai-code-check skill for automated code quality checks
- [`b5438d9`](https://github.com/walnut-admin/walnut-admin/commit/b5438d9d2a39398b0d42cd6c269d3779984916d6) by @Zhaocl1997 add dependency-management skill for pnpm catalog workflow
- [`7727064`](https://github.com/walnut-admin/walnut-admin/commit/77270640f109befd20852a969331635afcbbacf7) by @Zhaocl1997 adopt changesets + git-cliff release pipeline
- [`f00f980`](https://github.com/walnut-admin/walnut-admin/commit/f00f98089af3800384f85cac38802a16842bc20e) by @Zhaocl1997 add turbo boundaries with tag-based architecture enforcement
- [`baf5207`](https://github.com/walnut-admin/walnut-admin/commit/baf52075dc83dd36d146cf16df76998f98509ab6) by @Zhaocl1997 selective barrel exports for all packages, add ADR 0013
- [`04130cf`](https://github.com/walnut-admin/walnut-admin/commit/04130cf295d6bb7acfbade28b4becb5097859f48) by @Zhaocl1997 Step 2.1 — add socket/cookie/token/AES-GCM constants to contract, de-duplicate across FE/BE
- [`dec4619`](https://github.com/walnut-admin/walnut-admin/commit/dec4619e0da22d78f469fc97651fb390bbb4e92d) by @Zhaocl1997 Step 3.4 — add createWalnutStore() factory + Cookie to @walnut/client, admin Cookie re-exports
- [`0261bf1`](https://github.com/walnut-admin/walnut-admin/commit/0261bf184ae59314972b9c805fd37c64856eaed4) by @Zhaocl1997 **contract** 补全路由常量，迁移 admin 硬编码 API 路径
- [`b873b4f`](https://github.com/walnut-admin/walnut-admin/commit/b873b4fc995ce39bfe020bb62c8c8526ffd0f07d) by @Zhaocl1997 **ui** 新增 @walnut/ui 包，迁入 Switch/DynamicTags/TimePicker（POC）
- [`725a0fc`](https://github.com/walnut-admin/walnut-admin/commit/725a0fc1a40ae502d7359c2b7dea125268189a02) by @Zhaocl1997 **tooling** 抽取 @walnut/commitlint-config 与 @walnut/release 包
- [`18c699d`](https://github.com/walnut-admin/walnut-admin/commit/18c699ddfdaa8699dd0d1cdf2e9aa9ea51175ee4) by @Zhaocl1997 **docker** add multi-stage Dockerfile for @walnut/admin with brotli static server
- [`9f75c0e`](https://github.com/walnut-admin/walnut-admin/commit/9f75c0ef8af13968b472f3590e8d4ccf75d03e0d) by @Zhaocl1997 **docker** nginx image with brotli modules (alpine official packages)
- [`599622d`](https://github.com/walnut-admin/walnut-admin/commit/599622d0954cc6051c2bf79c38bbaba624211475) by @Zhaocl1997 **deploy** add docker-compose orchestration with nginx entry (brotli, internal network)
- [`2d820d3`](https://github.com/walnut-admin/walnut-admin/commit/2d820d3c2137926fbf197c25f4615ea38c70104f) by @Zhaocl1997 **deploy** fill real domains (www/api.walnutadmin.com), ignore deploy/env
- [`2c3c604`](https://github.com/walnut-admin/walnut-admin/commit/2c3c6042f89d3d04be2739bc5b5acd665daa2fdb) by @Zhaocl1997 **deploy** 部署后验证（post-verify）——轮询容器日志 + 端到端校验
- [`9100a41`](https://github.com/walnut-admin/walnut-admin/commit/9100a4138cb99f87509895807f34fc87708445e4) by @Zhaocl1997 **tooling** 新增「文档引用」门禁 —— 活文档里的包名与仓库路径必须真实存在
- [`64512cc`](https://github.com/walnut-admin/walnut-admin/commit/64512cc754ca6d3af00f71b782615ebeca9a9f0e) by @Zhaocl1997 **tooling** 文档门禁扩到 markdown 链接 + R11 收尾（又抓出 17 类真失效）
- [`ca07d53`](https://github.com/walnut-admin/walnut-admin/commit/ca07d532bb10416e41e200eed4a5922c36831134) by @Zhaocl1997 **tooling** 新增共享测试预设 @walnut/vitest-config（第 6 个 tooling 包，P3-14）
- [`27b092f`](https://github.com/walnut-admin/walnut-admin/commit/27b092faa080ab1dd2df143fb311ca4fd3ade0af) by @Zhaocl1997 **tooling** 文档代码块门禁落地（F2③）—— 先量后做，把「必须编译」收窄成「必须能解析」
- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器
- [`3edfa7c`](https://github.com/walnut-admin/walnut-admin/commit/3edfa7c7f42b31ab9ff6164b300d98f15d8dca8d) by @Zhaocl1997 **tooling** turbo 缓存边界门禁 + 三处边界修正
- [`a157e08`](https://github.com/walnut-admin/walnut-admin/commit/a157e08ad960b4b419b1851dcc9f76256fb17b39) by @Zhaocl1997 **tooling** 根级 lint 变成可缓存的 turbo 根任务
- [`da2c36d`](https://github.com/walnut-admin/walnut-admin/commit/da2c36d4d80026ccf148c217d6cf673760242b83) by @Zhaocl1997 **tooling** turbo 升到 2.11.2，拿到本地缓存回收与并发上限
- [`23d63c4`](https://github.com/walnut-admin/walnut-admin/commit/23d63c45a35f30da6fe2971d3fda58051e3169a2) by @Zhaocl1997 **tooling** 接 eslint-plugin-turbo，未声明的环境变量不再被静默剥离
- [`8dfde30`](https://github.com/walnut-admin/walnut-admin/commit/8dfde3056634df76017450d7b9a05057d6134805) by @Zhaocl1997 **tooling** 门禁接线反向断言 + catalog 锁步门禁（A1/A2/A3/A4/B1/B2）
- [`cfb7b57`](https://github.com/walnut-admin/walnut-admin/commit/cfb7b575391b0414d541fd3e6d4ce01cbbe34b02) by @Zhaocl1997 **tooling** 新增入口 nginx 安全响应头门禁（lint:nginx-headers）
- [`6cf07f6`](https://github.com/walnut-admin/walnut-admin/commit/6cf07f60014aa4df7568a38386ed4f20dc11a3a6) by @Zhaocl1997 **tooling** 产物去密体检（lint:dist）
- [`b88227d`](https://github.com/walnut-admin/walnut-admin/commit/b88227d0d035da8d71764f15874e08f4a5d90c50) by @Zhaocl1997 **eslint-config** 两条脚本入口规则（文件头 / 退出码三态）+ 本包第一套测试
- [`b823a01`](https://github.com/walnut-admin/walnut-admin/commit/b823a0116e2adfa552267ce434c0c3a160d56e29) by @Zhaocl1997 **tooling** 源码密钥形态门禁（lint:secrets）—— 被一次真实的 push 拒绝逼出来的
- [`ab240c8`](https://github.com/walnut-admin/walnut-admin/commit/ab240c869695d2b39c6d44417434fed748589f0f) by @Zhaocl1997 **tooling** exports-shape 门禁（lint:exports）+ 对比页状态补齐
- [`cac3590`](https://github.com/walnut-admin/walnut-admin/commit/cac359017cb8424bdfe29c809f170cbaf832abfe) by @Zhaocl1997 **tooling** 新门禁 lint:pre-hooks —— 跑 vite / vue-tsc 的脚本必须先接生成（那次 CI 事故的守卫）
- [`a01d451`](https://github.com/walnut-admin/walnut-admin/commit/a01d45150fdda280b3ce926b82efb112b9153916) by @Zhaocl1997 **tooling** 新增 `lint:dts` —— 手写 .d.ts 关掉 skipLibCheck 查一遍
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量
- [`71c8b7c`](https://github.com/walnut-admin/walnut-admin/commit/71c8b7c5e3f07445daba8045bbf858a9e9ce0b7f) by @Zhaocl1997 **tooling** 新增 `pnpm db:seed` —— 初始化数据播种（幂等；app_key 现生成）
- [`8db6801`](https://github.com/walnut-admin/walnut-admin/commit/8db680112af00935ebaf09c43b82c259d1294237) by @Zhaocl1997 **tooling** 新增 `pnpm db:export` + `--with-areas`（seed 数据从此"可再生成"）
- [`970d669`](https://github.com/walnut-admin/walnut-admin/commit/970d669d20fa89a87aa8eaa99865da294220a4b2) by @Zhaocl1997 **tooling** 新增 `pnpm lint:seed` —— 初始化数据的形态门禁（含 12 条反例用例）
- [`7426bfc`](https://github.com/walnut-admin/walnut-admin/commit/7426bfcf4d0068c4fb97feda2e446418231c3192) by @Zhaocl1997 **tooling** 新增 `pnpm lint:emoji` —— 注释里不许有 emoji（跨所有被跟踪文本文件）+ 常驻文档去 emoji
- [`001cc83`](https://github.com/walnut-admin/walnut-admin/commit/001cc831715fb52860b793543571d8026add42b9) by @Zhaocl1997 **tooling** 新增 `pnpm smoke:dist` 产物冒烟（真实浏览器断言已挂载）+ 进 CI
- [`c724f89`](https://github.com/walnut-admin/walnut-admin/commit/c724f89c25e13d9279f81274ae266c58e63c5f45) by @Zhaocl1997 **tooling** `db:seed --admin` —— 在本机建口令凭证，并当场验证登录握手（seed 链路收口）
- [`96c2143`](https://github.com/walnut-admin/walnut-admin/commit/96c214336c22fb4f1c51b5fa5f2f4272f7ab7e2d) by @Zhaocl1997 **tooling** `pnpm seed:pack` + 随 Release 发布初始化数据资产
- [`b287256`](https://github.com/walnut-admin/walnut-admin/commit/b287256a3df31b1c247fbf02d0807e4695383684) by @Zhaocl1997 **deploy** 首次部署注入参考数据（默认关闭的开关；只插不改）+ 部署侧文档

### 修复

- [`b6cd90c`](https://github.com/walnut-admin/walnut-admin/commit/b6cd90c1a8bea4128e85ea8672c4300d36efa5e2) by @Zhaocl1997 root tsconfig no longer extends ESM base — removes CJS/ESM architecture confusion
- [`f4936e8`](https://github.com/walnut-admin/walnut-admin/commit/f4936e8c21aa2250a663d76a8d786a1aae3190af) by @Zhaocl1997 default 'pnpm dev' to admin-only, remove vestigial tsconfig paths
- [`576964d`](https://github.com/walnut-admin/walnut-admin/commit/576964d1002b07c33237adda15e1b1251964f851) by @Zhaocl1997 **eslint** move @antfu/eslint-config to catalog, declare in all consumers
- [`4a21e4f`](https://github.com/walnut-admin/walnut-admin/commit/4a21e4f52775e4530ac2b007c2c4592aff2dcaa7) by @Zhaocl1997 limit lint:root scope to root files, remove deprecated hoisting
- [`5fab583`](https://github.com/walnut-admin/walnut-admin/commit/5fab583a8800fe4f0eb72f739d4af7390af99cf0) by @Zhaocl1997 align barrel exports + eslint-config deps with restructured packages
- [`7026428`](https://github.com/walnut-admin/walnut-admin/commit/7026428e534ddf55503b9520e7573737e58a0bb0) by @Zhaocl1997 add VITE_* env tracking to turbo.json, document toolchain divergence as ADR 0012
- [`269b88a`](https://github.com/walnut-admin/walnut-admin/commit/269b88a86f8db660f1da315e8e601e5a5a755ff5) by @Zhaocl1997 resolve remaining type errors after contract consolidation
- [`99e6170`](https://github.com/walnut-admin/walnut-admin/commit/99e6170d7d6c96676456a87b479bea1b3570aacb) by @Zhaocl1997 resolve remaining lint/boundary issues, update ADR docs
- [`30b5f14`](https://github.com/walnut-admin/walnut-admin/commit/30b5f14ad93a3a40f8fed046deb90a91e8210abc) by @Zhaocl1997 replace deep node_modules/zod import with @standard-schema/spec
- [`e6b8d03`](https://github.com/walnut-admin/walnut-admin/commit/e6b8d03542f679a15b9a6e151a93de7cad134673) by @Zhaocl1997 **build** 修复 admin 构建阻塞（lru-cache override、optimizeDeps）
- [`7922dcd`](https://github.com/walnut-admin/walnut-admin/commit/7922dcd84aefbaa8341868689bb78716b808cf55) by @Zhaocl1997 **admin** 修复 ~build 失效 import 与既有类型错误
- [`395a5a9`](https://github.com/walnut-admin/walnut-admin/commit/395a5a992ebabab4ed19024d531e5fa37b39125b) by @Zhaocl1997 **deploy** proxy /api to versioned backend route, enable brotli, align env mount & healthcheck
- [`134f057`](https://github.com/walnut-admin/walnut-admin/commit/134f0577fe9f4779b7f9ed1679b40aceb771f8ce) by @Zhaocl1997 **admin** enable brotli precompression, fix server prod paths, update env docs
- [`978e19d`](https://github.com/walnut-admin/walnut-admin/commit/978e19dcc31711eda6497a6c070a1a2ea8065a5d) by @Zhaocl1997 **deploy** switch TCR namespace to tron1997
- [`4dd67a3`](https://github.com/walnut-admin/walnut-admin/commit/4dd67a3af8ababb78df9252e6bcc22c024f3044d) by @Zhaocl1997 **docker** build nginx image from alpine repo (same-source nginx + brotli module)
- [`d0ac65b`](https://github.com/walnut-admin/walnut-admin/commit/d0ac65b0a0702d67ea71955930bffbdd52aedb5f) by @Zhaocl1997 **server** 清理 jest 残留依赖并修复 vitest 测试链路
- [`7ddd908`](https://github.com/walnut-admin/walnut-admin/commit/7ddd908c85d932a48597b4ce9ce4daa64320ad81) by @Zhaocl1997 **docker** skip manual brotli load_module when package auto-loads
- [`2a3d734`](https://github.com/walnut-admin/walnut-admin/commit/2a3d734e709e443ef7eac1e950692ced426bab08) by @Zhaocl1997 **docker** 前端镜像构建允许 env-local 进入构建上下文
- [`c27cc39`](https://github.com/walnut-admin/walnut-admin/commit/c27cc39f86d2473a6313513bc6ddfa8be8372443) by @Zhaocl1997 **deploy** 域名统一为 walnut-admin.com，证书改 .pem 命名并忽略 certs 私钥
- [`b6ac29a`](https://github.com/walnut-admin/walnut-admin/commit/b6ac29ae4abc0e0339725814efefed0c61a59fb2) by @Zhaocl1997 **server** setup-env 纳入基础 .env 加密，修复 CI 构建缺变量
- [`56a5f5b`](https://github.com/walnut-admin/walnut-admin/commit/56a5f5bed58fc4a7b92dc92bf9fe9b9f6e0fa8ae) by @Zhaocl1997 **admin** 修正 naive-ui Scrollbar 深路径导入大小写，修复 Linux CI 构建
- [`e2a3dfc`](https://github.com/walnut-admin/walnut-admin/commit/e2a3dfc0274c10b039745c93c2253b9de3d5a04f) by @Zhaocl1997 **deploy** 部署脚本补 set -e、服务器端 TCR 登录与健康检查
- [`5214952`](https://github.com/walnut-admin/walnut-admin/commit/5214952eb8e614aad233d4028fd431bd5fc5c186) by @Zhaocl1997 **turbo** add missing preview task definition
- [`19031bd`](https://github.com/walnut-admin/walnut-admin/commit/19031bd15b9a1287a193340ba189ca71662d1ac3) by @Zhaocl1997 **deploy** 修 actionlint shellcheck 报的 SC2086（$REGISTRY 未加引号）
- [`3e9d34b`](https://github.com/walnut-admin/walnut-admin/commit/3e9d34b61487e9cb6e05e003b6052251d066acca) by @Zhaocl1997 **release** 归属表里的幽灵包 `@walnut/tooling` + 补上该模块缺失的测试守卫
- [`6fdd679`](https://github.com/walnut-admin/walnut-admin/commit/6fdd6795811a2874777de4d6652e86fb72fdc864) by @Zhaocl1997 **server** staging 构建落到独立的 dist-stage（P3-22）
- [`730e759`](https://github.com/walnut-admin/walnut-admin/commit/730e759c2d3be90dd6fa010dd45287d4c4681dca) by @Zhaocl1997 **tooling** 把 NODE_ENV 移出缓存哈希（可见但不参与）
- [`00ff6c4`](https://github.com/walnut-admin/walnut-admin/commit/00ff6c470228c67fdf37fb4a11b681fbc36df32f) by @Zhaocl1997 **deploy** 入口 nginx 补齐安全响应头，post-verify 逐域名核实
- [`001fbfb`](https://github.com/walnut-admin/walnut-admin/commit/001fbfb2a570ff4919b55f3da0d80b2cae0d0a8c) by @Zhaocl1997 **admin** 恢复被误清空的 types/components.d.ts（上一提交 git add -A 带进去的）
- [`7271d3b`](https://github.com/walnut-admin/walnut-admin/commit/7271d3b1451332bdf4dda0a47729de80a439f119) by @Zhaocl1997 **pnpm** publicHoistPattern 补 3 个上游漏声明的运行时依赖（后端启动挂在引导阶段）
- [`2174147`](https://github.com/walnut-admin/walnut-admin/commit/2174147c2887e1b6954874d7c480cc49fb4a0182) by @Zhaocl1997 **admin** dev 下 GA_ID / GOOGLE_CLIENT_ID 允许不配（插件对「键不存在」是硬报错）
- [`98423b5`](https://github.com/walnut-admin/walnut-admin/commit/98423b55a8fc9678c25fbdba85c299431b23a355) by @Zhaocl1997 **admin** 两个 unplugin 的 dts 移出跟踪面（生成物不该被 git 追踪）
- [`e51d341`](https://github.com/walnut-admin/walnut-admin/commit/e51d341a832060170ab79faabb07ff2a1e4c7862) by @Zhaocl1997 **admin** 生成物改成每个 vite / vue-tsc 入口前都生成（CI 的 Build admin 因此挂过一次）
- [`51e6f4a`](https://github.com/walnut-admin/walnut-admin/commit/51e6f4ae197395a2e1e2fd983c904bd0f86e8d3a) by @Zhaocl1997 **admin** 没配 VITE_GOOGLE_CLIENT_ID 时跳过 Google 插件注册
- [`1e5b2e6`](https://github.com/walnut-admin/walnut-admin/commit/1e5b2e6c1692224e0db2cb1b02b4d49f702a131a) by @Zhaocl1997 **tooling** pre-commit 的 lint-staged 大提交必挂（补 --max-arg-length）
- [`62b5e94`](https://github.com/walnut-admin/walnut-admin/commit/62b5e94ed09063bfb4078bf3c9093c96053db441) by @Zhaocl1997 **admin** checker 的 eslint watchPath 指向不存在的目录（dev 里 lint 是假绿）
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
- [`c22d925`](https://github.com/walnut-admin/walnut-admin/commit/c22d925b3222d35f7f9f5e3976e77b80db8827d8) by @Zhaocl1997 **admin** 修掉 16 处被 skipLibCheck 藏住的手写 .d.ts 问题
- [`d32982b`](https://github.com/walnut-admin/walnut-admin/commit/d32982b967f77b404740659b049c478a084115fd) by @Zhaocl1997 **admin** 移除 window.echarts 隐式全局（拆掉 UMD/ESM 双身份那道墙）
- [`ac21804`](https://github.com/walnut-admin/walnut-admin/commit/ac2180463639372bf38a3a155a2c7fda766bfb73) by @Zhaocl1997 **admin** 启动序列容错 —— 关键步给错误屏、可降级步给提示（V4）
- [`a841b9d`](https://github.com/walnut-admin/walnut-admin/commit/a841b9d019222ff1db80a873f80307742fde80ed) by @Zhaocl1997 **admin** 生产构建产物跑不起来 —— `resolve.conditions` 抹掉了 Vite 默认条件（V13）
- [`ce60ac0`](https://github.com/walnut-admin/walnut-admin/commit/ce60ac0097864560cd84010999a06f6c27ea60ce) by @Zhaocl1997 **tooling** 规则误伤版权符号 —— 豁免 © ® ™ 并恢复被改掉的 JSDoc

### 性能

- [`022c60c`](https://github.com/walnut-admin/walnut-admin/commit/022c60c51b6fdefe6f6ccc8bad3e30815048a770) by @Zhaocl1997 **turbo** adopt $TURBO_DEFAULT$ microsyntax for all task inputs
- [`6ad21c7`](https://github.com/walnut-admin/walnut-admin/commit/6ad21c7a865396dbefdc4591a70ec9eb38976afa) by @Zhaocl1997 **deploy** docker 构建接入 buildx gha 缓存，依赖安装层跨运行命中

### 重构

- [`7f58970`](https://github.com/walnut-admin/walnut-admin/commit/7f589701e8a32cb2df5db7471058ce83dc6caf21) by @Zhaocl1997 remove empty stub packages and orphan tsconfig, add turbo test task
- [`140e94e`](https://github.com/walnut-admin/walnut-admin/commit/140e94e12ee097bd91bd04f8a8baff339de56397) by @Zhaocl1997 **tsconfig** root tsconfig.json extends base, eliminate duplication
- [`ba837ab`](https://github.com/walnut-admin/walnut-admin/commit/ba837abd05b6877ca37fbfc35fb97abc495da102) by @Zhaocl1997 **shared** convert ambient .d.ts globals to explicit modules
- [`5b60b02`](https://github.com/walnut-admin/walnut-admin/commit/5b60b0257095260a47ed78abf5139eaca9c3c188) by @Zhaocl1997 **skills** 整合 skill 到 .claude/skills/，中文化并精简为约束型
- [`bfa000d`](https://github.com/walnut-admin/walnut-admin/commit/bfa000d6185048cabf01a5f83295b6b4291db15f) by @Zhaocl1997 **packages** restructure monorepo packages — honest naming, clean separation
- [`94ee4c7`](https://github.com/walnut-admin/walnut-admin/commit/94ee4c7050147e9046ed00f1c2e548080fb9674d) by @Zhaocl1997 **server** extract shared tsconfig.lib.base.json, remove tsconfig.schema.json
- [`c1f2c8a`](https://github.com/walnut-admin/walnut-admin/commit/c1f2c8adef9cecc129fc9020dd82010efbd433f2) by @Zhaocl1997 **lint** extract shared @walnut/eslint-config package, add curated barrel exports
- [`dd7a25c`](https://github.com/walnut-admin/walnut-admin/commit/dd7a25c8fd1cf112269ea1490112b3d86178b126) by @Zhaocl1997 direct contract consumption — remove server wrapper layers and admin indirect imports
- [`2f8cb86`](https://github.com/walnut-admin/walnut-admin/commit/2f8cb86e9a946ae92b5d7fd08f556091b581f9f2) by @Zhaocl1997 **release** 接入 changelog-github per-package CHANGELOG，移除 git-cliff 并统一 repository
- [`1dc9e10`](https://github.com/walnut-admin/walnut-admin/commit/1dc9e100e6331e709a99d99c9aac3a13295950c8) by @Zhaocl1997 **server** remove env template dirs, keep env-encrypted (comments as template) + env-local
- [`67e74e8`](https://github.com/walnut-admin/walnut-admin/commit/67e74e8989b69e4c3737c31d851ee21d5c94b168) by @Zhaocl1997 **admin** 368 个文件补显式 import（移除 unplugin-auto-import 第 1 步）
- [`a52d559`](https://github.com/walnut-admin/walnut-admin/commit/a52d559f02a70310edaf4bcb575c3e66d478033a) by @Zhaocl1997 **admin** 摘掉 unplugin-auto-import 插件与生成物清理

### 回滚

- [`b102d7a`](https://github.com/walnut-admin/walnut-admin/commit/b102d7adc7f95f79ec2c612f84cbe8de345ef207) by @Zhaocl1997 remove ci.yml — maintainer doesn't want CI in current single-dev workflow
