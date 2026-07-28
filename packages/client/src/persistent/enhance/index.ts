import { aesGcmDecrypt, aesGcmEncrypt } from '@walnut/client/browser/crypto/symmetric/aes-gcm'
import { watob, wbtoa } from '@walnut/client/browser/window/base64'
import { withAsyncConditionalEncryption } from '@walnut/utils/persistent/enhance/async'
import { withSyncConditionalEncryption } from '@walnut/utils/persistent/enhance/sync'
import { getStorageIdbKey } from '../idb'
import { asyncLocalStorage, syncLocalStorage } from '../storage/localStorage'

/**
 * @description aes gcm encrypt/decrypt for localStorage
 */
export function enhancedAesGcmLocalStorage(forceEncrypt = false) {
  return withAsyncConditionalEncryption(asyncLocalStorage, {
    encrypt: async raw => aesGcmEncrypt(await getStorageIdbKey(), raw),
    decrypt: async encrypted => aesGcmDecrypt(await getStorageIdbKey(), encrypted),
  }, () => forceEncrypt)
}

/**
 * @description base64 atob/btoa encode/decode for localStorage
 */
export function enhancedBase64LocalStorage(forceEncrypt = false) {
  return withSyncConditionalEncryption(syncLocalStorage, {
    encrypt: plain => wbtoa(plain),
    decrypt: encoded => watob(encoded),
  }, () => forceEncrypt)
}
