# Per-Kiez map (`/api/kiez-map` + `<KiezMap>`)

Real boundary polygon, real POI points (filtered to what the user's intake selected), and geocoded
current/commute address markers — everything shown on one recommended Kiez's map.

## Pieces

- `src/lib/poi-locations.ts` — reads `src/data/poi_locations.json` (built by
  `Kiez Profile Master Table/build_poi_locations.py`: real Kita locations + real OSM
  yoga/kinderarzt/gym/bouldering locations, each point-in-polygon joined to its real `plr_id`).
- `src/lib/geocode.ts`'s `getBoundaryFeature(plrId)` — pulls one Planungsraum's polygon out of the
  bundled 542-feature boundaries file, so a single map request doesn't ship all 5.8MB to the client.
- `app/api/kiez-map/route.ts` — `GET ?plrId=...&categories=kita,n_yoga_studios&currentAddress=...&commuteAddress=...&commuteAddress=...`
  (categories omitted = all; commuteAddress is repeatable, capped at 2). Returns
  `{ plrId, plrName, boundary, pois, current, commutes }`.
- `src/components/KiezMap.tsx` — client component, fetches the route above and renders it with
  `react-leaflet`. **Must be loaded via `next/dynamic` with `ssr: false`** wherever it's used —
  Leaflet touches `window` at import time, and `"use client"` alone only moves hydration to the
  client, it doesn't skip the server-side pre-render of the component's initial HTML:
  ```tsx
  const KiezMap = dynamic(() => import("@/components/KiezMap"), { ssr: false });
  ```
- `src/app/map-test/page.tsx` — an interactive manual-QA harness (not a real app screen): a preset
  dropdown (Helmholtzplatz/Wannsee/Schmöckwitz/Charitéviertel) or free-typed `plr_id`, checkboxes for
  which POI categories to highlight, and optional current/commute address fields, all wired to
  `<KiezMap>`. "Apply" updates the URL query string (`?plrId=...&categories=...&currentAddress=...`)
  so a specific test scenario can be bookmarked or shared. Kept deliberately, not scratch —
  `react-leaflet` is exactly the kind of dependency that typechecks fine and breaks silently at
  runtime (SSR/hydration, missing marker icon assets, etc.), so having a live page to reload is worth
  more here than it would be for an ordinary component.

## Verified, not just typechecked

Screenshotted `/map-test` with Playwright + the pre-installed Chromium: real boundary shape render
correctly, POI markers land in genuinely correct positions and colors, legend only lists categories
actually present. Zero page/console errors from the component itself.

## Tile skin

Base tiles are CARTO Positron (`basemaps.cartocdn.com`), not raw OpenStreetMap tiles — a cleaner,
muted light style that stays out of the way of the boundary/POI colors, closer to the Wurzelraum
brand than the default OSM look. No API key required. Swap `TileLayer`'s `url`/`attribution` in
`KiezMap.tsx` to try alternatives (CARTO Voyager, OpenTopoMap, or a Thunderforest style once you
have a free API key for one closer to a hand-drawn cottagecore look).

## Known gap: one OpenStreetMap domain is blocked in this sandbox

- **`basemaps.cartocdn.com`** (the actual map background imagery) — same class of gap as the old
  `tile.openstreetmap.org`: confirmed blocked via the agent-proxy's own `recentRelayFailures` log
  (`connect_rejected`, policy denial) in this sandbox. The map renders correctly *without* tiles
  (gray background, boundary + markers still fully correct) but needs this domain allowlisted to
  show real street imagery underneath. Not an issue on a real machine outside this sandbox.
- **`nominatim.openstreetmap.org`** (address → coordinates geocoding, used for `currentAddress` /
  `commuteAddress` and also `/api/rank`'s existing `currentAddress` fallback) — this one is stranger:
  a direct `curl` to it returns `200`, but **every Node `fetch()` call to the exact same URL — including
  a brand-new `node -e` process, not just the long-running dev server — gets an explicit `403 Host not
  in allowlist` from the proxy.** Reproduced repeatedly, not a one-off flake. This suggests either the
  domain addition didn't fully apply, or there's a separate allowlist for app/Node-originated traffic
  vs. tool-originated (curl) traffic in this environment. Worth raising if you re-add the domain and
  still see this — `node -e "fetch('https://nominatim.openstreetmap.org/search?q=Berlin&format=json&limit=1').then(r=>console.log(r.status))"`
  is the fastest way to check whether it's actually fixed, since `curl` alone will look successful even
  when the app still can't reach it.

Both are `NEXT_PUBLIC`-free, no API key needed (Nominatim and OSM tiles are free/open) — this is
purely a network-egress-policy gap in this sandbox, not a missing credential.
