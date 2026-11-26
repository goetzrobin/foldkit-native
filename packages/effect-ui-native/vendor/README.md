# Vendored Effect UI

Two packages built from source. Neither is on npm yet.

- `effect-ui-0.0.0.tgz` is `@effect/ui`.
- `effect-ui-devtools-0.0.0.tgz` is `@effect/ui-devtools`: the dev tools
  server, its page and its MCP endpoint. Only the Mac runs it. See
  `docs/DEV_TOOLS.md`.

Both come from the same checkout:

- Source: https://github.com/Effect-TS/ui
- Commit: `c73e7ce` (Add toHaveAttribute matcher to Scene and Play testing APIs, #267)
- Built on 26 November 2026, the day of the public preview.
- Needs `effect` 4.1.4 or newer. This repo uses 4.1.6 with it.

## How `@effect/ui` was made

```
git clone https://github.com/Effect-TS/ui && cd ui && git checkout c73e7ce
pnpm install --frozen-lockfile
pnpm build
cd packages/ui && pnpm pack --pack-destination <this folder>
```

`pnpm pack` applies the package's `publishConfig`, so the tarball's `exports`
point at `dist/*.js`, as a published package would.

## How `@effect/ui-devtools` was made

In the same checkout:

```
pnpm install --frozen-lockfile --filter "@effect/ui-devtools..." --filter .
(cd packages/ui && pnpm build)
(cd packages/ui-kit && pnpm build)
(cd packages/ui-devtools && pnpm build && pnpm pack --pack-destination /tmp/pack)
```

The package's build also makes `dist/viewer.html`, the page the server
shows. It is one file with its script inside.

Then one change to the packed `package.json`, described in
`patches/README.md`, and the folder is packed again:

```
cd /tmp/pack && tar xzf effect-ui-devtools-0.0.0.tgz
# edit package/package.json as patches/README.md says
tar czf <this folder>/effect-ui-devtools-0.0.0.tgz package
```

The server needs `@effect/platform-node` at run time. It is an optional peer
of the package, so each place that runs the server lists it itself: this
package and the two apps, under `devDependencies`, at 4.1.6.

## Patches

`patches/` holds any change Effect UI needs to run on a phone. See the
README there.
