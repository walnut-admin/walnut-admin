import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
    markdown: false,
    unocss: true,
    rules: {
      // LINK reasonable https://stackoverflow.com/a/78566802
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
      'pnpm/json-enforce-catalog': 'off',
      'pnpm/enforce-catalog': 'off',
      // trustPolicy: no-downgrade blocked by 6 transitive deps flagged as high-risk
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
)
