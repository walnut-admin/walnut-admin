/** 允许的 scope：包名（含 apps 与 packages 下所有 workspace 包）+ 基础设施 scope */
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
  'tooling',
  // deploy
  'docker',
  'deploy',
  // repo infra（跨包的基础设施变更：包管理器、workspace 等）
  'pnpm',
  // 发版记账提交专用（`chore(release): vX.Y.Z`）。它不是包 scope：
  // release 编排本身归 @walnut/tooling，而发版提交需要一个人能一眼认出的稳定 scope。
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
    // scope 必须是包名或基础设施 scope。
    // ⚠️ 发版脚本用 `chore(release): vX.Y.Z`：`scope-empty: never` 会拒绝无 scope 的
    // `chore: release …`，而 release 提交被拒会让 tag 指向一个不含版本号的提交（后果严重）。
    'scope-enum': [2, 'always', SCOPES],
  },
}
