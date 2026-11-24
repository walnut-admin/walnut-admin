### Introduction

- This folder holds the svg icons which are added by developers.

- Svg icon usage: `<WIcon icon="w-svg:your-svg-file-name" />`.

- This folder will not be bundle into final output, so add whatever svg icons you like here.

- No script to run. The iconify plugin in `@walnut/vite-config` reads this folder **in memory** when dev / build starts (the SVG file name is the icon name), and dev watches it: adding or removing an SVG triggers a hot update. Nothing is written to disk.

- Notice that extra svg files in this folder, which are not used in this project(specific used under `vue,ts,tsx` files `src`) will not be bundled into the final output either.(using the same bundle logic that `iconify` provided to bundle `iconify/jsons`).

- Online or offline usage is decided by the `iconify.online` option that `vite.config.ts` passes to `createVitePlugins` (see `@walnut/vite-config`).
