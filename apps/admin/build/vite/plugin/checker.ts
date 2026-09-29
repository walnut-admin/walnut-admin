import checker from 'vite-plugin-checker'

export function createCheckerPlugin() {
  return checker({
    typescript: true,
    vueTsc: true,
    eslint: {
      lintCommand: 'eslint . --ignore-pattern "*.md"',
      useFlatConfig: true,
      // `watchPath` 是**相对 vite root（apps/admin）**解析的（插件源码：`path.resolve(root, watchPath)`）。
      // 这里曾经写的是 `../../../src` —— 解析成 `<repo 的上一级>/src`，**那个目录不存在**，
      // 于是 ESLint 那份只在启动时跑过一次，之后改文件不再重跑：dev 里的 lint 反馈是**假绿**。
      // 别改回带 `../` 的写法；也不要删掉它去赌默认值（默认是 root，会把 node_modules 一起看）。
      watchPath: 'src',
    },
  })
}
