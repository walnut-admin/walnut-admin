import type { StandardSchemaV1 } from '@standard-schema/spec'
import { ValidateEnv } from '@julr/vite-plugin-validate-env'
import DevSchema from '../config/env.development'
import ProdSchema from '../config/env.prod'
import StageSchema from '../config/env.stage'

type RecordViteKeys<T> = Record<`${string}_${string}`, T>

const envSchemaMap: Record<string, RecordViteKeys<StandardSchemaV1>> = {
  development: DevSchema,
  stage: StageSchema,
  production: ProdSchema,
}

export function createValidateEnvPlugin(mode: string) {
  return ValidateEnv({
    validator: 'standard',
    schema: envSchemaMap[mode],
  })
}
