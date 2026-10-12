# External CA signing — server module

Phase 1: CEO-only, QR + Deeplink, PAdES B-LT target. Mock provider works with
zero credentials; VNPT/Viettel adapters are stubs until test accounts arrive.

## Files

- `caConfig.js` — env schema, CEO gating (pure, testable).
- `CaProvider.js` — interface + factory.
- `providers/mockCa.js` — working mock (stateless auto-sign by elapsed time).
- `providers/vnptCa.js` — stub, throws NOT_CONFIGURED/NOT_IMPLEMENTED with TODOs.
- `providers/viettelCa.js` — stub, same contract.
- `caService.js` — Parse persistence (`CaTransaction`) + orchestration.
- `../parsefunction/caFunctions.js` — Cloud Functions: caInitiate/caStatus/caCancel/caComplete/caCallback.
- `../customRoute/customApp.js` — `POST /ca/:provider/callback` webhook.
- `../../cloud/main.js` — registrations.

## Env

See `deploy/.env.example` (CA block). Test accounts only fill
`VNPT_CA_*` / `VIETTEL_CA_*` — no code change. `CaTransaction` class is created
on first save (allowClientClassCreation=false still permits master-key saves).

## Real-CA wiring checklist (when creds arrive)

1. Fill `VNPT_CA_BASE_URL` (= UAT `https://rmgateway.vnptit.vn/sca/sp769`),
   `VNPT_CA_CLIENT_ID/_SECRET` (emailed pair; doubles as sp_id/sp_password
   unless VNPT issues separate `VNPT_CA_SP_ID/_PASSWORD`), `VNPT_CA_USER_ID`
   (CEO CCCD, e.g. `089099014377`), optional `VNPT_CA_SERIAL`.
2. `vnptCa.js` implements QD769 v1 (`get_certificate` -> `sign` ->
   `sign/{id}/status`, webhook §4.4 with sp_id check). Verified live against
   UAT with dummy creds: transport + 401 error mapping + callback verify OK.
3. Remaining for full e2e: approved test cert (order `HNI/LD/261012/00104`
   still pending) + confirm emailed pair works as sp_id/sp_password.
4. PAdES byte-embedding still open: `computeDocHash()` hashes IDs, not PDF
   bytes. When wiring embedding, hash real PDF bytes and replace ONLY it.
