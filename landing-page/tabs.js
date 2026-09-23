// Feature tabs: pick a claim on the left, see it on the right.
// Arrow keys move between tabs, as the ARIA tabs pattern expects.
(function () {
  "use strict";

  var root = document.querySelector("[data-tabs]");
  if (!root) return;

  var tabs = [].slice.call(root.querySelectorAll('[role="tab"]'));

  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      select(tab, false);
    });
    tab.addEventListener("keydown", function (event) {
      var next = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      select(next, true);
    });
  });
})();
