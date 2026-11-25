# Stepsmith

Record the steps you take on a website and turn them into a step-by-step
guide with screenshots, kept on your device. A Manifest V3 Chrome extension
by Extension Tools (`dookofcards`).

- **Record:** click "Record this tab", do the task, press Stop. Each click is
  a step with a screenshot, the clicked spot highlighted and an automatic
  caption. Typing becomes "Type in **Email**", never the typed value.
- **Safe:** password, one-time-code and card fields are never read and are
  blurred in screenshots.
- **Private:** guides live in your browser's IndexedDB. The free version makes
  no network requests. Buying Pro contacts ExtensionPay (that is the only
  time).
- **Free:** record, edit, reorder, unlimited guides, HTML export, Markdown copy.
- **Pro (one-time):** PDF export, redact and annotate, auto-blur emails and
  long numbers, branding, Markdown zip with images.

Permissions: `storage`, `scripting`, and an optional "all sites" host
permission requested the first time you record. See `SUBMISSION.md` for the
reason behind each.

## Develop

```sh
npm ci
npm run typecheck && npm test
npm run build            # load dist/ unpacked in chrome://extensions
npm run package && CI=1 xvfb-run --auto-servernum node tools/e2e.mjs
```

See `CLAUDE.md` for the architecture, the release gate and the rules.

Site: https://dookofcards.github.io/stepsmith/ · Support:
https://github.com/dookofcards/stepsmith/issues · MIT (see `LICENSE` and
`NOTICE`).
