# 需要你确认的清单（我会持续往这里追加）

> 规则（按你今晚定的）：**能给出推荐选项的，我直接做**，不再等你；
> 只有「实在决定不了 / 会改变对外契约或产品行为 / 不可逆」的，才写到这里。
> 每条都给：背景 / 选项 / 我的推荐 / 现在按哪个做的（或为什么没动）。

---

## 1. 现在等着确认的

### C1 · `device.ts:91` 的 `as` → `satisfies`

**背景**：B5 把 `deviceName` 从 Initial DTO 摘除后，admin 侧靠 `request.d.ts` 的 `Omit<..., 'deviceName'>` 做类型守卫。
但调用点用的是 `as`，实测**会把这个守卫吞掉**（多带 deviceName 时 tsc 零报错），只能靠服务端 40099 兜住。

**为什么没直接改**：换 `satisfies` 会立刻暴露两处**预存在**的类型松动
（`device.ts:83` 的 `unknown→number`、`:86` 的 `deviceInfo` 缺 `type`），要修得动 payload 的构造来源。

**选项**：
- A（**当前按这个做的**）：保留 `as`，在代码注释里写明代价，记为 P3
- B：改成 `satisfies` 并顺手修那两处类型松动（约半天，会碰 payload 构造）

**推荐 B，但排在 D 组之后。**

---

### C2 · 删不删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint`

**背景**：B5 之后两者都 0 消费者。R2 的理由是「删了会让 `DEVICE_ID_ENCRYPTION_KEY` 失去唯一引用」——
**R3 实测这个理由是错的**（另有 4 处引用：`validation.ts:211`、`crypto.config.ts:10`、`validation.spec.ts:125`、`process.d.ts:60`）。
删掉只会让 `crypto.deviceIdKey` 悬空。

**选项**：
- A（**当前按这个做的**）：先不删，等下一批统一清死代码
- B：现在删，同时处理 `crypto.deviceIdKey` 的悬空

**推荐 A**（单独一批做，别和认证链路混）。

---

### C3 · `concurrency` G6 的既有 flake

**背景**：`expected 3 to be 1003`（rotate 没命中自插的高 version 种子行），单跑 6/6 绿、全量偶发。
R3 的可疑方向：应用池上**会话级 RLS GUC 残留**，使造种子的连接与轮换事务的连接看到不同的 `app_key` 行。

**为什么没修**：这是**既有 flake**，且根因未证实；盲改 RLS 连接池风险很高。

**选项**：
- A（**当前按这个做的**）：记为已知 flake，全量读数偶发 1 failed 不结案
- B：单开一批查 RLS GUC 与会话复用（可能牵出连接池配置改动）
- C：让该 spec 自带隔离（每次用独立连接造种子）

**推荐 B**，但需要真实复现窗口；C 是低风险兜底。

---

## 2. 已按推荐直接做掉的（留档，供你事后否决）

| 项 | 我做的决定 | 依据 |
|---|---|---|
| `ON UPDATE CASCADE` | **不加** | 全仓 0 处把 `device_id` 改成另一个值；现状 FK 会让真改名 23503 硬失败，CASCADE 会静默改写子表 |
| `fingerprint_hash` 列 | **不加** | 全仓 0 消费者；指纹已在 `app_monitor_user.visitor_id`；加了会把「指纹合法漂移」变成无自愈路径的永久 40099 |
| 双读窗口 60 天 | **不实现**（硬切） | 开发阶段无存量；窗口的唯一价值是保护存量会话连续性 |
| 心跳 visitorId 校验 | 改成「与本设备已存行的 `visitor_id` 比」 | DTO 注释本来就是这么写的；行键已是不可伪造的 deviceId |
| 90 天锚点 | `active=false AND updated_at<90d` | 只用 `stale` 会漏掉「用过再放弃」的那群（永远 stale=false） |
| `banned/locked` 行 | **永久保留** | 删 = 静默解封 |
| `deviceName` | 服务端生成 + 从 Initial DTO 摘除 | 客户端拼的名字会撞 `uq_device_name` ⇒ 23505 ⇒ 设备永久注册不上 |
| CAP 的 40111 | 只在「本地可证 cookie 非 cap.js token 形态」时抛 | `success:false`（已消费/过期）若也抛 40111，等于每 20 分钟踢一次全部在线用户 |
| `otp/send` 的风控分级 | 保持 **fail-open** | 已有独立 throttle；风控抖动时 fail-close 会让全部 OTP 登录不可用 |
| 新业务码 `40667` | 保留独立码，不复用 40666 | 「风险过高」与「风控不可用」必须可区分，否则排查时分不清 |
| `APP:MURLOCK` 键前缀 | **不改** | 改 Redis 键空间要迁移，收益为 0 |
| `roles_list` / `roles_count` | **永久冻结** | 改名的收益（风格纯）远小于动 openapi + 前端 6 处 + 测试 5 处 + i18n |
