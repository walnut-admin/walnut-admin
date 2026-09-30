# @walnut/release

## 0.1.1

### 新功能

- [`676b7b4`](https://github.com/walnut-admin/walnut-admin/commit/676b7b4435c95f0f03e08ddb474642e116b58d2e) **release** 发版每步打印「第几步 / 共几步 + 任务名」

### 修复

- [`6d4598b`](https://github.com/walnut-admin/walnut-admin/commit/6d4598b7d9c7f3a02b3a11b486ed3c28fe7bca45) **release** 只改基建的提交不再被当成噪声丢弃 —— 归到 `infra` 桶并按 type 参与发版
- [`d26566b`](https://github.com/walnut-admin/walnut-admin/commit/d26566bd5bc831c2ce4baafdef969f4d5ec8dc9b) **release** 载体包改成真实包名 `@walnut/scripts`（上一版自造的 `infra` 被 pnpm 拒了）

## 0.1.0

### 新功能

- [`725a0fc`](https://github.com/walnut-admin/walnut-admin/commit/725a0fc1a40ae502d7359c2b7dea125268189a02) by @Zhaocl1997 **tooling** 抽取 @walnut/commitlint-config 与 @walnut/release 包
- [`edf4b6a`](https://github.com/walnut-admin/walnut-admin/commit/edf4b6acb5bd6ac6325fd6ec41b0b1b53de5df52) by @Zhaocl1997 **release** auto-changeset 按 commit scope 归因包，重构为可测试模块并补 vitest 测试
- [`9100a41`](https://github.com/walnut-admin/walnut-admin/commit/9100a4138cb99f87509895807f34fc87708445e4) by @Zhaocl1997 **tooling** 新增「文档引用」门禁 —— 活文档里的包名与仓库路径必须真实存在
- [`ca07d53`](https://github.com/walnut-admin/walnut-admin/commit/ca07d532bb10416e41e200eed4a5922c36831134) by @Zhaocl1997 **tooling** 新增共享测试预设 @walnut/vitest-config（第 6 个 tooling 包，P3-14）
- [`27b092f`](https://github.com/walnut-admin/walnut-admin/commit/27b092faa080ab1dd2df143fb311ca4fd3ade0af) by @Zhaocl1997 **tooling** 文档代码块门禁落地（F2③）—— 先量后做，把「必须编译」收窄成「必须能解析」
- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器
- [`3edfa7c`](https://github.com/walnut-admin/walnut-admin/commit/3edfa7c7f42b31ab9ff6164b300d98f15d8dca8d) by @Zhaocl1997 **tooling** turbo 缓存边界门禁 + 三处边界修正
- [`a157e08`](https://github.com/walnut-admin/walnut-admin/commit/a157e08ad960b4b419b1851dcc9f76256fb17b39) by @Zhaocl1997 **tooling** 根级 lint 变成可缓存的 turbo 根任务
- [`8dfde30`](https://github.com/walnut-admin/walnut-admin/commit/8dfde3056634df76017450d7b9a05057d6134805) by @Zhaocl1997 **tooling** 门禁接线反向断言 + catalog 锁步门禁（A1/A2/A3/A4/B1/B2）
- [`cfb7b57`](https://github.com/walnut-admin/walnut-admin/commit/cfb7b575391b0414d541fd3e6d4ce01cbbe34b02) by @Zhaocl1997 **tooling** 新增入口 nginx 安全响应头门禁（lint:nginx-headers）
- [`6cf07f6`](https://github.com/walnut-admin/walnut-admin/commit/6cf07f60014aa4df7568a38386ed4f20dc11a3a6) by @Zhaocl1997 **tooling** 产物去密体检（lint:dist）
- [`b823a01`](https://github.com/walnut-admin/walnut-admin/commit/b823a0116e2adfa552267ce434c0c3a160d56e29) by @Zhaocl1997 **tooling** 源码密钥形态门禁（lint:secrets）—— 被一次真实的 push 拒绝逼出来的
- [`ab240c8`](https://github.com/walnut-admin/walnut-admin/commit/ab240c869695d2b39c6d44417434fed748589f0f) by @Zhaocl1997 **tooling** exports-shape 门禁（lint:exports）+ 对比页状态补齐
- [`cac3590`](https://github.com/walnut-admin/walnut-admin/commit/cac359017cb8424bdfe29c809f170cbaf832abfe) by @Zhaocl1997 **tooling** 新门禁 lint:pre-hooks —— 跑 vite / vue-tsc 的脚本必须先接生成（那次 CI 事故的守卫）
- [`a01d451`](https://github.com/walnut-admin/walnut-admin/commit/a01d45150fdda280b3ce926b82efb112b9153916) by @Zhaocl1997 **tooling** 新增 `lint:dts` —— 手写 .d.ts 关掉 skipLibCheck 查一遍
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量
- [`970d669`](https://github.com/walnut-admin/walnut-admin/commit/970d669d20fa89a87aa8eaa99865da294220a4b2) by @Zhaocl1997 **tooling** 新增 `pnpm lint:seed` —— 初始化数据的形态门禁（含 12 条反例用例）
- [`7426bfc`](https://github.com/walnut-admin/walnut-admin/commit/7426bfcf4d0068c4fb97feda2e446418231c3192) by @Zhaocl1997 **tooling** 新增 `pnpm lint:emoji` —— 注释里不许有 emoji（跨所有被跟踪文本文件）+ 常驻文档去 emoji

### 修复

- [`30f6017`](https://github.com/walnut-admin/walnut-admin/commit/30f6017c988950c0f51c05394aefb7d7791bb4ac) by @Zhaocl1997 **release** auto-changeset 显式提及 fixed 组代表包，修复共享包永不升级
- [`3e9d34b`](https://github.com/walnut-admin/walnut-admin/commit/3e9d34b61487e9cb6e05e003b6052251d066acca) by @Zhaocl1997 **release** 归属表里的幽灵包 `@walnut/tooling` + 补上该模块缺失的测试守卫
- [`45b87cd`](https://github.com/walnut-admin/walnut-admin/commit/45b87cddaba3b438c8261836289a1e89d7faf365) by @Zhaocl1997 **tooling** turbo 配置门禁在 CI 上跑不了（Windows-only）+ 补 tags 三条不变量
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）

### 重构

- [`2f8cb86`](https://github.com/walnut-admin/walnut-admin/commit/2f8cb86e9a946ae92b5d7fd08f556091b581f9f2) by @Zhaocl1997 **release** 接入 changelog-github per-package CHANGELOG，移除 git-cliff 并统一 repository
