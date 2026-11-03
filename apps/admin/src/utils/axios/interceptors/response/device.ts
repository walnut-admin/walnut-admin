import { SingletonPromise } from '@walnut/client/queue'
import { useAppStoreGeoIP } from '@/store/modules/app/app-geo-ip'

/**
 * P0-1 自愈（与 40101 的 `SingletonPromiseRefreshToken` 同款形态，不新造抽象）：
 * 收到 `40605`（设备不受支持）时重建本机设备身份 ——
 *
 * 1. 清本地 device 缓存（`GEO_IP_DEVICE_ID` / geoInfo）；
 * 2. 重走 `POST /system/device/initial`（匿名，服务端重新签发 DEVICE_ID cookie）；
 * 3. 调用方拿到 resolve 后重放原请求。
 *
 * 为什么需要它：cookie 30 天硬过期（本轮后端已加滑动续期做纵深）或被用户/浏览器清掉
 * 之后，前端 `setupDeviceId` 因 localStorage 仍有 deviceId 而**不再 initial** ⇒ 40605 是
 * 死胡同：连登录端点都在 DeviceGuard 之后，用户连重新登录都做不到。
 *
 * 并发：用 SingletonPromise 收敛成一次（多个请求同时 40605 只 initial 一次）。
 */
const deviceQueue = new SingletonPromise<void>()

export function SingletonPromiseDeviceReset() {
  return deviceQueue.run(async () => {
    const appStoreGeoIP = useAppStoreGeoIP()
    await appStoreGeoIP.resetDeviceId()
  })
}
