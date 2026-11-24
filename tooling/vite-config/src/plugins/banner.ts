import type { ViteConfigPackageInfo } from '../types.ts'
import banner from 'vite-plugin-banner'

export function createBannerPlugin(outDir: string, pkg: ViteConfigPackageInfo) {
  return banner({
    outDir,
    content: `/**\n * name: ${pkg.name}\n * version: v${pkg.version}\n * description: ${pkg.description}\n * author: ${pkg.author.name}\n * homepage: ${pkg.homepage}\n */`,
  })
}
