import { describe, expect, it } from 'vitest'

import {
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  base64ToUint8Array,
  hexToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToHex,
  uint8ArrayToUtf8,
  utf8ToUint8Array,
} from './transformer'

describe('crypto transformer — base64', () => {
  it('encodes a known vector', () => {
    const data = new Uint8Array([0, 1, 2, 253, 254, 255])
    expect(uint8ArrayToBase64(data)).toBe('AAEC/f7/')
    expect(arrayBufferToBase64(data.buffer)).toBe('AAEC/f7/')
  })

  it('roundtrips uint8Array through base64', () => {
    const data = new Uint8Array([0, 1, 2, 253, 254, 255])
    expect(base64ToUint8Array(uint8ArrayToBase64(data))).toEqual(data)
  })

  it('roundtrips ArrayBuffer through base64', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer
    expect(new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(buf)))).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('crypto transformer — hex', () => {
  it('roundtrips known vectors', () => {
    const data = new Uint8Array([0x00, 0x0F, 0x10, 0xFF])
    expect(uint8ArrayToHex(data)).toBe('000f10ff')
    expect(hexToUint8Array('000f10ff')).toEqual(data)
    expect(hexToUint8Array('FF')).toEqual(new Uint8Array([255]))
  })

  it('handles ArrayBuffer input', () => {
    expect(arrayBufferToHex(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]).buffer)).toBe('deadbeef')
  })

  it('throws TypeError on odd-length hex strings', () => {
    expect(() => hexToUint8Array('abc')).toThrow(TypeError)
    expect(() => hexToUint8Array('a')).toThrow(TypeError)
  })
})

describe('crypto transformer — utf8', () => {
  it('roundtrips unicode text', () => {
    const str = '你好，walnut 🌰'
    expect(uint8ArrayToUtf8(utf8ToUint8Array(str))).toBe(str)
  })

  it('handles empty strings', () => {
    expect(uint8ArrayToUtf8(utf8ToUint8Array(''))).toBe('')
  })
})
