// Pure identity helpers for Mensajes. This module has no Firebase dependencies.

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function upper(value) {
  return clean(value).toUpperCase();
}

export function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  return email && email.includes('@') ? email : '';
}

function normalizeAlias(value) {
  return upper(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function profileUid(profile) {
  return clean(profile?.authUid || profile?.uid);
}

function profileEmail(profile) {
  return normalizeEmail(profile?.email) || normalizeEmail(profile?.id);
}

function profileLabel(profile, email = '') {
  return upper(
    profile?.nombre ||
    profile?.nombreCompleto ||
    profile?.usuario ||
    email ||
    profile?.id ||
    'USUARIO'
  );
}

function timestampMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function profilePriority(profile = {}) {
  const status = upper(profile.status || 'ACTIVO');
  const enabled = !['INACTIVO', 'RECHAZADO', 'BLOQUEADO', 'SUSPENDIDO'].includes(status)
    && profile.activo !== false
    && profile.autorizado !== false
    && profile.accesoSistema !== false;
  const recency = Math.max(...[
    profile.updatedAt,
    profile.lastSeenAt,
    profile.lastActiveAt,
    profile.ultimaConexionTs,
    profile.fechaActualizacion
  ].map(timestampMillis));
  return [enabled ? 1 : 0, profile.isOnline === true ? 1 : 0, recency, profileUid(profile) ? 1 : 0];
}

function isHigherPriority(next, current) {
  if (!current) return true;
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  return false;
}

function fallbackIdentity(raw, explicitEmail = '', explicitUid = '') {
  const uid = clean(explicitUid);
  const email = normalizeEmail(explicitEmail) || normalizeEmail(raw);
  const normalizedRaw = upper(raw || email || uid);

  if (uid) {
    return {
      key: `UID:${uid}`,
      uid,
      email,
      label: normalizedRaw || email.toUpperCase() || uid,
      raw: normalizedRaw
    };
  }

  if (email) {
    return {
      key: `EMAIL:${email}`,
      uid: '',
      email,
      label: email.toUpperCase(),
      raw: normalizedRaw || email.toUpperCase()
    };
  }

  const legacy = normalizeAlias(raw);
  return {
    key: `LEGACY:${legacy}`,
    uid: '',
    email: '',
    label: normalizedRaw || 'USUARIO',
    raw: normalizedRaw
  };
}

function addAlias(aliasIndex, value, key) {
  const alias = normalizeAlias(value);
  if (!alias) return;
  const matches = aliasIndex.get(alias) || new Set();
  matches.add(key);
  aliasIndex.set(alias, matches);
}

function resolveUniqueAlias(directory, value) {
  const alias = normalizeAlias(value);
  if (!alias || !directory?.aliasIndex) return null;
  const matches = directory.aliasIndex.get(alias);
  if (!matches || matches.size !== 1) return null;
  const [key] = matches;
  return directory.identities.get(key) || null;
}

function identityWithRaw(identity, raw) {
  return {
    key: identity.key,
    uid: identity.uid || '',
    email: identity.email || '',
    label: identity.label || identity.email?.toUpperCase() || 'USUARIO',
    raw: upper(raw || identity.email || identity.label || identity.uid)
  };
}

export function buildIdentityDirectory(users = []) {
  const identities = new Map();
  const aliasIndex = new Map();
  const records = [];
  const identityPriorities = new Map();
  const profiles = Array.isArray(users) ? users : [];
  const emailUidCandidates = new Map();

  for (const profile of profiles) {
    const email = profileEmail(profile);
    const uid = profileUid(profile);
    if (!email || !uid) continue;
    const matches = emailUidCandidates.get(email) || new Set();
    matches.add(uid);
    emailUidCandidates.set(email, matches);
  }

  for (const profile of profiles) {
    const directUid = profileUid(profile);
    const email = profileEmail(profile);
    const uidCandidates = email ? emailUidCandidates.get(email) : null;
    const uid = directUid || (uidCandidates?.size === 1 ? [...uidCandidates][0] : '');
    const label = profileLabel(profile, email);
    const legacy = normalizeAlias(label);
    const key = uid
      ? `UID:${uid}`
      : email
        ? `EMAIL:${email}`
        : `LEGACY:${legacy}`;

    if (!uid && !email && !legacy) continue;

    const current = identities.get(key);
    const priority = profilePriority(profile);
    const useProfile = isHigherPriority(priority, identityPriorities.get(key));
    const identity = {
      key,
      uid: uid || current?.uid || '',
      email: (useProfile ? email : current?.email) || email || current?.email || '',
      label: (useProfile && label !== 'USUARIO' ? label : current?.label) || label,
      raw: (useProfile ? label : current?.raw) || label
    };
    identities.set(key, identity);
    if (useProfile) identityPriorities.set(key, priority);
    records.push({ profile, identity });
  }

  for (const { profile, identity } of records) {
    const aliases = [
      identity.key,
      identity.uid,
      identity.email,
      profile?.id,
      profile?.email,
      profile?.nombre,
      profile?.nombreCompleto,
      profile?.usuario
    ];
    for (const alias of aliases) addAlias(aliasIndex, alias, identity.key);
  }

  return { identities, aliasIndex };
}

export function getCanonicalMessageIdentity(
  raw,
  explicitEmail = '',
  directory = null,
  explicitUid = ''
) {
  const uid = clean(explicitUid);
  const email = normalizeEmail(explicitEmail) || normalizeEmail(raw);

  if (uid) {
    const direct = directory?.identities?.get(`UID:${uid}`);
    if (direct) return identityWithRaw(direct, raw || email || uid);
    return fallbackIdentity(raw, email, uid);
  }

  if (email) {
    const resolved = resolveUniqueAlias(directory, email);
    if (resolved) return identityWithRaw(resolved, raw || email);
    return fallbackIdentity(raw, email);
  }

  const resolved = resolveUniqueAlias(directory, raw);
  if (resolved) return identityWithRaw(resolved, raw);
  return fallbackIdentity(raw);
}

export function getDisplayIdentity(side) {
  if (!side) return '-';
  return side.label || (side.email ? side.email.toUpperCase() : '') || side.raw || '-';
}

export function buildMyIdentity(profile = {}) {
  const uid = profileUid(profile);
  const email = profileEmail(profile);
  const display = profileLabel(profile, email);
  const aliases = new Set();
  const queryIdentities = [];

  for (const value of [
    uid,
    profile?.nombre,
    profile?.usuario,
    profile?.nombreCompleto,
    profile?.email,
    normalizeEmail(profile?.id)
  ]) {
    const queryValue = upper(value);
    const alias = normalizeAlias(value);
    if (queryValue && !queryIdentities.includes(queryValue)) queryIdentities.push(queryValue);
    if (alias) aliases.add(alias);
  }
  if (uid) aliases.add(normalizeAlias(uid));

  const identity = fallbackIdentity(display, email, uid);
  return {
    key: identity.key,
    uid,
    email,
    label: display,
    display,
    aliases,
    queryIdentities
  };
}

function sideField(message, side, suffix) {
  const capitalized = suffix.charAt(0).toUpperCase() + suffix.slice(1);
  return message?.[`${side}${capitalized}`] ?? message?.[`${side}_${suffix}`] ?? '';
}

export function getMessageSideIdentity(message, directory = null) {
  const remitente = getCanonicalMessageIdentity(
    message?.remitente,
    sideField(message, 'remitente', 'email'),
    directory,
    sideField(message, 'remitente', 'uid')
  );
  const destinatario = getCanonicalMessageIdentity(
    message?.destinatario,
    sideField(message, 'destinatario', 'email'),
    directory,
    sideField(message, 'destinatario', 'uid')
  );
  return { remitente, destinatario };
}

function isMineSide(side, me, directory) {
  if (!side || !me) return false;
  const mine = getCanonicalMessageIdentity(me.display, me.email, directory, me.uid);
  if (side.key && mine.key && side.key === mine.key) return true;
  if (side.uid && me.uid && side.uid === me.uid) return true;
  if (side.email && me.email && side.email === me.email) return true;
  return me.aliases instanceof Set && [side.raw, side.label, side.email, side.uid]
    .some(value => value && me.aliases.has(normalizeAlias(value)));
}

export function isMessageMine(message, me, directory = null) {
  if (!me) return false;
  const { remitente, destinatario } = getMessageSideIdentity(message, directory);
  const remitIsMine = isMineSide(remitente, me, directory);
  const destIsMine = isMineSide(destinatario, me, directory);

  if (remitIsMine && !destIsMine) return true;
  if (!remitIsMine && destIsMine) return false;
  return message?.esMio === true;
}

export function getPeerSide(message, me, directory = null) {
  const { remitente, destinatario } = getMessageSideIdentity(message, directory);
  return isMessageMine(message, me, directory) ? destinatario : remitente;
}

export function getPeerKey(message, me, directory = null) {
  return getPeerSide(message, me, directory).key;
}

export function canonicalizePeerKey(peerKey, directory = null) {
  const rawKey = clean(peerKey);
  if (!rawKey) return '';

  const separator = rawKey.indexOf(':');
  const prefix = separator > 0 ? rawKey.slice(0, separator).toUpperCase() : '';
  const value = separator > 0 ? rawKey.slice(separator + 1) : rawKey;

  if (prefix === 'UID') {
    const direct = directory?.identities?.get(`UID:${value}`);
    return direct?.key || `UID:${value}`;
  }

  if (prefix === 'EMAIL') {
    return getCanonicalMessageIdentity(value, value, directory).key;
  }

  if (prefix === 'LEGACY') {
    return getCanonicalMessageIdentity(value, '', directory).key;
  }

  return getCanonicalMessageIdentity(value, normalizeEmail(value), directory).key;
}

export function canonicalizeArchivedConversations(archived, directory = null) {
  if (!archived || typeof archived !== 'object' || Array.isArray(archived)) return {};
  const canonical = {};

  for (const [peerKey, archivedAt] of Object.entries(archived)) {
    const key = canonicalizePeerKey(peerKey, directory);
    if (!key || !archivedAt) continue;
    const previous = canonical[key];
    canonical[key] = previous == null || Number(archivedAt) > Number(previous)
      ? archivedAt
      : previous;
  }

  return canonical;
}
