import process from 'node:process'
import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  DiskHealthIndicator,
  HealthCheck,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'

import { WalnutPGConnectionName } from '@walnut-server/db'
import { Role } from '@walnut/contract'
import { DataSource } from 'typeorm'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'

const Permissions = {
  NETWORK: 'app:health:network',
  PG: 'app:health:postgres',
  MH: 'app:health:memory-heap',
  MR: 'app:health:memory-rss',
  DISK: 'app:health:disk',
} as const

/**
 * 磁盘健康检查的根路径（P3-22）：Windows 检查系统盘 `C:/`，类 Unix（容器 / Linux /
 * macOS）检查 `/`。此前硬编码 `C:/`，非 Windows 部署上 DiskHealthIndicator 直接抛错，
 * 经全局兜底成 50000 —— 磁盘检查恒失败。导出供单测钉住两个平台分支。
 */
export function getDiskHealthCheckPath(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'C:/' : '/'
}

@Controller('app/health')
@ApiTags('app/health')
@WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
export class AppTechHealthController {
  constructor(
    @InjectDataSource(WalnutPGConnectionName) private readonly pgDataSource: DataSource,
    private readonly http: HttpHealthIndicator,
    private readonly typeorm: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  @Get('network')
  @WalnutAdminDecoratorHasPermission(Permissions.NETWORK)
  @HealthCheck()
  async checkNetwork() {
    return this.http.pingCheck('baidu', 'https://www.baidu.com')
  }

  @Get('postgres')
  @WalnutAdminDecoratorHasPermission(Permissions.PG)
  @HealthCheck()
  async checkPostgres() {
    return this.typeorm.pingCheck('postgres', {
      connection: this.pgDataSource,
    })
  }

  @Get('memory-heap')
  @WalnutAdminDecoratorHasPermission(Permissions.MH)
  @HealthCheck()
  async checkMemoryHeap() {
    // the process should not use more than 200MB memory
    return this.memory.checkHeap('memory-heap', 200 * 1024 * 1024)
  }

  @Get('memory-rss')
  @WalnutAdminDecoratorHasPermission(Permissions.MR)
  @HealthCheck()
  async checkMemoryRSS() {
    // the process should not have more than 200MB RSS memory allocated
    return this.memory.checkRSS('memory-rss', 200 * 1024 * 1024)
  }

  @Get('disk')
  @WalnutAdminDecoratorHasPermission(Permissions.DISK)
  @HealthCheck()
  async checkDisk() {
    return this.disk.checkStorage('disk', {
      // The used disk storage should not exceed 75% of the full disk size
      thresholdPercent: 0.75,
      path: getDiskHealthCheckPath(),
    })
  }
}
