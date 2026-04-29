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
```

The GitHub Pages base path is configured as `/Simple-Calories-Ledger/` in `vite.config.ts`.
