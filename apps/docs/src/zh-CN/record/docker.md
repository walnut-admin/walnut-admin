# Docker 记录

## 安装
- 看官方[安装文档](https://docs.docker.com/engine/install/ubuntu/)就行

## 配置

### 拉镜像走代理

:::warning
镜像拉不下来**不是**「换个镜像加速源」能解决的：公共加速源到 2026 年基本都停服或限流了，
而且 `registry-mirrors` **只对 Docker Hub 生效**，改不了 `ghcr.io` / `registry.k8s.io` 这些。

正确做法是给 **dockerd** 配上游代理 —— 注意 `docker pull` 是 daemon 发起的，
shell 里 `export HTTPS_PROXY` 对它无效。完整步骤见 [wsl 记录](./wsl.md) 的
「让 WSL 和 docker 走 Windows 的 VPN」一节。
:::

:::tip
网上常见的「换成[清华镜像](https://mirrors.tuna.tsinghua.edu.cn/help/docker-ce/)」是 **apt 源**
（用来装 docker-ce 这个软件本身的），跟拉容器镜像完全是两件事 —— 照着改不会让 `docker pull` 变快。
:::

### 验证

```bash
docker compose version
docker info | grep -i proxy
```

:::tip
如果不行就reboot一下，apt update/upgrade后还是需要重启的
:::
