import { Module } from '@nestjs/common'
import { sysDeptRecoverableProvider } from './dept.recoverer'

import { SysDeptRepoModule } from './dept.repo.module'
import { SysDeptService } from './dept.service'

/**
 * 部门模块（B1 接线形态：PG forFeature 收在 SysDeptRepoModule，不另建 pg.module）。
 *
 * 导出 `SysDeptRepoModule` 供 employee 模块做「部门存在性」校验 —— 模块图单向：
 * employee → dept / post；dept / post 反向只做**实体级计数**（SysEmployeeEntity），
 * 不导入 employee 模块，无环。仓库模块单独拆出还让数据权限模块只依赖仓库、
 * 不提前装载部门 controller（见 dept.repo.module.ts 头注释）。
 */
@Module({
  imports: [
    SysDeptRepoModule,
  ],
  controllers: [],
  providers: [SysDeptService, sysDeptRecoverableProvider],
  exports: [SysDeptRepoModule, SysDeptService],
})
export class SysDeptModule {}
