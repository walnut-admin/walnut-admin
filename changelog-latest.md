## 0.1.3

### 修复

- [`7aee87d`](https://github.com/walnut-admin/walnut-admin/commit/7aee87d301eeb42c7c0f1e2f877b6db968c281ca) by @Zhaocl1997 **tooling** smoke:dist 的 Chrome 参数与新版本兼容（CI 假红的真因）
- [`96572f5`](https://github.com/walnut-admin/walnut-admin/commit/96572f5cff802e11f35aab1c66aaa2750d7a99e7) by @Zhaocl1997 **deploy** 先把容器起起来、注入参考数据，再等健康（空库首次部署必挂的顺序错误）

### 性能

- [`f22de5c`](https://github.com/walnut-admin/walnut-admin/commit/f22de5c94a9748fb73d0d6c4a8521807daf843fd) by @Zhaocl1997 **release** bake 的 cache-to 去掉 mode=max（冷缓存下最慢的一段）

---
由 `pnpm release` 生成（v0.1.3）。