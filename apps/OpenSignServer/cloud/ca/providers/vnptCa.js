// VNPT SmartCA adapter — QD769 v1 API mapping.
// Spec: VNPT.IT_SmartCA_SP_QD769_API_specification_document_v2.0
//   UAT:  https://rmgateway.vnptit.vn/sca/sp769
//   Prod: https://gwsca.vnpt.vn/sca/sp769
// Flow: get_certificate (resolve serial+chain) -> sign (hash only, CA never
// sees PDF bytes) -> user approves in SmartCA mobile app -> poll status /
// webhook -> confirm returns signature_value (+ optional TSA token).
//
// Auth: per-request sp_id / sp_password (env VNPT_CA_SP_ID/_PASSWORD,
// falling back to VNPT_CA_CLIENT_ID/_SECRET when VNPT issues one pair).
// Signer identity (CCCD/MST) arrives per-transaction from contactbook or
// user profile (resolved by caService); VNPT_CA_USER_ID is only a fallback.

import crypto from 'node:crypto';
import axios from 'axios';
import { CaProvider, CaError } from '../caBase.js';
import { getCaConfig } from '../caConfig.js';

function missingEnv(cfg) {
  const missing = [];
  if (!cfg.baseUrl) missing.push('VNPT_CA_BASE_URL');
  if (!cfg.spId) missing.push('VNPT_CA_SP_ID (or VNPT_CA_CLIENT_ID)');
  if (!cfg.spPassword) missing.push('VNPT_CA_SP_PASSWORD (or VNPT_CA_CLIENT_SECRET)');
  // NOTE: no VNPT_CA_USER_ID requirement here — the signer CCCD arrives
  // per-transaction (contactbook/profile resolved by caService); the env
  // value is only a fallback for ad-hoc/CEO flows.
  return missing;
}

// QD769 §3.2 + portal test console: status_code + message carry the meaning.
// 404 "no_credential_match_id_*" = user has no issued cert on this env.
function mapVnptError(body, httpStatus) {
  const code = Number(body?.status_code ?? httpStatus ?? 0);
  const message = body?.message || `VNPT request failed (HTTP ${httpStatus ?? '?'})`;
  if (code === 401 || /credential_invalid|sp_credential/i.test(message)) {
    return new CaError('INVALID_CREDENTIALS', `VNPT sp_id/sp_password rejected: ${message}`);
  }
  if (code === 403 || /credential_status_invalid/i.test(message)) {
    return new CaError('CERT_INVALID', `VNPT cert rejected: ${message}`);
  }
  if (code === 404 || /no_credential_match/i.test(message)) {
    return new CaError(
      'NO_CERT',
      `VNPT: user has no issued certificate on this environment (${message}). ` +
        `Approve the cert order in the demo app / test-cert list first.`
    );
  }
  return new CaError('PROVIDER_ERROR', `VNPT: ${message}`);
}

function utcStamp(d = new Date()) {
  // QD769 time_stamp: YYYYMMddHHmmSS (portal sample appends 'Z' for UTC).
  const p = n => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
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

  async _post(path, body) {
    const url = `${this.cfg.baseUrl}${path}`;
    let res;
    try {
      res = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: this.cfg.timeoutMs
      });
    } catch (e) {
      const status = e?.response?.status;
      if (e?.response?.data && typeof e.response.data === 'object') {
        throw mapVnptError(e.response.data, status);
      }
      throw new CaError('PROVIDER_ERROR', `VNPT network error: ${e?.message || e}`);
    }
    const data = res.data;
    if (Number(data?.status_code) !== 200) {
      throw mapVnptError(data, res.status);
    }
    return data;
  }

  _spAuth() {
    return { sp_id: this.cfg.spId, sp_password: this.cfg.spPassword };
  }

  // QD769 §4.1 — resolve the signing cert (serial + chain) for the user.
  async _getCertificate({ userId, serial, transactionId }) {
    const data = await this._post('/v1/credentials/get_certificate', {
      ...this._spAuth(),
      user_id: userId,
      serial_number: serial || '',
      transaction_id: transactionId
    });
    const certs = data?.data?.user_certificates || [];
    if (certs.length === 0) {
      throw new CaError('NO_CERT', 'VNPT returned no certificates for this user.');
    }
    const cert = (serial && certs.find(c => c.serial_number === serial)) || certs[0];
    if (serial && cert.serial_number !== serial) {
      throw new CaError(
        'CERT_INVALID',
        `VNPT_CA_SERIAL ${serial} not found among user certificates.`
      );
    }
    return cert;
  }

  async createTransaction({ docHash, signer, ttlMin } = {}) {
    this._assertConfigured();
    if (!docHash) throw new CaError('INVALID_HASH', 'vnpt: docHash is required');
    // Per-signer CCCD (resolved from contactbook/profile by caService);
    // env VNPT_CA_USER_ID is only a fallback for ad-hoc flows.
    const userId = signer?.nationalId || this.cfg.userId;
    if (!userId) {
      throw new CaError(
        'NO_CCCD',
        'vnpt: signer CCCD is missing. Fill CCCD in Contactbook or user profile.'
      );
    }
    const transactionId = crypto.randomUUID();
    // doc_id must be shown on BOTH the SP UI and the CA approval app so the
    // user can match them before confirming (QD769 §4.2/§4.4).
    const docCode = `DOCSIGN-${transactionId.slice(0, 8).toUpperCase()}`;

    const cert = await this._getCertificate({
      userId,
      serial: this.cfg.serial,
      transactionId
    });

    const desc = `DocSign ${docCode}${signer?.name ? ` — ${signer.name}` : ''}`.slice(0, 128);
    const data = await this._post('/v1/signatures/sign', {
      ...this._spAuth(),
      user_id: userId,
      transaction_desc: desc,
      sign_files: [
        {
          data_to_be_signed: String(docHash), // hex digest, sign_type 'hash'
          doc_id: docCode,
          file_type: 'pdf',
          sign_type: 'hash'
        }
      ],
      transaction_id: transactionId,
      serial_number: cert.serial_number,
      time_stamp: utcStamp()
    });

    // Success reply: { message: 'sig_wait_for_user_confirm',
    //   data: { transaction_id, tran_code } }. The user now approves in the
    // SmartCA mobile app (push notification); tran_code is the match code.
    const tranCode = data?.data?.tran_code || '';
    const ttl = Number(ttlMin || this.config.ttlMin || 15);
    return {
      tranId: transactionId,
      // API flow needs no deeplink: approval happens via push in the
      // SmartCA app. QR encodes tran_code for matching.
      deepLinkUrl: '',
      qrPayload: tranCode || transactionId,
      expiresAt: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
      extra: {
        tranCode,
        docCode,
        vnptUserId: userId,
        vnptSerial: cert.serial_number
      },
      raw: { provider: 'vnpt', transactionId, docCode, desc }
    };
  }

  // QD769 §4.3 — POST .../sign/{tranId}/status with empty body.
  async getStatus(tranId, opts = {}) {
    this._assertConfigured();
    if (opts.forcedStatus) return { status: opts.forcedStatus, raw: { tranId } };
    let data;
    try {
      data = await this._post(`/v1/signatures/sign/${encodeURIComponent(tranId)}/status`, {});
    } catch (e) {
      // Auth/cert problems are terminal; transport/5xx stays pending for retry.
      if (e instanceof CaError && ['INVALID_CREDENTIALS', 'CERT_INVALID', 'NO_CERT'].includes(e.code)) {
        throw e;
      }
      if (e instanceof CaError && /expir|not_found|not exist/i.test(e.message)) {
        return { status: 'expired', raw: { tranId, message: e.message } };
      }
      if (e instanceof CaError) return { status: 'pending', raw: { tranId, message: e.message } };
      throw e;
    }
    const sigs = data?.data?.signatures || [];
    if (sigs.length > 0) return { status: 'signed', raw: data?.data || {} };
    return { status: 'pending', raw: data?.data || {} };
  }

  // Signature retrieval = status endpoint (returns signature_value) +
  // get_certificate (chain). opts may carry { userId, serial } stored on the
  // CaTransaction at initiate time; env values are the fallback.
  async fetchSignature(tranId, opts = {}) {
    this._assertConfigured();
    const userId = opts.userId || this.cfg.userId;
    const serial = opts.serial || this.cfg.serial;
    const data = await this._post(`/v1/signatures/sign/${encodeURIComponent(tranId)}/status`, {});
    const sigs = data?.data?.signatures || [];
    if (sigs.length === 0) {
      throw new CaError('NOT_SIGNED', `vnpt: transaction ${tranId} has no signature yet`);
    }
    const first = sigs[0];
    const cert = await this._getCertificate({ userId, serial, transactionId: tranId });
    const chain = [cert.cert_data, cert?.chain_data?.ca_cert, cert?.chain_data?.root_cert].filter(Boolean);
    return {
      signatureValue: first.signature_value,
      certChain: chain,
      // timestamp_signature is null until the CA timestamps (see spec sample).
      tsaToken: first.timestamp_signature || null,
      signTime: new Date().toISOString(),
      certSerial: cert.serial_number,
      raw: { provider: 'vnpt', tranId, docId: first.doc_id }
    };
  }

  // QD769 §4.4 webhook { sp_id, status_code, message, transaction_id,
  // doc_id?, signature_value?, timestamp_signature? }. The spec defines NO
  // HMAC — authenticity = sp_id match. Unknown/unsigned bodies are rejected.
  verifyCallback({ body } = {}) {
    this._assertConfigured();
    const tranId = body?.transaction_id || body?.tranId || null;
    const spOk = Boolean(body?.sp_id) && String(body.sp_id) === String(this.cfg.spId);
    if (!spOk || !tranId) {
      return { tranId, status: null, valid: false };
    }
    const ok = Number(body?.status_code) === 200;
    return { tranId, status: ok ? 'signed' : 'failed', valid: true };
  }
}
