# <WPageTitle></WPageTitle>

## 需求

:::info
本地开发让 WSL 里的 docker 直接走 Windows 上已有的 VPN。**不需要镜像加速器** —— 公共加速源到
2026 年基本都停服或限流了，换源是绕远路，代理才是简单且长久的方案。
:::

- windows本地开发，把数据库和redis都塞到wsl中用docker管理，方便使用和更新。
- 新版windows都内置了wsl，应该就是linux虚拟机，用起来很方便，开发环境下可以把redis和数据库扔到虚拟机里，还可以导出镜像，换电脑开发直接安装导出的镜像就好了，感觉很方便。

## wsl安装

- 查看可安装的镜像版本
```bash
wsl --list --online
```

![Demo](/images/record/server1.png)

- 安装
```bash
wsl --install Ubuntu-24.04
```

![Demo](/images/record/server2.png)

- 切换root
```bash
sudo su root
```

![Demo](/images/record/server3.png)

- 查看版本
```bash
lsb_release -a
```

![Demo](/images/record/server4.png)

- 常规
```bash
apt-get update
apt-get upgrade
```

::: tip
如果update不通，那就切换国内镜像，因为我在北方就用的[清华镜像](https://mirrors.tuna.tsinghua.edu.cn/help/ubuntu/)。同时注意24.04开始用的是DEB822格式，即需要修改这个文件`/etc/apt/sources.list.d/ubuntu.sources`。
:::

:::warning
清华镜像默认安全的链接没改，建议还是勾选一下安全那个框，要不更新的时候关于安全的都会失效
:::

- 切换镜像
```bash
nano /etc/apt/sources.list.d/ubuntu.sources
```

## 让 WSL 和 docker 走 Windows 的 VPN

:::warning 先记住这一句，能省掉一半排查时间
`docker pull` 是 **`dockerd`（systemd 服务）** 发起的，不是 `docker` 这个 CLI。
所以在 shell 里 `export HTTPS_PROXY=...` 对**已经在跑的 daemon 完全无效** ——
这就是「我 `curl` 能通、但 `docker pull` 还是超时」的原因。daemon 必须单独配。
:::

### 方案：mirrored 网络 + autoProxy

为什么是这个组合，而不是「NAT + 自动取 Windows 网关 IP」：

- NAT 模式下 Windows 主机 IP（`ip route` 里的 `172.x.x.1`）是 WSL **每次启动动态分配**的，
  写进任何配置都会失效 —— 网上那些「自动获取 Windows IP，永不失效」的写法其实只在当前这个
  shell / 本次开机内成立；systemd 的 unit 文件里写命令替换更是**根本不会执行**。
- mirrored 模式下 WSL 直接复用 Windows 的回环，代理地址**永远是** `127.0.0.1:<端口>`；
  顺带也不用再在 VPN 客户端里开「允许局域网连接」了。

出处：微软 [WSL 网络文档](https://learn.microsoft.com/zh-cn/windows/wsl/networking)（mirrored / autoProxy /
dnsTunneling 的官方说明，也写了 mirrored 下用 `127.0.0.1` 连 Windows 服务器）、
Docker [daemon 代理文档](https://docs.docker.com/engine/daemon/proxy/)（`proxies` 字段，以及「当前终端里
`export HTTPS_PROXY` 不代表已运行的 daemon 会继承」的原文）。

前置条件：Windows 11 22H2+，WSL ≥ 2.0。查一下：

```powershell
wsl --version
```

**1. Windows 侧建 `%USERPROFILE%\.wslconfig`**（没有就新建）：

```ini
[wsl2]
networkingMode=mirrored
dnsTunneling=true
autoProxy=true
firewall=true
```

| 配置 | 作用 |
|------|------|
| `networkingMode=mirrored` | 把 Windows 的网络接口镜像进 WSL，于是 WSL 里的 `127.0.0.1` 就是 Windows 的 `127.0.0.1`（微软文档明确支持），VPN 兼容性也更好 |
| `dnsTunneling=true` | DNS 请求走虚拟化通道而不是发网络包，对 VPN / 复杂网络更友好（Win11 22H2+ 默认就开） |
| `autoProxy=true` | 让 WSL 自动继承 Windows 的系统代理设置 —— curl / git / wget 这些命令行工具就不用再手动 export 了 |

**2. 重启 WSL 让配置生效**：

```powershell
wsl --shutdown
```

:::warning
`wsl --shutdown` 会关掉 Ubuntu 里所有进程（docker 容器一起停）。先保存东西再执行。
:::

重进 WSL 后，先确认 Windows 上的代理端口。**端口不是固定的**：Clash Verge 系是 `7897`、
Clash for Windows 是 `7890`、v2rayN 是 `10809`。查实际值：

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' | Select-Object ProxyServer
```

**3. 验证 WSL 通网**：

```bash
# 不加 -x 也该是 401（registry 未认证的正常响应，等于通了）；超时就是没走代理
curl -s -o /dev/null -w 'direct: %{http_code}\n' https://registry-1.docker.io/v2/

# 显式指定代理再试一次（mirrored 模式下 127.0.0.1 就是 Windows）
curl -s -o /dev/null -w 'proxy:  %{http_code}\n' -x http://127.0.0.1:7897 https://registry-1.docker.io/v2/
```

**4. 给 dockerd 配代理（关键一步）**：

```bash
sudo install -d -m 0755 /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "proxies": {
    "http-proxy": "http://127.0.0.1:7897",
    "https-proxy": "http://127.0.0.1:7897",
    "no-proxy": "localhost,127.0.0.1,::1"
  }
}
EOF

sudo systemctl restart docker

sudo docker info | grep -i proxy    # 应打印出上面三条
sudo docker pull hello-world        # 收工
```

:::tip
`no-proxy` 里务必留着 `localhost,127.0.0.1`，否则以后访问本机 / 内网 registry 也会被塞进代理。
:::

**5.（可选）构建与容器内的代理**：`daemon.json` 只管 daemon 拉 / 推镜像。`docker build` 里的
网络步骤（比如 `deploy/nginx/Dockerfile` 那句 `apk add`）**不继承**它，要写在 `~/.docker/config.json`：

```json
{
  "proxies": {
    "default": {
      "httpProxy": "http://127.0.0.1:7897",
      "httpsProxy": "http://127.0.0.1:7897",
      "noProxy": "localhost,127.0.0.1"
    }
  }
}
```

**回退**：删掉 `%USERPROFILE%\.wslconfig` 再 `wsl --shutdown`，一秒回到 NAT 模式。

### 排错对照表

| 现象 / 报错 | 真正的原因 | 怎么办 |
|---|---|---|
| `i/o timeout`、`TLS handshake timeout`、`connection reset by peer` | dockerd 在直连 registry，没走代理 | 回到第 4 步 |
| 本机 curl 通、`docker pull` 不通 | `docker pull` 由 dockerd 发起，shell 里的 `export HTTPS_PROXY` 对它无效 | 回到第 4 步 |
| `proxyconnect tcp: dial tcp 127.0.0.1:7897: connect: connection refused` | 配了 `127.0.0.1`，但 WSL 还在 NAT 模式（NAT 下这个地址是 WSL 自己） | 回到第 1、2 步切 mirrored |
| `401 Unauthorized` | 通了 | 不是错误，别去修 |
| `429 Too Many Requests` | Docker Hub 限流：匿名按**出口 IP** 算 100 次 / 6 小时，VPN 共享出口很容易吃满 | `docker login` |
| `manifest unknown`、`not found` | 不是网络问题，是镜像名 / 标签不对 | 去查 tag，别乱改代理 |
| `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` | 当前用户不在 `docker` 组 | `sudo usermod -aG docker $USER`，然后重新登录 WSL |

:::warning 为什么不用镜像加速器
- 2026 年的现状：阿里云个人加速**已停止同步最新镜像**，DaoCloud / 1panel 那类有限流和白名单，
  USTC / 163 / 百度那批 2024 年就停服了；旧教程里的地址基本都不能照抄。
- `registry-mirrors` **只对 Docker Hub 生效**，改不了 `ghcr.io` / `registry.k8s.io` / `nvcr.io`
  —— 而代理对**所有** registry 都管用。
- 所以有可用代理时就不要配 `registry-mirrors`，两套混着只会让故障点更难判断。
:::

:::details 旧做法：systemd drop-in（能用，但没必要了）
```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo nano /etc/systemd/system/docker.service.d/http-proxy.conf
sudo systemctl daemon-reload && sudo systemctl restart docker
```

Docker 23.0 起 `daemon.json` 的 `proxies` 就是官方入口，改一个文件 + restart 即可，不必碰 systemd。
另外注意：unit 文件里的 `Environment=` **不做命令替换**，写 `$(ip route ...)` 只会被当成字面量
—— 很多教程照抄会失败，原因就在这。
:::

## docker

- 安装看[官方文档](https://docs.docker.com/engine/install/ubuntu/)，或本目录的[docker记录](./docker.md)

- 拉镜像的网络问题**只看上面那一节**（给 dockerd 配代理），不要再配镜像加速源

- 仓库里的 compose 在 `apps/server/docker/docker-compose.dev.yml`，起来即可：

```bash
sudo docker compose -f apps/server/docker/docker-compose.dev.yml up -d
```

:::tip
现在用户不在 `docker` 组，所以要么前面加 `sudo`，要么执行一次
`sudo usermod -aG docker $USER` 再重新登录 WSL。
:::

## redis

- 使用bitnami的redis镜像了，直接配环境变量就好了，看[这里](https://github.com/bitnami/containers/blob/main/bitnami/redis/README.md)

## mongodb

- 同理，bitnami的replicaset镜像，提供好的环境变量直接使用就行，看[这里](https://github.com/bitnami/containers/blob/main/bitnami/mongodb/README.md)

:::warning
Bitnami 在 2025 年把大部分免费镜像搬去了 `bitnamilegacy`（不再更新）。本页用的
`bitnami/mongodb` / `bitnami/redis` 目前仍在正常更新，但哪天 `latest` 报 `manifest unknown` 了，
就是这件事 —— 换 `bitnamilegacy/<name>` 或改用官方 `mongo` / `redis` 镜像。
:::

- 连接串

```bash
mongodb://root:123456@127.0.0.1:27017,127.0.0.1:27027,127.0.0.1:27037/?readPreference=primary&replicaSet=replicaset
```

:::warning
windows主机的`hosts`(C:\Windows\System32\drivers\etc)文件需要配置一下

```txt
127.0.0.1 dev-mongodb-primary
127.0.0.1 dev-mongodb-secondary
127.0.0.1 dev-mongodb-arbiter
```
:::

## 完整docker-compose.yml

见仓库里的 `apps/server/docker/docker-compose.dev.yml`（唯一真源 —— 本页曾复刻一份 70 行的副本，
已删除：两处必然会漂移）。启动命令在上一节。
