import { afterEach, describe, expect, it, vi } from 'vitest'

import { warnIfWorkerStandalone } from './schedule.composition'

// cron 让位组合根的两个分支钉子：standalone 时打让位 warn（worker 未运行会让 api
// 退化为默认配置，这条日志是部署契约的可见面），非 standalone 时保持静默。

function withEnv<T>(standalone: string | undefined, fn: () => T): T {
  const original = process.env.WORKER_STANDALONE
  if (standalone === undefined) {
    delete process.env.WORKER_STANDALONE
  }
  else {
    process.env.WORKER_STANDALONE = standalone
  }
  try {
    return fn()
  }
  finally {
    if (original === undefined) {
      delete process.env.WORKER_STANDALONE
    }
    else {
      process.env.WORKER_STANDALONE = original
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('warnIfWorkerStandalone', () => {
  it('设置 WORKER_STANDALONE=true → 打让位 warn（文案含 WorkerStandalone 与退化说明）', () => {
    withEnv('true', () => {
      const warn = vi.fn()
      warnIfWorkerStandalone({ warn } as never)

      expect(warn).toHaveBeenCalledTimes(1)
      const [message] = warn.mock.calls[0] as unknown as [string]
      expect(message).toContain('[WorkerStandalone]')
      expect(message).toContain('worker')
    })
  })

  it('未设置 WORKER_STANDALONE（默认）→ 静默', () => {
    withEnv(undefined, () => {
      const warn = vi.fn()
      warnIfWorkerStandalone({ warn } as never)

      expect(warn).not.toHaveBeenCalled()
    })
  })

  it('设置 WORKER_STANDALONE=false → 静默（只有字面 true 才让位）', () => {
    withEnv('false', () => {
      const warn = vi.fn()
      warnIfWorkerStandalone({ warn } as never)

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
