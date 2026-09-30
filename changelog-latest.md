## 0.1.1

### 新功能

- [`676b7b4`](https://github.com/walnut-admin/walnut-admin/commit/676b7b4435c95f0f03e08ddb474642e116b58d2e) **release** 发版每步打印「第几步 / 共几步 + 任务名」

### 修复

- [`b53611e`](https://github.com/walnut-admin/walnut-admin/commit/b53611e07bc81833f013d08b07479a9b202f521b) **release** bake 的 dockerfile 改成相对 context 根的路径（v0.1.0 首次发版构建失败）
- [`6d4598b`](https://github.com/walnut-admin/walnut-admin/commit/6d4598b7d9c7f3a02b3a11b486ed3c28fe7bca45) **release** 只改基建的提交不再被当成噪声丢弃 —— 归到 `infra` 桶并按 type 参与发版
- [`d26566b`](https://github.com/walnut-admin/walnut-admin/commit/d26566bd5bc831c2ce4baafdef969f4d5ec8dc9b) **release** 载体包改成真实包名 `@walnut/scripts`（上一版自造的 `infra` 被 pnpm 拒了）

---
由 `pnpm release` 生成（v0.1.1）。