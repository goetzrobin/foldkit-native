# Vendored Effect UI

`effect-ui-0.0.0.tgz` is `@effect/ui`, built from source. It is not on npm yet.

- Source: https://github.com/Effect-TS/ui
- Commit: `c73e7ce` (Add toHaveAttribute matcher to Scene and Play testing APIs, #267)
- Built on 26 November 2026, the day of the public preview.
- Needs `effect` 4.1.4 or newer. This repo uses 4.1.6 with it.

## How it was made

```
git clone https://github.com/Effect-TS/ui && cd ui && git checkout c73e7ce
pnpm install --frozen-lockfile
pnpm build
cd packages/ui && pnpm pack --pack-destination <this folder>
```

`pnpm pack` applies the package's `publishConfig`, so the tarball's `exports`
point at `dist/*.js`, as a published package would.

`@effect/ui-devtools` is left out: it needs `@effect/ui-kit` as well, and
phase 1 does not use it.

## Patches

`patches/` holds any change Effect UI needs to run on a phone. See the
README there. An empty folder means none was needed.
