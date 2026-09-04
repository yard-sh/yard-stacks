// The hero board is genuinely draggable. The argument for a kanban app is a
// card you can actually move, so the board is real rather than a picture.
// Nothing persists: a reload puts the cards back.
(function () {
  "use strict";

  var board = document.getElementById("board");
  if (!board) return;

  var drag = null;

  board.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    var card = event.target.closest(".b-card");
    if (!card) return;

    drag = {
      el: card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      tilt: 0,
      active: false,
      hold: null,
      column: null,
    };

    card.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      // A plain touch should still scroll the page; a hold picks the card up.
      drag.hold = setTimeout(function () {
        if (drag && !drag.active) activate();
      }, 380);
    } else {
      event.preventDefault();
    }

    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
  });

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;

    if (!drag.active) {
      var moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (event.pointerType === "touch") {
        if (moved > 10) {
          clearTimeout(drag.hold);
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
    var el = drag.el;
    var rect = el.getBoundingClientRect();

    drag.active = true;
    drag.grabX = drag.startX - rect.left;
    drag.grabY = drag.startY - rect.top;

    var slot = document.createElement("div");
    slot.className = "b-slot";
    slot.style.height = rect.height + "px";
    el.parentNode.insertBefore(slot, el);
    drag.slot = slot;

    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
    el.style.left = "0";
    el.style.top = "0";
    el.classList.add("is-dragging");
    document.body.classList.add("is-dragging");

    drag.frame = requestAnimationFrame(tick);
  }

  function tick() {
    if (!drag || !drag.active) return;

    // The card leans the way it is thrown.
    var velocity = drag.x - drag.lastX;
    drag.lastX = drag.x;
    var target = Math.max(-2.6, Math.min(2.6, velocity * 0.35));
    drag.tilt += (target - drag.tilt) * 0.2;

    drag.el.style.transform =
      "translate3d(" + (drag.x - drag.grabX) + "px," + (drag.y - drag.grabY) +
      "px,0) rotate(" + drag.tilt.toFixed(2) + "deg)";

    reposition();
    drag.frame = requestAnimationFrame(tick);
  }

  function reposition() {
    var columns = [].slice.call(board.querySelectorAll(".b-col"));
    var column = null;
    var nearestGap = Infinity;

    for (var i = 0; i < columns.length; i++) {
      var r = columns[i].getBoundingClientRect();
      var inside =
        drag.x >= r.left && drag.x <= r.right && drag.y >= r.top && drag.y <= r.bottom;
      if (inside) {
        column = columns[i];
        break;
      }
      var gap = Math.hypot(
        Math.max(r.left - drag.x, 0, drag.x - r.right),
        Math.max(r.top - drag.y, 0, drag.y - r.bottom),
      );
      if (gap < nearestGap) {
        nearestGap = gap;
        column = columns[i];
      }
    }
    if (!column) return;

    var list = column.querySelector(".b-col__cards");
    var cards = [].slice.call(list.querySelectorAll(".b-card:not(.is-dragging)"));

    var ref = null;
    for (var j = 0; j < cards.length; j++) {
      var cr = cards[j].getBoundingClientRect();
      if (drag.y < cr.top + cr.height / 2) {
        ref = cards[j];
        break;
      }
    }

    if (drag.column !== column) {
      if (drag.column) drag.column.classList.remove("is-target");
      column.classList.add("is-target");
      drag.column = column;
    }

    if (drag.slot.parentNode === list && drag.slot.nextElementSibling === ref) {
      return;
    }
    flip(function () {
      list.insertBefore(drag.slot, ref);
    });
  }

  // FLIP: measure, mutate, invert, play, so the gap opens instead of jumping.
  function flip(mutate) {
    var movers = [].slice.call(board.querySelectorAll(".b-card:not(.is-dragging)"));
    var before = movers.map(function (n) {
      return n.getBoundingClientRect();
    });

    mutate();

    var inverted = [];
    movers.forEach(function (node, i) {
      var after = node.getBoundingClientRect();
      var dx = before[i].left - after.left;
      var dy = before[i].top - after.top;
      if (!dx && !dy) return;
      node.style.transition = "none";
      node.style.transform = "translate(" + dx + "px," + dy + "px)";
      inverted.push(node);
    });

    if (!inverted.length) return;
    requestAnimationFrame(function () {
      inverted.forEach(function (node) {
        node.style.transition = "";
        node.style.transform = "";
      });
    });
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearTimeout(drag.hold);

    if (!drag.active) {
      teardown();
      return;
    }

    cancelAnimationFrame(drag.frame);
    var el = drag.el;
    var slot = drag.slot;
    var rest = slot.getBoundingClientRect();

    el.style.transition = "transform .17s cubic-bezier(.2,0,0,1)";
    el.style.transform =
      "translate3d(" + rest.left + "px," + rest.top + "px,0) rotate(0deg)";

    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      el.style.cssText = "";
      el.classList.remove("is-dragging");
      slot.replaceWith(el);
      document.body.classList.remove("is-dragging");
      if (drag && drag.column) drag.column.classList.remove("is-target");
      teardown();
      recount();
    };

    el.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 240);
  }

  function recount() {
    var columns = board.querySelectorAll(".b-col");
    for (var i = 0; i < columns.length; i++) {
      columns[i].querySelector(".b-col__n").textContent =
        columns[i].querySelectorAll(".b-card").length;
    }
  }

  function teardown() {
    if (!drag) return;
    var el = drag.el;
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    if (el.hasPointerCapture && el.hasPointerCapture(drag.pointerId)) {
      el.releasePointerCapture(drag.pointerId);
    }
    if (drag.frame) cancelAnimationFrame(drag.frame);
    drag = null;
  }
})();
