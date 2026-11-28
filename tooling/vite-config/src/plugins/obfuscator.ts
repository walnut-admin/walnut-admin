import type { ViteConfigPackageInfo } from '../types.ts'
import vitePluginBundleObfuscator from 'vite-plugin-bundle-obfuscator'

/**
 * `manualChunks` 的名字来自调用方的依赖表：裸包名原样用，`@scope/name` 归到 `vendor-@scope`。
 * 这份映射必须与 app 的 `codeSplitting.groups` 对得上，所以依赖表只能由调用方传进来。
 */
export function createObfuscatorPlugin(pkg: ViteConfigPackageInfo) {
  const normal = Object.keys(pkg.dependencies).filter((i) => !i.startsWith('@'))
  const startWithAt = Object.keys(pkg.dependencies)
    .filter((i) => i.startsWith('@'))
    .map((i) => `vendor-${i.split('/')[0]}`)

  return vitePluginBundleObfuscator({
    enable: true,
    log: true,
    threadPool: true,
    autoExcludeNodeModules: {
      enable: true,
      // https://github.com/z0ffy/vite-plugin-bundle-obfuscator/issues/122#issuecomment-2568652367
      manualChunks: normal.concat(startWithAt).concat('fuck'),
    },
    options: {
      optionsPreset: 'low-obfuscation',
    },
  })
}
