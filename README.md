<a href="https://nathanl1736.github.io/Simple-Calories-Ledger/" target="_blank" rel="noopener noreferrer">
  Open Calorie Tracker App
</a>

## Development

This app is now a React + Vite PWA. User data remains local-first in the existing IndexedDB store:

- database: `calorie-tracker-db`
- object store: `kv`
- key: `state`

Useful commands:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run preview
npm.cmd test
```

`npm test` checks the weekly calorie bank maths in `tests/` and needs Node 22.6 or newer.

The GitHub Pages base path is configured as `/Simple-Calories-Ledger/` in `vite.config.ts`.
