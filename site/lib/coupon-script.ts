import { COUPONS_COPIED, COUPONS_USE } from "../../src/output/copy.js";

/**
 * Inline page script (IIFE source). Shows each card only while now is inside [data-from, data-until),
 * re-checked every minute, toggles the empty state, and copies the code when "Usar" is clicked.
 * The click never calls preventDefault: the link always opens, even if the clipboard fails.
 */
export const COUPON_PAGE_SCRIPT = `(function () {
  var USE = ${JSON.stringify(COUPONS_USE)};
  var COPIED = ${JSON.stringify(COUPONS_COPIED)};
  var cards = Array.prototype.slice.call(document.querySelectorAll("[data-coupon]"));
  var empty = document.getElementById("cupones-empty");

  function refresh() {
    var now = new Date().getTime();
    var visible = 0;
    cards.forEach(function (card) {
      var from = Date.parse(card.dataset.from);
      var until = Date.parse(card.dataset.until);
      var live = now >= from && now < until;
      card.hidden = !live;
      if (live) visible += 1;
    });
    if (empty) empty.hidden = visible > 0;
  }

  function confirmCopy(button) {
    window.posthog?.capture("coupon_code_copied");
    button.textContent = COPIED;
    setTimeout(function () {
      button.textContent = USE;
    }, 2000);
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest("[data-copy]") : null;
    if (!button) return;
    try {
      var clipboard = navigator && navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== "function") return;
      var result = clipboard.writeText(button.dataset.copy);
      if (result && typeof result.then === "function") {
        result.then(function () { confirmCopy(button); }, function () {});
      }
    } catch (error) {}
  });

  refresh();
  setInterval(refresh, 60000);
})();`;
