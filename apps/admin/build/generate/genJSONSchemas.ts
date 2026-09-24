import * as TJS from 'ts-json-schema-generator'

import { BuildUtilsWriteFile } from '../utils/index.ts'
import {
  AppSettingsDevInterfaceFilePath,
  AppSettingsDevJSONSchemaFilePath,
} from '../utils/paths.ts'

const config: import('ts-json-schema-generator/dist/src/Config').Config = {
  path: AppSettingsDevInterfaceFilePath,
  tsconfig: 'tsconfig.json',
  type: 'IStoreSetting.Dev', // Or <type-name> if you want to generate schema for that one type only
}

/** 生成 `.vscode/settings-dev.schema.json`（由 `build/generate/index.ts` 统一调用） */
export async function generateJSONSchemas() {
  const shapeSchema = TJS.createGenerator(config).createSchema(config.type)
  await BuildUtilsWriteFile(AppSettingsDevJSONSchemaFilePath, JSON.stringify(shapeSchema, null, 2))
}
