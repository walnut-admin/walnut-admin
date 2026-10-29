import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { Role } from '@walnut/contract'

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
@WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
@UseInterceptors(WalnutAdminInterceptorResponseLooseSerializer)
export class AppMonitorServerController {
  constructor(private readonly monitorServerService: AppMonitorServerService) {}

  @Get('cpu')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.CPU)
  @ApiWalnutOkResponse({
    description: 'get server CPU info (systeminformation subset)',
    DTO: AppMonitorServerDTOCPU,
  })
  async getCpu() {
    return new AppMonitorServerDTOCPU(await this.monitorServerService.cpu())
  }

  @Get('mem')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.MEM)
  @ApiWalnutOkResponse({
    description: 'get server memory info (systeminformation subset)',
    DTO: AppMonitorServerDTOMem,
  })
  async getMem() {
    return new AppMonitorServerDTOMem(await this.monitorServerService.memory())
  }

  @Get('os')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.OS)
  @ApiWalnutOkResponse({
    description: 'get server OS info (systeminformation subset)',
    DTO: AppMonitorServerDTOOS,
  })
  async getOS() {
    return new AppMonitorServerDTOOS(await this.monitorServerService.os())
  }

  @Get('sys')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.SYS)
  @ApiWalnutOkResponse({
    description: 'get server system info (systeminformation subset)',
    DTO: AppMonitorServerDTOSystem,
  })
  async getSys() {
    return new AppMonitorServerDTOSystem(
      await this.monitorServerService.system(),
    )
  }

  @Get('disk')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.DISK)
  @ApiWalnutOkResponse({
    description: 'get server disk layout (systeminformation subset)',
    DTO: AppMonitorServerDTODisk,
    isArray: true,
  })
  async getDisk() {
    return (await this.monitorServerService.disk()).map(
      i => new AppMonitorServerDTODisk(i),
    )
  }

  @Get('battery')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.BATTERY)
  @ApiWalnutOkResponse({
    description: 'get server battery info (systeminformation subset)',
    DTO: AppMonitorServerDTOBattery,
  })
  async getBattery() {
    return new AppMonitorServerDTOBattery(
      await this.monitorServerService.battery(),
    )
  }

  @Get('time')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.TIME)
  @ApiWalnutOkResponse({
    description: 'get server time info (systeminformation subset)',
    DTO: AppMonitorServerDTOTime,
  })
  async getTime() {
    return new AppMonitorServerDTOTime(await this.monitorServerService.time())
  }

  @Get('network')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.NETWORK)
  @ApiWalnutOkResponse({
    description: 'get server network info (systeminformation subset)',
    DTO: AppMonitorServerDTONetwork,
  })
  async getNetwork() {
    return new AppMonitorServerDTONetwork(
      await this.monitorServerService.network(),
    )
  }
}
