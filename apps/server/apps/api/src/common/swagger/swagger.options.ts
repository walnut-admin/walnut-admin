import process from 'node:process'
import { DocumentBuilder } from '@nestjs/swagger'
import AppConfig from '@walnut-server/config/modules/app.config'

/**
 * Swagger 文档 options 的**唯一来源** —— main.ts（运行时挂 /api 标量文档）与
 * apps/cli/src/export-openapi.ts（离线导出 openapi.json）共用，保证导出物与在线文档同源。
 * 二者都经 common/swagger/swagger.document.ts 的 createSwaggerDocument 取文档
 * （那里还负责按 guard 元数据批量注入 bearer 声明）。
 *
 * 抽取时对 main.ts 原地替换（DocumentBuilder 链逐字未动）；版本号沿用
 * npm_package_version（pnpm script 运行时注入），离线导出脚本依赖同一机制保证
 * openapi.json 内容确定性（版本漂移才变，不因运行方式变）。
 *
 * .addBearerAuth() 的 scheme 名为库默认的 bearer，必须与 swagger.document.ts 里
 * ApiBearerAuth() 的默认名一致（两边都用默认值；单测断言「operation 引用的 scheme
 * 一定在 securitySchemes 里」兜住漂移）。文档级 security 刻意不设：匿名端点靠
 * 「不声明 security」表达（见 swagger.document.ts 头注释）。
 *
 * ## F-52（DOC-17 / 裁决 Q10-a）：补 servers —— 之前的导出物 servers 是空数组
 *
 * 本仓所有路径都挂在 URI versioning 的前缀下（main.ts 的 enableVersioning：
 * prefix = APP_API_PREFIX + '/v'，defaultVersion = APP_API_VERSION），而 openapi.json 的
 * paths 是**去掉前缀**的形态。没有 servers 时，消费方（Scalar try-it-out / 网关 / 代码生成
 * 之外的第三方工具）只能靠仓外知识自己拼前缀，否则请求会打到 /api 文档挂载点之外。
 *
 * 之所以是「按环境」而不是写死：前缀与版本都是 env（见下面的 buildSwaggerServerUrl），
 * 导出物按导出时的 env 落盘 —— 本地 dev 导出的就是 dev 的 APP_API_PREFIX/v1。
 */
export function buildSwaggerDocumentOptions() {
  const builder = new DocumentBuilder()
    .setTitle('NestJS Walnut Admin App')
    .setDescription(
      [
        'Document of API details',
        '',
        'Authentication: operations that declare `security: [{ bearer: [] }]` require a JWT access token',
        'in the `Authorization: Bearer <token>` header. Operations without a `security` declaration are',
        'public: no JWT is required (JwtFree / all-Free endpoints) -- request signing, device and risk',
        'guards may still reject a call.',
        'Authenticated calls also carry the `DEVICE_ID` cookie (device-scoped request signing and risk checks).',
        'Business errors are returned as HTTP 200 with a typed `body.code` (see the `code` enum of every 200 response).',
      ].join('\n'),
    )
    // https://docs.npmjs.com/cli/v10/using-npm/scripts
    .setVersion(process.env.npm_package_version!)
    .addBearerAuth()

  const serverUrl = buildSwaggerServerUrl()

  if (serverUrl !== null) {
    builder.addServer(
      serverUrl,
      'current deployment: URI versioning prefix and version come from APP_API_PREFIX / APP_API_VERSION (relative URL, resolved against the docs origin)',
    )
  }

  return builder.build()
}

/**
 * 文档 servers 的 URL。与运行时同源：libs/config/src/modules/app.config.ts 的
 * app.api.prefix / app.api.version 就读 APP_API_PREFIX / APP_API_VERSION（ConfigModule
 * 启动时把这些值灌进 process.env），所以这里不另设配置项、也不重复解析 env 文件。
 *
 * 用**相对 URL** 而不是拼 host：host 由部署环境决定（本地 127.0.0.1:3000、stage / prod 各异），
 * 写死任何一个都会让导出物对其它环境说谎；相对 URL 由文档页面所在 origin 解析，Scalar 的
 * try-it-out 因此能拼出完整请求地址（文档挂 /api，接口在 /<prefix>/v<version>）。
 *
 * 拿不到环境变量时（单测 / 未装配 ConfigModule 的裸脚本）返回 null：宁可**不声明** server，
 * 也不声明一个猜出来的前缀 —— 错误的前缀会让 try-it-out 全站 404，而缺省的相对路径在各
 * 工具里都会退化成「按文档 origin 拼 path」。
 */
function buildSwaggerServerUrl(): string | null {
  // 读配置走 libs/config 的 registerAs 工厂（ConfigModule 加载的就是同一个工厂），而不是在这里
  // 直接读 process.env：
  //   · 单源 —— prefix / version 的语义只定义在 app.config.ts 一处，在线文档与离线导出同源；
  //   · turbo/no-undeclared-env-vars 门禁只对 libs/config/src/modules/** 豁免（见
  //     @walnut/eslint-config/nest 的注释：那批值是 env-local/.env.* 在进程内灌进 process.env
  //     的运行期配置面，不是外部传给 turbo 任务的变量）。在别处裸读就会被该规则判红。
  const { api } = AppConfig()

  const { prefix, version } = api

  if (typeof prefix !== 'string' || prefix.length === 0 || Number.isNaN(version)) {
    return null
  }

  // 前后多余的斜杠不进 URL（部署里 APP_API_PREFIX 被写成 api/w 与 /api/w 两种形态都出现过）
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '')

  if (normalizedPrefix.length === 0) {
    return null
  }

  return `/${normalizedPrefix}/v${version}`
}
