import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'
import { applyDecorators } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, ApiOperation, getSchemaPath } from '@nestjs/swagger'
import { WalnutAdminSwaggerResponseSuccessSchemeData } from './ok.response'

// Note: ApiWalnutOkResponseOptions is now IWalnutAdminApiOkResponseOptions in types.d.ts

export function ApiWalnutOkResponse({
  description,
  DTO,
  isArray = false,
  primitive,
}: IWalnutAdminApiOkResponseOptions): MethodDecorator {
  const decorators: MethodDecorator[] = [
    ApiOperation({ summary: description }),
  ]

  let dataSchema: SchemaObject | ReferenceObject

  if (primitive) {
    dataSchema = isArray
      ? {
          type: 'array',
          items: { type: primitive },
        }
      : {
          type: primitive,
        }
  }
  else if (DTO) {
    decorators.push(ApiExtraModels(DTO))
    dataSchema = isArray
      ? {
          type: 'array',
          items: { $ref: getSchemaPath(DTO) },
        }
      : {
          $ref: getSchemaPath(DTO),
        }
  }
  else {
    dataSchema = { type: 'null' }
  }

  decorators.push(
    ApiOkResponse({
      description,
      schema: WalnutAdminSwaggerResponseSuccessSchemeData(dataSchema),
    }),
  )

  return applyDecorators(...decorators)
}
