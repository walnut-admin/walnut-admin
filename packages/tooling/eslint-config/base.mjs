import antfu from '@antfu/eslint-config'

export default function baseConfig(options = {}) {
  return antfu({
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
    markdown: false,
    rules: {
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
    },
    ...options,
  })
}
