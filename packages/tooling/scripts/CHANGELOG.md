# @walnut/scripts

## 0.1.0

### 新功能

- [`9100a41`](https://github.com/walnut-admin/walnut-admin/commit/9100a4138cb99f87509895807f34fc87708445e4) by @Zhaocl1997 **tooling** 新增「文档引用」门禁 —— 活文档里的包名与仓库路径必须真实存在
- [`64512cc`](https://github.com/walnut-admin/walnut-admin/commit/64512cc754ca6d3af00f71b782615ebeca9a9f0e) by @Zhaocl1997 **tooling** 文档门禁扩到 markdown 链接 + R11 收尾（又抓出 17 类真失效）
- [`ca07d53`](https://github.com/walnut-admin/walnut-admin/commit/ca07d532bb10416e41e200eed4a5922c36831134) by @Zhaocl1997 **tooling** 新增共享测试预设 @walnut/vitest-config（第 6 个 tooling 包，P3-14）
- [`27b092f`](https://github.com/walnut-admin/walnut-admin/commit/27b092faa080ab1dd2df143fb311ca4fd3ade0af) by @Zhaocl1997 **tooling** 文档代码块门禁落地（F2③）—— 先量后做，把「必须编译」收窄成「必须能解析」
- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器
- [`f70d9e5`](https://github.com/walnut-admin/walnut-admin/commit/f70d9e5ac6f29113e5acd8b70c5d21322f74fca7) by @Zhaocl1997 **tooling** 别名门禁扩到 apps/server/libs 下的文档（P2-22）
- [`3edfa7c`](https://github.com/walnut-admin/walnut-admin/commit/3edfa7c7f42b31ab9ff6164b300d98f15d8dca8d) by @Zhaocl1997 **tooling** turbo 缓存边界门禁 + 三处边界修正
- [`a157e08`](https://github.com/walnut-admin/walnut-admin/commit/a157e08ad960b4b419b1851dcc9f76256fb17b39) by @Zhaocl1997 **tooling** 根级 lint 变成可缓存的 turbo 根任务
- [`8dfde30`](https://github.com/walnut-admin/walnut-admin/commit/8dfde3056634df76017450d7b9a05057d6134805) by @Zhaocl1997 **tooling** 门禁接线反向断言 + catalog 锁步门禁（A1/A2/A3/A4/B1/B2）
- [`cfb7b57`](https://github.com/walnut-admin/walnut-admin/commit/cfb7b575391b0414d541fd3e6d4ce01cbbe34b02) by @Zhaocl1997 **tooling** 新增入口 nginx 安全响应头门禁（lint:nginx-headers）
- [`6cf07f6`](https://github.com/walnut-admin/walnut-admin/commit/6cf07f60014aa4df7568a38386ed4f20dc11a3a6) by @Zhaocl1997 **tooling** 产物去密体检（lint:dist）
- [`b88227d`](https://github.com/walnut-admin/walnut-admin/commit/b88227d0d035da8d71764f15874e08f4a5d90c50) by @Zhaocl1997 **eslint-config** 两条脚本入口规则（文件头 / 退出码三态）+ 本包第一套测试
- [`b823a01`](https://github.com/walnut-admin/walnut-admin/commit/b823a0116e2adfa552267ce434c0c3a160d56e29) by @Zhaocl1997 **tooling** 源码密钥形态门禁（lint:secrets）—— 被一次真实的 push 拒绝逼出来的
- [`ab240c8`](https://github.com/walnut-admin/walnut-admin/commit/ab240c869695d2b39c6d44417434fed748589f0f) by @Zhaocl1997 **tooling** exports-shape 门禁（lint:exports）+ 对比页状态补齐
- [`cac3590`](https://github.com/walnut-admin/walnut-admin/commit/cac359017cb8424bdfe29c809f170cbaf832abfe) by @Zhaocl1997 **tooling** 新门禁 lint:pre-hooks —— 跑 vite / vue-tsc 的脚本必须先接生成（那次 CI 事故的守卫）
- [`baebffd`](https://github.com/walnut-admin/walnut-admin/commit/baebffde2a2428edc2df6905fab2176cc4f516a3) by @Zhaocl1997 **tooling** lint:doc-ts 校验 `json` 块 + 7 处标错语言的块改标 `jsonc`
- [`a01d451`](https://github.com/walnut-admin/walnut-admin/commit/a01d45150fdda280b3ce926b82efb112b9153916) by @Zhaocl1997 **tooling** 新增 `lint:dts` —— 手写 .d.ts 关掉 skipLibCheck 查一遍
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量
- [`71c8b7c`](https://github.com/walnut-admin/walnut-admin/commit/71c8b7c5e3f07445daba8045bbf858a9e9ce0b7f) by @Zhaocl1997 **tooling** 新增 `pnpm db:seed` —— 初始化数据播种（幂等；app_key 现生成）
- [`8db6801`](https://github.com/walnut-admin/walnut-admin/commit/8db680112af00935ebaf09c43b82c259d1294237) by @Zhaocl1997 **tooling** 新增 `pnpm db:export` + `--with-areas`（seed 数据从此"可再生成"）
- [`970d669`](https://github.com/walnut-admin/walnut-admin/commit/970d669d20fa89a87aa8eaa99865da294220a4b2) by @Zhaocl1997 **tooling** 新增 `pnpm lint:seed` —— 初始化数据的形态门禁（含 12 条反例用例）
- [`7426bfc`](https://github.com/walnut-admin/walnut-admin/commit/7426bfcf4d0068c4fb97feda2e446418231c3192) by @Zhaocl1997 **tooling** 新增 `pnpm lint:emoji` —— 注释里不许有 emoji（跨所有被跟踪文本文件）+ 常驻文档去 emoji
- [`001cc83`](https://github.com/walnut-admin/walnut-admin/commit/001cc831715fb52860b793543571d8026add42b9) by @Zhaocl1997 **tooling** 新增 `pnpm smoke:dist` 产物冒烟（真实浏览器断言已挂载）+ 进 CI
- [`c724f89`](https://github.com/walnut-admin/walnut-admin/commit/c724f89c25e13d9279f81274ae266c58e63c5f45) by @Zhaocl1997 **tooling** `db:seed --admin` —— 在本机建口令凭证，并当场验证登录握手（seed 链路收口）
- [`96c2143`](https://github.com/walnut-admin/walnut-admin/commit/96c214336c22fb4f1c51b5fa5f2f4272f7ab7e2d) by @Zhaocl1997 **tooling** `pnpm seed:pack` + 随 Release 发布初始化数据资产
- [`4e924e6`](https://github.com/walnut-admin/walnut-admin/commit/4e924e673dfed6aa865f58cc6086e5e0fdc8f046) by @Zhaocl1997 **tooling** `db:seed --if-missing` —— 只插不改（生产注入用）
- [`b069302`](https://github.com/walnut-admin/walnut-admin/commit/b0693026ce9d0a64b74d6579857bc30bb8c174b6) by @Zhaocl1997 **tooling** `db:export --anonymize` —— 脱敏规则落地（通道 2），并接进 lint:seed 门禁

### 修复

- [`6fdd679`](https://github.com/walnut-admin/walnut-admin/commit/6fdd6795811a2874777de4d6652e86fb72fdc864) by @Zhaocl1997 **server** staging 构建落到独立的 dist-stage（P3-22）
- [`45b87cd`](https://github.com/walnut-admin/walnut-admin/commit/45b87cddaba3b438c8261836289a1e89d7faf365) by @Zhaocl1997 **tooling** turbo 配置门禁在 CI 上跑不了（Windows-only）+ 补 tags 三条不变量
- [`71b6115`](https://github.com/walnut-admin/walnut-admin/commit/71b6115433d3c1b2a5c70195e0aa70b2f14dcc94) by @Zhaocl1997 **tooling** 两处「本地全绿、CI 全红」的判据 —— doc-refs 与环境无关化 + 三条 env 依赖用例写明前提
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
- [`a303efb`](https://github.com/walnut-admin/walnut-admin/commit/a303efbeb66a64f1a120acabe60e08fe688034d3) by @Zhaocl1997 **tooling** 修掉三条「本机绿、CI 红」的平台相关用例（CI run 36548656157）

### 重构

- [`aef0cf7`](https://github.com/walnut-admin/walnut-admin/commit/aef0cf749e70c5f2d8b08600f2088222cd4dfbf6) by @Zhaocl1997 **tooling** 门禁接上已有的输出/错误层（唯一映射 + 统一文案）—— C1
