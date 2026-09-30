import type { ComponentResolver } from 'unplugin-vue-components/types'
import { globSync } from 'tinyglobby'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { componentsDtsPath } from '../../utils/paths.ts'

function WalnutAdminComponentResolver(): ComponentResolver {
  // 扫描 admin 内部组件
  const allComponents = globSync('src/components/**/**/index.ts', { dot: true })
  const componentMap = Object.fromEntries(allComponents.filter(i => !i.includes('utils')).map(i => [i.split('/').slice(-2, -1)[0], i.replace('src', '@')]))

  // 扫描 @walnut/ui 包组件（ADR-0017 Phase 3.1）
  const uiComponents = globSync('../../packages/platform-web/ui/src/*/index.ts', { dot: true })

  for (const p of uiComponents) {
    const componentName = p.split('/').slice(-2, -1)[0]
    componentMap[componentName] = `@walnut/ui/${componentName}`
  }

  return {
    type: 'component',
    resolve: (name) => {
      if (name.startsWith('W')) {
        const componentName = name.slice(1)

        if (componentMap[componentName]) {
          return componentMap[componentName]
        }
      }
    },
  }
}

export function createComponentPlugin() {
  return Components({
    dirs: ['@/components'],

    extensions: ['vue', 'ts', 'tsx'],

    // allow auto import and register components used in markdown
    include: [
      /\.[tj]sx?$/, // .ts, .tsx, .js, .jsx
      /\.vue$/,
      /\.vue\?vue/, // .vue
      /\.md$/, // .md
    ],

    // 这份 dts 的**唯一产出者就是本插件**：`pre*` 钩子里的 `build/generate/genTypeDeclarations.ts`
    // 是跑一次 stub 构建让插件把它写出来。所以这里**不能**改成 `dts: false` —— 那样 `pnpm dev` /
    // `pnpm build` 都不会再有 `types/generated/components.d.ts`（2026-09-30 实测：删掉文件后跑
    // `pnpm run predev`，文件不会回来）。
    //
    // 已知问题（未修，待方案）：真实 `vite build` 期间插件会**再写一次**这个文件，与构建自身的 TS
    // 变换存在竞争 ⇒ 偶发 `TS1434 Unexpected keyword or identifier` / `TS1128 Declaration or
    // statement expected`（v0.1.4 的 Release 就这么红在 `Build admin`，而同一提交的 CI 因命中
    // turbo 缓存是绿的）。
    dts: componentsDtsPath,

    deep: false,

    resolvers: [
      // Naive
      NaiveUiResolver(),

      // Custom
      WalnutAdminComponentResolver(),
    ],
  })
}
