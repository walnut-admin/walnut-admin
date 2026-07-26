import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminConstRole } from '@walnut-server/const/role/index'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { WalnutAdminInterceptorResponseLooseSerializer } from '@/interceptors/response/loose.interceptor'

import {
  AppMonitorServerDTOBattery,
  AppMonitorServerDTOCPU,
  AppMonitorServerDTODisk,
  AppMonitorServerDTOMem,
  AppMonitorServerDTONetwork,
  AppMonitorServerDTOOS,
  AppMonitorServerDTOSystem,
  AppMonitorServerDTOTime,
} from './server.dto'
import { AppMonitorServerService } from './server.service'

const Permissions = {
  CPU: 'app:monitor:server:cpu',
  MEM: 'app:monitor:server:memory',
  OS: 'app:monitor:server:os',
  SYS: 'app:monitor:server:system',
  DISK: 'app:monitor:server:disk',
  BATTERY: 'app:monitor:server:battery',
  TIME: 'app:monitor:server:time',
  NETWORK: 'app:monitor:server:network',
} as const

@Controller('app/monitor/server')
@WalnutAdminDecoratorHasRole([WalnutAdminConstRole.ROOT, WalnutAdminConstRole.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
@UseInterceptors(WalnutAdminInterceptorResponseLooseSerializer)
export class AppMonitorServerController {
  constructor(private readonly monitorServerService: AppMonitorServerService) {}

  @Get('cpu')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.CPU)
  async getCpu() {
    return new AppMonitorServerDTOCPU(await this.monitorServerService.cpu())
  }

  @Get('mem')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.MEM)
  async getMem() {
    return new AppMonitorServerDTOMem(await this.monitorServerService.memory())
  }

  @Get('os')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.OS)
  async getOS() {
    return new AppMonitorServerDTOOS(await this.monitorServerService.os())
  }

  @Get('sys')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.SYS)
  async getSys() {
    return new AppMonitorServerDTOSystem(
      await this.monitorServerService.system(),
    )
  }

  @Get('disk')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.DISK)
  async getDisk() {
    return (await this.monitorServerService.disk()).map(
      i => new AppMonitorServerDTODisk(i),
    )
  }

  @Get('battery')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.BATTERY)
  async getBattery() {
    return new AppMonitorServerDTOBattery(
      await this.monitorServerService.battery(),
    )
  }

  @Get('time')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.TIME)
  async getTime() {
    return new AppMonitorServerDTOTime(await this.monitorServerService.time())
  }

  @Get('network')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.NETWORK)
  async getNetwork() {
    return new AppMonitorServerDTONetwork(
      await this.monitorServerService.network(),
    )
  }
}
