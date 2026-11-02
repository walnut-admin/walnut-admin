# API 文档注解审查发现清单（DOC-*）

> DOC- 任务产出 2/2。范围：`apps/server` 47 个 controller 的 swagger 注解完整性与正确性 + openapi 装配链。
> 接口清单见 `api-catalog.md`。审查基准：`apps/server/AGENTS.md`、`apps/docs/.../backend/{dto,architecture,code-style}.md`、
> ADR 0022。对账基准：仓库内 `apps/server/openapi.json`（195 operations / 173 paths / 212 schemas，v0.1.24）。
>
> 优先级：P0=正确性错误/安全漏洞/数据丢失风险 · P1=明确缺陷或架构违例有实际风险 · P2=质量/可维护性 · P3=轻微/风格。
> 置信度：全部基于静态通读 + openapi.json 全量对账（未起服务实测）。

## 统计

| 优先级 | 数量 | 编号 |
|---|---|---|
| P0 | 1 | DOC-01 |
| P1 | 3 | DOC-02 / DOC-03 / DOC-04 |
| P2 | 7 | DOC-05 ~ DOC-11 |
| P3 | 9 | DOC-12 ~ DOC-20 |

---

## P0

### DOC-01 · `POST /system/user/identity/list` 直返实体，全局序列化剥空全部字段；文档声明与 wire 双重不符

- **优先级**：P0（正确性错误，接口实际返回空对象行）｜**置信度**：高
- **证据**：
  - `apps/server/apps/api/src/modules/system/identity/user_identity.controller.ts:40-45`：
    ```ts
    // @pseudo
    async list(...) {
      return this.userIdentityService.list({ ...dto, userId: user.userId })   // 无 plainToInstance
    ```
  - `apps/server/libs/identity/src/user_identity/user_identity.service.ts:41-49`：返回 `{ data: identities, total }`，
    identities 来自 `userIdentityRepoService.findByUserId`（`repo/user_identity.repo.service.ts:71-76` `find()` → TypeORM **实体实例**）。
  - `apps/server/libs/identity/src/user_identity/entity/user-identity.entity.ts:13-62`：**全文件无一个 @Expose**。
  - `apps/server/apps/api/src/main.ts:131-136`：全局 `ClassSerializerInterceptor` ``excludeExtraneousValues: true``。
  - 同类先例（本仓已修的同一故障模式）：`apps/server/apps/api/test/api/ENDPOINTS.md:139`
    「原 TypeORM find 返回无 @Expose 实体，被全局 ClassSerializer（excludeExtraneousValues）在 HTTP 出站剥成 `[{}]`」。
- **问题**：三层不符叠加：
  1. wire：实体无 @Expose → 序列化后 `data` 每项退化为 `{}`（`{data:[{},…], total:n}`）——接口实际坏；
  2. 文档：`user_identity.controller.ts:35-39` 声明 `isArray: true + SysUserIdentityDTO`，即文档称 data 是
     `SysUserIdentityDTO[]`（含 `value` AES 密文 / `valueHash` / `maskedValue` 等全字段），而真实 wire 是
     `{data, total}` 双层包裹且每项为空对象；
  3. 请求体：`SysUserIdentityListDTO`（`user_identity.dto.ts:147-150`）仅 `@Allow() _marker?: never`，无 ApiProperty，
     请求 schema 为空对象。
- **影响**：该端点对前端不可用（拿不到任何字段）；若后续有人给实体补 @Expose「修」它，`valueHash`（HMAC 查找键）等
  将按文档口径直接出站——敏感字段暴露面无人审过。
- **修复建议**：controller 补 `plainToInstance(SysUserIdentityDTO, identities)` 并包 `{data, total}`，响应装饰器改为
  专用 list DTO（`CreateWalnutAdminResponseListDTO(RealPartialType(SysUserIdentityDTO))`，并把 `value`/`valueHash`
  从响应 DTO pick 面剔除，只留 `maskedValue` 等）；或对齐 `AppMonitorUserController.list` 的
  `plainToInstance(ListResponse, …)` 手法。修后 `pnpm openapi:check` 必红，同步重导出。

---

## P1

### DOC-02 · `GET /security/sensitive/check` 的必填 query 参数零文档，端点在文档层面不可调用

- **优先级**：P1｜**置信度**：高
- **证据**：
  - `apps/server/apps/api/src/modules/security/sensitive/sensitive.controller.ts:31-32`：
    ```ts
    // @pseudo
    @Query('level', new WalnutAdminPipeParamEnum(WalnutAdminConstSecurityLevel)) level: IWalnutAdminConstSecurityLevel,
    @Query('type', new WalnutAdminPipeParamEnum(..., { required: false })) operationType?: ...,
    ```
  - `openapi.json` `/security/sensitive/check`：`"parameters": []`，200 无 schema、无 summary。
- **问题**：`level` 是必填参数且枚举外直接 40099，但文档完全看不到。根因：union 字面量类型
  （`IWalnutAdminConstSecurityLevel`）经 `emitDecoratorMetadata` 反射为 `Object`，@nestjs/swagger 只自动文档化
  String/Number/Boolean 反射型的 @Query 参数（对照 `/shared/area/children` 的 `pcode: string` 与
  `/system/locale/message` 的 `cache: number` 均被自动收编），联合类型则漏。
- **影响**：消费方（前端/测试/网关）无法从文档构造合法请求；敏感操作前置检查的 level/type 语义完全依赖口口相传。
- **修复建议**：补 `@ApiQuery({ name: 'level', required: true, enum: WalnutAdminConstSecurityLevel })` 与 type 同款；
  并补 `@ApiWalnutOkResponse({ DTO: SecuritySensitiveCheckResponseDTO })`（handler 本就 plainToInstance 了该 DTO）。

### DOC-03 · 全站 195 个 operation 无一个声明 security（@ApiBearerAuth 零使用），文档不表达任何认证要求

- **优先级**：P1（完整性，系统性）｜**置信度**：高
- **证据**：
  - `grep ApiBearerAuth apps/server` → 0 处；
  - `openapi.json`：`components.securitySchemes = { bearer: { type: http, scheme: bearer, bearerFormat: JWT } }`
    已由 `buildSwaggerDocumentOptions()` 的 `.addBearerAuth()`（`common/swagger/swagger.options.ts:18`）注册，
    但全部 195 op 的 `security` 列为空、文档级 `security` 字段缺失；
  - 认证现状实际是三级：全公开（全 Free）、匿名可（JwtFree）、登录态（全链 + 权限点/角色）——见清单「认证」列。
- **问题**：Scalar 的 Authorize 按钮没有任何 operation 引用，等于摆设；文档消费方无法区分
  `/app/setting/public`（匿名可）与 `/app/setting/private`（需登录）这类仅差一层 guard 的端点。
- **影响**：前端联调、开放 API 使用方、安全审计都无法以文档为据；JWT 载荷/cookie 依赖（RT_JTI、DEVICE_ID）更是零披露。
- **修复建议**：分层落地——(a) 在 `WalnutCrudDecorators` 工厂与 `ApiWalnutOkResponse` 的组装点按 Reflector 元数据
  （JWT guard 的 @Public()/Free 装饰器已在装饰器链上）批量注入 `@ApiBearerAuth()`；
  (b) 全 Free 端点显式 `@ApiSecurity` 留白或标记匿名。至少先给登录态端点补齐 bearer 引用。

### DOC-04 · 错误响应模型零文档：195 op 只写 200（含 5 个失真 503），4xxxx/5xxxx 错误码体系不在文档任何位置

- **优先级**：P1（完整性，系统性）｜**置信度**：高
- **证据**：
  - `openapi.json` responses 键分布：`{"200":190, "200,503":5}`——除 health 外全部仅 200；
  - 实际错误 wire：全局过滤器把一切异常兜成 HTTP 200 + `body.code`（`libs/app-domain/src/error/error.module.ts:44-47`；
    `app/probes.composition.ts:17-20` 注释「全局异常过滤器把一切错误兜成 HTTP 200（body.code = 50000）」；
    `ENDPOINTS.md:50`「响应形态：一律 HTTP 200」）；
  - 错误码全集 46 个（`libs/app-domain/src/error/error.controller.ts:84-135` ErrorMap），其中 guard 拒绝链
    （40112 签名 / 40114 MFA / 40116-40117 CAP / 40118 锁 / 40605-40607 设备 / 42900 限流等）对**每个端点**都可能发生。
- **问题**：错误码只在 200 包裹 schema 的 `code` 字段 description 里一句话带过（"see WalnutAdminConstAppResponseCode"），
  枚举本体、每个错误码的触发条件、`msg` 的 i18n 形态均无文档；health 的 503 声明与「本仓 terminus 不抛 503」的实测
  （`ENDPOINTS.md:189`）矛盾（另见 DOC-08）。
- **影响**：前端只能靠 `DESIGN-ISSUES.md`/口口相传对错误码分支；openapi-typescript 生成的类型完全不含错误形态。
- **修复建议**：不必逐端点 4xx——可以在 `WalnutAdminSwaggerResponseSuccessSchemeData`（`libs/decorators/src/swagger/ok.response.ts`）
  里把 `code` 字段补 `enum: Object.values(WalnutAdminConstAppResponseCode)`，一次生效全站；再为 health 端点
  摘除失真的 503 声明（覆盖 terminus 默认装饰）。

---

## P2

### DOC-05 · `GET /system/locale/message/{locale}`：路径参数 locale 未文档化 + cache 标 required 与实现不符

- **优先级**：P2｜**置信度**：高
- **证据**：
  - `apps/server/apps/api/src/modules/system/locale/locale.controller.ts:119-133`：`@Param('locale') locale: LocaleType`
    （LocaleType 为 union 字面量 → 反射 Object 不被自动文档化）；`@Query('cache', new DefaultValuePipe(1), ParseIntPipe)`
    有默认值；
  - `openapi.json`：parameters 仅 `{name:'cache', required:true, type:number}`，`locale` 缺席；无 summary/schema。
- **影响**：i18n 公共端点（匿名、前端启动即调）的路径参数只能猜；`cache` 的可选性文档错误。
- **修复建议**：补 `@ApiParam({ name: 'locale', enum: LocaleType })` 与 `@ApiQuery({ name: 'cache', required: false })`；
  同时补响应 schema（返回值为 locales 消息映射对象）。

### DOC-06 · CRUD 工厂 `WalnutAdminDecoratorList` 不生成 @ApiOperation：19 个 list 端点系统性缺 summary

- **优先级**：P2（系统性，一处修复全站生效）｜**置信度**：高
- **证据**：
  - `apps/server/libs/crud/src/list.ts:14-37`：仅 `ApiExtraModels + ApiOkResponse`——对照同目录
    `create.ts:17`/`read.ts:15`/`update.ts:18`/`delete.ts:19` 全部经 `ApiWalnutOkResponse`（内含
    `ApiOperation({ summary })`，见 `libs/decorators/src/swagger/response.decorator.ts:14-16`）；
  - `openapi.json`：19 个 `POST */list`（demo/deleted/cache/setting/logger/device/lang/locale/dictType/dictData/
    dept/post/employee/logAuth/logOperate/menu/role/user/monitorUser）`summary` 全缺，而它们的 200 schema 与
    requestBody 都在。
- **影响**：文档导航里所有「列表」接口只有 operationId 无人类可读标题；description 只落在 response 上。
- **修复建议**：`list.ts` 组装处加 `ApiOperation({ summary: description })`（description 已有默认值
  `${title} 列表`）；重导出 openapi。

### DOC-07 · 24 个端点 200 响应无任何 schema（含 4 个限流/握手/取消包裹的特殊面）

- **优先级**：P2｜**置信度**：高
- **证据**：`openapi.json` 200 响应无 `content` schema 的全集（清单见 api-catalog.md §9）：
  根 `/` 与 `/auth`、key init/rotate、monitor/user state+force-quit、oauth url/callback/sse ×2 组、
  rsa public-key、sign initial、cap challenge/redeem、sensitive check、deleted recover×2、app/error/{code}、
  cache clear、setting private+cache/refresh、locale message。
  其中 cap challenge/redeem 是 `@WalnutAdminDecoratorFreeResponse()` 无壳端点（`cap.controller.ts:21-35`），
  handler 返回 cap.js 原生对象，文档完全空白；`GET /app/error/{code}` 文档声明 200 而实现恒抛
  （`error.controller.ts:137` `throw new (ErrorMap[code]...)()`）。
- **影响**：占全站 12.3% 的接口出参无契约；api-types 生成的这些操作返回 `never/unknown`。
- **修复建议**：逐个补 `@ApiWalnutOkResponse`（含 primitive/string 形态）；FreeResponse 端点用裸 schema
  （cap.js challenge/token 形状）；`app/error` 端点应显式文档化「恒抛」语义或直接 `@ApiExcludeEndpoint`。
  `app/setting/private` 一项已登记保留（ENDPOINTS.md:88），是否维持见待用户裁决 DOC-19。

### DOC-08 · health 五端点文档声明 503，本仓实现下 503 不可达；响应形状非项目壳也未声明

- **优先级**：P2｜**置信度**：中高
- **证据**：
  - `openapi.json`：5 个 `/app/health/*` responses = `{200, 503}`（terminus `@HealthCheck()` 自带）；
  - `ENDPOINTS.md:189` 实测：「本仓库 terminus 不抛 503；或超阈兜底 50000」「出参形状实测只有 indicator 键、
    无 `{status,info,details}` 外壳」；
  - 全局过滤器把异常兜成 200 + body.code（DOC-04 证据）。
- **影响**：文档承诺的 503 探测语义不存在；编排方按文档做 503 判活会误判（真正的探针是 raw `/health/ready`）。
- **修复建议**：覆盖 terminus 默认 response 声明（@ApiOkResponse 显式重写 + 移除 503），或文档注明
  「本部署形态下失败=HTTP 200 + code 50000」。

### DOC-09 · SSE 端点（2 个）无任何事件流契约：文档呈现为普通 GET 200

- **优先级**：P2｜**置信度**：高
- **证据**：
  - `apps/server/apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:170-179`（gitee 同构 170-179）：
    `@WalnutAdminGuardSignFree()` + `@Sse('sse/:fp')`，返回 `getClientObservable`；
  - `openapi.json` `/auth/oauth/github/sse/{fp}`：parameters 只有 fp，responses 200 无 schema、无
    `text/event-stream` 内容类型、无事件说明；
  - 事件契约真实存在于 `@walnut/contract/sse.ts`（`WalnutAdminSseEvents` + `IWalnutAdminSseClientData`）。
- **影响**：OAuth 登录的令牌投递通道在文档里不可发现；`event:` 语义（payload.data.event）无披露。
- **修复建议**：补 `@ApiOperation` + `@ApiResponse({ content: { 'text/event-stream': { schema } } })`
  （或至少 description 写明「SSE 流，data 为 IWalnutAdminSseClientData JSON」）。

### DOC-10 · `GET /system/user/device/list` 的 swagger 描述复制粘贴错误（'get security tab1 status'）

- **优先级**：P2｜**置信度**：高
- **证据**：`apps/server/apps/api/src/modules/system/identity/user_device.controller.ts:32-35`：
  ```ts
  // @pseudo
  @ApiWalnutOkResponse({
    description: 'get security tab1 status',
    DTO: SysUserDeviceListDTO,
  })
  ```
  实现是「当前用户设备列表」（handler 名 getCurrentUserDeviceList，返回设备行 + total）。
- **影响**：安全页签与设备列表两块功能在文档里互相指错。
- **修复建议**：description 改 'get current user device list'；顺带核对同文件其余四端点描述（其余正确）。

### DOC-11 · `POST /system/locale` / `PUT /system/locale/{id}` 请求体完全未文档化（wire 是翻译映射，非 DTO 数组）

- **优先级**：P2｜**置信度**：高
- **证据**：
  - `apps/server/apps/api/src/modules/system/locale/locale.controller.ts:83-108`：自定义
    `TransformedLocaleBody()` = `RawBody` + 三段管道（局部放宽 ValidationPipe → LocalePayloadTransformPipe →
    ParseArrayPipe 严格校验）；wire 形状是 `{ key, oldKey?, <langId-uuid>: 翻译值 }` 映射，管道才转成
    `[{langId,key,value,oldKey}]`；
  - `openapi.json`：两操作的 `requestBody: null`（自定义参数装饰器无 swagger 元数据、反射类型也未收编）。
- **影响**：全站唯一「非 DTO 形状 body」的写接口零契约；批量翻译的正确请求形态只存在于 DESIGN-ISSUES P2-10 注释里。
- **修复建议**：为 TransfomredLocaleBody 附 `@ApiBody`（schema 用 additionalProperties + fixed key 的映射形状并注明
  「经服务端转换为 SysLocaleDTOCreateRequest[] 校验」），或至少 description 写清映射协议。

---

## P3

### DOC-12 · 标签命名不一致：`AppMonitorServer`（无 @ApiTags）与 `App`（根 controller）是全站仅有的非 slash 标签；`system/user/oauth` 空 tag

- **优先级**：P3｜**置信度**：高
- **证据**：
  - `libs/app-domain/src/monitor/server/server.controller.ts:37-40`：无 `@ApiTags`（对照同目录 cache.controller.ts:40 有）→ openapi 标签 `AppMonitorServer`（类名派生）；
  - `apps/api/src/app/app.controller.ts:9-11`：无 `@ApiTags` → 标签 `App`；
  - `apps/api/src/modules/system/identity/user_oauth.controller.ts:1-7`：空壳 controller 仍注册 `@ApiTags('system/user/oauth')` → openapi 出现 0 operation 的标签组。
- **影响**：Scalar/文档导航出现两个孤立标签 + 一个空标签；与其余 45 个 `域/子域` slash 标签风格断裂。
- **修复建议**：server/app 两个 controller 补 `@ApiTags('app/monitor/server')` / `@ApiTags('app')`；空壳 controller
  要么删（连同 module 与 contract 路由常量），要么摘 @ApiTags，需要用户裁决（ENDPOINTS.md:182 记录「C 段复核维持」）。

### DOC-13 · 数组 query 语义未表达：`types` / `codes` 文档为单个 string

- **优先级**：P3｜**置信度**：高
- **证据**：`dictType.controller.ts:50-55` 与 `area.controller.ts:45-50` 的 `@ApiQuery({ type: String })`；
  实现经 `WalnutAdminDecoratorQueryArray`（`libs/decorators/src/query/array.decorator.ts:34-46`）逗号分割成数组
  （`ParseArrayPipe({ separator: ',' })`）；openapi 中两者均为 `type: string`。
- **修复建议**：`@ApiQuery({ type: [String], required: true })` 或 isArray + 注明逗号分割约定。

### DOC-14 · `?_cascade=` 与 `?cache=` 文档 required:true，实现均有默认值

- **优先级**：P3｜**置信度**：高
- **证据**：`openapi.json` `/system/menu/{id}` delete 的 `_cascade` 与 `/system/locale/message/{locale}` 的 `cache`
  均 `required: true`；实现分别有 `DefaultValuePipe(0)`（`libs/decorators/src/query/delete.decorator.ts:22-30`）与
  `DefaultValuePipe(1)`（locale.controller.ts:130）。
- **影响**：消费方以为必传；无功能损害。
- **修复建议**：两处补显式 `@ApiQuery({ required: false })`（Nest 对带 DefaultValuePipe 的管道参数不自动判可选）。

### DOC-15 · OAuth callback 是 @Render HTML 页，文档声明 application/json 200

- **优先级**：P3｜**置信度**：高
- **证据**：`github.controller.ts:85-118`（gitee 同构）：`@Render('template/oauth/done')`；openapi 中
  `/auth/oauth/*/callback` 200 无 schema（默认 application/json 语义）。
- **修复建议**：补 `@ApiExcludeEndpoint` 或 `@ApiResponse({ content: { 'text/html': {} } })` 说明「浏览器渲染页，
  结果经 SSE 通道投递」。

### DOC-16 · DTO `?` 标记与裸 class-validator 违例（成文规矩 vs B1 模板注释，双真源风险）

- **优先级**：P3（有注释登记理由）｜**置信度**：高
- **证据**（规矩：`apps/docs/.../backend/dto.md:102-136`「字段声明不要 ? 与 !」；「字段一律用 @walnut-server/decorators/field」）：
  - `?` 字段：`apps/api/src/modules/system/user/dto/user.dto.ts:34`（`id?: string`）、
    `modules/app/monitor/user/dto/user.dto.ts:42`、`modules/system/deleted/dto/deleted.dto.ts:96,104,119,148`
    ——四处均有「B1 模板」注释声明有意为之；
  - 裸 class-validator：`IsOptional` 直用于 `user.dto.ts:31`、monitor `user.dto.ts:39`、`deleted.dto.ts:116,166`、
    `libs/identity/src/user_device/dto/user_device.dto.ts:83,100`、`user_identity.dto.ts:222`；`Allow` 直用于
    `user_identity.dto.ts:148`。
- **影响**：类型 `?` 与装饰器 `required:false` 形成两个真源，正是规矩要防的漂移形态；裸 IsOptional/Allow
  绕过「校验+转换+文档三合一」的装饰器体系（好在均附 @ApiProperty/field 装饰器，文档面未缺）。
- **修复建议**：要么按规矩收编（id 字段改 `default: null` + 现有 field 装饰器的可选表达；IsOptional 并入 field 装饰器
  的 validateOptions），要么把「B1 模板主键声明」登记为规矩的显式豁免。**两方向需用户拍板**（见待用户裁决）。

### DOC-17 · openapi.json 无 servers 字段、URI 版本前缀未体现

- **优先级**：P3｜**置信度**：高
- **证据**：`openapi.json` `servers: []`；路径无 `/{prefix}/v{version}` 前缀；真实前缀来自 env
  `APP_API_PREFIX/APP_API_VERSION`（`libs/config/src/modules/app.config.ts:10-11`，本地 dev 为 `/w/v1`，
  `ENDPOINTS.md:4`）。
- **影响**：Scalar/try-it-out 按相对路径发请求会打到 `/api` 挂载点之外；跨工具消费方需要仓外知识拼全 URL。
  对 `schema.d.ts` 类型生成无影响（客户端自行拼 base）。
- **修复建议**：`buildSwaggerDocumentOptions()` 里按环境补 `.addServer(prefix)`；或接受现状并在 Scalar 侧注明。

### DOC-18 · openapi 门禁（openapi:export/generate/check）评估：无实质漂移漏洞，存在三个已登记边界

- **优先级**：P3（观察记录，非缺陷）｜**置信度**：高
- **证据**：
  - 链路：`apps/server/package.json:38-40`（openapi:export / generate / check = export → generate →
    `git diff --exit-code -- openapi.json ../../packages/platform-web/api-types/src/schema.d.ts`）；
    prepush `openapi` 段（`packages/tooling/scripts/src/ci/prepush.ts:149-154`）+ CI
    `.github/workflows/ci.yml:305-381`「OpenAPI drift」job；
  - 同源性：main.ts 与 cli 共用 `buildSwaggerDocumentOptions()`（`swagger.options.ts:4-11`）✅；
  - 版本确定性：`npm_package_version` 缺失即抛错（`export-openapi.ts:49-53`）✅；
  - schema 键碰撞风险已消：`RealPickType/RealPartialType` 改名（`libs/utils/src/dto.ts:19-31`）、
    swagger 12 的 `IntersectionType` 合成 `Intersection<A+B>` 唯一名（node_modules helper 实证，
    openapi.json 0 处 `PickTypeClass/PartialTypeClass/IntersectionTypeClass` 泛名）✅；
  - 边界 1：`git diff --exit-code` 只查未暂存变更——已 add 的新生成物让门禁绿，但提交内容即新鲜产物，语义无损；
  - 边界 2：fork PR 无 ENV_KEYS 时 CI 段**静默跳过**（ci.yml:379-381 仅打 notice）——外部贡献者的路由改动可不重导出；
  - 边界 3：门禁会**改写工作区**（prepush.ts:57 注释自认），check 红时开发者工作区被重导出产物污染；
    lefthook 未装则 prepush 整段失效（`pnpm hooks:check` 是兜底探测而非强制）。
- **修复建议**：CI 对 fork PR 退化为「openapi.json mtime/内容与 schema.d.ts 生成一致性」的离线近似检查，或
  在 CODEOWNERS 把 openapi.json 指到必须人工审的路径；check 脚本可加 `git diff --cached` 一并比对消除边界 1。

### DOC-19 · `GET /app/setting/private` 无响应 schema 且无权限点（登录即可读四组功能开关）

- **优先级**：P3（文档侧）+ **待用户裁决**（权限面）｜**置信度**：高
- **证据**：`libs/app-domain/src/setting/setting.controller.ts:71-76`：仅 `@WalnutAdminGuardLockFree()`，
  无 `@HasPermission`（对照同文件 CRUD 全有权限点）；返回 maskUrl/hijackRefresh/watermark/transition 四组
  `{status, mode, value}`（`setting.service.ts:117-145`）。ENDPOINTS.md:88 已登记「swagger 无 response schema
  —— 收尾批保留为 admin store 消费形态」。
- **影响**：任意登录角色可读全站功能开关配置（非密文，但属运营配置面）；文档无 schema 使其不可从 api-types 消费。
- **修复建议**：文档侧补 `AppSettingDTOPrivateResponse`；权限侧是否收敛为管理端权限点需用户拍板（涉及 admin
  store 消费方改动）。

### DOC-20 · `POST /auth/opaque/user/login/client-error` 文档声明 boolean 200，实现恒抛 40103

- **优先级**：P3｜**置信度**：高
- **证据**：`apps/api/src/modules/auth/modules/opaque/user/opaque.user.controller.ts:69-96`：
  `@ApiWalnutOkResponse({ description: 'Report client-side OPAQUE error', primitive: 'boolean' })` 但 handler
  末行 `throw new WalnutAdminExceptionInvalidCredential()`——成功路径不存在（按 wire 约定即 200 + code 40103）。
- **影响**：文档形态（boolean）与真实返回（错误壳）不符；调用方按文档解 boolean 必失败。
- **修复建议**：响应声明改为错误码语义（description 注明恒返回 40103 形态），或移除 200 DTO 声明。

---

## 验证过、无问题的点（防重复劳动）

1. **原生 PickType/PartialType 零违例**：全仓 `extends (PartialType|PickType|OmitType|IntersectionType)(` 扫描
   37 处全部是 `RealPickType/RealPartialType` 包裹或 swagger 12 安全的 `IntersectionType`（自动合成唯一 schema 名，
   openapi.json 无泛名碰撞键）。CRUD 工厂 `title` 均如实进 summary/description（如「添加 用户」「添加 部门」）。
2. **@ApiProperty/@Expose 覆盖**：抽查 wire DTO（SysUserDTOSafe、AuthCorePermissionsDTO、AuthSuccessDTO、
   AuthMfaStatusDTO、AppBackendDepsResponseDTO、SysUserDeviceListDTO、AppMonitorServer* 8 件）字段装饰器齐备，
   生成 schema 与 wire 一致（openapi 抽样比对通过）。
3. **路径参数**：47 个 controller 的 uuid 参数统一走 `WalnutAdminDecoratorParamUuid`（@Param + 管道），CRUD 工厂
   附带 @ApiParam 描述，openapi path 参数无缺席。
4. **加密字段披露**：`/auth/keys`、`/security/sign/aes-key`、`/shared/ali/sts` 三处 RSA 信封字段均在
   DTO description 标注信封语义（codegen 二期收尾批成果）。
5. **探针逃逸**：`/health/live`、`/health/ready` 确认不进 openapi（设计如此，probes.composition.ts:24-25 注释）。

## 待用户裁决

| # | 事项 | 相关 finding | 选项 |
|---|---|---|---|
| 1 | identity list 修复口径：改 controller 补 plainToInstance + 专用 list DTO（剔除 value/valueHash 出参） | DOC-01 | 修 wire+文档 vs 先只修文档遮蔽密文字段 |
| 2 | 全站 @ApiBearerAuth/security 注入的落地层（工厂 vs 全局装饰器） | DOC-03 | 工厂注入 vs 逐端点手补 vs 接受现状 |
| 3 | `app/setting/private` 是否补响应 DTO + 是否加权限点（影响 admin store 消费面） | DOC-07/19 | 只补文档 vs 文档+权限收敛 |
| 4 | `system/user/oauth` 空壳 controller 去留（ENDPOINTS.md:182 记录「C 段复核维持」） | DOC-12 | 删除 vs 保留摘 tag |
| 5 | DTO `?`/裸 class-validator 与 B1 模板注释冲突：改字段还是改规矩 | DOC-16 | 收编字段 vs 规矩登记豁免 |
| 6 | socket.io admin-ui `instrument({ auth: false })`（socket.gateway.ts:69-73）：范围外安全观察——管理台无认证挂载，是否限网/加鉴权 | —（非 DOC 范围） | 需安全侧确认部署面后拍板 |
| 7 | health 端点 503 失真声明：改文档还是让 terminus 探针按部署契约真抛 503 | DOC-08 | 覆盖装饰器 vs 保留 503 并修行为 |
