// Base class + typed error for CA providers (no imports — cycle-free).

export class CaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CaError';
    this.code = code;
    this.details = details;
  }
}

// Interface contract every provider implements:
// - createTransaction({ docHash, signer, appearance, ttlMin }) -> { tranId, deepLinkUrl, qrPayload, expiresAt, raw }
// - getStatus(tranId) -> { status, raw }
// - fetchSignature(tranId) -> { signatureValue, certChain, tsaToken, signTime, certSerial, raw }
// - verifyCallback({ body, headers }) -> { tranId, status, valid }
export class CaProvider {
  constructor(name) {
    this.name = name;
  }
  async createTransaction() {
    throw new CaError('NOT_IMPLEMENTED', `${this.name}: createTransaction not implemented`);
  }
  async getStatus() {
    throw new CaError('NOT_IMPLEMENTED', `${this.name}: getStatus not implemented`);
  }
  async fetchSignature() {
    throw new CaError('NOT_IMPLEMENTED', `${this.name}: fetchSignature not implemented`);
  }
  verifyCallback() {
    throw new CaError('NOT_IMPLEMENTED', `${this.name}: verifyCallback not implemented`);
  }
}
