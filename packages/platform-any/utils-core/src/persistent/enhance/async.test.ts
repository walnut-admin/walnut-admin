import type { IStorageAsync } from '@walnut/types/storage'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withAsyncConditionalEncryption } from './async'

function createMemoryStorage() {
  const data = new Map<string, string>()
  const storage: IStorageAsync = {
    get length() {
      return data.size
    },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn(async (key: string) => data.has(key) ? data.get(key)! : null),
    setItem: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key)
    }),
    key: vi.fn((index: number) => [...data.keys()][index] ?? null),
  }
  return { storage, data }
}

describe('withAsyncConditionalEncryption', () => {
  const encrypt = async (plain: string) => `enc:${plain}`
  const decrypt = async (encrypted: string) => encrypted.startsWith('enc:') ? encrypted.slice(4) : null

  let store: ReturnType<typeof createMemoryStorage>

  beforeEach(() => {
    store = createMemoryStorage()
  })

  it('encrypts on write and decrypts on read', async () => {
    const wrapped = withAsyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)

    await wrapped.setItem('k', 'hello')
    expect(store.data.get('k')).toBe('enc:hello')
    await expect(wrapped.getItem('k')).resolves.toBe('hello')
  })

  it('returns null for a missing key without decrypting', async () => {
    const wrapped = withAsyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)
    await expect(wrapped.getItem('missing')).resolves.toBeNull()
  })

  it('returns null when decryption fails', async () => {
    store.data.set('k', 'corrupted-value')
    const wrapped = withAsyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)
    await expect(wrapped.getItem('k')).resolves.toBeNull()
  })

  it('delegates length / key / removeItem / clear to the underlying storage', async () => {
    const wrapped = withAsyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)

    await wrapped.setItem('a', '1')
    await wrapped.setItem('b', '2')
    expect(wrapped.length).toBe(2)
    expect(wrapped.key(0)).toBe('a')

    wrapped.removeItem('a')
    expect(wrapped.length).toBe(1)

    wrapped.clear()
    expect(wrapped.length).toBe(0)
  })

  it('passes through unmodified when shouldEncrypt is false', async () => {
    const wrapped = withAsyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => false)

    await wrapped.setItem('k', 'plain')
    expect(store.data.get('k')).toBe('plain')
    await expect(wrapped.getItem('k')).resolves.toBe('plain')
  })

  it('decides at wrap time — a false condition returns the same storage instance', () => {
    const wrapped = withAsyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => false)
    expect(wrapped).toBe(store.storage)
  })
})
