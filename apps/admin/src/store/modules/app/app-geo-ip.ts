import type { Nullable } from 'easy-fns-ts'
import type { IStoreApp } from '@/store/types'
import { useAppStorageSync } from '@walnut/client/persistent/storage/sync'
import { defineStore } from 'pinia'
import { getCurrentInstance } from 'vue'
import { initialDeviceAPI } from '@/api/system/device'
import { AppConstPersistKey } from '@/const/persistent'
import { StoreKeys } from '../../constant'
import { store } from '../../pinia'

const deviceId = useAppStorageSync<Nullable<string>>(AppConstPersistKey.GEO_IP_DEVICE_ID, null)

const geoInfo = useAppStorageSync<IStoreApp.GeoIP['geoInfo']>(AppConstPersistKey.GEO_IP_GEO_INFO, {
  countryCode: '',
  longitude: 0,
  latitude: 0,
})

const useAppStoreGeoIPInside = defineStore(StoreKeys.APP_GEO_IP, {
  state: (): IStoreApp.GeoIP => ({
    deviceId,
    geoInfo: geoInfo.value,
  }),

  getters: {
    getDeviceId(state) {
      return state.deviceId
    },
    getLng(state) {
      return state.geoInfo.longitude as number
    },
    getLat(state) {
      return state.geoInfo.latitude as number
    },
    getCountryCode(state) {
      return state.geoInfo.countryCode
    },
  },

  actions: {
    async setupDeviceId() {
      if (this.getDeviceId) {
        return
      }
      const res = await initialDeviceAPI()
      this.$patch(res)
    },

    /**
     * P0-1 自愈：**清掉本机 device 缓存** → 重走 `POST /system/device/initial` → 回填。
     *
     * 40605 的成因里有一类是「cookie 没了但 localStorage 还留着 deviceId」——
     * `setupDeviceId` 见到 localStorage 有值就早退（bootstrap 也不会再调 initial），于是
     * cookie 永远回不来。这个 action 绕开那道门闩：先把本地缓存清空（cookie 由服务端
     * 在 initial 里重新签发），再按响应回填。
     *
     * 由 response 拦截器的 `SingletonPromiseDeviceReset` 调用（与 40101 的
     * `SingletonPromiseRefreshToken` 同款：并发 40605 只自愈一次，其余重放原请求）。
     */
    async resetDeviceId() {
      this.$patch({
        deviceId: null,
        geoInfo: { countryCode: '', longitude: 0, latitude: 0 },
      })

      const res = await initialDeviceAPI()

      // initial 的响应是拍平形态（latitude/longitude/countryCode），本 store 是嵌套的
      // geoInfo —— 这里显式映射，不再沿用 setupDeviceId 的 $patch(res) 直塞。
      // 响应里这三个字段都可能缺（定位服务拿不到结果时 data 只有 deviceId），
      // 缺了必须回落到 geoInfo 的既有默认值，否则 store 的数值字段会变成 undefined
      // （getLng/getLat 的消费方拿到 undefined）。
      this.$patch({
        deviceId: res.deviceId,
        geoInfo: {
          countryCode: res.countryCode ?? '',
          longitude: res.longitude ?? 0,
          latitude: res.latitude ?? 0,
        },
      })

      return res
    },
  },
})

const useAppStoreGeoIPOutside = () => useAppStoreGeoIPInside(store)

export function useAppStoreGeoIP() {
  if (getCurrentInstance())
    return useAppStoreGeoIPInside()
  return useAppStoreGeoIPOutside()
}
