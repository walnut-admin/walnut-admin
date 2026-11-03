import { describe, expect, it, vi } from 'vitest'

import { SingletonPromise } from './queue'

describe('singletonPromise', () => {
  it('deduplicates concurrent runs into a single execution', async () => {
    const sp = new SingletonPromise<number>()
    const task = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return 42
    })

    const [a, b, c] = await Promise.all([sp.run(task), sp.run(task), sp.run(task)])

    expect(task).toHaveBeenCalledTimes(1)
    expect([a, b, c]).toEqual([42, 42, 42])
  })

  it('clears the cached promise after success by default', async () => {
    const sp = new SingletonPromise<number>()
    const task = vi.fn(async () => 1)

    await sp.run(task)
    await sp.run(task)

    expect(task).toHaveBeenCalledTimes(2)
  })

  it('clears after failure and allows retry', async () => {
    const sp = new SingletonPromise<number>()
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(sp.run(failing)).rejects.toThrow('boom')

    const ok = vi.fn(async () => 7)
    await expect(sp.run(ok)).resolves.toBe(7)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('keeps the promise cached when clearOnFinally is false', async () => {
    const sp = new SingletonPromise<number>(false)
    const task = vi.fn(async () => 99)

    await sp.run(task)
    await sp.run(task)

    expect(task).toHaveBeenCalledTimes(1)
  })

  it('never caches a failed promise, even with clearOnFinally false', async () => {
    const sp = new SingletonPromise<number>(false)
    const failing = vi.fn(async () => {
      throw new Error('x')
    })

    await expect(sp.run(failing)).rejects.toThrow('x')

    const ok = vi.fn(async () => 5)
    await expect(sp.run(ok)).resolves.toBe(5)
    expect(ok).toHaveBeenCalledTimes(1)
  })
})
