# Real commute time in scoring (`lib/commute.ts`)

Real transit commute time (not map distance) from the user's `commuteAddresses` (up to 2 —
averaged, e.g. both partners' workplaces) to a candidate Kiez, via VBB's live journey planner
(`v6.vbb.transport.rest` — a different domain from the static GTFS files used elsewhere for
`nearest_transit_station`).

Distinct from `src/tools/commute.py`, which solves a different problem: a walkable-catchment-area
polygon for trips **from Brandenburg train stations to a fixed destination** (Alexanderplatz).
This module needs the reverse — an arbitrary user-supplied destination, a real number per
Planungsraum, for scoring.

## How it's used

- `UserPreferences.commuteAddresses` (types.ts) — optional, up to 2, geocoded server-side.
- `FactorWeights.commute` — a normal soft-weighted factor (same tier as price/schools/parks/noise,
  weight 3), zero unless `commuteAddresses` was given. See `commuteScore` / `preferencesToWeights`
  in rank.ts.
- `MAX_COMMUTE_MIN` (60 min, no intake question lets the user pick their own yet) — a hard cutoff,
  same tier as the kita/kidDoctor hard filters. Only relaxed as a last resort if it would otherwise
  leave fewer than 3 results — see `commuteConstraintRelaxed` in the API response, same pattern as
  the existing `distanceConstraintRelaxed`.

## Why this isn't run against all ~540 Planungsräume

VBB rate-limits to roughly 100 req/min (per `src/tools/commute.py`'s own comment) — calling it per
candidate for the whole city would take minutes per ranking request. Instead, `rank.ts` only
live-checks a bounded shortlist: the top 8 candidates per distance tier (near/mid/far) by every
*other* factor's score, ~24 total. The hard cutoff and soft weighting only ever apply within that
shortlist, not the full dataset — a deliberate, documented approximation, not a bug.

Results are cached in-memory per (rounded origin coordinates, plr_id) for the life of the server
process, so repeat requests for the same address are instant. Resets on server restart — this is a
hackathon-scope cache, not meant to survive deploys.

## A live public API with no SLA — designed to degrade, not hang

`v6.vbb.transport.rest` has been observed hanging outright (TLS handshake succeeds, then no
response for 30s+) and also returning fast errors. Two layers guard against this stalling the
whole ranking request:

- Per-request timeout (6s, `AbortController`) + limited retries inside `vbbGet`.
- An overall time budget (15s, `COMMUTE_PHASE_BUDGET_MS` in rank.ts) around the whole
  shortlist-fetch phase — past that, the request returns using whatever commute data arrived in
  time, treating the rest as "unknown" (excluded from that Kiez's weighted average, never
  penalized, never hard-filtered out on missing data). In-flight VBB calls keep running in the
  background and still land in the cache, warming it for the next request.

## Known gap: `v6.vbb.transport.rest` — Node fetch gets a 403, curl doesn't

Same class of discrepancy already documented for `nominatim.openstreetmap.org` in
`app/api/kiez-map/README.md`: a direct `curl` to `v6.vbb.transport.rest` gets past this sandbox's
proxy (TLS handshake succeeds), but every Node `fetch()` call — including the actual running dev
server — gets an explicit `403 Host not in allowlist`, even after the domain was added to the
environment's allowed domains. Reproduce with:

```
node -e "fetch('https://v6.vbb.transport.rest/stops/900100003').then(r=>console.log(r.status))"
```

Because of the timeout/budget design above, this doesn't break the feature — it just means every
Kiez's `commuteMinutes` comes back `null` (unknown) in this sandbox right now, so `commute`
contributes nothing to the score and the hard cutoff never excludes anyone. Verified end-to-end via
`POST /api/rank` with `commuteAddresses` set: returns in ~300ms (not a hang), correct shape,
`commuteConstraintRelaxed: false` (nothing was actually excluded — there was no data to exclude
on). Once this sandbox's proxy allowlist actually takes effect for Node-originated traffic (or
tested outside this sandbox), real minutes should populate without any code change.
