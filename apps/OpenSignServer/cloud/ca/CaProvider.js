// Factory + shared status enum. Base types live in caBase.js (cycle-free).

import { SUPPORTED_PROVIDERS } from './caConfig.js';
import { CaError, CaProvider } from './caBase.js';
import { MockCaProvider } from './providers/mockCa.js';
import { VnptSmartCaProvider } from './providers/vnptCa.js';
import { ViettelMysignProvider } from './providers/viettelCa.js';

export { CaError, CaProvider };
export const CA_STATUS = ['pending', 'signed', 'failed', 'expired', 'cancelled'];

const instances = new Map();

export function getCaProvider(name, config) {
  const normalized = String(name || '').toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    throw new CaError('UNSUPPORTED_PROVIDER', `Unsupported CA provider "${name}"`);
  }
  if (instances.has(normalized)) return instances.get(normalized);
  let instance;
  if (normalized === 'mock') instance = new MockCaProvider(config);
  else if (normalized === 'vnpt') instance = new VnptSmartCaProvider(config);
  else instance = new ViettelMysignProvider(config);
  instances.set(normalized, instance);
  return instance;
}

export function resetCaProvidersForTest() {
  instances.clear();
}
