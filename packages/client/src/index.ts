export { generateRsaOaepKeyPair } from './browser/crypto/asymmetric/rsa-oaep'

export { deriveApiSignKey } from './browser/crypto/derive/api-sign-key'

export { hmacSha256 } from './browser/crypto/mac/hmac-sha256'

export {
  exportAesKeyToRaw,
  generateAes256Key,
  importAesKeyFromRaw,
  importRsaPublicKey,
} from './browser/crypto/shared'

export { aesGcmDecrypt, aesGcmEncrypt } from './browser/crypto/symmetric/aes-gcm'

export { base64ToBlob, blobToBase64, imgUrlToBase64 } from './browser/file/base64'

export {
  downloadByBase64,
  downloadByBlob,
  downloadByOnlineUrl,
  downloadByUrl,
} from './browser/file/download'

export {
  detectDeviceType,
  getBoolean,
  getCPUCoreCount,
  getDefaultSlotText,
  getFunctionBoolean,
  getGPUArchitecture,
  getIsInIncognitoMode,
  getMemoryGB,
  isInSetup,
} from './browser/shared'

export { watob, wbtoa } from './browser/window/base64'

export { useGlobalAsyncComponent } from './hooks/component/useGlobalAsyncComponent'

export { useContext } from './hooks/core/useContext'

export { localRefreshFlag, toggleLocalRefreshFlag } from './hooks/core/useLocalRefresh'

export type { IHooksUseProps } from './hooks/core/useProps'

export { useProps } from './hooks/core/useProps'

export { useState } from './hooks/core/useState'

export { useSharedBattery } from './hooks/vueuse/useBattery'

export { useAppBreakpoints } from './hooks/vueuse/useBreakpoints'

export { useSharedDocumentVisibility } from './hooks/vueuse/useDocumentVisibility'

export { useDraggableElement } from './hooks/vueuse/useDraggableElement'

export { useIntervalFnWithPercent } from './hooks/vueuse/useIntervalFnWithPercent'

export { useSharedNavigatorLanguage } from './hooks/vueuse/useNavigatorLanguage'

export { useSharedNetwork } from './hooks/vueuse/useNetwork'

export { useSharedPreferredReducedMotion } from './hooks/vueuse/usePreferredReducedMotion'

export { useWindowResize } from './hooks/vueuse/useResize'

export { useBlob } from './hooks/web/useBlob'

export { useLinkTag } from './hooks/web/useLinkTag'

export {
  enhancedAesGcmLocalStorage,
  enhancedBase64LocalStorage,
} from './persistent/enhance/index'

export { getStorageIdbKey } from './persistent/idb/index'

export { removeStorageItemsContaining } from './persistent/shared'
