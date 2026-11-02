import process from 'node:process'
import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  DiskHealthIndicator,
  HealthCheck,
  HttpHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorHasRole } from '@walnut-server/guards'
import { AppRoutes, Role } from '@walnut/contract'
import { AppTechHealthProbeService } from './health.probe.service'
import { AppTechHealthCheckOkResponse } from './health.swagger'

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

@Controller(AppRoutes.HEALTH)
@ApiTags('app/health')
@WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
export class AppTechHealthController {
  constructor(
    private readonly probe: AppTechHealthProbeService,
    private readonly http: HttpHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  // 五个端点的 swagger 声明统一由 health.swagger.ts 显式重写（去 503、按项目壳写形状）；
  // terminus 自己的默认声明（200 {status,info,details} + 503）一并关掉，保留它的 Cache-Control 头。
  // 4A：这五个端点原先只有 200 的 response description、没有 operation summary（OpenAPI 里
  // summary 与 description 是两个字段）—— 这里逐个补 @ApiOperation({ summary })。
  @Get('network')
  @WalnutAdminDecoratorHasPermission(Permissions.NETWORK)
  @ApiOperation({
    summary: 'Network reachability probe',
  })
  @AppTechHealthCheckOkResponse('baidu', 'Network reachability: HTTP ping to https://www.baidu.com')
  @HealthCheck({ swaggerDocumentation: false })
  async checkNetwork() {
    return this.http.pingCheck('baidu', 'https://www.baidu.com')
  }

  @Get('postgres')
  @WalnutAdminDecoratorHasPermission(Permissions.PG)
  @ApiOperation({
    summary: 'PostgreSQL connectivity probe',
  })
  @AppTechHealthCheckOkResponse('postgres', 'PostgreSQL connectivity of the app connection')
  @HealthCheck({ swaggerDocumentation: false })
  async checkPostgres() {
    // F-36（Q6=b）：DataSource 归 probe service（SELECT 1 探活），controller 只装配
    return this.probe.checkPostgres()
  }

  @Get('memory-heap')
  @WalnutAdminDecoratorHasPermission(Permissions.MH)
  @ApiOperation({
    summary: 'Process heap usage probe',
  })
  @AppTechHealthCheckOkResponse('memory-heap', 'Heap usage below 200 MB')
  @HealthCheck({ swaggerDocumentation: false })
  async checkMemoryHeap() {
    // the process should not use more than 200MB memory
    return this.memory.checkHeap('memory-heap', 200 * 1024 * 1024)
  }

  @Get('memory-rss')
  @WalnutAdminDecoratorHasPermission(Permissions.MR)
  @ApiOperation({
    summary: 'Process resident set size probe',
  })
  @AppTechHealthCheckOkResponse('memory-rss', 'Resident set size below 200 MB')
  @HealthCheck({ swaggerDocumentation: false })
  async checkMemoryRSS() {
    // the process should not have more than 200MB RSS memory allocated
    return this.memory.checkRSS('memory-rss', 200 * 1024 * 1024)
  }

  @Get('disk')
  @WalnutAdminDecoratorHasPermission(Permissions.DISK)
  @ApiOperation({
    summary: 'Root volume disk usage probe',
  })
  @AppTechHealthCheckOkResponse('disk', 'Root volume usage below 75%')
  @HealthCheck({ swaggerDocumentation: false })
  async checkDisk() {
    return this.disk.checkStorage('disk', {
      // The used disk storage should not exceed 75% of the full disk size
      thresholdPercent: 0.75,
      path: getDiskHealthCheckPath(),
    })
  }
}
