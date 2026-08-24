# Tasks

## 1. Planning declares the name

- [x] 1.1 Add the optional kebab-case `change` to the plan schema (`packages/core/src/plan.ts`) and
      the derivation from the declared title for when it is absent. Verify: `bun test packages` covers
      a declared name, an absent one, and one outside the shape.
- [x] 1.2 Tell the planner role it may name the change (`roles/planner.md`). Verify: the role file
      names the field and its shape.

## 2. Store it

- [x] 2.1 Add the nullable change-name column to `tasks` and generate the migration
      (`packages/db`). Verify: `bun run db:generate` produces one migration and `bun run typecheck` passes.
- [x] 2.2 Record the declared name in `recordPlanOutcome` (`apps/orchestrator/src/store.ts`). Verify:
      `bun test apps/orchestrator` asserts a declared name lands on the task and an absent one leaves it null.

## 3. Name the folder from it

- [x] 3.1 Take the change name as an input to the change folder's path and to provisioning
      (`packages/workspace`), falling back to the slug, and disambiguate a name already taken in the
      repository. Verify: `bun test packages/workspace` covers a declared name, no declared name, and a
      collision with an existing folder.
- [x] 3.2 Converge a folder standing under the provisional name onto the declared one, and leave a
      folder that is already committed alone. Verify: `bun test packages/workspace` covers both.
- [x] 3.3 Run the convergence on accepting the stage that declared the plan, before its commit
      (`apps/orchestrator/src/engine.ts`). Verify: `bun test apps/orchestrator` asserts the accepted
      commit carries no path under the provisional name.

## 4. Close it out

- [x] 4.1 `bun run ci` passes.
