import { applyDecorators, HttpCode, HttpStatus, Post } from '@nestjs/common'

import { ApiExtraModels, ApiOkResponse, ApiOperation, getSchemaPath } from '@nestjs/swagger'
import { WalnutAdminSwaggerResponseSuccessSchemeData } from '@walnut-server/decorators/swagger'
import { CreateWalnutAdminResponseListDTO } from '@walnut-server/list'

export function WalnutAdminDecoratorList(options: IWalnutAdminCrudOptions) {
  const { operateLog, swagger } = options

  const { title } = operateLog

  const { DTO, listResponseDTO, description = `${title} 列表` } = swagger

  // 200 的 `data` 是**单个分页壳对象**（`{ data: 行[], total }`），不是分页壳数组：
  // service 返回 `{ data, total }`，响应拦截器把它原样塞进 `{ code, msg, data }` 壳。
  // 旧写法把 `data` 标成「分页壳的数组」（多包一层），生成类型与真实 wire 不符
  // （P2-6：E2E 的类型桥曾为此显式取组件补偿）。
  //
  // 行 schema 用 `listResponseDTO`（controller 实际返回的分页壳类）而不是工厂的 DTO：
  // list 行常被 `RealPickType` 裁成字段子集，只有 controller 知道真实那一个。
  // 未提供时退回 `CreateWalnutAdminResponseListDTO(DTO)`（行 = 完整 DTO，兼容存量端点）。
  const responseDTO = listResponseDTO ?? CreateWalnutAdminResponseListDTO(DTO!)

  return applyDecorators(
    Post('list'),
    HttpCode(HttpStatus.OK),
    // F-17（DOC-06）：create/read/update/delete 走 ApiWalnutOkResponse，那里内联了
    // ApiOperation({ summary })，而 list 手搓了特殊 schema（分页壳 + 行 DTO 分离，
    // ApiWalnutOkResponse 的 dataSchema 表达不了）—— 于是全站 19 个 POST */list 都缺
    // summary，文档导航里只剩 operationId。summary 在这里显式补一次，description 仍与
    // 其它五个工厂同源（默认 `${title} 列表`，调用方可用 swagger.description 覆盖）。
    ApiOperation({ summary: description }),
    ApiExtraModels(responseDTO, DTO!),
    ApiOkResponse({
      description,
      schema: WalnutAdminSwaggerResponseSuccessSchemeData({ $ref: getSchemaPath(responseDTO) }),
    }),
  )
}
