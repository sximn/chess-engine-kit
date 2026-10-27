# Minimal browser example

A Vite + TypeScript page with editable root FEN and UCI history, three candidate
lines, progress, cancellation and error handling. It imports the installed package
and keeps the UI in [src/main.ts](src/main.ts). Use Node >=22.12. Repository setup
also uses Bun.

## From the repository

```sh
bun install --frozen-lockfile
bun run example:setup
npm --prefix examples/minimal run dev
```

Setup builds and packs the current version, installs pinned example tooling with
`npm ci`, and installs that tarball without changing the example's manifest or
lockfile. Edit this folder's source and use Vite's development server normally.
To inspect production output:

```sh
npm --prefix examples/minimal run build
npm --prefix examples/minimal run preview
```

## As your own project, after publication

Copy this folder, then install the package from the registry:

```sh
npm install --save-exact chess-engine-kit@next
npm run dev
```

Commit the updated package.json and lockfile in your app. Asset copying is already
included in the development and production scripts. For SvelteKit, adapt the
destination to `static/engines/frozenight` and initialize in `onMount`.

UCI uses coordinates (`g1f3`), not SAN (`Nf3`). Positive scores favor White. Mate
distance is in plies. Frozenight requires a node limit. Preserve original FEN plus
moves for repetition detection; a current FEN alone loses earlier history.

The example includes analysis UI, without a board or offline page caching. A
framework component should unsubscribe and dispose its engine on unmount.
