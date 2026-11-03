# 环境配置

## 密文随仓库提交

环境文件用 **dotenvx** 加密（AES-256）后提交，明文从不进 git —— `env-encrypted/` 里的文件本身就是
模板，改配置时照着里面的注释加 key 即可。完整机制见
[环境变量加密管理](../monorepo/env-management.md)。

日常两条命令，都在**仓库根**执行：

- `pnpm setup-env` —— 解密 `env-encrypted/` → `env-local/`（新成员初始化，需要根目录的 `.env.keys`，
  私钥经 1Password 共享）
- `pnpm encrypt-env` —— 改完密钥后把 `env-local/` 重新加密回 `env-encrypted/`

`apps/server/env-local/` 是 gitignored 的。所以「改了 env 却不生效」的第一嫌疑永远是这个顺序问题：
先 `setup-env`，并且**后端必须从 `apps/server/` 目录启动**（ConfigModule 用 `process.cwd()` 定位 env；
从仓库根起后端走 `pnpm dev` 或 `pnpm dev:server` —— 它们由 turbo 在 `apps/server/` 下执行，cwd 正确）。

CI 里通过 GitHub Secret `ENV_KEYS`（内容就是 `.env.keys` 全文）自动解密；旧文档里的
`DOTENVX_KEYS_FILE` 已废弃。

## 加载哪几个文件

| 文件 | 用途 |
|------|------|
| `.env.development` | 开发配置 |
| `.env.production` | 生产配置 |
| `.env.stage` | 预发（stage）配置 |

## 部署后绝不能改的 5 个 key

下面这几个 key 只在首次部署时确定一次；改动之后，用旧 key 加密过的历史数据
（OPAQUE 凭据、MFA 密钥、refresh token、用户身份标识）**再也解不开** ——
不是「要迁移」，是直接不可读。

| key | 加密的是什么 |
|-----|-------------|
| `AUTH_OPAQUE_SECRET` | OPAQUE 协议密钥 |
| `MFA_ENCRYPTION_KEY` | MFA 数据 |
| `RT_ENCRYPTION_KEY` | refresh token |
| `DEVICE_ID_ENCRYPTION_KEY` | 历史指纹盐（**没有加密过任何数据**，见下） |
| `USER_ID_ENCRYPTION_KEY` | 用户身份标识 |

> `DEVICE_ID_ENCRYPTION_KEY` 是这张表里的例外：它只在 B5 之前当过「指纹 → device_id」的
> **单向 HMAC 盐**，从来没有加密过数据，今天**0 个消费者** —— 没有任何加解密 / 派生 / 身份用途
> （设备 ID 已改为服务端随机签发，判据见 `apps/server/libs/const/src/app/device.ts`）。
> 它在代码里还有 3 处读者，但全是**配置骨架**、不是使用：命名空间注册（`crypto.config.ts`）、
> 启动必填校验（`validation.ts`）、类型声明（`process.d.ts`）。留在「不许改」清单里是**部署契约**
> 的选择 —— 退役要连同 env 模板、dotenvx 密文与部署说明一起另案裁定；在那之前一律按「不许改」对待。

这几个 key 的名字也抄在常驻指引 `apps/server/AGENTS.md` 里 —— 它们属于「改之前必须想起来」的那一类，
不该只躺在参考文档里。

## 网络边界：与部署拓扑耦合的开关

两个都是**可选**项，默认值就是本仓的部署形态（容器前面恰好一层 nginx）。也都不在 `env-encrypted/`
的模板注释里 —— 需要时手动写进 `env-local/.env.<环境>`（文件名后缀见上面「加载哪几个文件」），
再 `pnpm encrypt-env` 回写密文（`setup-env` 只负责解密，不会替你补 key）。两者都进
`apps/server/libs/config/src/validation.ts` 的 env schema，由 `ConfigModule` 在**启动时**校验：
值不合法是**起不来**，不是静默降级。

### `APP_TRUST_PROXY_HOPS`

| 项 | 值 |
|----|----|
| 默认 | `1`（恰好一层 nginx） |
| 取值 | 整数；空串等同未配置（回落默认），非整数启动即失败，负数在 `main.ts` 里回落默认 |
| 作用点 | `apps/server/apps/api/src/main.ts` 的 `app.set('trust proxy', N)` |

**为什么不是一个布尔值**：`trust proxy = true` 等于信任**任意长度**的代理跳，客户端自带
`X-Forwarded-For` 就能把 `req.ip` 改成任意值。而本项目的 IP 维度控制全都吃真实客户端 IP
（IP 黑名单、限流 tracker、失败登录临时拉黑与扫描路径永久拉黑、设备 IP 变更跟踪、风控）——
伪造 XFF 的后果不只是绕过，还包括**嫁祸**：把任意 IP 打进永久黑名单。

**默认 1 的含义是「信任几跳」而不是「信任全部」**：`deploy/docker-compose.yml` 只发布 80/443，
容器前面正好一层 nginx，而 `deploy/nginx/conf.d/api.conf` 用 `$remote_addr` **覆写**
`X-Forwarded-For` / `X-Real-IP`。所以拓扑一变就得跟着改：

- 再加一层（CDN / 云负载均衡）→ 往上加跳数；
- nginx 改成**不覆写**（透传客户端自带的 XFF）→ 先修 nginx，把这个数改大没有意义。

> 另有一条**并存**的取 IP 通道：`apps/server/apps/api/src/middleware/src/ip.middleware.ts` 用
> `@supercharge/request-ip` 取 IP，**header 优先**，它不看 `trust proxy`。两套口径必须一起成立，
> 该文件头注释里写着同一段警示。

### `APP_CORS_ALLOW_ORIGINS`

| 项 | 值 |
|----|----|
| 默认 | 不配置 —— dev / stage 用内置的本地白名单，prod 用 `https://www.walnut-admin.com` 单源（域名取 `apps/server/package.json` 的 `config.domain`） |
| 取值 | 逗号分隔的**完整源**（含协议与端口），允许空白与空项 |
| 作用点 | `apps/server/libs/config/src/modules/middleware.config.ts` 的 `resolveAllowOrigin()` |

它是**覆盖**而不是追加：只要解析出非空数组，内置列表就整体让位 —— 想额外放行一个源，要把原来那些
源一起写进去。

**不要写 `*`**：本项目全站走 cookie（`DEVICE_ID` / `SIGN_TICKET` / `CAPJS_TOKEN`）且中间件固定
`credentials: true`，而 CORS 规范里 `Access-Control-Allow-Origin: *` 与凭据**互斥** —— 浏览器会
直接拒绝这种组合的跨源响应（开发下表现为「登录态跨源请求拿不到响应」，线上是静默失效）。
真配了 `*`，`CorsMiddleware` 启动时会打一条 warn，但**浏览器那侧照拒**：能修的地方在 env，
不在 HTTP 层。[跨域](./cors.md)那一篇讲的五种解决方式，与这里的代码真源是同一处。

## socket.io Admin UI：两个可选 key

| key | 说明 |
|-----|------|
| `SOCKET_ADMIN_UI_USER` | 登录用户名 |
| `SOCKET_ADMIN_UI_PASSWORD` | **bcrypt hash**（不是明文，见下） |

**两者同时配置才会挂载** `@socket.io/admin-ui`（`apps/server/apps/api/src/socket/socket.gateway.ts`
的 `afterInit`）；只配一个或都不配 = **不挂载**（fail-closed），启动时打一条 warn。这是有意的：
此前是 `auth: false` 的无鉴权裸奔。

`SOCKET_ADMIN_UI_PASSWORD` 必须是 **bcrypt hash**（`$2a$` / `$2b$` / `$2y$` 开头、共 60 位）：
上游包只接受 hash，明文会在 `instrument()` 时被拒、**启动即崩**，env schema 里另有一道格式校验兜住
（连同一句「对应的强口令最少 8 位」的提示）。做法是先定一个强口令 —— 8 位只是 schema 的下限，
别真按下限配 —— 再用 bcryptjs 生成 hash（`bcryptjs` 是 `apps/server` 自己的依赖）：

```bash
# 在 apps/server/ 下执行（这样 require('bcryptjs') 能解析到）
node -e "console.log(require('bcryptjs').hash('你的强口令', 10))"
```

> 这个口令与 admin 的**登录口令是两套东西**：管理 UI 的口令不进数据库，只存在于 env。
> 生产环境另外建议在边缘把 `/socket/admin` 直接 404 ——
> `deploy/nginx/conf.d/frontend.conf` 已有对应的两条 location，别让管理面板成为对外的第二个入口。
