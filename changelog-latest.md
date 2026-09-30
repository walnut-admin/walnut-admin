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

---
由 `pnpm release` 生成（v0.1.7）。