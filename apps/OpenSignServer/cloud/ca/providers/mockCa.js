// Mock CA provider — fully working without any external account.
// Stateless auto-sign: status is derived from elapsed time so it works across
// server restarts and is deterministic in tests.

import { CaProvider, CaError } from '../caBase.js';
import { getCaConfig } from '../caConfig.js';

function rand(n = 6) {
  const chars = 'abcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function parseMockTranId(tranId) {
  // mock_<epochMs>_<rand>
  const m = String(tranId || '').match(/^mock_(\d+)_([a-z0-9]+)$/);
  if (!m) return null;
  return { createdAt: Number(m[1]), suffix: m[2] };
}

export class MockCaProvider extends CaProvider {
  constructor(config) {
    super('mock');
    this.config = config || getCaConfig();
  }

  async createTransaction({ docHash, signer, ttlMin } = {}) {
    if (!docHash) throw new CaError('INVALID_HASH', 'mock: docHash is required');
    const createdAt = Date.now();
    const tranId = `mock_${createdAt}_${rand()}`;
    const ttl = Number(ttlMin || this.config.ttlMin || 15);
    const expiresAt = new Date(createdAt + ttl * 60 * 1000).toISOString();
    const deepLinkUrl = `mock-ca://sign?tranId=${tranId}`;
    return {
      tranId,
      deepLinkUrl,
      qrPayload: deepLinkUrl,
      expiresAt,
      raw: { provider: 'mock', createdAt, signerId: signer?.id || signer || null }
    };
  }

  _isExpired(tranId, ttlMin) {
    const parsed = parseMockTranId(tranId);
    if (!parsed) return true;
    const ttl = Number(ttlMin || this.config.ttlMin || 15);
    return Date.now() > parsed.createdAt + ttl * 60 * 1000;
  }

  async getStatus(tranId, opts = {}) {
    if (!parseMockTranId(tranId)) {
      return { status: 'failed', raw: { error: 'unknown tranId' } };
    }
    if (this._isExpired(tranId, opts.ttlMin)) {
      return { status: 'expired', raw: { tranId } };
    }
    if (opts.forcedStatus) return { status: opts.forcedStatus, raw: { tranId } };
    if (!this.config.mockAutoSign) return { status: 'pending', raw: { tranId } };
    const { createdAt } = parseMockTranId(tranId);
    const delayMs = Number(this.config.mockDelayMs ?? 5000);
    const elapsed = Date.now() - createdAt;
    if (elapsed >= delayMs) {
      return { status: 'signed', raw: { tranId, elapsed } };
    }
    return { status: 'pending', raw: { tranId, elapsed } };
  }

  async fetchSignature(tranId) {
    const { status } = await this.getStatus(tranId);
    if (status !== 'signed') {
      throw new CaError('NOT_SIGNED', `mock: transaction ${tranId} is ${status}, not signed`);
    }
    const fakeSig = Buffer.from(`mock-signature:${tranId}`).toString('base64');
    return {
      signatureValue: fakeSig,
      certChain: ['MOCK_CERT_CHAIN'],
      tsaToken: 'mock-tsa-token',
      signTime: new Date().toISOString(),
      certSerial: `MOCK-${tranId.slice(-6).toUpperCase()}`,
      raw: { provider: 'mock', tranId }
    };
  }

  verifyCallback({ body } = {}) {
    const tranId = body?.tranId || body?.tran_id || null;
    const status = body?.status || 'signed';
    if (!tranId || !parseMockTranId(tranId)) {
      return { tranId: null, status: 'failed', valid: false };
    }
    return { tranId, status, valid: true };
  }
}
