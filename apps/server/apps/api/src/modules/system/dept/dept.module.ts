import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysDeptBasicRepository } from './dept.basic.repository'
import { SysDeptController } from './dept.controller'
import { SysDeptService } from './dept.service'
import { SysDeptEntity } from './entity/dept.entity'

/**
 * 部门模块（B1 接线形态：PG forFeature，不另建 pg.module）。
 *
 * 导出 `SysDeptBasicRepository` 供 employee 模块做「部门存在性」校验 —— 模块图单向：
 * employee → dept / post；dept / post 反向只做**实体级计数**（SysEmployeeEntity），
 * 不导入 employee 模块，无环。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysDeptEntity], WalnutPGConnectionName),
  ],
  controllers: [SysDeptController],
  providers: [SysDeptBasicRepository, SysDeptService],
  exports: [SysDeptBasicRepository],
})
export class SysDeptModule {}
