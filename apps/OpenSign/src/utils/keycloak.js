import Keycloak from "keycloak-js";
import { keycloakConfig } from "../constant/appinfo";
import { appOrigin } from "../constant/Utils";

let kcInstance = null;

export function getKeycloak() {
  const cfg = keycloakConfig();
  if (!cfg.enabled || !cfg.url || !cfg.realm || !cfg.clientId) {
    throw new Error("Keycloak is not configured.");
  }
  if (!kcInstance) {
    kcInstance = new Keycloak({
      url: cfg.url,
      realm: cfg.realm,
      clientId: cfg.clientId
    });
  }
  return kcInstance;
}

export function isKeycloakEnabled() {
  try {
    const cfg = keycloakConfig();
    return Boolean(cfg.enabled && cfg.url && cfg.realm && cfg.clientId);
  } catch {
    return false;
  }
}

export async function logoutKeycloak(redirectUri) {
  if (!kcInstance) return;
  try {
    await kcInstance.logout({ redirectUri: redirectUri || appOrigin() + "/" });
  } catch (e) {
    console.log("Keycloak logout err", e);
  } finally {
    kcInstance = null;
  }
}
