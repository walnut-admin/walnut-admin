# 初始化数据（seed）

本目录是**随仓库发布的初始化数据集**：装好库、跑一条命令，应用就能起来、界面有字、权限树完整。

```bash
pnpm db:seed                 # 按 _id 幂等 upsert（重复跑安全）
pnpm db:seed --dry-run       # 只看会写什么，不落库
pnpm db:seed --with-areas <文件>   # 额外导入行政区划（见下）
```

正源与再生成：**仓库为本目录的唯一真源**，`pnpm db:export` 从库反向导出（导出的东西与本目录
逐字可比）—— 也就是说数据不是"某次手工导出的快照"，而是**可以再生的产物**。

## 进了哪些集合

| 集合 | 条数 | 作用 |
|------|------|------|
| `app_setting` | 21 | 应用设置（**空库时后端会 500 的就是它**：语言包/签名等链路都读它） |
| `sys_lang` | 2 | 语言清单（en_US / zh_CN） |
| `sys_locale` | 1806 | 前端语言包（界面上所有的字） |
| `sys_menu` | 157 | 菜单与权限点 |
| `sys_role` | 6 | 角色（`visitor` / `admin` / `root` / 开发 …） |
| `sys_user` | 2 | 演示账号档案（`visitor` / `admin`）—— **不含任何凭证**，见下 |
| `sys_dict_type` / `sys_dict_data` | 14 / 169 | 字典 |

`sys_user` 是从导出里**裁剪**过的：只留演示账号，头像外链置空（原始导出里有开发者本人账号）。

## 刻意**不**进本目录的东西（每一条都有理由，别当成漏了）

| 没进的东西 | 为什么 | 那谁来补 |
|------------|--------|----------|
| `app_key` | 里面是**真实密钥材料**（RSA 私钥 PEM、AES `keyB64`）。提交进公开仓既是泄密，也会被本仓的 `lint:secrets` 判红 | `db:seed` **现生成**一套 ACTIVE 的 AES + RSA（每个安装各自一套，这也更对） |
| `sys_user_identity` | 口令凭证是 OPAQUE 注册记录，**绑定服务端的 `AUTH_OPAQUE_SECRET`**（该 secret 就是 OPAQUE 的 `serverSetup`）—— 换个环境必然登不进去，发布它等于发布一份在别人机器上无效的凭证 | `db:seed --admin <userName>` 用真实注册流程现生成 |
| `sys_user_mfa` / `sys_user_oauth` | MFA 密文用 env 密钥加密（跨环境解不开），且属用户隐私；OAuth 绑定是运行时状态 | 各自在使用中产生 |
| `sys_device` / `sys_user_device` | 设备指纹 / IP / 地理位置历史 —— 运行时状态 + 个人数据 | 各自在使用中产生 |
| `shared_area` | 66 万条行政区划（89.3 MB，gzip 后约 7.4 MB）。**随 Release 作为发版资产发布**，版本号与 tag 对齐 | `db:seed --with-areas <文件>` |

## 格式

- 每个集合一个 `.json`，内容是**文档数组**（Compass / `mongoimport --jsonArray` 可直接用）。
- 保留 **Extended JSON**（`{"$oid": …}` / `{"$date": …}`），所以时间与主键的精度不会在导出-导入间丢失，
  也让本目录与「用图形工具手工导入」这条老路子兼容。
- 播种按 `_id` upsert，**不删**库里多出来的文档（seed 不是"清库"）。
