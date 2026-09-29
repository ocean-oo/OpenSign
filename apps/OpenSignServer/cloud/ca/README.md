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

1. Fill `*_BASE_URL/_CLIENT_ID/_CLIENT_SECRET/_CALLBACK_URL`, whitelist the callback URL in the partner portal.
2. Map `createTransaction/getStatus/fetchSignature` in `vnptCa.js` / `viettelCa.js` to the real endpoints.
3. Verify `verifyCallback()` HMAC scheme against the real spec.
4. Replace `computeDocHash()` in `caService.js` with real PDF-byte hashing if the CA mandates it.
5. UAT: QR opens app, doc code matches SP+app, Adobe/Foxit shows valid + timestamp + LTV.
