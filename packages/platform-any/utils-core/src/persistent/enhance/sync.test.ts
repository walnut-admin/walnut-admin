import type { IStorageSync } from '@walnut/types/storage'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withSyncConditionalEncryption } from './sync'

function createMemoryStorage() {
  const data = new Map<string, string>()
  const storage: IStorageSync = {
    get length() {
      return data.size
    },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn((key: string) => data.has(key) ? data.get(key)! : null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key)
    }),
    key: vi.fn((index: number) => [...data.keys()][index] ?? null),
  }
  return { storage, data }
}

describe('withSyncConditionalEncryption', () => {
  const encrypt = (plain: string) => `enc:${plain}`
  const decrypt = (encrypted: string) => encrypted.startsWith('enc:') ? encrypted.slice(4) : null

  let store: ReturnType<typeof createMemoryStorage>

  beforeEach(() => {
    store = createMemoryStorage()
  })

  it('encrypts on write and decrypts on read', () => {
    const wrapped = withSyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)

    wrapped.setItem('k', 'hello')
    expect(store.data.get('k')).toBe('enc:hello') // underlying storage holds ciphertext
    expect(wrapped.getItem('k')).toBe('hello') // reads back plaintext
  })

  it('returns null for a missing key without decrypting', () => {
    const wrapped = withSyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)
    expect(wrapped.getItem('missing')).toBeNull()
  })

  it('returns null when decryption fails', () => {
    store.data.set('k', 'corrupted-value')
    const wrapped = withSyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)
    expect(wrapped.getItem('k')).toBeNull()
  })

  it('delegates length / key / removeItem / clear to the underlying storage', () => {
    const wrapped = withSyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => true)

    wrapped.setItem('a', '1')
    wrapped.setItem('b', '2')
    expect(wrapped.length).toBe(2)
    expect(wrapped.key(0)).toBe('a')

    wrapped.removeItem('a')
    expect(wrapped.length).toBe(1)

    wrapped.clear()
    expect(wrapped.length).toBe(0)
  })

  it('passes through unmodified when shouldEncrypt is false', () => {
    const wrapped = withSyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => false)

    wrapped.setItem('k', 'plain')
    expect(store.data.get('k')).toBe('plain')
    expect(wrapped.getItem('k')).toBe('plain')
  })

  it('decides at wrap time — a false condition returns the same storage instance', () => {
    const wrapped = withSyncConditionalEncryption(store.storage, { encrypt, decrypt }, () => false)
    expect(wrapped).toBe(store.storage)
  })
})
