# Design Spec: Enable Cloudflare Workers Cache in AI-Valid

## Goal
Integrate Cloudflare Workers Cache into the **AI-Valid** project to improve performance, reduce latency, and lower CPU/outbound network requests. This includes caching static assets and converting the `/api/audit` endpoint from `POST` to `GET` to enable caching of audit results.

## Proposed Changes

### Configuration
- **Wrangler Configuration**: Modify `wrangler.toml` to enable the Cloudflare Workers Cache feature:
  ```toml
  [cache]
  enabled = true
  ```

### Static Asset Caching
- **Routing & Cache Headers**: Modify `src/index.js` static routes to return real `Cache-Control` headers instead of `no-store, no-cache`:
  - `/style.css`, `/app.client.js`: Capped at `max-age=86400, stale-while-revalidate=604800` (1 day fresh, 7 days stale-while-revalidate).
  - `/` (HTML and Markdown versions): Capped at `max-age=86400, stale-while-revalidate=604800` and include the `Vary: Accept` header to correctly differentiate HTML vs Markdown responses.
  - Other assets (`/favicon.svg`, `/openapi.json`, etc.): Capped at `max-age=86400, stale-while-revalidate=604800`.

### Audit Caching
- **API Endpoint (`src/index.js`)**:
  - Convert route `POST /api/audit` to `GET /api/audit`.
  - Extract the target URL using query parameters (`url.searchParams.get("targetUrl")`) instead of parsing JSON from the request body.
  - Return the header: `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (1 hour fresh, 24 hours stale-while-revalidate).
- **Client Application (`public/app.client.js`)**:
  - Update the fetch request to use `GET` with `targetUrl` passed in the query string: `/api/audit?targetUrl=...`.
- **Unit Tests (`tests/index.test.js`, `tests/ssrf.test.js`)**:
  - Update all tests for `/api/audit` to verify `GET` requests instead of `POST` requests.

## Verification
- Run Vitest unit tests to ensure that all 37 tests continue to pass and correctly cover the new `GET` behavior for the audit endpoint.
- Verify headers of static resources and GET API responses using mock requests in the tests.
