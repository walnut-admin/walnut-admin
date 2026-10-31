import { Injectable, Logger } from '@nestjs/common'
import { omit } from 'lodash'

import * as systemInfo from 'systeminformation'

@Injectable()
export class AppMonitorServerService {
  private readonly logger = new Logger(AppMonitorServerService.name)

  constructor() {}

  async cpu() {
    this.logger.log('Getting cpu info...')

    const res = await systemInfo.cpu()

    return {
      cores: res.cores,
      brand: res.brand,
      speed: res.speed,
      manufacturer: res.manufacturer,
    }
  }

  async memory() {
    this.logger.log('Getting memory info...')

    const res = await systemInfo.mem()

    return {
      total: res.total,
      free: res.free,
      used: res.used,
      available: res.available,
    }
  }

  async os() {
    this.logger.log('Getting os info...')

    const res = await systemInfo.osInfo()

    return {
      hostname: res.hostname,
      arch: res.arch,
      distro: res.distro,
      platform: res.platform,
    }
  }

  async system() {
    this.logger.log('Getting system info...')

    const res = await systemInfo.system()

    return {
      manufacturer: res.manufacturer,
      model: res.model,
      version: res.version,
      uuid: res.uuid,
    }
  }

  async disk() {
    this.logger.log('Getting disk info...')

    const res = await systemInfo.diskLayout()

    return res.map(disk => ({
      name: disk.name,
      size: disk.size,
      device: disk.device,
      type: disk.type,
    }))
  }

  async battery() {
    this.logger.log('Getting battery info...')

    const res = await systemInfo.battery()

    return {
      voltage: res.voltage,
      designedCapacity: res.designedCapacity,
      currentCapacity: res.currentCapacity,
      percent: res.percent,
    }
  }

  async time() {
    this.logger.log('Getting time info...')

    const res = systemInfo.time()

    return res
  }

  async network() {
    this.logger.log('Getting network info...')

    const res = await systemInfo.networkInterfaces()

    const formatted = omit(
      res
        .map(i => ({ ...i, netSpeed: i.speed }))
        .find(i => i.default),
      ['speed', 'default'],
    )

    return {
      iface: formatted.iface,
      ip4: formatted.ip4,
      mac: formatted.mac,
      netSpeed: formatted.netSpeed!,
    }
  }
}
