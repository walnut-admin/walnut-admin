import { ApiProperty } from '@nestjs/swagger'
import { TransformMbitsToMBs, TransformSecondsToHours, TransformSizeToGB, TransformToGHz, TransformToMWH, TransformToPercentage, TransformToVoltage, WalnutAdminDecoratorTransformDateToString } from '@walnut-server/decorators/transformer'

// 以下 DTO 是 systeminformation 直出字段的**轻量子集**（server service 逐字段投影，
// 不把库的完整返回值透出）：每个类恰好就是该端点 wire 上的字段集，仅补 swagger 文档
// （ApiProperty 不参与序列化，wire 零变化）。数值字段的 Transform* 是既有 wire 口径
// （如 mem total 出参是 `x.xx GB` 字符串），文档类型仍按构造期 number 声明。

export class AppMonitorServerDTOCPU {
  constructor(partial: Partial<AppMonitorServerDTOCPU>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: Number, description: 'number of logical CPU cores' })
  cores: number

  @ApiProperty({ type: String, description: 'CPU brand string' })
  brand: string

  @TransformToGHz()
  @ApiProperty({ type: Number, description: 'CPU speed in GHz (wire: formatted string)' })
  speed: number

  @ApiProperty({ type: String, description: 'CPU manufacturer' })
  manufacturer: string
}

export class AppMonitorServerDTOMem {
  constructor(partial: Partial<AppMonitorServerDTOMem>) {
    Object.assign(this, partial)
  }

  @TransformSizeToGB()
  @ApiProperty({ type: Number, description: 'total memory in GB (wire: formatted string)' })
  total: number

  @TransformSizeToGB()
  @ApiProperty({ type: Number, description: 'free memory in GB (wire: formatted string)' })
  free: number

  @TransformSizeToGB()
  @ApiProperty({ type: Number, description: 'used memory in GB (wire: formatted string)' })
  used: number

  @TransformSizeToGB()
  @ApiProperty({ type: Number, description: 'available memory in GB (wire: formatted string)' })
  available: number
}

export class AppMonitorServerDTOOS {
  constructor(partial: Partial<AppMonitorServerDTOOS>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: String, description: 'OS hostname' })
  hostname: string

  @ApiProperty({ type: String, description: 'OS architecture' })
  arch: string

  @ApiProperty({ type: String, description: 'OS distribution' })
  distro: string

  @ApiProperty({ type: String, description: 'OS platform' })
  platform: string
}

export class AppMonitorServerDTOSystem {
  constructor(partial: Partial<AppMonitorServerDTOSystem>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: String, description: 'hardware manufacturer' })
  manufacturer: string

  @ApiProperty({ type: String, description: 'hardware model' })
  model: string

  @ApiProperty({ type: String, description: 'hardware version' })
  version: string

  @ApiProperty({ type: String, description: 'hardware UUID' })
  uuid: string
}

export class AppMonitorServerDTOBattery {
  constructor(partial: Partial<AppMonitorServerDTOBattery>) {
    Object.assign(this, partial)
  }

  @TransformToVoltage()
  @ApiProperty({ type: Number, description: 'battery voltage (wire: formatted string)' })
  voltage: number

  @TransformToMWH()
  @ApiProperty({ type: Number, description: 'designed capacity in mWh (wire: formatted string)' })
  designedCapacity: number

  @TransformToMWH()
  @ApiProperty({ type: Number, description: 'current capacity in mWh (wire: formatted string)' })
  currentCapacity: number

  @TransformToPercentage()
  @ApiProperty({ type: Number, description: 'battery percent (wire: formatted string)' })
  percent: number
}

export class AppMonitorServerDTOTime {
  constructor(partial: Partial<AppMonitorServerDTOTime>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorTransformDateToString('YYYY-MM-DD HH:mm:ss')
  @ApiProperty({ type: Number, description: 'current time (wire: `YYYY-MM-DD HH:mm:ss` string)' })
  current: number

  @TransformSecondsToHours()
  @ApiProperty({ type: Number, description: 'uptime in hours (wire: formatted string)' })
  uptime: number

  @ApiProperty({ type: String, description: 'timezone' })
  timezone: string

  @ApiProperty({ type: String, description: 'timezone name' })
  timezoneName: string
}

export class AppMonitorServerDTONetwork {
  constructor(partial: Partial<AppMonitorServerDTONetwork>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: String, description: 'network interface name' })
  iface: string

  @ApiProperty({ type: String, description: 'IPv4 address' })
  ip4: string

  @ApiProperty({ type: String, description: 'MAC address' })
  mac: string

  @TransformMbitsToMBs()
  @ApiProperty({ type: Number, description: 'network speed (wire: formatted string)' })
  netSpeed: number
}

export class AppMonitorServerDTODisk {
  constructor(partial: Partial<AppMonitorServerDTODisk>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: String, description: 'disk name' })
  name: string

  @TransformSizeToGB()
  @ApiProperty({ type: Number, description: 'disk size in GB (wire: formatted string)' })
  size: number

  @ApiProperty({ type: String, description: 'disk device' })
  device: string

  @ApiProperty({ type: String, description: 'disk type' })
  type: string
}
