# Stacks

A free kanban board — boards, columns, cards, and drag-and-drop — hosted
end to end on Yard: static frontend, Worker backend, per-environment SQLite,
and buyer sign-in. There is no separate backend and no auth code.

- Product page: https://tatelax.yard.sh/stacks
- App: https://tatelax.yard.sh/stacks/app/
- Dev preview (owner only): `yard app open`

## Layout

    app/                  the deployable bundle (recorded as app.dir)
      _worker.js          the entire backend — a fetch handler, no ports
      migrations/         applied in filename order at deploy
      index.html          app shell
      styles.css          design tokens, light + dark
      app.js              rendering, editing, and the pointer-drag engine
    .yard/
      settings.json       every project setting — product, app, landing page
      landing-page/       the marketing page
    wrangler.toml         local dev only; never uploaded

All project configuration lives in `.yard/settings.json` (schema v2). The `app`
block is what used to be `app/yard.json` plus the old top-level `app_dir`:

    "app": { "dir": "app", "access": "authenticated", "database": true }

It ships to the deploy as the release's `config` artifact, so changing how the
app deploys is an edit to that file followed by `yard push`.

## How it fits together

`app.access` is `"authenticated"`, so the Yard edge signs visitors in
and hands the Worker trusted `X-Yard-User-Id` / `X-Yard-Entitlement` headers.
Every row is scoped to that user id, and every write re-checks ownership by
joining back to `boards.user_id` — a card id alone is never trusted.

The product has a single $0 tier, so Stacks is free: signing in is the only
gate. Nobody runs a checkout, which is why `yard customers` stays empty.

Drag uses Pointer Events, not HTML5 drag-and-drop (no touch support, and an
unstylable drag image). One endpoint, `POST /api/boards/:id/reorder`, covers
reordering within a column, moving a card across columns, and reordering the
columns themselves.

Two details worth knowing before editing:

- **Relative URLs only.** The app is mounted at `/stacks/app/`, so
  `fetch("api/boards")` — never `/api/boards`. Board selection lives in
  `location.hash` rather than a pushState path for the same reason.
  `yard app check` lints for this.
- **Migrations are not transactional.** Keep every statement idempotent
  (`CREATE TABLE IF NOT EXISTS`); a mid-file failure leaves the file
  unrecorded in `_yard_migrations` and re-runs it from the top next deploy.

## Logging

The Worker logs one line per action. Read them back with:

    yard app logs --env production --since 2h
    yard app logs --env production --since 2h | grep 'cards.reorder'

Every line starts with `[stacks]` and is a single event, so it greps cleanly:

    [stacks] card.create board=5b1c37d7 column=05c444a7 card=c91853ac position=0 titleLen=24 bodyLen=0 cardsOnBoard=3
    [stacks] cards.reorder board=5b1c37d7 kind=across-columns columnsTouched=2 cardsPlaced=3 statements=3
    [stacks] request method=POST path=/api/boards/5b1c37d7/reorder status=200 user=ui-test- env=local ms=6

Events: `request`, `auth.rejected`, `board.seed|create|open|rename|delete`,
`column.create|rename|delete`, `card.create|update|delete`, `cards.reorder`,
`reorder.rejected`. Failures go to `console.error` as `request.failed`.

`cards.reorder` names the drag it came from — `across-columns`,
`within-column`, or `columns-only`.

**Not logged:** card titles, note bodies, board and column names, emails.
Those are the user's content; lengths are logged instead. Ids are truncated to
8 characters everywhere, including inside request paths — enough to correlate
lines within a session, not a durable identifier left sitting in a log store.

Note that `Date.now()` barely advances between I/O in Workers, so `ms=` is a
rough floor, not a real latency measurement.

## Commands

    npx wrangler dev                          local; migrations applied by hand:
      npx wrangler d1 execute dev --local --file app/migrations/0001_init.sql
    yard app check                            validate bundle + lint, no network
    yard app deploy                           → development, prints preview URL
    yard app open                              browse the development preview
    yard env promote development production   go live (data/secrets never move)
    yard app db query "select * from cards" --env production
    yard app logs --env development
    yard page push --publish                  update the landing page

Local dev has no edge, so identity headers are believed rather than verified,
and `__yard/auth/*` does not exist (the UI degrades gracefully). Useful for
exercising CRUD; worthless for validating auth.
