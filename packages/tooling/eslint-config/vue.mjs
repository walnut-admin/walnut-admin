import antfu from '@antfu/eslint-config'

export default function vueConfig(options = {}) {
  return antfu({
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
    markdown: false,
    unocss: true,
    vue: true,
    typescript: true,
    pnpm: true,
    rules: {
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
      'pnpm/yaml-enforce-settings': 'off',
    },
    ...options,
  })
}
