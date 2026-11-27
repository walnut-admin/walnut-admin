/**
 * **每轮都要重做**的运行时状态 —— 与「封板快照」互补的那一半。
 *
 * 封板（scripts/baseline.ts 的 seal）保存的是**库内数据**：迁移、seed、admin 提升为 root、
 * CAP 节流放宽。下面这些**不在 dump 里**，所以无论走 restore 还是全量 prepare，每轮都必须重做：
 *
 * 1. `walnut_app` 口令：它是**集群级角色**（pg_dump 只导库、不导角色），而迁移建它时带的是
 *    开发引导密码，后端 stage 启动会拒绝那个字面量 —— 每次都要在本库把它换成本栈固定值；
 * 2. Redis 的应用设置缓存：库换了，键还留着上一轮的读数（例如 CAP 节流仍是旧的 4/60）。
 *
 * 反过来：**口令身份、菜单 junction、CAP 设置行都在快照里**，别在这里重复写 ——
 * 判断某个后置步骤该放哪边，就看它「是库内数据」还是「库外的运行时状态」。
 */
import type { Client } from 'pg'
import { createClient } from 'redis'
import {
  assertE2eRedisPort,
  E2E_PG_APP_PASS,
  E2E_PG_APP_USER,
  E2E_REDIS_HOST,
  E2E_REDIS_PASS,
  E2E_REDIS_PORT,
} from './env.ts'

function log(message: string): void {
  console.log(`[e2e/runtime-reset] ${message}`)
}

/**
 * 把运行时角色 `walnut_app` 的口令改成本栈固定值。
 *
 * 角色是**集群级**的，但本栈的 PG 实例只服务 E2E，所以这里改的就是「本栈自己的角色」。
 * 口令与角色名来自 scripts/env.ts 的常量（不是外部输入），没有注入面。
 */
export async function resetRuntimeRolePassword(client: Client): Promise<void> {
  await client.query(`ALTER ROLE ${E2E_PG_APP_USER} WITH LOGIN PASSWORD '${E2E_PG_APP_PASS}'`)
  log(`已重置 ${E2E_PG_APP_USER} 口令（stage 启动不接受迁移里的开发引导密码）`)
}

/**
 * 清掉应用设置的 Redis 缓存（**只删这两个键，不 FLUSHDB** —— compose 里 FLUSH 已被禁用）。
 *
 * 键形对齐 apps/server/libs/const/src/app/cache.ts；服务端改键形时这里要同步。
 *
 * **profile 化后仍然不加前缀、不换逻辑库**（P1-6 设计结论，见 scripts/stack-profiles.ts 头注释）：
 * 这两个全局键的值由同一份基线数据派生，本地多 profile 串行、CI 每个 job 独立 Redis service；
 * 设备作用域键则按 deviceId 精确删，跨 profile 撞不上。
 */
export async function clearAppSettingCache(): Promise<void> {
  assertE2eRedisPort(E2E_REDIS_PORT)
  const redis = createClient({
    socket: { host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
    password: E2E_REDIS_PASS,
  })
  redis.on('error', () => {})
  try {
    await redis.connect()
    await redis.del(['WALNUT_CACHE_APP:SETTING', 'APP:SETTING'])
  }
  finally {
    await redis.quit().catch(() => {})
  }
  log('已清 Redis 应用设置缓存（WALNUT_CACHE_APP:SETTING / APP:SETTING）')
}
