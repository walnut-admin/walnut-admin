import TurboConsole from 'unplugin-turbo-console/vite'

export function createTurboConsolePlugin(packageName: string) {
  return TurboConsole({
    highlight: {
      themeDetect: true,
    },
    prefix: packageName.toLocaleUpperCase(),
  })
}
