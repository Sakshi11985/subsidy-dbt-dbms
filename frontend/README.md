# Frontend (React 19 + Vite + Tailwind 4)

All data comes from the API in `../backend`. In development Vite proxies `/api`
to `http://localhost:4000` (see `vite.config.ts`).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

Set `VITE_API_URL` to point at a different API, e.g. `VITE_API_URL=http://192.168.1.5:4000/api npm run dev`.
