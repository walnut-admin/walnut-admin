# 初始化数据（seed）

本目录是**随仓库发布的初始化数据集**：装好库、跑一条命令，应用就能起来、界面有字、权限树完整。

```bash
pnpm db:seed:pg              # 按 id 幂等 upsert 进 PostgreSQL（重复跑安全）
pnpm db:seed:pg --dry-run    # 只看会写什么，不落库
pnpm db:seed:pg --admin <userName> --password <口令>   # 现生成 admin 口令凭证（见下）
```

正源与再生成：**仓库为本目录的唯一真源**，且数据不是"某次手工导出的快照"，而是**可以机械再生的产物**：

```bash
pnpm db:export:pg --out apps/server/.tmp/pg-export      # ① 库 → 快照（Extended JSON，uuid 本体）
pnpm db:seed:reshape --from apps/server/.tmp/pg-export  # ② 快照 → 行形态（写本目录）
```

> ### ⚠️ 两条与「写本目录」有关的行为（批次 5-B 起，改之前先读）
>
> 1. **`db:export:pg` 的默认输出目录已经是 `apps/server/.tmp/pg-export`** —— 第 ① 步的 `--out`
>    可以整段省略（写了也一样）。默认不指向本目录是**有意的**：快照是中间物，本目录是行形态真源。
> 2. **`--out` 指到本目录会直接报错**：命令在连库之前就拒绝执行，退出码 **2**（前置条件未满足，
>    不是「查出违规」的 1），一个文件都不会写。原因是把 Extended JSON 快照写进真源 = 把真源打回
>    旧格式（`pnpm lint:seed` 会判红，`ejson.ts` 那一层映射也会重新长回来）。`--anonymize` 是同一
>    条红线（脱敏有损，永不许覆盖真源）。
>
> 子目录不在拦截范围内 —— 别把快照放在 `apps/server/db/seed/` 下面任何一层。

改完形状/映射后跑一次双库对拍（旧 seed + 旧管线 与 新 seed 各灌一个空库，逐表逐列比）：
`pnpm db:seed:verify`。（Phase 5a 起 MongoDB 通道 `db:seed` / `db:export` / `seed:pack` 已退役。）

## 进了哪些集合

| 表 | 条数 | 作用 |
|----|------|------|
| `app_setting` | 21 | 应用设置（**空库时后端会 500 的就是它**：语言包/签名等链路都读它） |
| `sys_lang` | 2 | 语言清单（en_US / zh_CN） |
| `sys_locale` | 1836 | 前端语言包（界面上所有的字） |
| `sys_menu` | 172 | 菜单与权限点 |
| `sys_role` | 6 | 角色（`visitor` / `admin` / `root` / 开发 …） |
| `sys_user` | 2 | 演示账号档案（`visitor` / `admin`）—— **不含任何凭证**，见下 |
| `sys_dict_type` / `sys_dict_data` | 14 / 169 | 字典 |
| `sys_user_role` / `sys_role_menu` | 2 / 15 | 授权关系（junction 独立文件，**别删**：删了登录后权限与侧边栏是空的） |

`sys_user` 是从导出里**裁剪**过的：只留演示账号，头像外链置空（原始导出里有开发者本人账号）。

## 刻意**不**进本目录的东西（每一条都有理由，别当成漏了）

| 没进的东西 | 为什么 | 那谁来补 |
|------------|--------|----------|
| `app_key` | 里面是**真实密钥材料**（RSA 私钥 PEM、AES `keyB64`）。提交进公开仓既是泄密，也会被本仓的 `lint:secrets` 判红 | `db:seed:pg` **现生成**一套 ACTIVE 的 AES + RSA（每个安装各自一套，这也更对） |
| `sys_user_identity` | 口令凭证是 OPAQUE 注册记录，**绑定服务端的 `AUTH_OPAQUE_SECRET`**（该 secret 就是 OPAQUE 的 `serverSetup`）—— 换个环境必然登不进去，发布它等于发布一份在别人机器上无效的凭证 | `db:seed:pg --admin <userName> --password <口令>` 用真实注册流程现生成 |
| `sys_user_mfa` / `sys_user_oauth` | MFA 密文用 env 密钥加密（跨环境解不开），且属用户隐私；OAuth 绑定是运行时状态 | 各自在使用中产生 |
| `sys_device` / `sys_user_device` | 设备指纹 / IP / 地理位置历史 —— 运行时状态 + 个人数据 | 各自在使用中产生 |
| `shared_area` | 66 万条行政区划（89.3 MB，gzip 后约 7.4 MB）。**随 Release 作为发版资产发布**，版本号与 tag 对齐 | 下载资产后经 PG 通道导入（区划通道随 Mongo 退役的重建安排见 phase3-plan §5） |

## 格式

- 每个表一个 `.json`，内容是 **PG 行数组**：`{ "id": "<uuid>", "created_at": "2026-…", … }`。
- 列名就是 PG 列名（snake_case），时间列是 **ISO 字符串**（timestamptz 直接吃它），jsonb 列是 JSON 值。
- junction 表（`sys_user_role` / `sys_role_menu`）各有独立文件：一行的两列都是 uuid 引用，**没有 `id`**。
- **不再有 Extended JSON**（`$oid` / `$date`）：出现即被 `pnpm lint:seed` 判红（真源退回旧格式 =
  运行期映射层又会长出来）。历史导出仍然读得进来（`db:seed:reshape` 走 `ejson.ts`）。
- 播种按主键 upsert：业务表整行刷新为 seed 值，junction 只补缺不回收（seed 不是"清库"）。
- 列 / 主键 / 外键 / jsonb 的判据全部来自 PG 元数据，播表顺序是 FK 拓扑序 —— **加一列不需要改映射**，
  重新导出一次即可。
