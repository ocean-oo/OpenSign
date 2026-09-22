import logo from "../assets/images/logo.png";
import { getEnv, basePath } from "./Utils";

export function serverUrl_fn() {
  const env = getEnv();
  const serverurl = env?.REACT_APP_SERVERURL
    ? env.REACT_APP_SERVERURL // env.REACT_APP_SERVERURL is used for prod
    : process.env.REACT_APP_SERVERURL; //  process.env.REACT_APP_SERVERURL is used for dev (locally)
  let baseUrl = serverurl ? serverurl : window.location.origin + basePath() + "/api/app";
  return baseUrl;
}
export function keycloakConfig() {
  const env = getEnv();
  const pick = (k) => env?.[k] || process.env[k] || "";
  return {
    enabled: String(pick("REACT_APP_ENABLE_KEYCLOAK")).toLowerCase() === "true",
    url: pick("REACT_APP_KEYCLOAK_URL"),
    realm: pick("REACT_APP_KEYCLOAK_REALM"),
    clientId: pick("REACT_APP_KEYCLOAK_CLIENT_ID")
  };
}
export const appInfo = {
  applogo: logo,
  appId: process.env.REACT_APP_APPID ? process.env.REACT_APP_APPID : "opensign",
  baseUrl: serverUrl_fn(),
  defaultRole: "contracts_User",
  fev_Icon:
    "data:image/png;base64,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",
  googleClientId: process.env.REACT_APP_GOOGLECLIENTID
    ? `${process.env.REACT_APP_GOOGLECLIENTID}`
    : "",
  metaDescription:
    "The fastest way to sign PDFs & request signatures from others.",
  settings: [
    {
      role: "contracts_Admin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_OrgAdmin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_Editor",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_User",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    }
  ]
};
