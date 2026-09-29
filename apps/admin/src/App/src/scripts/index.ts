import { sendUserMonitorBeacon } from '@/hooks/web/useMonitor'
import { useAppStoreFingerprint } from '@/store/modules/app/app-fingerprint'
import { useAppStoreGeoIP } from '@/store/modules/app/app-geo-ip'
import { useAppStoreSecurity } from '@/store/modules/app/app-security'
import { setupGoogleAnalytics } from './analytics'

/**
 * 启动脚本各步**各自成函数**（原先是一个 `setupAppScripts()` 把四步串在一起）。
 *
 * 为什么拆开（2026-09-29，留档 V4）：组合根要能**逐步**捕获失败并说清「是哪一步挂了」——
 * 整串 `await` 的报错只能得到一句「启动失败」，而这四步的失败原因完全不同
 * （GA 脚本被墙 / 指纹库初始化失败 / 设备注册接口 500 / 签名密钥拿不到）。
 * 顺序由组合根（`bootstrap.ts`）决定，这里只保证单步语义。
 */

/** Google Analytics + web-vitals（没配 `VITE_GA_ID` 时自己短路返回） */
export async function setupAnalytics() {
  await setupGoogleAnalytics()
}

/** 设备指纹；顺带发一次 beacon，用来写入设备缓存并确保指纹已上报 */
export async function setupFingerprint() {
  const appStoreFingerprint = useAppStoreFingerprint()
  await appStoreFingerprint.setupFingerprint()

  // send beacon with left: false ensure device cache set
  // also to make sure the fingerprint is sent
  sendUserMonitorBeacon({ left: false })
}

/** 设备注册（`/system/device/initial` 一类） */
export async function setupDeviceId() {
  const appStoreGeoIP = useAppStoreGeoIP()
  await appStoreGeoIP.setupDeviceId()
}

/** 请求签名所需的密钥（`/security/sign/aes-key`） */
export async function setupSign() {
  const appStoreSecurity = useAppStoreSecurity()
  await appStoreSecurity.setupSign()
}
