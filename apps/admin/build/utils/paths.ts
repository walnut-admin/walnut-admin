export const typesCheckLogPath = 'report/tsc.log'

// `unplugin-vue-components` 生成的声明文件。
//
// ⚠️ 它是**生成物、不进 git**（`apps/admin/types/generated/` 已被 gitignore）。
// 以前它和 auto-import 那份一起被提交在 `types/*.d.ts`，于是每次 `pnpm dev` 重写都会把工作区
// 弄脏；移出跟踪面之后，干净检出里**没有**这份文件 ⇒ 必须靠
// `build/generate/genTypeDeclarations.ts` 显式生成（`pretypes:check` 会跑它）。
export const componentsDtsPath = 'types/generated/components.d.ts'

// ⚠️ **已废弃**：`unplugin-auto-import`（2026-09-29 移除，见 ADR 0020）的生成物。
// 它已经没有任何生产者，留在这里只为让 `genTypeDeclarations` 每次生成前把它清掉 —— 理由见那个
// 文件里的注释：它是 gitignored 的，`git` 不会替**已存在的本地检出**删掉它，而 `tsconfig.json`
// 用 `types/generated/*.d.ts` 通配包含它 ⇒ 那份旧文件会把那批全局声明**继续生效**（漏 import 也不红）。
export const legacyAutoImportDtsPath = 'types/generated/auto-import.d.ts'

// paths.ts
export const generatedPathsFilePath = 'build/_generated/paths.ts'

// app settings json schema file path
export const AppSettingsDevJSONSchemaFilePath = '../../.vscode/settings-dev.schema.json'

// app setting interface file path
export const AppSettingsDevInterfaceFilePath = 'src/store/types.d.ts'
