/**
 * 设备位置展示串（libs 解耦批 6 随身份内核下沉）。
 *
 * 原 `apps/api/src/modules/system/device/entity/device.entity.ts` 的同名纯函数 ——
 * user_device 列表的 location 出参跨模块消费。
 * 逻辑与原实现一致（`region === city` 时去重），仅补一处防御：原实现只判 `loc === null`，这里加 `undefined` 同判。
 */
export interface IIdentityDeviceLocationInfo {
  country?: unknown
  region?: unknown
  city?: unknown
}

export interface IIdentityDeviceLocationLike {
  locationInfo?: IIdentityDeviceLocationInfo | null
}

export function getDeviceLocationString(device: IIdentityDeviceLocationLike): string {
  const loc = device.locationInfo
  if (loc === null || loc === undefined) {
    return 'Unknown'
  }

  const country = loc.country as string | undefined
  const region = loc.region as string | undefined
  const city = loc.city as string | undefined

  if (region === city) {
    return `${country} ${region}`
  }

  return [
    country,
    region,
    city,
  ].filter(Boolean).join(' ')
}
