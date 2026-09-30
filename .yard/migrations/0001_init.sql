-- Stacks schema. Every statement is idempotent: migration files are not
-- transactional, so a mid-file failure leaves earlier statements applied and
-- the file unrecorded in _yard_migrations, which re-runs it from the top on
-- the next deploy. IF NOT EXISTS makes that re-run harmless.
--
-- The table is board_columns, not columns, to stay clear of SQLite keywords.
-- Deletes cascade explicitly in _service.js: foreign-key enforcement is off
-- by default in SQLite, so ON DELETE CASCADE here would silently do nothing.
--
-- Times are milliseconds since the epoch, written by the service.

CREATE TABLE IF NOT EXISTS boards (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_user ON boards (user_id, position);

CREATE TABLE IF NOT EXISTS board_columns (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_columns_board ON board_columns (board_id, position);

CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  column_id  TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_column ON cards (column_id, position);
CREATE INDEX IF NOT EXISTS idx_cards_board ON cards (board_id);
