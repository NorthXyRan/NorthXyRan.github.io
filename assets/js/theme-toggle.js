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
