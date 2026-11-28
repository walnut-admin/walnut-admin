import checker from 'vite-plugin-checker'

export function createCheckerPlugin(watchPath = 'src') {
  return checker({
    // **不要加回 `typescript: true`。** 仓库的 `typescript` 是 TNB（tsgo 外壳，catalog/overrides
    // 全局替换），它的 native bridge 是进程级单例、只接受一个 lib 路径（Go 侧 SetLibPath 二次调用
    // 直接抛 conflict）。`typescript` 与 `vueTsc` 虽然各跑一个 worker，却共享同一进程：
    //   · typescript checker 直接从原包加载 TNB → SetLibPath(<原包>/lib)
    //   · vueTsc checker 用 prepareVueTsc 复制出的副本加载 → SetLibPath(<fixture>/lib) ⇒ 冲突崩溃
    // （vite-plugin-checker 0.14.5 与 1.1.0 都实测如此，1.1.0 的 fixture 仍会复制整个 TS 目录。）
    // vue-tsc 本身就是 tsc + .vue 语言插件，覆盖 `types:check`（`vue-tsc --noEmit`）的全部范围，
    // 只留 vueTsc 既保住 dev/build 的类型反馈，也避免双份 TNB 同时进一个进程。
    vueTsc: true,
    eslint: {
      lintCommand: 'eslint . --ignore-pattern "*.md"',
      useFlatConfig: true,
      // `watchPath` 是**相对 vite root**解析的（插件源码：`path.resolve(root, watchPath)`）。
      // 这里曾经写的是 `../../../src` —— 解析成 `<repo 的上一级>/src`，**那个目录不存在**，
      // 于是 ESLint 那份只在启动时跑过一次，之后改文件不再重跑：dev 里的 lint 反馈是**假绿**。
      // 别改回带 `../` 的写法；也不要删掉它去赌默认值（默认是 root，会把 node_modules 一起看）。
      watchPath,
    },
  })
}
