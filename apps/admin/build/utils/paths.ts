// `unplugin-vue-components` 生成的声明文件。
//
// 它**提交进仓**（`.gitignore` 对这个目录的忽略里，给这一个文件留了例外）：由插件在真实的
// dev / build 期间扫描写出，组件集合变了就跟代码一起提交 —— 干净检出里它本来就在，`pnpm dev` 与
// `vue-tsc` 开箱可用。`pre*` 钩子不再生成它（那一版做法为什么被撤掉，见 `build/generate/index.ts`
// 的头注释）。
export const componentsDtsPath = 'types/generated/components.d.ts'

// **已废弃**：`unplugin-auto-import`（2026-09-29 移除，见 ADR 0020）的生成物。
// 它已经没有任何生产者，留在这里只为让 `build/generate/index.ts` 每次运行时把它清掉 —— 理由见那个
// 文件里的注释：它是 gitignored 的，`git` 不会替**已存在的本地检出**删掉它，而 `tsconfig.json`
// 用 `types/generated/*.d.ts` 通配包含它 ⇒ 那份旧文件会把那批全局声明**继续生效**（漏 import 也不红）。
export const legacyAutoImportDtsPath = 'types/generated/auto-import.d.ts'

// app settings json schema file path
export const AppSettingsDevJSONSchemaFilePath = '../../.vscode/settings-dev.schema.json'

// app setting interface file path
export const AppSettingsDevInterfaceFilePath = 'src/store/types.d.ts'
