import process from 'node:process'
import { DocumentBuilder } from '@nestjs/swagger'

/**
 * Swagger 文档 options 的**唯一来源** —— main.ts（运行时挂 /api 标量文档）与
 * database/export-openapi.ts（离线导出 openapi.json）共用，保证导出物与在线文档同源。
 *
 * 抽取时对 main.ts 原地替换（DocumentBuilder 链逐字未动）；版本号沿用
 * `npm_package_version`（pnpm script 运行时注入），离线导出脚本依赖同一机制保证
 * openapi.json 内容确定性（版本漂移才变，不因运行方式变）。
 */
export function buildSwaggerDocumentOptions() {
  return new DocumentBuilder()
    .setTitle('NestJS Walnut Admin App')
    .setDescription('Document of API details')
    // https://docs.npmjs.com/cli/v10/using-npm/scripts
    .setVersion(process.env.npm_package_version!)
    .addBearerAuth()
    .build()
}
