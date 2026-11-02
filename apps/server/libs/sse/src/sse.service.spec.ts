import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AppTechSseService } from './sse.service'

/**
 * F-04 / F-40（2026-11-01）单测：
 * - `createClient` 对同一频道键幂等复用：同频道的多条连接共享一个 Subject，一次投递全部送达；
 * - 多连接互不误删：关掉其中一条不终结、也不移除同频道的另一条（多标签页场景）；
 * - 空回退不再是「永不发射的冷 Observable」：未注册频道取流直接抛 NotFoundException；
 * - `close` 幂等，且旧句柄的 close 不会删掉同键的新频道。
 *
 * 为什么走单测：这四条都是内存结构不变量，HTTP 层只能间接观察到「token 没收到」，
 * 定位不到是覆盖、误删还是空回退 —— 单测直接把语义钉在服务出口上。
 */

function createPayload(message: string) {
  return { success: true, message, data: {} }
}

describe('appTechSseService (F-04 / F-40)', () => {
  it('同一频道键复用一个频道：一次 sendToClient 送达所有同频道连接', () => {
    const service = new AppTechSseService()

    const first = service.createClient('channel-a')
    const second = service.createClient('channel-a')

    expect(first.clientId).toBe('channel-a')
    expect(second.clientId).toBe('channel-a')

    const received: string[] = []
    const subscription = service.getClientObservable('channel-a').subscribe((data) => {
      received.push(data.message)
    })

    expect(service.sendToClient('channel-a', createPayload('hello'))).toBe(true)
    expect(received).toEqual(['hello'])

    subscription.unsubscribe()
  })

  it('未注册频道取流抛 NotFoundException，不再是永不发射的 Observable（F-40）', () => {
    const service = new AppTechSseService()

    expect(() => service.getClientObservable('missing')).toThrow(NotFoundException)
    // 无人订阅时投递是静默 no-op（回调侧不能因为没人听就失败），但要如实报告 false
    expect(service.sendToClient('missing', createPayload('nobody'))).toBe(false)
  })

  it('多连接互不误删：关闭先前的连接不终结同频道的另一条连接', () => {
    const service = new AppTechSseService()

    const first = service.createClient('channel-b')
    const second = service.createClient('channel-b')

    const received: string[] = []
    let completed = false

    const subscription = service.getClientObservable('channel-b').subscribe({
      next: data => received.push(data.message),
      complete: () => {
        completed = true
      },
    })

    first.close()

    expect(service.sendToClient('channel-b', createPayload('after-first-close'))).toBe(true)
    expect(received).toEqual(['after-first-close'])
    expect(completed).toBe(false)

    second.close()

    // 最后一个连接关闭：流终结，频道移除
    expect(completed).toBe(true)
    expect(service.sendToClient('channel-b', createPayload('after-last-close'))).toBe(false)
    expect(() => service.getClientObservable('channel-b')).toThrow(NotFoundException)

    subscription.unsubscribe()
  })

  it('close 幂等，且旧句柄的 close 不会删掉同键的新频道', () => {
    const service = new AppTechSseService()

    const stale = service.createClient('channel-c')
    stale.close()
    stale.close()

    const fresh = service.createClient('channel-c')
    const received: string[] = []
    const subscription = service.getClientObservable('channel-c').subscribe((data) => {
      received.push(data.message)
    })

    // 旧句柄再关一次：不能影响后来新建的频道
    stale.close()

    expect(service.sendToClient('channel-c', createPayload('still-alive'))).toBe(true)
    expect(received).toEqual(['still-alive'])

    fresh.close()
    subscription.unsubscribe()
  })

  it('不同频道键互相隔离', () => {
    const service = new AppTechSseService()

    const left = service.createClient('channel-left')
    const right = service.createClient('channel-right')

    const leftReceived: string[] = []
    const rightReceived: string[] = []

    const leftSubscription = service.getClientObservable('channel-left').subscribe((data) => {
      leftReceived.push(data.message)
    })
    const rightSubscription = service.getClientObservable('channel-right').subscribe((data) => {
      rightReceived.push(data.message)
    })

    service.sendToClient('channel-left', createPayload('left-only'))

    expect(leftReceived).toEqual(['left-only'])
    expect(rightReceived).toEqual([])

    left.close()
    right.close()
    leftSubscription.unsubscribe()
    rightSubscription.unsubscribe()
  })
})
