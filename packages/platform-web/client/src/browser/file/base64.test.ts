import { afterEach, describe, expect, it, vi } from 'vitest'

import { imgUrlToBase64 } from './base64'

describe('imgUrlToBase64 的 crossOrigin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('必须是规范允许的小写 anonymous（大写会退化成 no-cors，跨域图转 base64 静默失败）', async () => {
    const instances: FakeImage[] = []

    class FakeImage {
      crossOrigin: string | null = null
      height = 4
      width = 4
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      #src = ''

      constructor() {
        instances.push(this)
      }

      get src() {
        return this.#src
      }

      set src(value: string) {
        this.#src = value
        // 源码里 src 先赋值、onload 后挂，所以必须延后触发，否则 Promise 永远不 resolve
        queueMicrotask(() => this.onload?.())
      }
    }

    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
    } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')

    await imgUrlToBase64('https://example.com/a.png')

    expect(instances).toHaveLength(1)
    expect(instances[0]?.crossOrigin).toBe('anonymous')
  })
})
