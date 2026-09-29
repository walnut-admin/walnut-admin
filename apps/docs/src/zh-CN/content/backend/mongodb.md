# 数据库与初始化数据

## 跑起来需要什么

MongoDB **副本集**（事务必需，单节点副本集也行：`rs.initiate()`）与 Redis 7+。
连接参数由后端那份 env 决定（`apps/server/env-local/.env.${NODE_ENV ?? development}` 里的
`DATABASE_*`），不是一条单机 URI —— 这一点决定了下面的工具都按**同一份 env** 连接。

## 初始化数据（seed）

装好库、跑一条命令，应用就能起来：界面有字、权限树完整、请求签名可用的密钥也就位了。

```bash
pnpm db:seed                    # 幂等：按 _id upsert，重复跑安全
pnpm db:seed --dry-run          # 只看会写什么，不落库
pnpm db:seed --only sys_role    # 只播某几个集合
pnpm db:seed --with-areas <文件> # 额外导入行政区划（见下）
```

数据本身在 [`apps/server/db/seed/`](https://github.com/walnut-admin/walnut-admin/tree/main/apps/server/db/seed)，
格式是**每个集合一个 JSON 数组**，保留 Extended JSON（`{"$oid": …}` / `{"$date": …}`）——
所以既可以用这个命令导，也可以用 Compass / `mongoimport --jsonArray` 手工导（老路子仍然通）。

**仓库是这份数据的唯一真源**，而且它是**可再生成**的：

```bash
pnpm db:export                  # 从当前库反向导出到 apps/server/db/seed/
pnpm lint:seed                  # 形态门禁：必需/禁入集合、体积、凭据形状、引用完整性
```

导出与仓内文件**逐字节可比**（导出按 `_id` 升序、并套用同一份裁剪规则），所以 `git diff` 就是判据：
数据漂了、有人手工改过、库里多出该裁剪的账号 —— 都会在这里露出来。

## 哪些数据**刻意不在**仓里

| 不在仓里的 | 为什么 | 谁来补 |
|------------|--------|--------|
| 密钥表（`app_key`） | 里面是**真实密钥材料**（RSA 私钥 PEM、AES key）。提交进公开仓既是泄密，也会被本仓的凭据门禁判红 | `db:seed` 现生成一套 ACTIVE 的 AES + RSA —— 每个安装各自一套，本来也更对 |
| 口令凭证（`sys_user_identity`） | OPAQUE 的注册记录**绑定服务端的 `AUTH_OPAQUE_SECRET`**（该 secret 就是 OPAQUE 的 `serverSetup`）⇒ 换环境必然登不进去，发布它等于发布一份在别人机器上无效的凭证 | 装好后**走应用的注册流程**建立第一个管理员；演示账号同理 |
| MFA 密文 / OAuth 绑定 | 密文用 env 密钥加密（跨环境解不开），且属用户隐私；OAuth 是运行时状态 | 各自在使用中产生 |
| 设备指纹 / 用户设备 | 设备信息、IP 与地理位置历史 —— 运行时状态 + 个人数据 | 各自在使用中产生 |
| 行政区划（`shared_area`） | 66 万条、压缩后仍有数 MB。它的定位是**参考数据**，不是配置 | 由发版产物附带的资产提供，用 `pnpm db:seed --with-areas <文件>` 导入（支持 `.json` 与 `.json.gz`） |

## 注意：这不是"清库工具"

`db:seed` 只做 upsert，**不删**库里多出来的文档 —— 别指望它把开发数据扫干净。
要重建一个干净环境，请自己换库名或用 `--db` 指向一个新库。
