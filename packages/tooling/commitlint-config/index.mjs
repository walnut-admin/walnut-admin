/** 允许的 scope：包名（含 apps 与 packages 下所有 workspace 包） */
const SCOPES = [
  // apps
  'admin',
  'server',
  'docs',
  // platform-any
  'utils',
  'contract',
  'types',
  // platform-web
  'client',
  'http',
  'ui',
  // tooling
  'eslint-config',
  'commitlint-config',
  'release',
]

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // 修 bug
        'docs', // 文档
        'style', // 格式（不影响代码逻辑）
        'refactor', // 重构
        'perf', // 性能优化
        'test', // 测试
        'chore', // 杂项（依赖更新、配置调整等）
        'ci', // CI/CD
        'build', // 构建系统
        'revert', // 回滚（git revert 生成）
      ],
    ],
    // scope 必填（commit 格式：type(包名): message）
    // 注意：git revert 自动生成的 "Revert ..." 提交不满足格式，需用 --no-verify 或改写为 revert(x): 后提交
    'scope-empty': [2, 'never'],
    // scope 必须是包名
    'scope-enum': [2, 'always', SCOPES],
  },
}
