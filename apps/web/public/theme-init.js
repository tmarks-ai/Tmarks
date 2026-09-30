// Pre-paint theme initialization (R5-P3: dark-theme flash on every hard load).
// The React effect in shared/ui-theme.ts runs after hydration; a dark-preference
// user would see a light flash first. CSP script-src 'self' forbids inline
// scripts, so this ships as a self-hosted file referenced from index.html head
// (before the module bundle) and mirrors applyDocumentTheme's class contract.
;(() => {
  try {
    var raw = localStorage.getItem('theme-storage')
    var preference = 'system'
    if (raw) {
      var parsed = JSON.parse(raw)
      if (parsed && parsed.state && typeof parsed.state.preference === 'string') {
        preference = parsed.state.preference
      }
    }
    var resolved =
      preference === 'system'
        ? window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : preference
    var root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.dataset.theme = preference
    root.dataset.resolvedTheme = resolved
  } catch {
    /* any parse/storage failure falls back to the default light render */
  }
})()
