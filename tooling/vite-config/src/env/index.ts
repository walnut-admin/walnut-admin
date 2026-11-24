import type { ImportMetaEnvAugmented } from '@julr/vite-plugin-validate-env'

export { default as devEnvSchema } from './env.development.ts'
export { default as prodEnvSchema } from './env.prod.ts'
export { default as stageEnvSchema } from './env.stage.ts'
export type { IViteEnv } from './types.ts'
export { useBuildEnv } from './use-build-env.ts'

/**
 * `import.meta.env` 的类型增强结果，供消费方声明 `ImportMetaEnv` 时继承。
 *
 * 口径与搬迁前逐字一致：只取 development 与 stage 两份 schema 的并集（prod 不含在内）。
 * 消费方拿到的键就是这两份 schema 校验过的键，未声明的键在 `strictImportMetaEnv` 下会报错。
 */
export type ViteImportMetaEnv = ImportMetaEnvAugmented<
  typeof import('./env.development.ts').default
  & typeof import('./env.stage.ts').default
>
