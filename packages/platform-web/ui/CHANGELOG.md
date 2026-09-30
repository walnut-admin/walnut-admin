# @walnut/ui

## 0.1.0

### 新功能

- [`b873b4f`](https://github.com/walnut-admin/walnut-admin/commit/b873b4fc995ce39bfe020bb62c8c8526ffd0f07d) by @Zhaocl1997 **ui** 新增 @walnut/ui 包，迁入 Switch/DynamicTags/TimePicker（POC）
- [`ffb03cb`](https://github.com/walnut-admin/walnut-admin/commit/ffb03cb69f62e31cfdbd856d9e4c0faea488bdd4) by @Zhaocl1997 **tooling** 字数门禁 + 文档架构（F7/F8）+ prepush 长串改成门禁表与并行执行器

### 修复

- [`98423b5`](https://github.com/walnut-admin/walnut-admin/commit/98423b55a8fc9678c25fbdba85c299431b23a355) by @Zhaocl1997 **admin** 两个 unplugin 的 dts 移出跟踪面（生成物不该被 git 追踪）
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
