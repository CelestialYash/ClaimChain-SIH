# Fonts

Place the licensed font files here:

- `tt-norms-pro-regular.woff2` (weight 400)
- `tt-norms-pro-semibold.woff2` (weight 600)

They are loaded by `src/index.css` via `@font-face` with `font-display: swap`.
Until the files are present, the UI falls back to `Inter` (loaded from Google
Fonts in `index.html`), so the app works without them.
