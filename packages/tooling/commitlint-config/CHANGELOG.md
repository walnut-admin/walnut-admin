# @walnut/commitlint-config

## 0.1.0

### 新功能

- [`725a0fc`](https://github.com/walnut-admin/walnut-admin/commit/725a0fc1a40ae502d7359c2b7dea125268189a02) by @Zhaocl1997 **tooling** 抽取 @walnut/commitlint-config 与 @walnut/release 包
- [`a445628`](https://github.com/walnut-admin/walnut-admin/commit/a4456280b3975e548878002755063e36bace72d4) by @Zhaocl1997 **commitlint-config** 强制 scope 必填且为包名，补 revert type
- [`accccc5`](https://github.com/walnut-admin/walnut-admin/commit/accccc5e0863c537804c2d75ae3a8fdb1127d721) by @Zhaocl1997 **commitlint-config** add docker and deploy scopes
- [`8dfde30`](https://github.com/walnut-admin/walnut-admin/commit/8dfde3056634df76017450d7b9a05057d6134805) by @Zhaocl1997 **tooling** 门禁接线反向断言 + catalog 锁步门禁（A1/A2/A3/A4/B1/B2）
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量

### 修复

- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
