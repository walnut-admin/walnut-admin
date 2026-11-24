/**
 * 环境变量的类型来自 `@walnut/vite-config`：schema 与 `useBuildEnv` 的映射都在那里，
 * 这里只把增强结果接到全局的 `ImportMetaEnv` 上。
 */
type WalnutImportMetaEnv = import('@walnut/vite-config').ViteImportMetaEnv

interface ViteTypeOptions {
  // Avoid adding an index type to `ImportMetaDev` so
  // there's an error when accessing unknown properties.
  // This option requires Vite 6.3.x or higher
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv extends WalnutImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/// <reference types="vite/client" />
