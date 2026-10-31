import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysPostEntity } from './entity/post.entity'

import { SysPostBasicRepository } from './post.basic.repository'
import { sysPostRecoverableProvider } from './post.recoverer'
import { SysPostService } from './post.service'

/** 岗位模块（导出 BasicRepository 供 employee 模块做存在性校验，模块图单向无环） */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysPostEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysPostBasicRepository, SysPostService, sysPostRecoverableProvider],
  exports: [SysPostBasicRepository, SysPostService],
})
export class SysPostModule {}
