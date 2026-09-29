// Client helpers for external CA signing (QR + Deeplink, Phase 1 CEO-only).
// Server enforces CEO gating; these helpers only hide the button early.

export const CA_PROVIDERS = [
  { value: 'vnpt', label: 'VNPT SmartCA' },
  { value: 'viettel', label: 'Viettel MySign' }
];

if (String(process.env.REACT_APP_CA_SHOW_MOCK || '').toLowerCase() === 'true') {
  CA_PROVIDERS.push({ value: 'mock', label: 'Mock CA (dev)' });
}

export function isCaEnabled() {
  return String(process.env.REACT_APP_CA_ENABLED || '').toLowerCase() === 'true';
}

// Client-side pre-check only. Pass CEO ids via REACT_APP_CA_CEO_IDS (comma-separated
// Parse user objectIds) and/or REACT_APP_CA_CEO_EMAILS. Server re-checks CA_CEO_USER_IDS.
export function canShowExternalCa(user) {
  if (!isCaEnabled()) return false;
  if (!user) return false;
  const ids = String(process.env.REACT_APP_CA_CEO_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = String(process.env.REACT_APP_CA_CEO_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0 && emails.length === 0) return true; // show, server decides
  const uid = user.objectId || user.id || user?.object?.objectId;
  const email = String(user.email || user?.Email || '').toLowerCase();
  return (uid && ids.includes(String(uid))) || (email && emails.includes(email));
}

export const callCaInitiate = (Parse, params) => Parse.Cloud.run('caInitiate', params);
export const callCaStatus = (Parse, tranId) => Parse.Cloud.run('caStatus', { tranId });
export const callCaCancel = (Parse, tranId) => Parse.Cloud.run('caCancel', { tranId });
export const callCaComplete = (Parse, params) => Parse.Cloud.run('caComplete', params);

export function pollMs() {
  const v = Number(process.env.REACT_APP_CA_POLL_MS || 3000);
  return Number.isFinite(v) && v >= 1000 ? v : 3000;
}
