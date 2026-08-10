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
    [stacks] request method=POST path=/api/boards/5b1c37d7/reorder status=200 user=5b1c37d7 env=production ms=6

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

    yard app check                            validate bundle + lint, no network
    yard status                               what a push would change
    yard push                                 upload app + page into the draft
    yard releases publish <tag>               publish the draft → live
    yard app open                             print/open the production app URL
    yard app db query "select * from cards" --env production
    yard app logs --env production --since 2h

`yard push` sends the whole project — app bundle, landing page, and
`.yard/settings.json` as the release `config`. There is no separate page
command. Nothing serves a draft release, so pushing is safe to repeat as often
as you like; the app only changes for customers at `yard releases publish`.

## There is no local iteration

The app only runs on Yard's edge. Identity headers, `__yard/auth/*`, and the
database are all edge- and environment-provided, so there is nothing to run on
your own machine and no local substitute for them — iterate by pushing to the
draft and publishing. Migrations apply themselves at deploy; you never run them
by hand.

`production` is the only environment here. To get somewhere to publish that
customers can't see, create one and promote it when it looks right:

    yard env create preview
    yard releases publish <tag> --env preview
    yard app open --env preview                 owner-only URL
    yard env promote preview production         go live

Data and secrets never move between environments — set production secrets
explicitly.
