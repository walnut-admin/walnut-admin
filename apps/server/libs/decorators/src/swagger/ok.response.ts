import type {
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'

export function WalnutAdminSwaggerResponseSuccessSchemeData(data: SchemaObject | ReferenceObject): SchemaObject {
  return {
    allOf: [
      {
        properties: {
          data,
          code: {
            type: 'number',
            default: WalnutAdminConstAppResponseCode.SUCCESS,
            description:
            'response code, see `WalnutAdminConstAppResponseCode` for more details',
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
