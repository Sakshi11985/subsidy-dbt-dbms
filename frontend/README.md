# Frontend (React 19 + Next.js 16 + Tailwind 4)

All data comes from the API in `../backend`. Next.js forwards every `/api/...`
request to `http://localhost:4000` (see the `rewrites` in `next.config.mjs`).

- `src/app/layout.tsx` – page shell, title, global CSS
- `src/app/page.tsx` – the `/` route; renders the React app in `src/App.tsx`
- `src/components/` – the role desks (Citizen, Verifier, Approval & Payment, Vigilance)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into .next/
```

Set `API_URL` to point at a different API, e.g. `API_URL=http://192.168.1.5:4000 npm run dev`.
