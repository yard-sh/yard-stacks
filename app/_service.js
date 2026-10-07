// Stacks backend.
//
// No ports, no listen(): Yard runs this as a fetch handler. Requests arrive
// with the app path rooted at "/" and, for signed-in visitors, trusted
// identity headers the edge verified:
//   X-Yard-User-Id, X-Yard-Email, X-Yard-Entitlement, X-Yard-Tier,
//   X-Yard-Tier-Key, X-Yard-Sandbox
// Clients can never spoof these: the edge strips inbound X-Yard-* first, and
// `yard dev` stamps the same headers locally from the persona you pick.
// The service entry in .yard/settings.json sets access: "authenticated", so
// Yard Auth signs anonymous visitors in before they reach this code.

const MAX_NAME = 80;
const MAX_TITLE = 200;
const MAX_BODY = 5000;
const MAX_BOARDS = 50;
const MAX_COLUMNS = 20;
const MAX_CARDS_PER_BOARD = 500;

const STARTER_COLUMNS = ["To do", "In progress", "Done"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Never serve the backend as an asset. Yard excludes it server-side; this
    // guard keeps any other host honest.
    if (url.pathname === "/_service.js") {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname.startsWith("/api/")) {
      const started = Date.now();
      try {
        const response = await handleAPI(request, env, url);
        log("request", {
          method: request.method,
          path: redactPath(url.pathname),
          status: response.status,
          user: shortId(request.headers.get("X-Yard-User-Id")),
          ms: Date.now() - started,
        });
        return response;
      } catch (err) {
        console.error(
          `[stacks] request.failed ${request.method} ${url.pathname}`,
          err && err.stack,
        );
        return json({ error: "something went wrong on our end" }, 500);
      }
    }

    // Everything else: the static frontend (env.ASSETS is this directory).
    return env.ASSETS.fetch(request);
  },
};

async function handleAPI(request, env, url) {
  // Every API route is per-user data. The access gate normally guarantees the
  // header; this is the backstop.
  const user = request.headers.get("X-Yard-User-Id");
  const method = request.method;
  if (!user) {
    log("auth.rejected", { method, path: url.pathname });
    return json({ error: "sign in to use Stacks" }, 401);
  }

  // ["api", "boards", "<id>", "columns"]: the leading "api" is dropped.
  const [, ...seg] = url.pathname.split("/").filter(Boolean);

  // /api/boards
  if (seg[0] === "boards" && seg.length === 1) {
    if (method === "GET") return listBoards(env, user);
    if (method === "POST") return createBoard(request, env, user);
    return methodNotAllowed();
  }

  // /api/boards/:id  and  /api/boards/:id/{columns,reorder}
  if (seg[0] === "boards" && seg.length >= 2) {
    const board = await ownedBoard(env, user, seg[1]);
    if (!board) return json({ error: "board not found" }, 404);

    if (seg.length === 2) {
      if (method === "GET") return getBoard(env, board);
      if (method === "PATCH") return renameBoard(request, env, board);
      if (method === "DELETE") return deleteBoard(env, board);
      return methodNotAllowed();
    }
    if (seg.length === 3 && seg[2] === "columns" && method === "POST") {
      return createColumn(request, env, board);
    }
    if (seg.length === 3 && seg[2] === "reorder" && method === "POST") {
      return reorder(request, env, board);
    }
    return json({ error: "not found" }, 404);
  }

  // /api/columns/:id  and  /api/columns/:id/cards
  if (seg[0] === "columns" && seg.length >= 2) {
    const column = await ownedColumn(env, user, seg[1]);
    if (!column) return json({ error: "column not found" }, 404);

    if (seg.length === 2) {
      if (method === "PATCH") return renameColumn(request, env, column);
      if (method === "DELETE") return deleteColumn(env, column);
      return methodNotAllowed();
    }
    if (seg.length === 3 && seg[2] === "cards" && method === "POST") {
      return createCard(request, env, column);
    }
    return json({ error: "not found" }, 404);
  }

  // /api/cards/:id
  if (seg[0] === "cards" && seg.length === 2) {
    const card = await ownedCard(env, user, seg[1]);
    if (!card) return json({ error: "card not found" }, 404);

    if (method === "PATCH") return updateCard(request, env, card);
    if (method === "DELETE") return deleteCard(env, card);
    return methodNotAllowed();
  }

  return json({ error: "not found" }, 404);
}

/* ---------------------------------------------------------------- boards */

async function listBoards(env, user) {
  let boards = await allBoards(env, user);

  // First visit: seed a board so nobody lands on an empty screen.
  if (boards.length === 0) {
    await seedBoard(env, user);
    boards = await allBoards(env, user);
  }
  return json(boards);
}

async function allBoards(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, position, created_at FROM boards WHERE user_id = ?1 ORDER BY position, created_at",
  )
    .bind(user)
    .all();
  return results || [];
}

async function seedBoard(env, user) {
  const boardId = crypto.randomUUID();
  const columnIds = STARTER_COLUMNS.map(() => crypto.randomUUID());
  const now = Date.now();

  const stmts = [
    env.DB.prepare(
      "INSERT INTO boards (id, user_id, name, position, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
    ).bind(boardId, user, "My board", now),
  ];

  STARTER_COLUMNS.forEach((name, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO board_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(columnIds[i], boardId, name, i, now),
    );
  });

  const welcome = [
    ["Drag me to In progress", "Cards move between columns by dragging them, or by focusing a card and pressing Cmd/Ctrl + arrow keys."],
    ["Rename a column by clicking its name", "Every change saves the moment you make it. There is no save button."],
  ];
  welcome.forEach(([title, body], i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO cards (id, column_id, board_id, title, body, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
      ).bind(crypto.randomUUID(), columnIds[0], boardId, title, body, i, now),
    );
  });

  await env.DB.batch(stmts);
  log("board.seed", {
    user: shortId(user),
    board: shortId(boardId),
    columns: STARTER_COLUMNS.length,
    cards: welcome.length,
  });
  return boardId;
}

async function createBoard(request, env, user) {
  const { name } = await readJSON(request);
  const clean = text(name, MAX_NAME);
  if (!clean) return json({ error: "name your board" }, 400);

  const existing = await allBoards(env, user);
  if (existing.length >= MAX_BOARDS) {
    return json({ error: `you can have up to ${MAX_BOARDS} boards` }, 400);
  }

  const boardId = crypto.randomUUID();
  const position = existing.length;
  const now = Date.now();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO boards (id, user_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(boardId, user, clean, position, now),
  ];
  STARTER_COLUMNS.forEach((name, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO board_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(crypto.randomUUID(), boardId, name, i, now),
    );
  });
  await env.DB.batch(stmts);
  log("board.create", {
    user: shortId(user),
    board: shortId(boardId),
    position,
    nameLen: clean.length,
    boardsNow: existing.length + 1,
  });

  return json({ id: boardId, name: clean, position }, 201);
}

async function getBoard(env, board) {
  const [cols, cards] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, position FROM board_columns WHERE board_id = ?1 ORDER BY position, created_at",
    )
      .bind(board.id)
      .all(),
    env.DB.prepare(
      "SELECT id, column_id, title, body, position, updated_at FROM cards WHERE board_id = ?1 ORDER BY position, created_at",
    )
      .bind(board.id)
      .all(),
  ]);

  const byColumn = new Map();
  for (const col of cols.results || []) byColumn.set(col.id, []);
  for (const card of cards.results || []) {
    const list = byColumn.get(card.column_id);
    if (list) list.push(card);
  }

  log("board.open", {
    board: shortId(board.id),
    columns: (cols.results || []).length,
    cards: (cards.results || []).length,
  });

  return json({
    board: { id: board.id, name: board.name },
    columns: (cols.results || []).map((col) => ({
      ...col,
      cards: byColumn.get(col.id) || [],
    })),
  });
}

async function renameBoard(request, env, board) {
  const { name } = await readJSON(request);
  const clean = text(name, MAX_NAME);
  if (!clean) return json({ error: "name your board" }, 400);
  await env.DB.prepare("UPDATE boards SET name = ?1 WHERE id = ?2")
    .bind(clean, board.id)
    .run();
  log("board.rename", { board: shortId(board.id), nameLen: clean.length });
  return json({ id: board.id, name: clean });
}

async function deleteBoard(env, board) {
  // Explicit cascade: see the note at the top of 0001_init.sql.
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM cards WHERE board_id = ?1").bind(board.id),
    env.DB.prepare("DELETE FROM board_columns WHERE board_id = ?1").bind(board.id),
    env.DB.prepare("DELETE FROM boards WHERE id = ?1").bind(board.id),
  ]);
  log("board.delete", {
    board: shortId(board.id),
    cardsRemoved: changed(results[0]),
    columnsRemoved: changed(results[1]),
  });
  return json({ ok: true });
}

/* --------------------------------------------------------------- columns */

async function createColumn(request, env, board) {
  const { name } = await readJSON(request);
  const clean = text(name, MAX_NAME);
  if (!clean) return json({ error: "name your column" }, 400);

  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n, IFNULL(MAX(position), -1) AS maxpos FROM board_columns WHERE board_id = ?1",
  )
    .bind(board.id)
    .first();

  if (row.n >= MAX_COLUMNS) {
    return json({ error: `a board can hold up to ${MAX_COLUMNS} columns` }, 400);
  }

  const id = crypto.randomUUID();
  const position = row.maxpos + 1;
  await env.DB.prepare(
    "INSERT INTO board_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(id, board.id, clean, position, Date.now())
    .run();

  log("column.create", {
    board: shortId(board.id),
    column: shortId(id),
    position,
    nameLen: clean.length,
    columnsNow: row.n + 1,
  });

  return json({ id, name: clean, position, cards: [] }, 201);
}

async function renameColumn(request, env, column) {
  const { name } = await readJSON(request);
  const clean = text(name, MAX_NAME);
  if (!clean) return json({ error: "name your column" }, 400);
  await env.DB.prepare("UPDATE board_columns SET name = ?1 WHERE id = ?2")
    .bind(clean, column.id)
    .run();
  log("column.rename", {
    board: shortId(column.board_id),
    column: shortId(column.id),
    nameLen: clean.length,
  });
  return json({ id: column.id, name: clean });
}

async function deleteColumn(env, column) {
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM cards WHERE column_id = ?1").bind(column.id),
    env.DB.prepare("DELETE FROM board_columns WHERE id = ?1").bind(column.id),
  ]);
  log("column.delete", {
    board: shortId(column.board_id),
    column: shortId(column.id),
    cardsRemoved: changed(results[0]),
  });
  return json({ ok: true });
}

/* ----------------------------------------------------------------- cards */

async function createCard(request, env, column) {
  const { title, body } = await readJSON(request);
  const cleanTitle = text(title, MAX_TITLE);
  if (!cleanTitle) return json({ error: "give the card a title" }, 400);

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM cards WHERE board_id = ?1",
  )
    .bind(column.board_id)
    .first();
  if (count.n >= MAX_CARDS_PER_BOARD) {
    return json(
      { error: `a board can hold up to ${MAX_CARDS_PER_BOARD} cards` },
      400,
    );
  }

  const row = await env.DB.prepare(
    "SELECT IFNULL(MAX(position), -1) AS maxpos FROM cards WHERE column_id = ?1",
  )
    .bind(column.id)
    .first();

  const id = crypto.randomUUID();
  const position = row.maxpos + 1;
  const cleanBody = text(body, MAX_BODY) || "";

  await env.DB.prepare(
    "INSERT INTO cards (id, column_id, board_id, title, body, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
  )
    .bind(id, column.id, column.board_id, cleanTitle, cleanBody, position, Date.now())
    .run();

  log("card.create", {
    board: shortId(column.board_id),
    column: shortId(column.id),
    card: shortId(id),
    position,
    titleLen: cleanTitle.length,
    bodyLen: cleanBody.length,
    cardsOnBoard: count.n + 1,
  });

  return json(
    { id, column_id: column.id, title: cleanTitle, body: cleanBody, position },
    201,
  );
}

async function updateCard(request, env, card) {
  const patch = await readJSON(request);
  const title = patch.title === undefined ? card.title : text(patch.title, MAX_TITLE);
  if (!title) return json({ error: "give the card a title" }, 400);
  const body = patch.body === undefined ? card.body : text(patch.body, MAX_BODY) || "";

  await env.DB.prepare(
    "UPDATE cards SET title = ?1, body = ?2, updated_at = ?3 WHERE id = ?4",
  )
    .bind(title, body, Date.now(), card.id)
    .run();

  log("card.update", {
    board: shortId(card.board_id),
    card: shortId(card.id),
    titleChanged: title !== card.title,
    bodyChanged: body !== card.body,
    titleLen: title.length,
    bodyLen: body.length,
  });

  return json({ id: card.id, title, body });
}

async function deleteCard(env, card) {
  await env.DB.prepare("DELETE FROM cards WHERE id = ?1").bind(card.id).run();
  log("card.delete", {
    board: shortId(card.board_id),
    column: shortId(card.column_id),
    card: shortId(card.id),
  });
  return json({ ok: true });
}

/* --------------------------------------------------------------- reorder */

// The drag endpoint. One shape covers reordering inside a column, moving a
// card across columns, and reordering the columns themselves:
//   { columns: { "<columnId>": ["<cardId>", ...] }, columnOrder: ["<columnId>", ...] }
// Only the touched columns need to be listed. Every id is re-checked against
// this board before anything is written: the client's word is never enough.
async function reorder(request, env, board) {
  const payload = await readJSON(request);
  const columns = payload.columns || {};
  const columnOrder = payload.columnOrder;

  const [colRows, cardRows] = await Promise.all([
    env.DB.prepare("SELECT id FROM board_columns WHERE board_id = ?1")
      .bind(board.id)
      .all(),
    env.DB.prepare("SELECT id FROM cards WHERE board_id = ?1").bind(board.id).all(),
  ]);
  const validColumns = new Set((colRows.results || []).map((r) => r.id));
  const validCards = new Set((cardRows.results || []).map((r) => r.id));

  const stmts = [];
  const seen = new Set();
  const now = Date.now();

  for (const [columnId, cardIds] of Object.entries(columns)) {
    if (!validColumns.has(columnId)) {
      log("reorder.rejected", {
        board: shortId(board.id),
        reason: "column-not-on-board",
        column: shortId(columnId),
      });
      return json({ error: "that column is not on this board" }, 400);
    }
    if (!Array.isArray(cardIds)) {
      log("reorder.rejected", {
        board: shortId(board.id),
        reason: "cards-not-a-list",
        column: shortId(columnId),
      });
      return json({ error: "each column needs a list of card ids" }, 400);
    }
    cardIds.forEach((cardId, index) => {
      if (!validCards.has(cardId)) return;
      if (seen.has(cardId)) return; // a card can only land in one place
      seen.add(cardId);
      stmts.push(
        env.DB.prepare(
          "UPDATE cards SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4 AND board_id = ?5",
        ).bind(columnId, index, now, cardId, board.id),
      );
    });
  }

  if (Array.isArray(columnOrder)) {
    columnOrder.forEach((columnId, index) => {
      if (!validColumns.has(columnId)) return;
      stmts.push(
        env.DB.prepare(
          "UPDATE board_columns SET position = ?1 WHERE id = ?2 AND board_id = ?3",
        ).bind(index, columnId, board.id),
      );
    });
  }

  if (stmts.length) await env.DB.batch(stmts);

  // Two touched columns means a card crossed between them; one means it was
  // reordered in place. That distinction is the whole drag interaction, so
  // it is worth naming in the log rather than leaving to be inferred.
  const touched = Object.keys(columns);
  const kind = touched.length === 0
    ? "columns-only"
    : touched.length > 1
      ? "across-columns"
      : "within-column";
  log("cards.reorder", {
    board: shortId(board.id),
    kind,
    columnsTouched: touched.length,
    cardsPlaced: seen.size,
    columnsResorted: Array.isArray(columnOrder) ? columnOrder.length : 0,
    statements: stmts.length,
  });

  return json({ ok: true, updated: stmts.length });
}

/* ----------------------------------------------------------------- utils */

async function ownedBoard(env, user, boardId) {
  return env.DB.prepare(
    "SELECT id, name FROM boards WHERE id = ?1 AND user_id = ?2",
  )
    .bind(boardId, user)
    .first();
}

async function ownedColumn(env, user, columnId) {
  return env.DB.prepare(
    "SELECT c.id, c.board_id, c.name FROM board_columns c" +
      " JOIN boards b ON b.id = c.board_id" +
      " WHERE c.id = ?1 AND b.user_id = ?2",
  )
    .bind(columnId, user)
    .first();
}

async function ownedCard(env, user, cardId) {
  return env.DB.prepare(
    "SELECT k.id, k.board_id, k.column_id, k.title, k.body FROM cards k" +
      " JOIN boards b ON b.id = k.board_id" +
      " WHERE k.id = ?1 AND b.user_id = ?2",
  )
    .bind(cardId, user)
    .first();
}

async function readJSON(request) {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function text(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function methodNotAllowed() {
  return json({ error: "method not allowed" }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/* ------------------------------------------------------------------ logging */
//
// Read these back with `yard service logs` (add --since 2h).
// Every line starts with [stacks] and is one event, so it greps cleanly:
//   yard service logs | grep 'card.create'
//
// What is deliberately NOT logged: card titles, note bodies, board and column
// names, and emails. Those are the user's content. Ids are truncated to 8
// characters: enough to correlate lines within a session, not enough to be a
// durable identifier sitting in a log store. Sizes are logged as lengths.

function log(event, fields) {
  const parts = ["[stacks] " + event];
  for (const key in fields) {
    const value = fields[key];
    if (value === undefined || value === null) continue;
    parts.push(key + "=" + value);
  }
  console.log(parts.join(" "));
}

function shortId(id) {
  return typeof id === "string" && id ? id.slice(0, 8) : "-";
}

// Otherwise the request line would carry full UUIDs while every domain line
// carries truncated ones. Shortening here keeps the log consistent and lets
// "path=/api/boards/d1f649b5/reorder" line up with "board=d1f649b5".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redactPath(pathname) {
  return pathname
    .split("/")
    .map((segment) => (UUID.test(segment) ? shortId(segment) : segment))
    .join("/");
}

// The database reports affected rows per statement; useful for confirming a cascade.
function changed(result) {
  return (result && result.meta && result.meta.changes) || 0;
}
