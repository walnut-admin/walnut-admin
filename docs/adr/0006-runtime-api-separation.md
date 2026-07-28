# ADR-0006: Runtime API Separation

**Date:** 2026-07-28
**Status:** Accepted

## Context

Code in a monorepo can be categorized by what runtime APIs it depends on:

| Category | APIs | Example |
|----------|------|---------|
| **Pure** | None — just JavaScript | `SingletonPromise`, regex validators, binary transformers |
| **Browser** | DOM, Web Crypto, `window`, `navigator`, IndexedDB | `aesGcmEncrypt`, `downloadByUrl`, `getCPUCoreCount` |
| **Node** | `fs`, `path`, `crypto` (Node), `process` | File system operations, OS-level utilities |
| **Framework** | Vue, React, NestJS decorators | `useState`, `@Injectable()`, `defineComponent` |

Mixing these categories in one package causes:
- Backend can't consume browser code (no DOM)
- Frontend can't consume Node code (no `fs`)
- Pure utilities get buried under framework dependencies

## Decision

Packages are organized by their **maximum runtime API dependency**:

```
@walnut/utils        ← Pure only (zero runtime APIs)
@walnut/client       ← Browser APIs + Vue framework
@walnut-server/utils ← Node APIs only (backend-internal)
@walnut-server/*     ← Node + NestJS framework (backend-internal)
```

**Within `@walnut/client`**, code is further organized by API level:

```
client/src/
  browser/           ← Browser APIs only (no Vue dependency)
    crypto/          ← Web Crypto API
    file/            ← DOM FileReader, Blob, Canvas
    window/          ← window.btoa/atob
    shared.ts        ← navigator, device detection
  hooks/             ← Vue composables (stateful, reactive)
  persistent/        ← Storage subsystem (browser + Vue)
```

This makes it immediately clear whether a function:
- Can run in any JS runtime (→ `@walnut/utils`)
- Needs a browser (→ `@walnut/client/browser/`)
- Needs Vue (→ `@walnut/client/hooks/`)

## Consequences

- `@walnut/utils` has zero `vue`, `@vueuse`, `idb`, or DOM dependencies. Only `js-base64`.
- Adding a new pure utility: goes to `@walnut/utils`. Adding a browser crypto wrapper: goes to `@walnut/client/browser/crypto/`.
- A backend developer can `require('@walnut/utils')` without pulling in browser globals.
- Future: if the project adds React/SSR/Electron, the separation maps cleanly — pure utils are reusable, browser utils need browser, Vue composables stay in client.
