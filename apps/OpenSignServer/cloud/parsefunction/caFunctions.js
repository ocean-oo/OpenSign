// Parse Cloud Function wrappers for external CA signing (QR + Deeplink).
// Server-authoritative CEO gating happens in caService.initiateCaSign.

import {
  initiateCaSign,
  getCaStatus,
  cancelCaSign,
  completeCaSign,
  handleCaCallback
} from '../ca/caService.js';
import { CaError } from '../ca/CaProvider.js';

function toParseError(e) {
  const code = e?.code === 'FORBIDDEN' ? Parse.Error.OPERATION_FORBIDDEN : Parse.Error.INVALID_QUERY;
  return new Parse.Error(code, e?.message || 'CA request failed.');
}

export async function caInitiate(request) {
  try {
    const { documentId, provider, page, rect, signerName } = request.params || {};
    return await initiateCaSign({
      documentId,
      provider,
      page,
      rect,
      signerName,
      user: request.user
    });
  } catch (e) {
    if (e instanceof CaError) throw toParseError(e);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, e?.message || 'caInitiate failed.');
  }
}

export async function caStatus(request) {
  try {
    const { tranId } = request.params || {};
    if (!tranId) throw new CaError('INVALID_TRAN', 'tranId is required.');
    return await getCaStatus({ tranId, user: request.user });
  } catch (e) {
    if (e instanceof CaError) throw toParseError(e);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, e?.message || 'caStatus failed.');
  }
}

export async function caCancel(request) {
  try {
    const { tranId } = request.params || {};
    if (!tranId) throw new CaError('INVALID_TRAN', 'tranId is required.');
    return await cancelCaSign({ tranId, user: request.user });
  } catch (e) {
    if (e instanceof CaError) throw toParseError(e);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, e?.message || 'caCancel failed.');
  }
}

export async function caComplete(request) {
  try {
    const { tranId, signerName, signerTitle } = request.params || {};
    if (!tranId) throw new CaError('INVALID_TRAN', 'tranId is required.');
    return await completeCaSign({ tranId, user: request.user, signerName, signerTitle });
  } catch (e) {
    if (e instanceof CaError) throw toParseError(e);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, e?.message || 'caComplete failed.');
  }
}

// Callable by the mobile-app callback path when a CA posts JSON directly to a
// Cloud Function (alternative to the express webhook below).
export async function caCallback(request) {
  try {
    const { provider, body, headers } = request.params || {};
    if (!provider) throw new CaError('INVALID_PROVIDER', 'provider is required.');
    return await handleCaCallback({ provider, body: body || {}, headers: headers || {}, rawBody: '' });
  } catch (e) {
    if (e instanceof CaError) throw toParseError(e);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, e?.message || 'caCallback failed.');
  }
}
