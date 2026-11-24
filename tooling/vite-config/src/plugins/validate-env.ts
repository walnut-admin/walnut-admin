import type { StandardSchemaV1 } from '@standard-schema/spec'
import { ValidateEnv } from '@julr/vite-plugin-validate-env'
import DevSchema from '../env/env.development.ts'
import ProdSchema from '../env/env.prod.ts'
import StageSchema from '../env/env.stage.ts'

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
