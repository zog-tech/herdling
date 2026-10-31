// Runs before the first paint: apply the saved theme, so the page does not flash.
// Without a saved choice, the page follows the system setting (prefers-color-scheme).
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try {
    var saved = localStorage.getItem('hd-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {}
})();
