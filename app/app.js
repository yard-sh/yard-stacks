// Stacks — frontend.
//
// Zero dependencies, one module. Every fetch is RELATIVE ("api/boards", not
// "/api/boards"): the app is mounted at /<slug>/app/, so a root-absolute URL
// would resolve against the domain root. Board selection lives in the hash
// for the same reason — pushState to a nested path would break every
// relative URL on the page.

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const boardNameEl = document.getElementById("board-name");
const menuEl = document.getElementById("board-menu");
const menuButton = document.getElementById("board-menu-button");
const accountEl = document.getElementById("account");
const toastEl = document.getElementById("toast");
const sheetEl = document.getElementById("sheet");
const sheetTitle = document.getElementById("sheet-title");
const sheetBody = document.getElementById("sheet-body");
const sheetColumn = document.getElementById("sheet-column");
const sheetMeta = document.getElementById("sheet-meta");
const sheetDelete = document.getElementById("sheet-delete");

const state = {
  boards: [],
  boardId: null,
  board: null,
  composerFor: null, // column id with an open card composer
  openCard: null,
};

/* --------------------------------------------------------------------- api */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const message = (payload && payload.error) || "that didn't save";
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return payload;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message);
    if (err.status === 401) location.reload();
    else await loadBoard(state.boardId);
  }
}

/* ------------------------------------------------------------------ render */

function render() {
  boardEl.textContent = "";

  if (!state.board) {
    boardEl.append(statusEl);
    return;
  }

  for (const column of state.board.columns) {
    boardEl.append(renderColumn(column));
  }

  const add = el("button", "addcolumn", "+  Add column");
  add.addEventListener("click", startColumnComposer);
  boardEl.append(add);
}

function renderColumn(column) {
  const node = el("section", "column");
  node.dataset.id = column.id;

  const head = el("div", "column__head");

  const name = document.createElement("input");
  name.className = "column__name";
  name.value = column.name;
  name.readOnly = true;
  name.maxLength = 80;
  name.setAttribute("aria-label", "Column name");
  name.addEventListener("blur", () => commitColumnName(column, name));
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      name.blur();
    } else if (event.key === "Escape") {
      name.value = column.name;
      name.blur();
    }
  });

  const count = el("span", "column__count", String(column.cards.length));

  const remove = el("button", "iconbutton");
  remove.title = "Delete column";
  remove.setAttribute("aria-label", "Delete " + column.name);
  remove.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  remove.addEventListener("click", () => deleteColumn(column));

  head.append(name, count, remove);

  const list = el("div", "column__cards");
  list.dataset.list = column.id;
  for (const card of column.cards) list.append(renderCard(card, column));

  const foot = el("div", "column__foot");
  if (state.composerFor === column.id) {
    foot.append(cardComposer(column));
  } else {
    const add = el("button", "composer", "+  Add a card");
    add.addEventListener("click", () => {
      state.composerFor = column.id;
      render();
    });
    foot.append(add);
  }

  node.append(head, list, foot);
  return node;
}

function renderCard(card, column) {
  const node = el("article", "card");
  node.dataset.id = card.id;
  node.dataset.columnId = column.id;
  node.tabIndex = 0;
  node.append(el("div", "card__title", card.title));
  if (card.body) node.append(el("div", "card__note", "Notes"));
  node.dataset.body = card.body || "";
  node.dataset.updated = card.updated_at || "";
  return node;
}

function cardComposer(column) {
  const wrap = document.createElement("div");
  const input = document.createElement("textarea");
  input.className = "composer__input";
  input.rows = 2;
  input.maxLength = 200;
  input.placeholder = "What needs doing?";

  const hint = el("div", "composer__hint mono");
  hint.innerHTML =
    "<span><kbd>Enter</kbd> to add</span><span><kbd>Esc</kbd> to close</span>";

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = "";
      guard(() => addCard(column, title));
    } else if (event.key === "Escape") {
      state.composerFor = null;
      render();
    }
  });
  input.addEventListener("blur", () => {
    if (!input.value.trim()) {
      state.composerFor = null;
      render();
    }
  });

  wrap.append(input, hint);
  queueMicrotask(() => input.focus());
  return wrap;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------- loads */

async function loadBoards() {
  state.boards = await api("api/boards");
  const wanted = hashBoardId() || localStorage.getItem("stacks.board");
  const exists = state.boards.some((b) => b.id === wanted);
  state.boardId = exists ? wanted : state.boards[0] && state.boards[0].id;
  renderMenu();
}

async function loadBoard(id) {
  if (!id) return;
  state.boardId = id;
  localStorage.setItem("stacks.board", id);
  if (hashBoardId() !== id) location.hash = "board=" + id;
  const data = await api("api/boards/" + id);
  state.board = data;
  boardNameEl.textContent = data.board.name;
  document.title = data.board.name + " · Stacks";
  render();
  renderMenu();
}

function hashBoardId() {
  const match = /board=([\w-]+)/.exec(location.hash);
  return match ? match[1] : null;
}

/* -------------------------------------------------------------------- menu */

function renderMenu() {
  menuEl.textContent = "";

  for (const board of state.boards) {
    const item = el("button", "menu__item");
    item.append(el("span", null, board.name));
    if (board.id === state.boardId) {
      item.setAttribute("aria-current", "true");
      item.append(el("span", "menu__count mono", "open"));
    }
    item.addEventListener("click", () => {
      closeMenu();
      guard(() => loadBoard(board.id));
    });
    menuEl.append(item);
  }

  menuEl.append(el("div", "menu__rule"));

  const create = el("button", "menu__item", "New board");
  create.addEventListener("click", () => {
    closeMenu();
    const name = prompt("Name your board", "Untitled board");
    if (name && name.trim()) {
      guard(async () => {
        const board = await api("api/boards", {
          method: "POST",
          body: JSON.stringify({ name: name.trim() }),
        });
        await loadBoards();
        await loadBoard(board.id);
      });
    }
  });

  const rename = el("button", "menu__item", "Rename this board");
  rename.addEventListener("click", () => {
    closeMenu();
    const current = state.board ? state.board.board.name : "";
    const name = prompt("Rename board", current);
    if (name && name.trim() && name.trim() !== current) {
      guard(async () => {
        await api("api/boards/" + state.boardId, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim() }),
        });
        await loadBoards();
        await loadBoard(state.boardId);
      });
    }
  });

  const remove = el("button", "menu__item", "Delete this board");
  remove.addEventListener("click", () => {
    closeMenu();
    if (state.boards.length < 2) {
      toast("Keep at least one board");
      return;
    }
    if (!confirm("Delete this board and everything on it?")) return;
    guard(async () => {
      await api("api/boards/" + state.boardId, { method: "DELETE" });
      state.board = null;
      await loadBoards();
      await loadBoard(state.boardId);
    });
  });

  menuEl.append(create, rename, remove);
}

function closeMenu() {
  menuEl.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
}

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = menuEl.hidden;
  menuEl.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", (event) => {
  if (!menuEl.hidden && !menuEl.contains(event.target)) closeMenu();
});

/* ------------------------------------------------------------------ writes */

async function addCard(column, title) {
  const card = await api("api/columns/" + column.id + "/cards", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  column.cards.push({ ...card, body: "" });
  state.composerFor = column.id;
  render();
}

async function commitColumnName(column, input) {
  const name = input.value.trim();
  input.readOnly = true;
  if (!name || name === column.name) {
    input.value = column.name;
    return;
  }
  column.name = name;
  await guard(() =>
    api("api/columns/" + column.id, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  );
}

function deleteColumn(column) {
  const count = column.cards.length;
  const message = count
    ? `Delete "${column.name}" and its ${count} card${count === 1 ? "" : "s"}?`
    : `Delete "${column.name}"?`;
  if (!confirm(message)) return;
  guard(async () => {
    await api("api/columns/" + column.id, { method: "DELETE" });
    state.board.columns = state.board.columns.filter((c) => c.id !== column.id);
    render();
  });
}

function startColumnComposer() {
  const name = prompt("Name your column", "");
  if (!name || !name.trim()) return;
  guard(async () => {
    const column = await api("api/boards/" + state.boardId + "/columns", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    state.board.columns.push({ ...column, cards: [] });
    render();
    boardEl.scrollLeft = boardEl.scrollWidth;
  });
}

/* ------------------------------------------------------------------- sheet */

function openCard(cardEl) {
  const id = cardEl.dataset.id;
  const column = state.board.columns.find((c) => c.id === cardEl.dataset.columnId);
  const card = column && column.cards.find((c) => c.id === id);
  if (!card) return;

  state.openCard = { card, column };
  sheetColumn.textContent = column.name;
  sheetTitle.value = card.title;
  sheetBody.value = card.body || "";
  sheetMeta.textContent = card.updated_at ? "Edited " + ago(card.updated_at) : "";
  sheetEl.hidden = false;
  autosize(sheetTitle);
  queueMicrotask(() => sheetTitle.focus());
}

function closeSheet() {
  if (sheetEl.hidden) return;
  const open = state.openCard;
  sheetEl.hidden = true;
  state.openCard = null;
  if (!open) return;

  const title = sheetTitle.value.trim();
  const body = sheetBody.value.trim();
  if (!title || (title === open.card.title && body === (open.card.body || ""))) {
    return;
  }
  open.card.title = title;
  open.card.body = body;
  render();
  guard(() =>
    api("api/cards/" + open.card.id, {
      method: "PATCH",
      body: JSON.stringify({ title, body }),
    }),
  );
}

sheetEl.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) closeSheet();
});

sheetDelete.addEventListener("click", () => {
  const open = state.openCard;
  if (!open) return;
  sheetEl.hidden = true;
  state.openCard = null;
  open.column.cards = open.column.cards.filter((c) => c.id !== open.card.id);
  render();
  guard(() => api("api/cards/" + open.card.id, { method: "DELETE" }));
});

sheetTitle.addEventListener("input", () => autosize(sheetTitle));
sheetTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    closeSheet();
  }
});

function autosize(node) {
  node.style.height = "auto";
  node.style.height = node.scrollHeight + "px";
}

function ago(stamp) {
  const then = new Date(stamp.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + "h ago";
  return Math.round(hours / 24) + "d ago";
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!sheetEl.hidden) closeSheet();
  else if (!menuEl.hidden) closeMenu();
});

/* -------------------------------------------------------------------- drag */
//
// Pointer Events, not HTML5 drag-and-drop: HTML5 DnD has no touch support and
// an unstylable drag image. The dragged element becomes a fixed-position ghost
// that tilts into its direction of travel; a placeholder holds its slot, and
// every other card FLIPs to its new position so the gap opens smoothly.

let drag = null;

boardEl.addEventListener("pointerdown", onPointerDown);

function onPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (event.target.closest("button, textarea, a")) return;
  // A column name is an input, but it is also the column's drag handle: the
  // pointer only means "edit" once the field is already unlocked.
  const isName = event.target.classList.contains("column__name");
  if (event.target.matches("input") && !isName) return;
  if (isName && !event.target.readOnly) return;

  const cardEl = event.target.closest(".card");
  const headEl = event.target.closest(".column__head");
  const kind = cardEl ? "card" : headEl ? "column" : null;
  if (!kind) return;

  const el = kind === "card" ? cardEl : headEl.closest(".column");
  if (!el) return;

  drag = {
    kind,
    el,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    tilt: 0,
    active: false,
    cancelled: false,
    holdTimer: null,
    sourceColumnId: kind === "card" ? cardEl.dataset.columnId : null,
    // Pointer capture retargets pointerup to the capturing element, so the
    // only reliable record of what was grabbed is taken here, at pointerdown.
    nameInput: isName ? event.target : null,
  };

  el.setPointerCapture(event.pointerId);

  if (event.pointerType === "touch") {
    // Let a plain touch scroll the column; only a deliberate hold picks up.
    drag.holdTimer = setTimeout(() => {
      if (drag && !drag.cancelled) activate();
    }, 380);
  } else {
    event.preventDefault();
  }

  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;

  if (!drag.active) {
    const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
    if (event.pointerType === "touch") {
      if (moved > 10) {
        // Scrolling, not dragging.
        drag.cancelled = true;
        clearTimeout(drag.holdTimer);
        teardown();
      }
      return;
    }
    if (moved > 4) activate();
    return;
  }

  event.preventDefault();
}

function activate() {
  const { el, kind } = drag;
  const rect = el.getBoundingClientRect();

  drag.active = true;
  drag.grabX = drag.startX - rect.left;
  drag.grabY = drag.startY - rect.top;

  const placeholder = el.ownerDocument.createElement("div");
  placeholder.className =
    kind === "card" ? "placeholder" : "placeholder placeholder--column";
  placeholder.style.height = rect.height + "px";
  placeholder.style.width = rect.width + "px";
  el.parentNode.insertBefore(placeholder, el);
  drag.placeholder = placeholder;

  el.style.width = rect.width + "px";
  el.style.height = rect.height + "px";
  el.style.left = "0";
  el.style.top = "0";
  el.classList.add(kind === "card" ? "is-dragging" : "is-dragging-column");
  document.body.classList.add("is-dragging");

  drag.frame = requestAnimationFrame(tick);
}

function tick() {
  if (!drag || !drag.active) return;

  // Tilt tracks horizontal velocity — the card leans the way it is thrown.
  const velocity = drag.x - drag.lastX;
  drag.lastX = drag.x;
  drag.tilt += (clamp(velocity * 0.35, -2.6, 2.6) - drag.tilt) * 0.2;

  drag.el.style.transform =
    "translate3d(" +
    (drag.x - drag.grabX) +
    "px," +
    (drag.y - drag.grabY) +
    "px,0) rotate(" +
    drag.tilt.toFixed(2) +
    "deg)";

  autoScroll();
  reposition();

  drag.frame = requestAnimationFrame(tick);
}

function autoScroll() {
  const edge = 80;
  const rect = boardEl.getBoundingClientRect();
  if (drag.x < rect.left + edge) boardEl.scrollLeft -= 16;
  else if (drag.x > rect.right - edge) boardEl.scrollLeft += 16;

  if (drag.kind === "card" && drag.list) {
    const listRect = drag.list.getBoundingClientRect();
    if (drag.y < listRect.top + 44) drag.list.scrollTop -= 12;
    else if (drag.y > listRect.bottom - 44) drag.list.scrollTop += 12;
  }
}

function reposition() {
  if (drag.kind === "card") repositionCard();
  else repositionColumn();
}

function repositionCard() {
  const column = columnAt(drag.x);
  if (!column) return;

  const list = column.querySelector(".column__cards");
  const cards = [...list.querySelectorAll(".card:not(.is-dragging)")];

  let ref = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (drag.y < rect.top + rect.height / 2) {
      ref = card;
      break;
    }
  }

  if (drag.list !== list) {
    if (drag.column) drag.column.classList.remove("is-target");
    column.classList.add("is-target");
    drag.column = column;
    drag.list = list;
  }

  if (drag.placeholder.parentNode === list && drag.placeholder.nextElementSibling === ref) {
    return;
  }
  flip(() => list.insertBefore(drag.placeholder, ref));
}

function repositionColumn() {
  const columns = [...boardEl.querySelectorAll(".column:not(.is-dragging-column)")];
  let ref = null;
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    if (drag.x < rect.left + rect.width / 2) {
      ref = column;
      break;
    }
  }
  if (!ref) ref = boardEl.querySelector(".addcolumn");
  if (drag.placeholder.nextElementSibling === ref) return;
  flip(() => boardEl.insertBefore(drag.placeholder, ref));
}

function columnAt(x) {
  const columns = [...boardEl.querySelectorAll(".column")];
  if (!columns.length) return null;

  let nearest = null;
  let nearestGap = Infinity;
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right) return column;
    const gap = x < rect.left ? rect.left - x : x - rect.right;
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = column;
    }
  }
  return nearest;
}

// FLIP: measure, mutate, invert, play. Without it the gap would jump.
function flip(mutate) {
  const movers = [
    ...boardEl.querySelectorAll(".card:not(.is-dragging), .column:not(.is-dragging-column)"),
  ];
  const before = movers.map((node) => node.getBoundingClientRect());

  mutate();

  const inverted = [];
  movers.forEach((node, i) => {
    const after = node.getBoundingClientRect();
    const dx = before[i].left - after.left;
    const dy = before[i].top - after.top;
    if (!dx && !dy) return;
    node.style.transition = "none";
    node.style.transform = "translate(" + dx + "px," + dy + "px)";
    inverted.push(node);
  });

  if (!inverted.length) return;
  requestAnimationFrame(() => {
    for (const node of inverted) {
      node.style.transition = "";
      node.style.transform = "";
    }
  });
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  clearTimeout(drag.holdTimer);

  if (!drag.active) {
    const tapped = !drag.cancelled;
    const kind = drag.kind;
    const el = drag.el;
    const nameInput = drag.nameInput;
    teardown();
    if (!tapped) return;
    if (kind === "card") openCard(el);
    else if (nameInput) {
      nameInput.readOnly = false;
      nameInput.focus();
      nameInput.select();
    }
    return;
  }

  cancelAnimationFrame(drag.frame);
  const { el, placeholder, kind } = drag;
  const target = placeholder.getBoundingClientRect();

  // Settle: glide the ghost into the slot it will occupy.
  el.style.transition = "transform .17s cubic-bezier(.2,0,0,1)";
  el.style.transform =
    "translate3d(" + target.left + "px," + target.top + "px,0) rotate(0deg)";

  const finish = () => {
    el.style.cssText = "";
    el.classList.remove("is-dragging", "is-dragging-column");
    placeholder.replaceWith(el);
    document.body.classList.remove("is-dragging");
    if (drag && drag.column) drag.column.classList.remove("is-target");
    const payload = kind === "card" ? cardPayload() : columnPayload();
    teardown();
    syncModelFromDOM();
    persist(payload);
  };

  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(() => {
    if (el.classList.contains("is-dragging") || el.classList.contains("is-dragging-column")) {
      finish();
    }
  }, 240);
}

function cardPayload() {
  const columns = {};
  const touched = new Set([drag.sourceColumnId]);
  // The placeholder is already gone by now — read the card's new home.
  const landed = drag.el.closest(".column");
  if (landed) touched.add(landed.dataset.id);

  for (const id of touched) {
    const column = boardEl.querySelector('.column[data-id="' + id + '"]');
    if (!column) continue;
    columns[id] = [...column.querySelectorAll(".card")].map((c) => c.dataset.id);
  }
  return { columns };
}

function columnPayload() {
  return {
    columnOrder: [...boardEl.querySelectorAll(".column")].map((c) => c.dataset.id),
  };
}

// The DOM is the source of truth right after a drag; fold it back into state
// so the next render doesn't undo the move.
function syncModelFromDOM() {
  if (!state.board) return;
  const byId = new Map();
  for (const column of state.board.columns) {
    for (const card of column.cards) byId.set(card.id, card);
  }

  const columns = [];
  for (const columnEl of boardEl.querySelectorAll(".column")) {
    const existing = state.board.columns.find((c) => c.id === columnEl.dataset.id);
    if (!existing) continue;
    existing.cards = [...columnEl.querySelectorAll(".card")]
      .map((cardEl) => {
        const card = byId.get(cardEl.dataset.id);
        if (card) cardEl.dataset.columnId = columnEl.dataset.id;
        return card;
      })
      .filter(Boolean);
    columns.push(existing);
  }
  state.board.columns = columns;
  render();
}

function persist(payload) {
  guard(() =>
    api("api/boards/" + state.boardId + "/reorder", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
}

function teardown() {
  if (!drag) return;
  const { el, pointerId } = drag;
  el.removeEventListener("pointermove", onPointerMove);
  el.removeEventListener("pointerup", onPointerUp);
  el.removeEventListener("pointercancel", onPointerUp);
  if (el.hasPointerCapture && el.hasPointerCapture(pointerId)) {
    el.releasePointerCapture(pointerId);
  }
  if (drag.frame) cancelAnimationFrame(drag.frame);
  drag = null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ---------------------------------------------------------------- keyboard */
// Drag is not the only way to move a card.

boardEl.addEventListener("keydown", (event) => {
  const cardEl = event.target.closest(".card");
  if (!cardEl) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openCard(cardEl);
    return;
  }

  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step || !(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();

  const columns = state.board.columns;
  const from = columns.findIndex((c) => c.id === cardEl.dataset.columnId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= columns.length) return;

  const card = columns[from].cards.find((c) => c.id === cardEl.dataset.id);
  if (!card) return;
  columns[from].cards = columns[from].cards.filter((c) => c.id !== card.id);
  columns[to].cards.push(card);
  render();

  const moved = boardEl.querySelector('.card[data-id="' + card.id + '"]');
  if (moved) moved.focus();

  persist({
    columns: {
      [columns[from].id]: columns[from].cards.map((c) => c.id),
      [columns[to].id]: columns[to].cards.map((c) => c.id),
    },
  });
});

/* ------------------------------------------------------------------ chrome */

document.getElementById("theme-toggle").addEventListener("click", () => {
  const dark =
    document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("stacks.theme", next);
  } catch {}
});

// __yard/auth/me is answered by the Yard edge — no backend code needed.
// It does not exist under local wrangler dev, so this must fail soft.
async function renderAccount() {
  const me = await fetch("__yard/auth/me")
    .then((r) => r.json())
    .catch(() => null);

  accountEl.textContent = "";
  if (!me || !me.authenticated) return;

  if (me.email) accountEl.append(el("span", "account__email", me.email));
  const out = document.createElement("a");
  out.href = "__yard/auth/logout";
  out.textContent = "Sign out";
  accountEl.append(out);
}

window.addEventListener("hashchange", () => {
  const id = hashBoardId();
  if (id && id !== state.boardId) guard(() => loadBoard(id));
});

async function main() {
  renderAccount();
  try {
    await loadBoards();
    if (!state.boardId) {
      statusEl.textContent = "No boards yet";
      return;
    }
    await loadBoard(state.boardId);
  } catch (err) {
    statusEl.textContent =
      err.status === 401 ? "Sign in to use Stacks" : "Could not load your boards";
  }
}

main();
