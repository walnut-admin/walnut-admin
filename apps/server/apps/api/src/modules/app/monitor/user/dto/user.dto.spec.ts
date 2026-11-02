import { randomUUID } from 'node:crypto'
import { instanceToPlain, plainToInstance } from 'class-transformer'
import { describe, expect, it } from 'vitest'
import {
  AppMonitorUserDTOListResponse,
  AppMonitorUserDTOReadResponse,
  AppMonitorUserDTOUpdateState,
} from './user.dto'

/**
 * P0-2（设备追踪 P0 批）的机械闸门：**原始浏览器指纹绝不出现在响应面**。
 *
 * 背景：`deviceId = HMAC(指纹, 服务端 key)`（review 实测 MATCH），crypto 之前 monitor 的
 * list / read 出参里带着原始指纹 ⇒ 「读到别人指纹 → 匿名 POST /system/device/initial
 * 铸出该设备的合法 cookie → 订阅对方 OAuth 结果流」是一条可复现的账号接管链。
 *
 * 这里按全局 ClassSerializerInterceptor 的同一口径（`excludeExtraneousValues: true`，
 * 见 app/src/main.ts:157）把 DTO 实例化 + 序列化，断言指纹字段消失；同时守住
 * 「请求面还留着它」（心跳 body 仍以 visitorId 作行键，P1-3 另批处理）—— 两侧一起钉，
 * 免得下一次为了修 P1-3 又把它加回基座。
 */

const rawVisitorId = '020ce1fb9ab27da269915faff17a6814'

function monitorRow() {
  return {
    id: randomUUID(),
    visitorId: rawVisitorId,
    deviceId: 'b'.repeat(64),
    userId: null,
    auth: false,
    focus: true,
    left: false,
    currentRouter: '/about',
    firstVisitAt: new Date(),
    lastActiveAt: new Date(),
  }
}

const serializerOptions = { excludeExtraneousValues: true }

describe('appMonitorUser DTO：指纹只进不出（P0-2）', () => {
  it('list 响应：data[] 里没有 visitorId', () => {
    const instance = plainToInstance(AppMonitorUserDTOListResponse, { data: [monitorRow()], total: 1 })

    const plain = instanceToPlain(instance, serializerOptions) as { data: Record<string, unknown>[] }

    expect(plain.data).toHaveLength(1)
    expect(plain.data[0]).not.toHaveProperty('visitorId')
    // 同行的其它字段照常下发（不是把整个响应剥空了）
    expect(plain.data[0]).toHaveProperty('deviceId')
    expect(plain.data[0]).toHaveProperty('currentRouter')
  })

  it('read 响应：没有 visitorId', () => {
    const instance = plainToInstance(AppMonitorUserDTOReadResponse, monitorRow())

    const plain = instanceToPlain(instance, serializerOptions) as Record<string, unknown>

    expect(plain).not.toHaveProperty('visitorId')
    expect(plain.deviceId).toBe('b'.repeat(64))
  })

  it('心跳 body（请求面）：visitorId 仍在，且能原样取到（P1-3 之前不改契约）', () => {
    const instance = plainToInstance(AppMonitorUserDTOUpdateState, {
      visitorId: rawVisitorId,
      focus: true,
      left: false,
    })

    expect(instance.visitorId).toBe(rawVisitorId)
  })

  it('list 查询过滤（请求面）：visitorId 可作为过滤字段传入', () => {
    const instance = plainToInstance(AppMonitorUserDTOUpdateState, { visitorId: rawVisitorId })

    expect(instance.visitorId).toBe(rawVisitorId)
  })
})
