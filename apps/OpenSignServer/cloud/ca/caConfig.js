// CA external signing config — pure helpers, no Parse dependency (unit-testable).
// Fill values via env; test accounts only change env, never code.

export const SUPPORTED_PROVIDERS = ['vnpt', 'viettel', 'mock'];

export const PROVIDER_LABELS = {
  vnpt: 'VNPT SmartCA',
  viettel: 'Viettel MySign',
  mock: 'Mock CA (dev)'
};

export function getCaConfig(env = process.env) {
  const list = v =>
    String(v || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  return {
    enabled: String(env.CA_ENABLED || 'false').toLowerCase() === 'true',
    defaultProvider: (env.CA_PROVIDER_DEFAULT || 'mock').toLowerCase(),
    ceoOnly: String(env.CA_PHASE1_CEO_ONLY ?? 'true').toLowerCase() !== 'false',
    ceoUserIds: list(env.CA_CEO_USER_IDS),
    padesLevel: env.CA_PADES_LEVEL || 'B-LT',
    tsaUrl: env.CA_TSA_URL || '',
    pollIntervalMs: Number(env.CA_POLL_INTERVAL_MS || 3000),
    ttlMin: Number(env.CA_TRANSACTION_TTL_MIN || 15),
    mockAutoSign: String(env.CA_MOCK_AUTO_SIGN ?? 'true').toLowerCase() !== 'false',
    mockDelayMs: Number(env.CA_MOCK_DELAY_MS || 5000),
    vnpt: {
      baseUrl: (env.VNPT_CA_BASE_URL || '').replace(/\/+$/, ''),
      clientId: env.VNPT_CA_CLIENT_ID || '',
      clientSecret: env.VNPT_CA_CLIENT_SECRET || '',
      // QD769 v1 APIs authenticate per-request with sp_id / sp_password.
      // When VNPT issues a single credential pair it usually works for both;
      // explicit SP vars take precedence, client vars are the fallback.
      spId: env.VNPT_CA_SP_ID || env.VNPT_CA_CLIENT_ID || '',
      spPassword: env.VNPT_CA_SP_PASSWORD || env.VNPT_CA_CLIENT_SECRET || '',
      // Phase 1: CCCD/MST of the single CEO signer whose cert is used.
      userId: env.VNPT_CA_USER_ID || '',
      // Optional: pin a cert when the user owns several. Otherwise first cert.
      serial: env.VNPT_CA_SERIAL || '',
      // Partner mobile code issued with the account (used by SmartCA app flows).
      mobileCode: env.VNPT_CA_MOBILE_CODE || '',
      env: env.VNPT_CA_ENV || 'development',
      callbackUrl: env.VNPT_CA_CALLBACK_URL || '',
      timeoutMs: Number(env.VNPT_CA_TIMEOUT_MS || 300000)
    },
    viettel: {
      baseUrl: (env.VIETTEL_CA_BASE_URL || '').replace(/\/+$/, ''),
      clientId: env.VIETTEL_CA_CLIENT_ID || '',
      clientSecret: env.VIETTEL_CA_CLIENT_SECRET || '',
      env: env.VIETTEL_CA_ENV || 'staging',
      callbackUrl: env.VIETTEL_CA_CALLBACK_URL || '',
      timeoutMs: Number(env.VIETTEL_CA_TIMEOUT_MS || 300000)
    }
  };
}

export function isCeoAllowed(userId, config = getCaConfig()) {
  if (!config.ceoOnly) return true;
  if (!userId) return false;
  if (config.ceoUserIds.length === 0) return false;
  return config.ceoUserIds.includes(String(userId));
}

// Dev convenience: when no CEO list is configured yet, mock provider allows
// any authenticated user so the UI/mock flow can be tested end-to-end.
// Real providers (vnpt/viettel) still require an explicit CEO list.
export function canInitiateProvider(userId, provider, config = getCaConfig()) {
  if (!config.enabled) return { ok: false, reason: 'CA integration is disabled (CA_ENABLED=false).' };
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return { ok: false, reason: `Unsupported provider "${provider}".` };
  }
  if (!config.ceoOnly) return { ok: true };
  if (isCeoAllowed(userId, config)) return { ok: true };
  if (provider === 'mock' && config.ceoUserIds.length === 0 && userId) {
    return { ok: true, devBypass: true };
  }
  return {
    ok: false,
    reason: 'Phase 1: only the CEO account may sign with an external CA. Set CA_CEO_USER_IDS.'
  };
}
