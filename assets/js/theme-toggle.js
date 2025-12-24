/* ==========================================================================
   Theme toggle (light/dark)
   ========================================================================== */

(function() {
  var storageKey = 'site-theme';
  var root = document.documentElement;
  var toggle = document.querySelector('[data-theme-toggle]');
  var systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

  if (!toggle) {
    return;
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(storageKey);
    } catch (e) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch (e) {
      // no-op if storage not available
    }
  }

  function getCurrentTheme() {
    var theme = root.getAttribute('data-theme');
    return theme === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    toggle.setAttribute('aria-pressed', theme === 'dark');
    setStoredTheme(theme);
  }

  function handleSystemChange(event) {
    if (getStoredTheme()) {
      return;
    }
    applyTheme(event.matches ? 'dark' : 'light');
  }

  toggle.addEventListener('click', function() {
    var nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });

  if (systemPrefersDark && systemPrefersDark.addEventListener) {
    systemPrefersDark.addEventListener('change', handleSystemChange);
  }

  applyTheme(getCurrentTheme());
})();

/* ==========================================================================
   Whale background animation seed + continuity
   ========================================================================== */
(function() {
  var root = document.documentElement;
  if (!root) {
    return;
  }

  var seedKey = 'whale-seed';

  function getSeed() {
    try {
      var stored = localStorage.getItem(seedKey);
      if (stored) {
        return stored;
      }
      var created = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(seedKey, created);
      return created;
    } catch (e) {
      return Math.random().toString(36).slice(2, 10);
    }
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function pick(base, span, salt) {
    return base + (hash(salt) % span);
  }

  var seed = getSeed();
  var baseX = pick(8, 40, seed + 'x');   // 8% - 47%
  var baseY = pick(20, 45, seed + 'y');  // 20% - 64%
  var driftX = pick(12, 18, seed + 'dx'); // 12vw - 29vw
  var driftY = pick(4, 7, seed + 'dy');   // 4vh - 10vh
  var duration = pick(45, 20, seed + 't'); // 45s - 64s

  root.style.setProperty('--whale-base-x', baseX + '%');
  root.style.setProperty('--whale-base-y', baseY + '%');
  root.style.setProperty('--whale-drift-x', driftX + 'vw');
  root.style.setProperty('--whale-drift-y', driftY + 'vh');
  root.style.setProperty('--whale-duration', duration + 's');

  var offsetSeconds = (Date.now() / 1000) % duration;
  root.style.setProperty('--whale-offset', offsetSeconds.toFixed(2));
})();
