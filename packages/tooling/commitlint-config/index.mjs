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
      ],
    ],
  },
}
