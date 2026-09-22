import { useEffect, useState } from "react";
import Parse from "parse";
import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { getKeycloak } from "../utils/keycloak";
import { appInfo } from "../constant/appinfo";
import { showTenant } from "../redux/reducers/ShowTenant";
import Loader from "../primitives/Loader";
import Alert from "../primitives/Alert";

function KeycloakCallback() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const kc = getKeycloak();
        const authenticated = await kc.init({
          onLoad: "check-sso",
          pkceMethod: "S256",
          checkLoginIframe: false
        });
        if (!authenticated || !kc.token) {
          setError(t("sso-login-failed"));
          return;
        }
        const res = await Parse.Cloud.run("loginWithKeycloak", {
          accessToken: kc.token,
          idToken: kc.idToken
        });
        if (!res?.sessionToken) {
          setError(t("sso-login-failed"));
          return;
        }
        await Parse.User.become(res.sessionToken);
        localStorage.setItem("accesstoken", res.sessionToken);
        localStorage.setItem("UserInformation", JSON.stringify(res));
        if (res.email) localStorage.setItem("userEmail", res.email);
        localStorage.setItem("profileImg", "");
        // Reuse standard post-login flow (role/tenant/menu)
        const userSettings = appInfo.settings;
        const extUser = await Parse.Cloud.run("getUserDetails");
        if (!extUser) {
          setError(t("user-not-found"));
          return;
        }
        if (extUser?.get("IsDisabled")) {
          setError(t("do-not-access-contact-admin"));
          await Parse.User.logOut().catch(() => {});
          return;
        }
        const userRole = extUser?.get("UserRole");
        const menu = userRole && userSettings.find((m) => m.role === userRole);
        if (!menu) {
          setError(t("role-not-found"));
          await Parse.User.logOut().catch(() => {});
          return;
        }
        const extInfo = JSON.parse(JSON.stringify(extUser));
        const lang = extUser?.get("Language");
        if (lang) i18n.changeLanguage(lang);
        localStorage.setItem("_user_role", userRole.replace("contracts_", ""));
        localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
        localStorage.setItem("userEmail", extInfo.Email);
        localStorage.setItem("username", extInfo.Name);
        if (extInfo?.TenantId) {
          const tenant = {
            Id: extInfo.TenantId.objectId || "",
            Name: extInfo.TenantId.TenantName || ""
          };
          localStorage.setItem("TenantId", tenant.Id);
          dispatch(showTenant(tenant.Name));
          localStorage.setItem("TenantName", tenant.Name);
        }
        localStorage.setItem("PageLanding", menu.pageId);
        localStorage.setItem("defaultmenuid", menu.menuId);
        localStorage.setItem("pageType", menu.pageType);
        navigate(location?.state?.from || `/${menu.pageType}/${menu.pageId}`);
      } catch (err) {
        console.error("Keycloak callback err", err);
        setError(err?.message || t("something-went-wrong-mssg"));
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen flex flex-col justify-center items-center gap-3 p-4">
      {!error ? <Loader /> : <Alert type="danger">{error}</Alert>}
    </div>
  );
}

export default KeycloakCallback;
