import type {
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'

/**
 * 全站 200 响应的**统一壳** schema：`{ code, msg, data }`。
 *
 * 由 `ApiWalnutOkResponse`（普通端点）与 CRUD 工厂（list/create/read/update/delete/deleteMany）
 * 共用，所以这里是「响应壳长什么样」的唯一来源 —— 改一次全站生效。
 *
 * `code` 内联 `enum`（F-09）：错误在 wire 上是 HTTP 200 + body.code（全局异常过滤器兜底），
 * 而错误码体系此前只在一句 description 里提了个名字，openapi-typescript 生成的类型完全不含
 * 错误形态。枚举一次进 schema，消费方（前端分支 / 网关 / 代码生成）就能拿到全集。
 */
export function WalnutAdminSwaggerResponseSuccessSchemeData(data: SchemaObject | ReferenceObject): SchemaObject {
  return {
    allOf: [
      {
        properties: {
          data,
          code: {
            type: 'number',
            // 成功只有 20000 一个；其余为业务错误码，语义对齐 HTTP 状态码前三位
            enum: Object.values(WalnutAdminConstAppResponseCode),
            default: WalnutAdminConstAppResponseCode.SUCCESS,
            description:
            'response code (20000 = success; other values follow HTTP-status semantics), see `WalnutAdminConstAppResponseCode` for more details',
            nullable: true,
            readOnly: true,
          },
          msg: {
            type: 'string',
            default: 'Success',
            description: 'response msg, `Success` or error msg',
            nullable: true,
            readOnly: true,
          },
        },
      },
    ],
  }
}
