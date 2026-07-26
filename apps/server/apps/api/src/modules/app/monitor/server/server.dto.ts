import { TransformMbitsToMBs, TransformSecondsToHours, TransformSizeToGB, TransformToGHz, TransformToMWH, TransformToPercentage, TransformToVoltage, WalnutAdminDecoratorTransformDateToString } from '@walnut-server/decorators/transformer'

export class AppMonitorServerDTOCPU {
  constructor(partial: Partial<AppMonitorServerDTOCPU>) {
    Object.assign(this, partial)
  }

  cores: number

  brand: string

  @TransformToGHz()
  speed: number

  manufacturer: string
}

export class AppMonitorServerDTOMem {
  constructor(partial: Partial<AppMonitorServerDTOMem>) {
    Object.assign(this, partial)
  }

  @TransformSizeToGB()
  total: number

  @TransformSizeToGB()
  free: number

  @TransformSizeToGB()
  used: number

  @TransformSizeToGB()
  available: number
}

export class AppMonitorServerDTOOS {
  constructor(partial: Partial<AppMonitorServerDTOOS>) {
    Object.assign(this, partial)
  }

  hostname: string

  arch: string

  distro: string

  platform: string
}

export class AppMonitorServerDTOSystem {
  constructor(partial: Partial<AppMonitorServerDTOSystem>) {
    Object.assign(this, partial)
  }

  manufacturer: string

  model: string

  version: string

  uuid: string
}

export class AppMonitorServerDTOBattery {
  constructor(partial: Partial<AppMonitorServerDTOBattery>) {
    Object.assign(this, partial)
  }

  @TransformToVoltage()
  voltage: number

  @TransformToMWH()
  designedCapacity: number

  @TransformToMWH()
  currentCapacity: number

  @TransformToPercentage()
  percent: number
}

export class AppMonitorServerDTOTime {
  constructor(partial: Partial<AppMonitorServerDTOTime>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorTransformDateToString('YYYY-MM-DD HH:mm:ss')
  current: number

  @TransformSecondsToHours()
  uptime: number

  timezone: string

  timezoneName: string
}

export class AppMonitorServerDTONetwork {
  constructor(partial: Partial<AppMonitorServerDTONetwork>) {
    Object.assign(this, partial)
  }

  iface: string

  ip4: string

  mac: string

  @TransformMbitsToMBs()
  netSpeed: number
}

export class AppMonitorServerDTODisk {
  constructor(partial: Partial<AppMonitorServerDTODisk>) {
    Object.assign(this, partial)
  }

  name: string

  @TransformSizeToGB()
  size: number

  device: string

  type: string
}
