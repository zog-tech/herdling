// Shared behaviour for every page: theme toggle, header border, scroll reveal, store links,
// the installer command, screenshots, copy buttons and the docs contents highlight.
(function () {
  'use strict';
  var root = document.documentElement;
  var config = window.HERDLING_CONFIG || {};
  function all(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  // Theme toggle: switch to the opposite of what shows now, and remember it.
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function current() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return dark && dark.matches ? 'dark' : 'light';
  }
  all('[data-theme-toggle]', function (btn) {
    function label() { btn.setAttribute('aria-label', current() === 'dark' ? 'Use light appearance' : 'Use dark appearance'); }
    label();
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('hd-theme', next); } catch (e) {}
      label();
    });
  });

  // Header: show the hairline only after the page scrolls.
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Reveal sections as they come into view. Without IntersectionObserver, show all.
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
  }

  // Store links. Defaults in the HTML: "coming soon" and /download.
  function store(kind, url) {
    if (!url) return;
    all('[data-store="' + kind + '"]', function (a) { a.href = url; a.removeAttribute('aria-disabled'); });
    all('[data-when="' + kind + '-soon"]', function (el) { el.hidden = true; });
    all('[data-when="' + kind + '-ready"]', function (el) { el.hidden = false; });
  }
  store('ios', config.appStoreUrl);
  if (!config.appStoreUrl && config.testFlightUrl) {
    all('[data-store="testflight"]', function (a) { a.href = config.testFlightUrl; a.hidden = false; });
    all('[data-when="testflight"]', function (el) { el.hidden = false; });
  }
  store('android', config.playUrl);

  // The herdlingd installer: the command text lives in config.js.
  var inst = config.installer || {};
  if (inst.command) all('[data-installer-command]', function (el) { el.textContent = inst.command; });
  if (inst.ready) {
    all('[data-when="installer-soon"]', function (el) { el.hidden = true; });
    all('[data-when="installer-ready"]', function (el) { el.hidden = false; });
    all('.code.soon', function (el) { el.classList.remove('soon'); });
  }

  // Screenshots: replace a drawn placeholder with the real image when its slot is listed.
  var shots = config.screenshots || [];
  all('[data-shot]', function (el) {
    var slot = el.getAttribute('data-shot');
    if (shots.indexOf(slot) < 0) return;
    var img = document.createElement('img');
    img.src = '/img/' + slot + '-720.webp';
    img.srcset = '/img/' + slot + '-360.webp 360w, /img/' + slot + '-720.webp 720w';
    img.sizes = el.getAttribute('data-sizes') || '300px';
    img.width = 360;
    img.height = 782;
    img.alt = el.getAttribute('aria-label') || '';
    img.decoding = 'async';
    if (!el.hasAttribute('data-eager')) img.loading = 'lazy';
    el.replaceWith(img);
  });

  // Copy buttons on code blocks.
  if (navigator.clipboard) {
    all('.code', function (box) {
      var pre = box.querySelector('pre');
      if (!pre) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy the command');
      btn.addEventListener('click', function () {
        var text = pre.innerText.split('\n').filter(function (l) { return l.trim().indexOf('#') !== 0; }).join('\n').trim();
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = 'Copied';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
        });
      });
      box.appendChild(btn);
    });
  }

  // Docs: mark the section that is in view in the contents list.
  var links = document.querySelectorAll('.docs-nav a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    Array.prototype.forEach.call(links, function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Array.prototype.forEach.call(links, function (a) { a.removeAttribute('aria-current'); });
        var a = byId[e.target.id];
        if (a) a.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }
})();
