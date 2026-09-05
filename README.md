# Stacks

[![create-in-yard](assets/create-in-yard.png)](https://dash.yard.sh/projects?action=create&repo=https%3A%2F%2Fgithub.com%2Fyard-sh%2Fyard-stacks)

A free kanban board (boards, columns, cards, drag-and-drop) hosted end to end
on Yard: a static frontend, a fetch-handler backend, a per-project SQLite
database, and buyer sign-in. There is no separate server and no auth code.

- Product page: <https://tatelax.yard.sh/stacks>
- App: <https://tatelax.yard.sh/stacks/app/>

Use the link above, or paste this repository's URL into the Create from GitHub
URL field of the Yard dashboard's Create Project dialog.

## Layout

    .yard/
      settings.json       every project setting: services, landing page, pricing
      migrations/         applied in filename order at deploy, and by yard dev
      dev/                local state written by yard dev; ignored by git
    app/                  the deployable bundle (the services[] entry with dir: app)
      _service.js         the entire backend: a fetch handler, no ports
      index.html          app shell
      styles.css          design tokens, light + dark
      app.js              rendering, editing, and the pointer-drag engine
    landing-page/         the marketing page

All project configuration lives in `.yard/settings.json`. The service is one
entry on the `services` list, which declares its mount path, access mode, and
database access:

    "services": [
      { "dir": "app", "name": "app", "url": "/app",
        "access": "authenticated", "database_access": true }
    ]

`yard push` sends that file along with the bundles, so changing how the
service deploys is an edit there followed by a push.

## How it fits together

The service's `access` is `"authenticated"`, so Yard signs visitors in and
hands the service a trusted `X-Yard-User-Id` header. Every row is scoped to
that user id, and every write re-checks ownership by joining back to
`boards.user_id`; a card id alone is never trusted.

The project has a single $0 tier, so Stacks is free: signing in is the only
gate. Nobody runs a checkout, which is why `yard users` stays empty.

Drag uses Pointer Events, not HTML5 drag-and-drop (no touch support, and an
unstylable drag image). One endpoint, `POST /api/boards/:id/reorder`, covers
reordering within a column, moving a card across columns, and reordering the
columns themselves.

Two details worth knowing before editing:

- **Relative URLs only.** The app is mounted at `/stacks/app/`, so
  `fetch("api/boards")`, never `/api/boards`. Board selection lives in
  `location.hash` rather than a pushState path for the same reason. The
  landing page links to `app/` too: it serves under `/stacks/`, and under
  `/stacks/@<sandbox>/` in a sandbox. `yard service check` lints for this.
- **Migrations are not transactional.** Keep every statement idempotent
  (`CREATE TABLE IF NOT EXISTS`); a mid-file failure leaves the file
  unrecorded in `_yard_migrations` and re-runs it from the top next deploy.

## Local development

    yard dev

serves the landing page at `http://localhost:9875/stacks/` and the app at
`http://localhost:9875/stacks/app/`, with the migrations applied to a local
database under `.yard/dev/`. There is no real sign-in locally: the app's
`authenticated` gate sends you to a persona picker instead, or pick one up
front with `yard dev --as signed-in`. Files are watched, so a save reloads,
and a new migration file applies the moment it is saved. `yard dev --reset-db`
starts from an empty database.

## Logging

The service logs one line per action. Read them back with:

    yard service logs --since 2h
    yard service logs --since 2h | grep 'cards.reorder'

Every line starts with `[stacks]` and is a single event, so it greps cleanly:

    [stacks] card.create board=5b1c37d7 column=05c444a7 card=c91853ac position=0 titleLen=24 bodyLen=0 cardsOnBoard=3
    [stacks] cards.reorder board=5b1c37d7 kind=across-columns columnsTouched=2 cardsPlaced=3 statements=3
    [stacks] request method=POST path=/api/boards/5b1c37d7/reorder status=200 user=5b1c37d7 ms=6

Events: `request`, `auth.rejected`, `board.seed|create|open|rename|delete`,
`column.create|rename|delete`, `card.create|update|delete`, `cards.reorder`,
`reorder.rejected`. Failures go to `console.error` as `request.failed`.

`cards.reorder` names the drag it came from: `across-columns`,
`within-column`, or `columns-only`.

**Not logged:** card titles, note bodies, board and column names, emails.
Those are the user's content; lengths are logged instead. Ids are truncated to
8 characters everywhere, including inside request paths: enough to correlate
lines within a session, not a durable identifier left sitting in a log store.

`ms=` is a rough floor, not a latency measurement: the hosted runtime only
advances the clock at I/O boundaries.

## Shipping

    yard service check                        validate bundle + lint, no network
    yard status                               what a push would change
    yard push                                 upload service, page, and settings into the draft
    yard releases publish <tag>               publish the draft, which makes it live
    yard service open                         print/open the live app URL
    yard db query "select * from cards"
    yard service logs --since 2h

Nothing serves a draft release, so pushing is safe to repeat as often as you
like; the app only changes for users at `yard releases publish`.
Migrations apply themselves at deploy; you never run them by hand.

The project follows the `Production` channel and starts with no sandboxes. To
publish somewhere users can't see, create one, hold the storefront where
it is, and ship when it looks right:

    yard sandbox create preview
    yard sandbox pin                            hold the project on what it serves
    yard releases publish <tag>
    yard sandbox pin <tag> --sandbox preview
    yard service open --sandbox preview         team-only URL
    yard sandbox unpin                          go live

Data and secrets never move between the project and its sandboxes.
