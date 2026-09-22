import axios from 'axios';
import crypto from 'node:crypto';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

const keycloakUrl = (process.env.KEYCLOAK_URL || '').replace(/\/$/, '');
const keycloakRealm = process.env.KEYCLOAK_REALM || '';
const keycloakTenantId = process.env.KEYCLOAK_TENANT_ID || '';
const defaultRole = process.env.KEYCLOAK_DEFAULT_ROLE || 'contracts_User';

function normalizeEmail(email) {
  return email?.toLowerCase()?.replace(/\s/g, '');
}

function userInfoUrl() {
  return `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/userinfo`;
}

// Verify access token against Keycloak userinfo (public client + PKCE, no secret).
// Phase 2 hardening: verify idToken signature via JWKS (jose) — see README note below.
async function fetchKeycloakProfile(accessToken) {
  const res = await axios.get(userInfoUrl(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
  return res.data;
}

async function loginAs(userId) {
  const serverUrl = cloudServerUrl;
  const url = `${serverUrl}/loginAs`;
  const axiosRes = await axios({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Master-Key': process.env.MASTER_KEY,
    },
    params: { userId },
  });
  return axiosRes.data;
}

async function findOrCreateUser({ email, name }) {
  const normalizedEmail = normalizeEmail(email);
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('username', email);
  const existing = await userQuery.first({ useMasterKey: true });
  if (existing) {
    // Ensure emailVerified so SSO users pass document gates
    if (!existing.get('emailVerified')) {
      existing.set('emailVerified', true);
      existing.set('email', normalizedEmail);
      await existing.save(null, { useMasterKey: true });
    }
    return existing;
  }
  const user = new Parse.User();
  user.set('username', email);
  user.set('password', crypto.randomBytes(32).toString('hex'));
  user.set('email', normalizedEmail);
  user.set('normalizedEmail', normalizedEmail);
  user.set('name', name || email);
  user.set('emailVerified', true);
  const saved = await user.signUp(null, { useMasterKey: true });
  return saved;
}

async function findOrCreateExtUser({ parseUser, email, name }) {
  const normalizedEmail = normalizeEmail(email);
  const extQuery = new Parse.Query('contracts_Users');
  extQuery.equalTo('Email', normalizedEmail);
  extQuery.include('TenantId');
  const existing = await extQuery.first({ useMasterKey: true });
  if (existing) {
    if (existing.get('IsDisabled')) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User is disabled.');
    }
    return existing;
  }
  if (!keycloakTenantId) {
    throw new Parse.Error(
      Parse.Error.CONFIGURATION_ERROR || 147,
      'KEYCLOAK_TENANT_ID is not configured.'
    );
  }
  // Never auto-provision Admin via SSO — fixed to contracts_User/Editor only
  const safeRole =
    defaultRole === 'contracts_User' || defaultRole === 'contracts_Editor'
      ? defaultRole
      : 'contracts_User';
  const extCls = Parse.Object.extend('contracts_Users');
  const extUser = new extCls();
  extUser.set('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: parseUser.id,
  });
  extUser.set('UserRole', safeRole);
  extUser.set('Email', normalizedEmail);
  extUser.set('Name', name || email);
  extUser.set('TenantId', {
    __type: 'Pointer',
    className: 'partners_Tenant',
    objectId: keycloakTenantId,
  });
  extUser.set('CreatedBy', {
    __type: 'Pointer',
    className: '_User',
    objectId: parseUser.id,
  });
  const saved = await extUser.save(null, { useMasterKey: true });
  return saved;
}

export default async function loginWithKeycloak(request) {
  try {
    if (!keycloakUrl || !keycloakRealm) {
      throw new Parse.Error(
        Parse.Error.CONFIGURATION_ERROR || 147,
        'Keycloak is not configured.'
      );
    }
    const accessToken = request.params?.accessToken;
    if (!accessToken) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, 'Missing accessToken.');
    }
    let profile;
    try {
      profile = await fetchKeycloakProfile(accessToken);
    } catch (err) {
      console.log('loginWithKeycloak userinfo failed', err?.response?.status);
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Keycloak token is invalid.');
    }
    const email = normalizeEmail(profile?.email || '');
    if (!email) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Keycloak email is missing.');
    }
    const name = profile?.name || profile?.preferred_username || email;

    const parseUser = await findOrCreateUser({ email, name });
    await findOrCreateExtUser({ parseUser, email, name });
    const session = await loginAs(parseUser.id);
    return {
      id: session.objectId,
      sessionToken: session.sessionToken,
      email,
      name,
    };
  } catch (err) {
    console.log('Err loginWithKeycloak', err?.message);
    if (err instanceof Parse.Error) throw err;
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR || 1, 'Keycloak login failed.');
  }
}
