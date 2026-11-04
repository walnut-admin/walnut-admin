import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { googleJwk } from '../google-jwk'

// 双源漂移守卫（批 8 评审补）：JWKS 存在两处 —— lib 内编译期快照（google-jwk.ts，
// google.strategy 运行期用）与 app 公开静态副本（public/json/google-jwk.json，静态
// 资源面）。Google 轮换密钥时两处都要更新，这里机械钉住逐字段一致。

describe('google JWKS 双源一致性', () => {
  it('lib 编译期快照 ≡ app 公开静态副本（逐 key 逐字段）', () => {
    const publicCopy = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/api/src/public/json/google-jwk.json'), 'utf8')) as { keys: Array<Record<string, unknown>> }

    expect(publicCopy.keys.length).toBe(googleJwk.keys.length)
    for (const [index, key] of googleJwk.keys.entries()) {
      const copy = publicCopy.keys[index]
      for (const field of ['kty', 'n', 'e', 'kid', 'use', 'alg']) {
        expect(copy[field], `keys[${index}].${field} 两源不一致`).toEqual(key[field as keyof typeof key])
      }
    }
  })
})
