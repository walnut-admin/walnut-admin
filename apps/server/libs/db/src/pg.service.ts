import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  TypeOrmModuleOptions,
  TypeOrmOptionsFactory,
} from '@nestjs/typeorm'

import { WalnutPGConnectionName } from './pg.const'

@Injectable()
export class WalnutPGConfigService implements TypeOrmOptionsFactory {
  private readonly logger = new Logger(WalnutPGConfigService.name)

  constructor(private readonly configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    this.logger.log('[PGLog] Initiating postgres module...')

    return {
      // TypeORM 1.x 的 DataSourceOptions 已移除 name，连接名由 NestJS 层
      // （forRootAsync 的 name）持有，这里仅作声明性回显，两处必须同值
      name: WalnutPGConnectionName,
      type: 'postgres',
      entities: [],
      // schema 演进一律走迁移，禁止自动同步
      synchronize: false,
      autoLoadEntities: true,

      // 数据权限三期：运行时连接角色（pg.config 已优先取 DATABASE_PG_APP_USER/PASS）。
      // 迁移/管理通道仍走 DATABASE_PG_USER/PASS（data-source.cli.ts 与
      // 集成测试 globalSetup 独立读取），两个通道分离后 RLS 才真正生效。
      host: this.configService.get<string>('pg.host'),
      port: this.configService.get<number>('pg.port'),
      username: this.configService.get<string>('pg.user'),
      password: this.configService.get<string>('pg.pass'),
      database: this.configService.get<string>('pg.name'),
    }
  }
}
