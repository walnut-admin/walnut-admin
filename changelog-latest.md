## 0.1.4

### 修复

- [`c13082a`](https://github.com/walnut-admin/walnut-admin/commit/c13082a632dcd65580417931e746ffc982353ae5) by @Zhaocl1997 **deploy** 参考数据注入改为每次部署都跑（tag 自动发版够不到那个开关）
- [`9a198c1`](https://github.com/walnut-admin/walnut-admin/commit/9a198c1291e363c976d504b6d47e354e64a9db42) by @Zhaocl1997 **deploy** nginx 镜像自带 nginx.conf —— Alpine 那份把 vhost 包含在 http 之外，容器起不来

---
由 `pnpm release` 生成（v0.1.4）。