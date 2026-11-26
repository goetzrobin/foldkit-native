# Patches to Effect UI

## `@effect/ui`

None. `@effect/ui` at `c73e7ce` runs on the phone's JavaScript engine as it
is: the native host needed no change to it.

What made that possible is listed in `docs/EFFECT_UI_NATIVE.md`, with what
is still missing or hard for a native host.

## `@effect/ui-devtools`

One, and only in its `package.json`. No code was changed.

The package names `@effect/ui-kit` as a peer it must have. Only its overlay
for web pages uses the kit. The server, the page it serves (already built
into one file) and the entry point for hosts with no web page do not. npm
installs a required peer by itself, and `@effect/ui-kit` is not on npm, so
`npm install` would fail. The peer is marked optional:

```json
"peerDependenciesMeta": {
  "@effect/platform-node": { "optional": true },
  "@effect/ui-kit": { "optional": true }
}
```

Importing the package's index (`@effect/ui-devtools`, the web overlay) would
fail here, because the kit is missing. Nothing in this repo does: the apps
use `@effect/ui-devtools/node` on the Mac, through `scripts/eui-devtools.mjs`.
