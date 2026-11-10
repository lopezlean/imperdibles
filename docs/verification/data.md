# Data side verification log

## V0 D1 REST query shape

- Date: 2026-11-10
- Checked: Cloudflare API reference for D1 "Query D1 Database" (developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) and the D1 Worker API `batch()` docs, through the docs index. No live call.
- URL: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query`, header `Authorization: Bearer <token>`.
- Body: `{"sql": "<statement>", "params": [<bound values>]}`. The reference also lists a `batch` array of `{sql, params}` objects on the sibling `raw` endpoint.
- Response: `{"success": true|false, "errors": [{code, message}], "messages": [], "result": [{"success": true, "results": [rows], "meta": {"changes", "last_row_id", "rows_read", "rows_written", ...}}]}`. One `result` entry per statement.
- Atomic multi-statement over REST: not documented for this endpoint. The Worker binding's `batch()` is documented as transactional, the REST endpoint is not stated to be.
- Fallback applied (design decision regardless): every write that must be atomic is a single SQL statement; multi-row writes use `INSERT ... SELECT ... FROM json_each(?)` with one JSON parameter. `SqlClient` sends one statement per request and reads `result[0]` only.
- Fixtures: `fixtures/cloudflare/d1-query-ok.json` and `d1-query-error.json` are written from the documented shape, not recorded from a live call. The error body (`success: false`, `errors[0].message`) is the documented envelope; the exact error code is illustrative.
