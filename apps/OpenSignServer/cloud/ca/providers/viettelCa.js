// Viettel MySign adapter — STUB until test credentials arrive.
// Public model (MySign API+SDK v1.8): getToken(clientId/secret) -> create
// signing request with document hash -> user confirms in MySign app ->
// SP polls / receives callback, then downloads the signature value.
// TODO-WITH-REAL-DOCS:
//   1. Set VIETTEL_CA_BASE_URL / VIETTEL_CA_CLIENT_ID / VIETTEL_CA_CLIENT_SECRET / VIETTEL_CA_CALLBACK_URL.
//   2. Map the 3 calls below to the real v1.8 endpoints.
//   3. Confirm callback auth scheme and adjust verifyCallback().

import crypto from 'node:crypto';
import { CaProvider, CaError } from '../caBase.js';
import { getCaConfig } from '../caConfig.js';

function missingEnv(cfg) {
  const missing = [];
  if (!cfg.baseUrl) missing.push('VIETTEL_CA_BASE_URL');
  if (!cfg.clientId) missing.push('VIETTEL_CA_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('VIETTEL_CA_CLIENT_SECRET');
  return missing;
}

export class ViettelMysignProvider extends CaProvider {
  constructor(config) {
    super('viettel');
    const full = config || getCaConfig();
    this.config = full;
    this.cfg = full.viettel;
  }

  _assertConfigured() {
    const missing = missingEnv(this.cfg);
    if (missing.length > 0) {
      throw new CaError(
        'NOT_CONFIGURED',
        `Viettel MySign is not configured. Missing env: ${missing.join(', ')}. ` +
          `Fill them in deploy/.env and redeploy — no code change needed.`
      );
    }
  }

  async createTransaction() {
    this._assertConfigured();
    throw new CaError(
      'NOT_IMPLEMENTED',
      'Viettel createTransaction mapping pending real MySign v1.8 endpoint. See TODO at top of viettelCa.js.'
    );
  }

  async getStatus() {
    this._assertConfigured();
    throw new CaError('NOT_IMPLEMENTED', 'Viettel getStatus mapping pending real MySign v1.8 endpoint.');
  }

  async fetchSignature() {
    this._assertConfigured();
    throw new CaError('NOT_IMPLEMENTED', 'Viettel fetchSignature mapping pending real MySign v1.8 endpoint.');
  }

  // Assumed scheme (VERIFY): HMAC-SHA256 over raw body, header x-vt-signature.
  verifyCallback({ body, headers = {}, rawBody = '' } = {}) {
    this._assertConfigured();
    const provided =
      headers['x-vt-signature'] || headers['x-signature'] || body?.signature || '';
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
