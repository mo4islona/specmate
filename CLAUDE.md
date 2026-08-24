# SpecMate — repository conventions

## The web app is drawn from one kit

Three layers, and a change belongs to exactly one of them:

- `apps/web/src/theme/theme.css` — every colour and typeface, one block per theme. A component
  names a role (`accent`, `attention`, `danger`, `info`, `success`, the four greys, mono, sans);
  the theme decides what it looks like.
- `apps/web/src/index.css` — the parts those roles dress, in Tailwind's `components` layer.
- `apps/web/src/ui` — the React kit: a name and a typed set of choices per part. **Nothing outside
  `src/ui` writes one of those classes.** `Button`, not `className="button-primary"`.

A call site owns its layout — every primitive takes a `className` and appends it last, so a margin
or a width written beside it means what it says. What a call site does not own is the part.
`ui/kit-discipline.test.ts` enforces both halves of that: no component class outside the kit, and
every colour utility naming a role the theme actually defines.

`/kit` renders every part in every variant and state under the theme switcher. Look at it after
changing anything in `src/ui`, and add the new part to it.

## Tests are written on vitest

New tests are written on **vitest**, and use what it actually gives you rather than hand-rolled
scaffolding: `vi.fn` / `vi.spyOn` for doubles, `vi.mock` for module boundaries,
`vi.useFakeTimers` for clocks, `test.each` for tables, `expect.soft` when several assertions on
one subject should all report, `expect.poll` / `vi.waitFor` for eventually-true conditions,
`toMatchObject` and the asymmetric matchers instead of assembling comparisons by hand. Nothing is
global — `globals: false` everywhere, so every import is explicit.

Do not write new `bun:test` files, and do not reach for bun's built-in `expect`.

Where each suite runs today:

- `apps/web` — vitest + jsdom + testing-library (`bun run --cwd apps/web test`).
- `packages/core` — vitest under the root `vitest.config.ts` (`bun run vitest run`).
- everything else — still `bun test` (`bun run test:bun`), because those suites import the Bun
  runtime itself: `packages/db` imports `SQL` from `bun`, and the workspace and runner packages
  call `Bun.spawn`, `Bun.$`, `Bun.file` and `Bun.write`. Vitest's workers are Node, so those
  files cannot move until the code under them stops binding to Bun. A wholesale migration is not
  planned; move a suite when the code it covers stops needing Bun.

`bun run test` runs all three.
