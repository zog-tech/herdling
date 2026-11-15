/**
 * The HTML page of the terminal web view: xterm.js, its addons and the app font, all inline, so the
 * page works offline and loads nothing from the network. The page script is small on purpose: the
 * rules live in `bridge.ts`, `layout.ts` and `search.ts` (tested in Jest). The page only runs the
 * messages from the app and reports what it measures.
 *
 * The page never types into the pane: xterm.js `onData` is not connected, the input is off
 * (`disableStdin`), the hidden text area cannot take the keyboard, and a layer over the terminal
 * takes every touch.
 */
import type { XtermAssets } from "./assets";

/**
 * The page code. Messages from the app (`ToWeb` in `bridge.ts`) arrive as JSON strings; the page
 * answers with `FromWeb` messages through `ReactNativeWebView.postMessage`.
 */
export const PAGE_SCRIPT = String.raw`
(function () {
  "use strict";
  var bridge = window.ReactNativeWebView;
  function post(m) { if (bridge) bridge.postMessage(JSON.stringify(m)); }
  window.onerror = function (msg) { post({ type: "error", message: String(msg) }); };

  var term = null, search = null, epoch = -1, fontSize = 12, longTimer = 0, reportTimer = 0;
  var last = { alternate: null, atBottom: null };
  var wrap = document.getElementById("wrap");
  var host = document.getElementById("term");
  var touch = document.getElementById("touch");

  function cell() {
    try {
      var c = term._core._renderService.dimensions.css.cell;
      if (c && c.width > 0 && c.height > 0) return { w: c.width, h: c.height };
    } catch (e) {}
    var s = document.createElement("span");
    s.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-family:" + term.options.fontFamily + ";font-size:" + fontSize + "px";
    s.textContent = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW";
    document.body.appendChild(s);
    var r = { w: s.offsetWidth / 32, h: s.offsetHeight };
    document.body.removeChild(s);
    return r;
  }

  function size() {
    var c = cell();
    host.style.width = Math.ceil(term.cols * c.w) + "px";
    host.style.height = Math.ceil(term.rows * c.h) + "px";
    return c;
  }

  function metrics() {
    var c = size();
    post({ type: "metrics", cellWidth: c.w, cellHeight: c.h, fontSize: fontSize, width: window.innerWidth, height: window.innerHeight });
  }

  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(function () {
      reportTimer = 0;
      var b = term.buffer.active;
      var now = { alternate: b.type === "alternate", atBottom: b.viewportY >= b.baseY };
      if (now.alternate !== last.alternate || now.atBottom !== last.atBottom) {
        last = now;
        post({ type: "buffer", alternate: now.alternate, atBottom: now.atBottom });
      }
    }, 100);
  }

  function bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toEnd() {
    term.scrollToBottom();
    wrap.scrollTop = wrap.scrollHeight;
  }

  function plainText() {
    var b = term.buffer.active, lines = [];
    for (var i = 0; i < b.length; i++) {
      var l = b.getLine(i);
      lines.push(l ? l.translateToString(true) : "");
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join("\n");
  }

  function handle(m) {
    switch (m.type) {
      case "reset":
        epoch = m.e;
        term.reset();
        term.resize(m.cols, m.rows);
        // xterm.js shows the cursor only after focus or input, and this page never takes either.
        try { term._core._showCursor(); } catch (e) {}
        metrics();
        toEnd();
        break;
      case "data":
        if (m.e === epoch) term.write(bytes(m.b64));
        break;
      case "resize":
        if (m.e !== epoch) break;
        term.resize(m.cols, m.rows);
        metrics();
        toEnd();
        break;
      case "theme":
        term.options.theme = m.theme;
        document.body.style.background = m.theme.background;
        break;
      case "font":
        if (m.size === fontSize) break;
        fontSize = m.size;
        term.options.fontSize = m.size;
        setTimeout(metrics, 0);
        break;
      case "search":
        if (m.dir === "clear" || !m.term) { search.clearDecorations(); term.clearSelection(); post({ type: "search", index: -1, count: 0 }); break; }
        var opts = { decorations: m.decorations };
        if (m.dir === "next") search.findNext(m.term, opts); else search.findPrevious(m.term, opts);
        break;
      case "scrollToBottom":
        toEnd();
        break;
      case "scrollPages":
        term.scrollPages(m.n);
        break;
    }
  }

  function onMessage(ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m && typeof m.type === "string" && term) handle(m);
  }
  window.addEventListener("message", onMessage);
  document.addEventListener("message", onMessage);

  // Touch: the layer over the terminal takes every touch. A vertical drag scrolls the buffer, a
  // sideways drag scrolls the page, a tap and a long press go to the app.
  var t0 = null, axis = null, accY = 0, velocity = 0, lastMove = 0, glide = 0;
  function scrollBy(dy) {
    var h = cell().h;
    accY += dy;
    var n = Math.trunc(accY / h);
    if (n !== 0) {
      var b = term.buffer.active, before = b.viewportY;
      term.scrollLines(-n);
      accY -= n * h;
      // The buffer is at its end: the page scrolls (a grid taller than the view).
      if (b.viewportY === before) wrap.scrollTop -= n * h;
    }
  }
  touch.addEventListener("touchstart", function (e) {
    var p = e.touches[0];
    cancelAnimationFrame(glide);
    t0 = { x: p.clientX, y: p.clientY, lx: p.clientX, ly: p.clientY, at: Date.now() };
    axis = null; accY = 0; velocity = 0;
    clearTimeout(longTimer);
    longTimer = setTimeout(function () { if (t0 && !axis) { t0 = null; post({ type: "text", text: plainText() }); } }, 500);
  }, { passive: false });
  touch.addEventListener("touchmove", function (e) {
    e.preventDefault();
    if (!t0) return;
    var p = e.touches[0], dx = p.clientX - t0.lx, dy = p.clientY - t0.ly;
    if (!axis && (Math.abs(p.clientX - t0.x) > 6 || Math.abs(p.clientY - t0.y) > 6)) {
      axis = Math.abs(p.clientX - t0.x) > Math.abs(p.clientY - t0.y) ? "x" : "y";
      clearTimeout(longTimer);
    }
    var now = Date.now();
    if (axis === "y") { scrollBy(dy); velocity = dy / Math.max(1, now - lastMove); }
    if (axis === "x") wrap.scrollLeft -= dx;
    lastMove = now;
    t0.lx = p.clientX; t0.ly = p.clientY;
  }, { passive: false });
  touch.addEventListener("touchend", function () {
    clearTimeout(longTimer);
    if (t0 && !axis && Date.now() - t0.at < 500) post({ type: "tap" });
    if (axis === "y" && Math.abs(velocity) > 0.2) {
      var v = velocity * 16;
      var step = function () {
        scrollBy(v);
        v *= 0.95;
        if (Math.abs(v) > 0.5) glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    }
    t0 = null;
  });
  touch.addEventListener("wheel", function (e) {
    e.preventDefault();
    scrollBy(-e.deltaY);
    wrap.scrollLeft += e.deltaX;
  }, { passive: false });

  function start() {
    term = new Terminal({
      allowProposedApi: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "block",
      cursorInactiveStyle: "block",
      fontFamily: "HerdlingMono, Menlo, monospace",
      fontSize: fontSize,
      scrollback: 5000,
      scrollOnUserInput: false,
      drawBoldTextInBrightColors: false
    });
    var unicode = new Unicode11Addon.Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";
    search = new SearchAddon.SearchAddon();
    term.loadAddon(search);
    search.onDidChangeResults(function (r) { post({ type: "search", index: r.resultIndex, count: r.resultCount }); });
    term.open(host);
    var ta = term.textarea;
    if (ta) {
      ta.setAttribute("inputmode", "none");
      ta.readOnly = true;
      ta.addEventListener("focus", function () { ta.blur(); });
    }
    term.onWriteParsed(report);
    term.onScroll(report);
    window.addEventListener("resize", metrics);
    post({ type: "ready" });
    metrics();
  }

  var fonts = document.fonts ? Promise.all([document.fonts.load("400 12px HerdlingMono"), document.fonts.load("700 12px HerdlingMono")]) : Promise.resolve();
  fonts.then(start, start);
})();
`;

/** The full page, with the assets inline. */
export function xtermHtml(a: XtermAssets, background: string): string {
  const face = (b64: string, weight: number) =>
    `@font-face{font-family:HerdlingMono;font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format("truetype");}`;
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no\">",
    "<style>",
    face(a.fontRegular, 400),
    face(a.fontBold, 700),
    a.css,
    `html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${background};-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}`,
    "#wrap{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden}",
    "#term{position:relative}",
    "#touch{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10;touch-action:none}",
    ".xterm .xterm-viewport{overflow:hidden !important}",
    "</style></head><body>",
    "<div id=\"wrap\"><div id=\"term\"></div></div><div id=\"touch\"></div>",
    `<script>${a.xterm}</script>`,
    `<script>${a.search}</script>`,
    `<script>${a.unicode11}</script>`,
    `<script>${PAGE_SCRIPT}</script>`,
    "</body></html>",
  ].join("\n");
}
