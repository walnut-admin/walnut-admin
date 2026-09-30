# @walnut/types

## 0.1.0

### 新功能

- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量

### 修复

- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
- [`b996bd0`](https://github.com/walnut-admin/walnut-admin/commit/b996bd08eef11ad4803a3010f0ef7abb6dc70187) by @Zhaocl1997 **types** IStorageAsync 的 `Exclude` 改成 `Omit`（前者对接口等于没写）
