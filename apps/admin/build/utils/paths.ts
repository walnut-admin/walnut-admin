export const typesCheckLogPath = 'report/tsc.log'

// 两个 unplugin 生成的声明文件（`unplugin-auto-import` / `unplugin-vue-components`）。
//
// ⚠️ 它们是**生成物、不进 git**（`apps/admin/types/generated/` 已被 gitignore）。
// 以前它们被提交在 `types/*.d.ts`，于是每次 `pnpm dev` 重写都会把工作区弄脏；
// 移出跟踪面之后，干净检出里**没有**这两份文件 ⇒ 必须靠
// `build/generate/genTypeDeclarations.ts` 显式生成（`pretypes:check` 会跑它）。
export const autoImportDtsPath = 'types/generated/auto-import.d.ts'
export const componentsDtsPath = 'types/generated/components.d.ts'

// paths.ts
export const generatedPathsFilePath = 'build/_generated/paths.ts'

// app settings json schema file path
export const AppSettingsDevJSONSchemaFilePath = '../../.vscode/settings-dev.schema.json'

// app setting interface file path
export const AppSettingsDevInterfaceFilePath = 'src/store/types.d.ts'
