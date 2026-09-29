// VNPT SmartCA adapter — STUB until partner test credentials arrive.
// Public integration model (doitac-smartca.vnpt.vn, QD769/CSC):
//   SP creates a transaction (clientId + tranId) -> user confirms in the
//   VNPT SmartCA mobile app (QR + Deeplink) -> SP polls / receives callback.
// TODO-WITH-REAL-DOCS (fill when test account is issued):
//   1. Set VNPT_CA_BASE_URL / VNPT_CA_CLIENT_ID / VNPT_CA_CLIENT_SECRET / VNPT_CA_CALLBACK_URL.
//   2. Map createTransaction() to the real SP "create signing transaction" endpoint.
//   3. Map getStatus()/fetchSignature() to the real query/download endpoints.
//   4. Confirm callback HMAC scheme below against the real spec and adjust verifyCallback().

import crypto from 'node:crypto';
import { CaProvider, CaError } from '../caBase.js';
import { getCaConfig } from '../caConfig.js';

function missingEnv(cfg) {
  const missing = [];
  if (!cfg.baseUrl) missing.push('VNPT_CA_BASE_URL');
  if (!cfg.clientId) missing.push('VNPT_CA_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('VNPT_CA_CLIENT_SECRET');
  return missing;
}

export class VnptSmartCaProvider extends CaProvider {
  constructor(config) {
    super('vnpt');
    const full = config || getCaConfig();
    this.config = full;
    this.cfg = full.vnpt;
  }

  _assertConfigured() {
    const missing = missingEnv(this.cfg);
    if (missing.length > 0) {
      throw new CaError(
        'NOT_CONFIGURED',
        `VNPT SmartCA is not configured. Missing env: ${missing.join(', ')}. ` +
          `Fill them in deploy/.env and redeploy — no code change needed.`
      );
    }
  }

  async createTransaction() {
    this._assertConfigured();
    // Real call goes here (axios POST ${baseUrl}/... with clientId + docHash).
    throw new CaError(
      'NOT_IMPLEMENTED',
      'VNPT createTransaction mapping pending real QD769 endpoint. See TODO at top of vnptCa.js.'
    );
  }

  async getStatus() {
    this._assertConfigured();
    throw new CaError('NOT_IMPLEMENTED', 'VNPT getStatus mapping pending real QD769 endpoint.');
  }

  async fetchSignature() {
    this._assertConfigured();
    throw new CaError('NOT_IMPLEMENTED', 'VNPT fetchSignature mapping pending real QD769 endpoint.');
  }

  // Assumed scheme (VERIFY against real docs): HMAC-SHA256 over the raw JSON
  // body with clientSecret, sent as header x-vnpt-signature. Kept isolated so
  // only this method changes when the real spec arrives.
  verifyCallback({ body, headers = {}, rawBody = '' } = {}) {
    this._assertConfigured();
    const provided =
      headers['x-vnpt-signature'] || headers['x-signature'] || body?.signature || '';
    const hmac = crypto
      .createHmac('sha256', this.cfg.clientSecret)
      .update(rawBody || JSON.stringify(body || {}))
      .digest('hex');
    const valid =
      Boolean(provided) &&
      provided.length === hmac.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(hmac));
    return { tranId: body?.tranId || body?.tran_id || null, status: body?.status || null, valid };
  }
}
