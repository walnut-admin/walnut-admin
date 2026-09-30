# @walnut/contract

## 0.1.0

### 新功能

- [`04130cf`](https://github.com/walnut-admin/walnut-admin/commit/04130cf295d6bb7acfbade28b4becb5097859f48) by @Zhaocl1997 Step 2.1 — add socket/cookie/token/AES-GCM constants to contract, de-duplicate across FE/BE
- [`0261bf1`](https://github.com/walnut-admin/walnut-admin/commit/0261bf184ae59314972b9c805fd37c64856eaed4) by @Zhaocl1997 **contract** 补全路由常量，迁移 admin 硬编码 API 路径
- [`ca07d53`](https://github.com/walnut-admin/walnut-admin/commit/ca07d532bb10416e41e200eed4a5922c36831134) by @Zhaocl1997 **tooling** 新增共享测试预设 @walnut/vitest-config（第 6 个 tooling 包，P3-14）
- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器

### 修复

- [`5c64f2a`](https://github.com/walnut-admin/walnut-admin/commit/5c64f2a4f494c652911c4acb22f741e7739e8791) by @Zhaocl1997 **utils** anchor phone regex with ^, commit contract snapshots
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
