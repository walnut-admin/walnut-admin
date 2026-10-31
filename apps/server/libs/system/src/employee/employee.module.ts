import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserEntity } from '@walnut-server/identity'

import { SysDeptModule } from '../dept/dept.module'
import { SysPostModule } from '../post/post.module'
import { SysEmployeeBasicRepository } from './employee.basic.repository'
import { sysEmployeeRecoverableProvider } from './employee.recoverer'
import { SysEmployeeService } from './employee.service'
import { SysEmployeeEntity } from './entity/employee.entity'

/**
 * 职工模块 —— 依赖 dept/post 模块的 BasicRepository（存在性校验）。
 * `SysUserEntity` 一并 forFeature：绑定前的账号存在性计数走它的仓库
 * （user_id 是松引用，没有 FK 兜底）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysEmployeeEntity, SysUserEntity], WalnutPGConnectionName),
    SysDeptModule,
    SysPostModule,
  ],
  controllers: [],
  providers: [SysEmployeeBasicRepository, SysEmployeeService, sysEmployeeRecoverableProvider],
  exports: [SysEmployeeService],
})
export class SysEmployeeModule {}
