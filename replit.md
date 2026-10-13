# DFSift — DFS Dashboard

A personal, dark multi-sport dashboard with daily slates, available game totals, news, and sourced fantasy projections. The web app can be installed on desktop, laptop, and mobile devices.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server through its managed workflow
- `pnpm --filter @workspace/dfs-dashboard run dev` — run the dashboard through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The DFS dashboard uses public ESPN feeds and does not require a Yahoo connection or API key.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: React + Vite + Tailwind CSS
- Available DB package: PostgreSQL + Drizzle ORM; the DFS feed currently does not use it
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/dfs-dashboard/src/pages/dashboard.tsx` — dashboard and install interaction
- `artifacts/dfs-dashboard/public/` — PWA manifest, service worker, and app icons
- `artifacts/api-server/src/routes/dfs.ts` — public sports-feed adapter and coverage reporting
- `lib/api-spec/openapi.yaml` — API contracts; run codegen after changes

## Architecture decisions

- A PWA was chosen to meet the user's desktop, laptop, and phone installation request with one app. This is browser installation, not a native `.exe` or App Store package.
- Fantasy forecasts must remain explicit about scoring and horizon. ESPN default fantasy scoring is not DraftKings/FanDuel scoring, and season forecasts must not be presented as single-game projections.
- Projection colors compare only players sharing a sport, forecast basis, and source. They are relative-point ranks, not confidence or value ratings, to avoid misleading season-vs-daily comparisons.
- Source gaps are intentional empty states, not placeholders: never invent projections, totals, or salaries when the feed does not supply them.

## Product

- Date selection and filtering across NFL, NHL, WNBA, NBA, MLB, NASCAR, and college football
- Event slate with available totals/spreads; recent ESPN news and supported fantasy outlooks
- Player projections with scoring-period/season labels and coverage messages
- CSV exports and desktop/mobile installation help

## User preferences

- The user wants a dark theme and information for all seven sports listed above.
- The app name should be short and clearly DFS-related.
- The user wants the dashboard available on their desktop, laptop, and mobile phone.
- Sports must stay separate in individual tabs, not an all-sports feed. The news section must scroll independently.
- Player projections should be a compact, color-coded grid like the user's reference.

## Gotchas

- PWA registration is production-only. The installation flow is intended for the published HTTPS app opened directly in a browser, not an embedded preview.
- ESPN public feed coverage can change. Current projection gaps include WNBA, NASCAR, and CFB; NBA coverage is unavailable when no source forecasts are returned.
- The backend caches feed data for up to five minutes. Do not auto-refresh faster than five minutes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
