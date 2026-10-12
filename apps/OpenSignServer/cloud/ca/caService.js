// Shared CA transaction service (Parse persistence + provider orchestration).
// Phase 1: CEO-only gating lives here (server-authoritative).

import crypto from 'node:crypto';
import { getCaConfig, canInitiateProvider, PROVIDER_LABELS, SUPPORTED_PROVIDERS } from './caConfig.js';
import { getCaProvider, CaError } from './CaProvider.js';
import { findPlaceholderIndex, findPendingPriorSigner } from '../../utils/workflowUtils.js';

export const CA_CLASS = 'CaTransaction';
// Signer CA phải đặt tối thiểu 2 ô vị trí ký (để dành nhúng appearance PAdES sau này).
export const MIN_CA_WIDGETS = 2;

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

// Resolve who may CA-sign this document:
// - designation: placeholder.signWithCA (+ caProvider) set at authoring,
//   inherited from template;
// - identity: CCCD from contactbook/profile (env fallback), pointer class.
// CEO-listed users bypass designation but still wait their turn.
async function resolveCaSigner(documentId, userId) {
  const doc = await new Parse.Query('contracts_Document').get(String(documentId), master());
  if (!doc) throw new CaError('INVALID_DOC', 'Document not found.');
  const j = doc.toJSON();
  if (j.IsCompleted || j.IsDeclined || j.IsArchive) {
    throw new CaError('INVALID_DOC', 'Document is no longer signable.');
  }
  const placeholders = Array.isArray(j.Placeholders) ? j.Placeholders : [];
  const uid = String(userId);

  let linkedContactIds = [];
  try {
    const cq = new Parse.Query('contracts_Contactbook');
    cq.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: uid });
    linkedContactIds = (await cq.find(master())).map(c => c.id);
  } catch {
    /* best effort */
  }
  const candidates = [uid, ...linkedContactIds];
  const placeholder =
    placeholders.find(
      p => p?.Role !== 'prefill' && candidates.includes(String(p?.signerObjId || ''))
    ) || null;

  const getById = async (cls, id) => {
    try {
      return (await new Parse.Query(cls).get(String(id), master())).toJSON();
    } catch {
      return null;
    }
  };
  let contact = placeholder?.signerObjId ? await getById('contracts_Contactbook', placeholder.signerObjId) : null;
  let className = 'contracts_Users';
  let contactId = placeholder?.signerObjId || null;
  let nationalId = '';
  if (contact?.NationalId) {
    nationalId = String(contact.NationalId);
    className = 'contracts_Contactbook';
  }
  if (!nationalId) {
    let ext =
      (contactId && (await getById('contracts_Users', contactId))) ||
      (await getById('contracts_Users', uid)) ||
      (contact?.UserId?.objectId && (await getById('contracts_Users', contact.UserId.objectId)));
    if (ext?.NationalId) {
      nationalId = String(ext.NationalId);
      if (!contact) className = 'contracts_Users';
      else className = 'contracts_Contactbook';
    }
  }
  if (!nationalId) {
    // Last resort: match contactbook by signer email.
    const emails = [
      placeholder?.email,
      ...((j.Signers || [])
        .filter(s => String(s.objectId) === String(placeholder?.signerObjId))
        .map(s => s.Email))
    ]
      .map(e => String(e || '').toLowerCase().trim())
      .filter(Boolean);
    for (const email of emails) {
      try {
        const q = new Parse.Query('contracts_Contactbook');
        q.equalTo('Email', email);
        const hit = await q.first(master());
        if (hit?.toJSON()?.NationalId) {
          nationalId = String(hit.toJSON().NationalId);
          className = 'contracts_Contactbook';
          contactId = contactId || hit.id;
          break;
        }
      } catch {
        /* best effort */
      }
    }
  }
  return { doc: j, placeholder, nationalId, className, contactId };
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

  const name = String(provider).toLowerCase();
  if (!config.enabled) {
    throw new CaError('FORBIDDEN', 'CA integration is disabled (CA_ENABLED=false).');
  }
  if (!SUPPORTED_PROVIDERS.includes(name)) {
    throw new CaError('FORBIDDEN', `Unsupported CA provider "${provider}".`);
  }
  const adapter = getCaProvider(name, config);

  // Per-document designation (inherited from template) or CEO-list backdoor.
  const ctx = await resolveCaSigner(documentId, userId);
  const designated = Boolean(ctx.placeholder?.signWithCA);
  const gate = canInitiateProvider(userId, name, config);
  if (!designated && !gate.ok) {
    throw new CaError(
      'FORBIDDEN',
      'Only a signer designated for external CA signing (or a CEO-listed account) may initiate.'
    );
  }
  if (designated) {
    const expected = String(ctx.placeholder?.caProvider || 'vnpt').toLowerCase();
    if (name !== expected) {
      throw new CaError('FORBIDDEN', `This signer is designated to sign with ${expected}.`);
    }
  }
  // Sequential order: a CA signer waits for prior signers like everyone else.
  if (ctx.doc.SendInOrderStrict === true && ctx.placeholder?.signerObjId) {
    const myIdx = findPlaceholderIndex(ctx.doc.Placeholders || [], ctx.placeholder.signerObjId);
    const pending =
      myIdx > 0 ? findPendingPriorSigner(ctx.doc.Placeholders || [], myIdx, ctx.doc.AuditTrail) : null;
    if (pending) {
      throw new CaError('NOT_YOUR_TURN', 'Previous signers have not signed yet. Please wait for your turn.');
    }
  }
  const nationalId = ctx.nationalId || (name === 'vnpt' ? config.vnpt.userId : '');
  if (!nationalId) {
    throw new CaError(
      'NO_CCCD',
      'CCCD/CMND is missing for this signer. Please fill CCCD in Contactbook or user profile.'
    );
  }

  const docHash = computeDocHash({ documentId, signerId: userId });

  let created;
  try {
    created = await adapter.createTransaction({
      docHash,
      signer: { id: userId, name: signerName, nationalId },
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
  tx.set('signerContactId', ctx.contactId ? String(ctx.contactId) : '');
  tx.set('signerClass', ctx.className);
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
    // Activity 'Signed' (not a custom one) so completion counting and
    // strict-order gating treat the CA step exactly like an internal signature.
    // UserPtr is REQUIRED: findPendingPriorSigner matches audit entries to
    // placeholders by UserPtr.objectId === signerObjId.
    doc.add('AuditTrail', {
      Activity: 'Signed',
      UserPtr: {
        __type: 'Pointer',
        className: tx.get('signerClass') || 'contracts_Contactbook',
        objectId: tx.get('signerContactId') || String(userId)
      },
      SignedUrl: '',
      SignedOn: sig.signTime ? new Date(sig.signTime) : new Date(),
      caProvider: tx.get('provider'),
      caLabel: label,
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
