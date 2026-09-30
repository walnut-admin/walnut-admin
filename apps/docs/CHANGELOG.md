# @walnut/docs

## 0.1.7

### 基建（CI / 构建 / 部署）

- [`5ee3a50`](https://github.com/walnut-admin/walnut-admin/commit/5ee3a5048ddc8d1033c15d8d12b2934225bc0678) by @Zhaocl1997 **tooling** 新增 workflow shell 语法门禁（逐块 bash -n）+ 五处接线

## 0.1.1

### 修复

- [`6d4598b`](https://github.com/walnut-admin/walnut-admin/commit/6d4598b7d9c7f3a02b3a11b486ed3c28fe7bca45) **release** 只改基建的提交不再被当成噪声丢弃 —— 归到 `infra` 桶并按 type 参与发版
- [`d26566b`](https://github.com/walnut-admin/walnut-admin/commit/d26566bd5bc831c2ce4baafdef969f4d5ec8dc9b) **release** 载体包改成真实包名 `@walnut/scripts`（上一版自造的 `infra` 被 pnpm 拒了）

## 0.1.0

### 新功能

- [`b63ec42`](https://github.com/walnut-admin/walnut-admin/commit/b63ec42ad270db58522cf0d1385a432fb94b4175) by @Zhaocl1997 three-repo monorepo merge — Phase 1 complete
- [`b4db0d2`](https://github.com/walnut-admin/walnut-admin/commit/b4db0d2b34015e55e6dda6a04b88ebdc66a718f9) by @Zhaocl1997 dotenvx encrypted env management + staging->stage unification
- [`f00f980`](https://github.com/walnut-admin/walnut-admin/commit/f00f98089af3800384f85cac38802a16842bc20e) by @Zhaocl1997 add turbo boundaries with tag-based architecture enforcement
- [`baf5207`](https://github.com/walnut-admin/walnut-admin/commit/baf52075dc83dd36d146cf16df76998f98509ab6) by @Zhaocl1997 selective barrel exports for all packages, add ADR 0013
- [`2c3c604`](https://github.com/walnut-admin/walnut-admin/commit/2c3c6042f89d3d04be2739bc5b5acd665daa2fdb) by @Zhaocl1997 **deploy** 部署后验证（post-verify）——轮询容器日志 + 端到端校验
- [`9100a41`](https://github.com/walnut-admin/walnut-admin/commit/9100a4138cb99f87509895807f34fc87708445e4) by @Zhaocl1997 **tooling** 新增「文档引用」门禁 —— 活文档里的包名与仓库路径必须真实存在
- [`64512cc`](https://github.com/walnut-admin/walnut-admin/commit/64512cc754ca6d3af00f71b782615ebeca9a9f0e) by @Zhaocl1997 **tooling** 文档门禁扩到 markdown 链接 + R11 收尾（又抓出 17 类真失效）
- [`ca07d53`](https://github.com/walnut-admin/walnut-admin/commit/ca07d532bb10416e41e200eed4a5922c36831134) by @Zhaocl1997 **tooling** 新增共享测试预设 @walnut/vitest-config（第 6 个 tooling 包，P3-14）
- [`27b092f`](https://github.com/walnut-admin/walnut-admin/commit/27b092faa080ab1dd2df143fb311ca4fd3ade0af) by @Zhaocl1997 **tooling** 文档代码块门禁落地（F2③）—— 先量后做，把「必须编译」收窄成「必须能解析」
- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器
- [`a157e08`](https://github.com/walnut-admin/walnut-admin/commit/a157e08ad960b4b419b1851dcc9f76256fb17b39) by @Zhaocl1997 **tooling** 根级 lint 变成可缓存的 turbo 根任务
- [`da2c36d`](https://github.com/walnut-admin/walnut-admin/commit/da2c36d4d80026ccf148c217d6cf673760242b83) by @Zhaocl1997 **tooling** turbo 升到 2.11.2，拿到本地缓存回收与并发上限
- [`23d63c4`](https://github.com/walnut-admin/walnut-admin/commit/23d63c45a35f30da6fe2971d3fda58051e3169a2) by @Zhaocl1997 **tooling** 接 eslint-plugin-turbo，未声明的环境变量不再被静默剥离
- [`8dfde30`](https://github.com/walnut-admin/walnut-admin/commit/8dfde3056634df76017450d7b9a05057d6134805) by @Zhaocl1997 **tooling** 门禁接线反向断言 + catalog 锁步门禁（A1/A2/A3/A4/B1/B2）
- [`6cf07f6`](https://github.com/walnut-admin/walnut-admin/commit/6cf07f60014aa4df7568a38386ed4f20dc11a3a6) by @Zhaocl1997 **tooling** 产物去密体检（lint:dist）
- [`b88227d`](https://github.com/walnut-admin/walnut-admin/commit/b88227d0d035da8d71764f15874e08f4a5d90c50) by @Zhaocl1997 **eslint-config** 两条脚本入口规则（文件头 / 退出码三态）+ 本包第一套测试
- [`b823a01`](https://github.com/walnut-admin/walnut-admin/commit/b823a0116e2adfa552267ce434c0c3a160d56e29) by @Zhaocl1997 **tooling** 源码密钥形态门禁（lint:secrets）—— 被一次真实的 push 拒绝逼出来的
- [`ab240c8`](https://github.com/walnut-admin/walnut-admin/commit/ab240c869695d2b39c6d44417434fed748589f0f) by @Zhaocl1997 **tooling** exports-shape 门禁（lint:exports）+ 对比页状态补齐
- [`cac3590`](https://github.com/walnut-admin/walnut-admin/commit/cac359017cb8424bdfe29c809f170cbaf832abfe) by @Zhaocl1997 **tooling** 新门禁 lint:pre-hooks —— 跑 vite / vue-tsc 的脚本必须先接生成（那次 CI 事故的守卫）
- [`baebffd`](https://github.com/walnut-admin/walnut-admin/commit/baebffde2a2428edc2df6905fab2176cc4f516a3) by @Zhaocl1997 **tooling** lint:doc-ts 校验 `json` 块 + 7 处标错语言的块改标 `jsonc`
- [`a01d451`](https://github.com/walnut-admin/walnut-admin/commit/a01d45150fdda280b3ce926b82efb112b9153916) by @Zhaocl1997 **tooling** 新增 `lint:dts` —— 手写 .d.ts 关掉 skipLibCheck 查一遍
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量
- [`970d669`](https://github.com/walnut-admin/walnut-admin/commit/970d669d20fa89a87aa8eaa99865da294220a4b2) by @Zhaocl1997 **tooling** 新增 `pnpm lint:seed` —— 初始化数据的形态门禁（含 12 条反例用例）
- [`7426bfc`](https://github.com/walnut-admin/walnut-admin/commit/7426bfcf4d0068c4fb97feda2e446418231c3192) by @Zhaocl1997 **tooling** 新增 `pnpm lint:emoji` —— 注释里不许有 emoji（跨所有被跟踪文本文件）+ 常驻文档去 emoji
- [`96c2143`](https://github.com/walnut-admin/walnut-admin/commit/96c214336c22fb4f1c51b5fa5f2f4272f7ab7e2d) by @Zhaocl1997 **tooling** `pnpm seed:pack` + 随 Release 发布初始化数据资产
- [`b287256`](https://github.com/walnut-admin/walnut-admin/commit/b287256a3df31b1c247fbf02d0807e4695383684) by @Zhaocl1997 **deploy** 首次部署注入参考数据（默认关闭的开关；只插不改）+ 部署侧文档

### 修复

- [`576964d`](https://github.com/walnut-admin/walnut-admin/commit/576964d1002b07c33237adda15e1b1251964f851) by @Zhaocl1997 **eslint** move @antfu/eslint-config to catalog, declare in all consumers
- [`c3b6780`](https://github.com/walnut-admin/walnut-admin/commit/c3b6780b788753256e645f7839d740d7c4bd5e4f) by @Zhaocl1997 **docs** add netlify.toml for VitePress deployment
- [`30f6017`](https://github.com/walnut-admin/walnut-admin/commit/30f6017c988950c0f51c05394aefb7d7791bb4ac) by @Zhaocl1997 **release** auto-changeset 显式提及 fixed 组代表包，修复共享包永不升级
- [`134f057`](https://github.com/walnut-admin/walnut-admin/commit/134f0577fe9f4779b7f9ed1679b40aceb771f8ce) by @Zhaocl1997 **admin** enable brotli precompression, fix server prod paths, update env docs
- [`06864c5`](https://github.com/walnut-admin/walnut-admin/commit/06864c51dab3a769370b7c49977366e57bd1b440) by @Zhaocl1997 **server** encrypt-env 全量重建 .env.keys，消除密钥无限累积
- [`b6ac29a`](https://github.com/walnut-admin/walnut-admin/commit/b6ac29ae4abc0e0339725814efefed0c61a59fb2) by @Zhaocl1997 **server** setup-env 纳入基础 .env 加密，修复 CI 构建缺变量
- [`3e9d34b`](https://github.com/walnut-admin/walnut-admin/commit/3e9d34b61487e9cb6e05e003b6052251d066acca) by @Zhaocl1997 **release** 归属表里的幽灵包 `@walnut/tooling` + 补上该模块缺失的测试守卫
- [`6fdd679`](https://github.com/walnut-admin/walnut-admin/commit/6fdd6795811a2874777de4d6652e86fb72fdc864) by @Zhaocl1997 **server** staging 构建落到独立的 dist-stage（P3-22）
- [`730e759`](https://github.com/walnut-admin/walnut-admin/commit/730e759c2d3be90dd6fa010dd45287d4c4681dca) by @Zhaocl1997 **tooling** 把 NODE_ENV 移出缓存哈希（可见但不参与）
- [`45b87cd`](https://github.com/walnut-admin/walnut-admin/commit/45b87cddaba3b438c8261836289a1e89d7faf365) by @Zhaocl1997 **tooling** turbo 配置门禁在 CI 上跑不了（Windows-only）+ 补 tags 三条不变量
- [`98423b5`](https://github.com/walnut-admin/walnut-admin/commit/98423b55a8fc9678c25fbdba85c299431b23a355) by @Zhaocl1997 **admin** 两个 unplugin 的 dts 移出跟踪面（生成物不该被 git 追踪）
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）

### 重构

- [`c1f2c8a`](https://github.com/walnut-admin/walnut-admin/commit/c1f2c8adef9cecc129fc9020dd82010efbd433f2) by @Zhaocl1997 **lint** extract shared @walnut/eslint-config package, add curated barrel exports
- [`2f8cb86`](https://github.com/walnut-admin/walnut-admin/commit/2f8cb86e9a946ae92b5d7fd08f556091b581f9f2) by @Zhaocl1997 **release** 接入 changelog-github per-package CHANGELOG，移除 git-cliff 并统一 repository
- [`1dc9e10`](https://github.com/walnut-admin/walnut-admin/commit/1dc9e100e6331e709a99d99c9aac3a13295950c8) by @Zhaocl1997 **server** remove env template dirs, keep env-encrypted (comments as template) + env-local
- [`aef0cf7`](https://github.com/walnut-admin/walnut-admin/commit/aef0cf749e70c5f2d8b08600f2088222cd4dfbf6) by @Zhaocl1997 **tooling** 门禁接上已有的输出/错误层（唯一映射 + 统一文案）—— C1
