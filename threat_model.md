# Threat Model

## Project Overview

This repository contains a small production deployment with two reachable surfaces: a static React/Vite web app in `artifacts/dots-and-boxes-3d` served at `/`, and an Express 5 API in `artifacts/api-server` served at `/api`. The API currently exposes only a health check, while the web app is a browser-based 3D game that also loads third-party browser resources. Shared libraries include a PostgreSQL/Drizzle bootstrap package in `lib/db` and a generated fetch client in `lib/api-client-react`.

Production scope for this scan excludes `artifacts/mockup-sandbox`, which is a design/mockup artifact mounted under `/__mockup` and treated as dev-only unless future deployments expose it. TLS for deployed traffic is provided by the platform.

## Assets

- **Integrity of the shipped web application** — users trust the JavaScript and HTML served at `/`. Any unauthorized script execution in that origin can alter gameplay, phish users, or exfiltrate browser-accessible data.
- **API availability and correctness** — even the minimal API should only expose intended routes and should not leak internals through logging or errors.
- **Environment-backed infrastructure secrets** — `DATABASE_URL`, server configuration, and any future API tokens must remain server-only.
- **Future user/session data** — the shared API client and database bootstrap indicate likely future expansion to authenticated or stateful features, so browser trust boundaries should not assume the app will remain low-sensitivity forever.

## Trust Boundaries

- **Browser to static app origin** — users execute whatever JavaScript the app ships. Any third-party script or embedded frame loaded into that page crosses a trust boundary into the application's origin and user experience.
- **Browser to API (`/api`)** — client input crossing into Express must be validated and handled as untrusted.
- **API to database** — the server would hold direct database access through `lib/db`; injection or misuse here would expose the full datastore.
- **Production vs dev-only artifacts** — `artifacts/mockup-sandbox` and related preview helpers are development tooling and should normally be ignored during production scans unless deployment changes make them reachable.

## Scan Anchors

- Production entry points: `artifacts/dots-and-boxes-3d/index.html`, `artifacts/dots-and-boxes-3d/src/main.tsx`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`.
- Highest-risk current area: browser-side third-party integrations in `artifacts/dots-and-boxes-3d/index.html` and `src/MusicPlayer.tsx`.
- Public surfaces: `/` static game and `GET /api/healthz`.
- Dev-only area to usually skip: `artifacts/mockup-sandbox/**`.

## Threat Categories

### Tampering

The main tampering risk in this project is unauthorized modification of the JavaScript that runs in users' browsers. Because the production web app is largely static, any third-party script included in `index.html` has the same ability to manipulate the page as first-party code. The application must only execute browser scripts that are intentionally trusted, pinned, and integrity-protected where feasible.

### Information Disclosure

Current server-side exposure is small, but browser-executed third-party code can still read DOM content, browser storage, and outbound navigation context, then send it off-origin. Server logs must continue to redact authentication and cookie headers, and future API responses must avoid exposing unnecessary data to the client.

### Denial of Service

The current API surface is minimal, but the project should preserve bounded request handling and avoid adding unauthenticated expensive endpoints without rate limiting or timeouts. Browser-side third-party dependencies can also become an availability risk if they block rendering or fail unexpectedly.

### Elevation of Privilege

The current production API does not yet implement authentication or authorization, so classic privilege-separation flaws are not present today. However, the codebase already includes shared auth/token plumbing and direct database bootstrap code; when protected routes are added, authorization must be enforced server-side and database access must remain parameterized and non-user-controlled.
