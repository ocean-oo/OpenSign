// Shared CA transaction service (Parse persistence + provider orchestration).
// Phase 1: CEO-only gating lives here (server-authoritative).

import crypto from 'node:crypto';
import { getCaConfig, canInitiateProvider, PROVIDER_LABELS } from './caConfig.js';
import { getCaProvider, CaError } from './CaProvider.js';

export const CA_CLASS = 'CaTransaction';

export function formatVnTime(iso) {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

// Placeholder hash until the real PDF-byte hashing step is wired to a CA that
// requires it. Deterministic per (documentId, signerId) so retries are stable.
// When VNPT/Viettel test docs arrive and mandate hashing the PDF bytes with a
// PAdES placeholder, replace ONLY this function.
export function computeDocHash({ documentId, signerId, salt = '' }) {
  return crypto
    .createHash('sha256')
    .update(`${documentId}:${signerId}:${salt}`)
    .digest('hex');
}

// Professional visible-signature appearance (spec 3.1): handwritten image +
// name/title + VN time + cert serial + CA label. PAdES level + TSA recorded.
export function buildAppearance({ signerName, signerTitle, signTimeIso, certSerial, provider }) {
  const label = PROVIDER_LABELS[provider] || provider;
  const config = getCaConfig();
  return {
    line1: signerTitle ? `${signerName} — ${signerTitle}` : String(signerName || 'CEO'),
    line2: `Ky ngay ${formatVnTime(signTimeIso)} (GMT+7)`,
    line3: `Serial: ${certSerial} — ${label}`,
    provider: label,
    padesLevel: config.padesLevel,
    tsaUrl: config.tsaUrl || null
  };
}

function master() {
  return { useMasterKey: true };
}

async function findTransaction(tranId) {
  const q = new Parse.Query(CA_CLASS);
  q.equalTo('tranId', String(tranId));
  const obj = await q.first(master());
  if (!obj) throw new CaError('NOT_FOUND', `CA transaction "${tranId}" not found.`);
  return obj;
}

function assertOwner(tx, userId) {
  if (!userId) throw new CaError('FORBIDDEN', 'Authentication required.');
  const signer = tx.get('signerId');
  const signerId = typeof signer === 'string' ? signer : signer?.objectId || signer?.id;
  const config = getCaConfig();
  // CEO list members and master-context callers may operate; otherwise owner only.
  if (signerId && signerId === String(userId)) return;
  if (config.ceoUserIds.includes(String(userId))) return;
  throw new CaError('FORBIDDEN', 'You do not own this CA transaction.');
}

function toEnvelope(tx) {
  const j = tx.toJSON ? tx.toJSON() : {};
  return {
    tranId: tx.get('tranId'),
    provider: tx.get('provider'),
    documentId: tx.get('documentId'),
    status: tx.get('status'),
    deepLinkUrl: tx.get('deepLinkUrl'),
    qrPayload: tx.get('qrPayload'),
    expiresAt: tx.get('expiresAt'),
    certSerial: tx.get('certSerial') || null,
    signTime: tx.get('signTime') || null,
    errorCode: tx.get('errorCode') || null,
    errorMessage: tx.get('errorMessage') || null,
    // Provider match codes (VNPT tran_code/doc_id) for the approval app.
    tranCode: tx.get('tranCode') || null,
    docCode: tx.get('docCode') || null,
    objectId: j.objectId || tx.id
  };
}

export async function initiateCaSign({
  documentId,
  provider = 'mock',
  page = 1,
  rect = null,
  signerName = '',
  user
}) {
  const config = getCaConfig();
  const userId = user?.id || user?.objectId || null;
  if (!userId) throw new CaError('FORBIDDEN', 'Authentication required.');
  if (!documentId) throw new CaError('INVALID_DOC', 'documentId is required.');
  const gate = canInitiateProvider(userId, String(provider).toLowerCase(), config);
  if (!gate.ok) throw new CaError('FORBIDDEN', gate.reason);

  const name = String(provider).toLowerCase();
  const adapter = getCaProvider(name, config);
  const docHash = computeDocHash({ documentId, signerId: userId });

  let created;
  try {
    created = await adapter.createTransaction({
      docHash,
      signer: { id: userId, name: signerName },
      appearance: { page, rect },
      ttlMin: config.ttlMin
    });
  } catch (e) {
    if (e instanceof CaError) throw e;
    throw new CaError('PROVIDER_ERROR', e?.message || 'CA provider error.');
  }

  const tx = new Parse.Object(CA_CLASS);
  tx.set('provider', name);
  tx.set('documentId', String(documentId));
  tx.set('signerId', String(userId));
  tx.set('docHash', docHash);
  tx.set('tranId', created.tranId);
  tx.set('deepLinkUrl', created.deepLinkUrl);
  tx.set('qrPayload', created.qrPayload);
  tx.set('expiresAt', created.expiresAt);
  tx.set('status', 'pending');
  tx.set('signPage', Number(page) || 1);
  if (rect) tx.set('signRect', rect);
  tx.set('rawRequest', created.raw || {});
  // Generic passthrough for provider match codes (strings only).
  if (created.extra && typeof created.extra === 'object') {
    for (const [k, v] of Object.entries(created.extra)) {
      if (typeof v === 'string' && v) tx.set(k, v);
    }
  }
  const acl = new Parse.ACL();
  try {
    acl.setReadAccess(userId, true);
    acl.setWriteAccess(userId, true);
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
  } catch {
    /* ACL best effort */
  }
  tx.setACL(acl);
  await tx.save(null, master());
  return toEnvelope(tx);
}

async function refreshStatus(tx, adapter, config) {
  const current = tx.get('status');
  if (current !== 'pending') return current;
  const expiresAt = tx.get('expiresAt');
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    tx.set('status', 'expired');
    await tx.save(null, master());
    return 'expired';
  }
  let remote;
  try {
    remote = await adapter.getStatus(tx.get('tranId'), { ttlMin: config.ttlMin });
  } catch (e) {
    tx.set('status', 'failed');
    tx.set('errorCode', e?.code || 'PROVIDER_ERROR');
    tx.set('errorMessage', e?.message || 'CA provider error.');
    await tx.save(null, master());
    return 'failed';
  }
  const next = remote?.status || 'pending';
  if (['signed', 'failed', 'expired', 'cancelled'].includes(next)) {
    tx.set('status', next);
    tx.set('rawCallback', remote.raw || {});
    await tx.save(null, master());
    return next;
  }
  return 'pending';
}

export async function getCaStatus({ tranId, user }) {
  const config = getCaConfig();
  const userId = user?.id || user?.objectId || null;
  const tx = await findTransaction(tranId);
  assertOwner(tx, userId);
  const adapter = getCaProvider(tx.get('provider'), config);
  await refreshStatus(tx, adapter, config);
  return toEnvelope(tx);
}

export async function cancelCaSign({ tranId, user }) {
  const userId = user?.id || user?.objectId || null;
  const tx = await findTransaction(tranId);
  assertOwner(tx, userId);
  if (tx.get('status') === 'pending') {
    tx.set('status', 'cancelled');
    await tx.save(null, master());
  }
  return toEnvelope(tx);
}

export async function handleCaCallback({ provider, body, headers, rawBody }) {
  const config = getCaConfig();
  const adapter = getCaProvider(String(provider).toLowerCase(), config);
  let verdict;
  try {
    verdict = adapter.verifyCallback({ body, headers, rawBody });
  } catch (e) {
    throw new CaError(e?.code || 'PROVIDER_ERROR', e?.message || 'Callback verify failed.');
  }
  if (!verdict?.valid || !verdict?.tranId) {
    throw new CaError('INVALID_CALLBACK', 'Invalid CA callback signature.');
  }
  const tx = await findTransaction(verdict.tranId);
  if (tx.get('provider') !== String(provider).toLowerCase()) {
    throw new CaError('INVALID_CALLBACK', 'Provider mismatch for this transaction.');
  }
  const next = verdict.status || 'signed';
  if (tx.get('status') === 'pending' && ['signed', 'failed', 'expired', 'cancelled'].includes(next)) {
    tx.set('status', next);
    tx.set('rawCallback', body || {});
    await tx.save(null, master());
  }
  return toEnvelope(tx);
}

export async function completeCaSign({ tranId, user, signerName = '', signerTitle = 'CEO' }) {
  const config = getCaConfig();
  const userId = user?.id || user?.objectId || null;
  const tx = await findTransaction(tranId);
  assertOwner(tx, userId);
  const adapter = getCaProvider(tx.get('provider'), config);
  const status = await refreshStatus(tx, adapter, config);
  if (status !== 'signed') {
    throw new CaError('NOT_SIGNED', `Transaction is ${status}, not signed yet.`);
  }
  let sig;
  try {
    sig = await adapter.fetchSignature(tx.get('tranId'), {
      userId: tx.get('vnptUserId') || undefined,
      serial: tx.get('vnptSerial') || undefined
    });
  } catch (e) {
    throw new CaError(e?.code || 'PROVIDER_ERROR', e?.message || 'Failed to fetch signature.');
  }
  tx.set('certSerial', sig.certSerial);
  tx.set('signTime', sig.signTime);
  tx.set('rawSignature', {
    certChain: sig.certChain,
    tsaToken: sig.tsaToken ? 'present' : null,
    tsaUrl: config.tsaUrl || null,
    padesLevel: config.padesLevel
  });
  await tx.save(null, master());

  const appearance = buildAppearance({
    signerName: signerName || String(userId),
    signerTitle,
    signTimeIso: sig.signTime,
    certSerial: sig.certSerial,
    provider: tx.get('provider')
  });

  // Append an audit entry to the document WITHOUT altering the existing
  // signing flow. Byte-level PAdES embedding uses sig.signatureValue when a
  // real CA is connected (mock stores the value for verification instead).
  let auditAppended = false;
  try {
    const doc = new Parse.Object('contracts_Document');
    doc.id = String(tx.get('documentId'));
    const label = PROVIDER_LABELS[tx.get('provider')] || tx.get('provider');
    doc.add('AuditTrail', {
      Activity: `Signed with ${label}`,
      tranId: tx.get('tranId'),
      tranCode: tx.get('tranCode') || undefined,
      docCode: tx.get('docCode') || undefined,
      certSerial: sig.certSerial,
      signTime: sig.signTime,
      padesLevel: config.padesLevel,
      tsaUrl: config.tsaUrl || null,
      UserId: userId,
      createdAt: new Date().toISOString()
    });
    await doc.save(null, master());
    auditAppended = true;
  } catch (e) {
    // Document may not exist in mock/dev flows — signature data is still saved.
    auditAppended = false;
  }

  return { ...toEnvelope(tx), appearance, auditAppended };
}
