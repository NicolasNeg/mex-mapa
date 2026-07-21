'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;

function pass(scope, message) {
  passCount += 1;
  console.log(`PASS [${scope}] ${message}`);
}

function fail(scope, message) {
  failCount += 1;
  console.error(`FAIL [${scope}] ${message}`);
}

function readRequired(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  } catch (_) {
    fail('files', `No se pudo leer ${relativePath}.`);
    return null;
  }
}

function parseJson(relativePath, source) {
  if (source == null) return null;
  try {
    return JSON.parse(source);
  } catch (_) {
    fail('files', `${relativePath} no contiene JSON valido.`);
    return null;
  }
}

function normalizePattern(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function ignoreLines(source) {
  return new Set(
    String(source || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(normalizePattern)
  );
}

function hasAny(set, candidates) {
  return candidates.some((candidate) => set.has(normalizePattern(candidate)));
}

function checkHosting(firebaseConfig) {
  if (!firebaseConfig || !firebaseConfig.hosting || Array.isArray(firebaseConfig.hosting)) {
    fail('hosting', 'firebase.json debe definir un unico bloque hosting.');
    return;
  }

  const hosting = firebaseConfig.hosting;
  if (hosting.public === '.') {
    pass('hosting', 'El directorio publico es la raiz declarada de forma explicita.');
  } else {
    fail('hosting', 'hosting.public debe ser exactamente ".".');
  }

  const ignores = new Set(
    Array.isArray(hosting.ignore) ? hosting.ignore.map(normalizePattern) : []
  );
  const ignoreRequirements = [
    ['request.json', ['request.json']],
    ['request.json anidado', ['**/request.json']],
    ['serviceAccountKey.json', ['serviceaccountkey.json', '**/serviceaccountkey.json']],
    ['.worktrees', ['.worktrees/**', '**/.worktrees/**']],
    ['.agents', ['.agents/**', '**/.agents/**']],
    ['.claude', ['.claude/**', '**/.claude/**']],
    ['.firebase', ['.firebase/**', '**/.firebase/**']],
    ['Markdown', ['*.md', '**/*.md']],
    ['logs de la raiz', ['*.log']],
    ['logs anidados', ['**/*.log']]
  ];

  for (const [label, candidates] of ignoreRequirements) {
    if (!hasAny(ignores, candidates)) {
      fail('hosting-ignore', `Falta una exclusion explicita para ${label}.`);
    }
  }

  const packagesCovered = hasAny(ignores, ['package*.json', '**/package*.json'])
    || (hasAny(ignores, ['package.json']) && hasAny(ignores, ['package-lock.json']));
  if (!packagesCovered) {
    fail('hosting-ignore', 'Falta excluir package*.json (o package.json y package-lock.json).');
  }

  if (ignoreRequirements.every(([, candidates]) => hasAny(ignores, candidates)) && packagesCovered) {
    pass('hosting-ignore', 'Credenciales, metadatos de desarrollo, Markdown, paquetes y logs estan excluidos.');
  }

  const globalHeaders = Array.isArray(hosting.headers)
    ? hosting.headers.find((entry) => entry && entry.source === '**')
    : null;
  if (!globalHeaders || !Array.isArray(globalHeaders.headers)) {
    fail('headers', 'Falta un bloque global de headers para source "**".');
    return;
  }

  const headerMap = new Map();
  for (const header of globalHeaders.headers) {
    if (header && typeof header.key === 'string') {
      headerMap.set(header.key.toLowerCase(), String(header.value || '').trim());
    }
  }

  const hsts = headerMap.get('strict-transport-security') || '';
  const maxAge = /(?:^|;)\s*max-age=(\d+)/i.exec(hsts);
  if (maxAge && Number(maxAge[1]) >= 31536000 && /(?:^|;)\s*includesubdomains(?:;|$)/i.test(hsts)) {
    pass('headers', 'HSTS cubre al menos un ano e incluye subdominios.');
  } else {
    fail('headers', 'HSTS debe tener max-age>=31536000 e includeSubDomains.');
  }

  if ((headerMap.get('x-content-type-options') || '').toLowerCase() === 'nosniff') {
    pass('headers', 'X-Content-Type-Options esta fijado en nosniff.');
  } else {
    fail('headers', 'Falta X-Content-Type-Options: nosniff.');
  }

  if ((headerMap.get('x-frame-options') || '').toUpperCase() === 'SAMEORIGIN') {
    pass('headers', 'X-Frame-Options conserva los iframes del mismo origen.');
  } else {
    fail('headers', 'X-Frame-Options debe ser SAMEORIGIN.');
  }

  const referrerPolicy = (headerMap.get('referrer-policy') || '').toLowerCase();
  const acceptedReferrerPolicies = new Set([
    'no-referrer',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin'
  ]);
  if (acceptedReferrerPolicies.has(referrerPolicy)) {
    pass('headers', `Referrer-Policy usa una politica restrictiva (${referrerPolicy}).`);
  } else {
    fail('headers', 'Falta una Referrer-Policy restrictiva reconocida.');
  }

  const csp = (headerMap.get('content-security-policy') || '').toLowerCase();
  const directives = new Map();
  for (const rawDirective of csp.split(';')) {
    const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) directives.set(tokens[0], tokens.slice(1));
  }

  const cspChecks = [
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['frame-ancestors', "'self'"]
  ];
  let cspValid = true;
  for (const [directive, requiredValue] of cspChecks) {
    const values = directives.get(directive) || [];
    if (!values.includes(requiredValue)) {
      cspValid = false;
      fail('headers', `CSP debe incluir ${directive} ${requiredValue}.`);
    }
  }
  if (cspValid) {
    pass('headers', "CSP protege base-uri, object-src y frame-ancestors.");
  }
}

function checkIgnoreFiles(gitignoreSource, firebaseignoreSource) {
  const gitignore = ignoreLines(gitignoreSource);
  const firebaseignore = ignoreLines(firebaseignoreSource);

  const gitRequirements = [
    ['request.json', ['request.json']],
    ['serviceAccountKey.json', ['serviceaccountkey.json']],
    ['.env', ['.env']],
    ['.firebase', ['.firebase', '.firebase/**']],
    ['logs', ['*.log']]
  ];
  let gitValid = true;
  for (const [label, candidates] of gitRequirements) {
    if (!hasAny(gitignore, candidates)) {
      gitValid = false;
      fail('gitignore', `Falta ignorar ${label}.`);
    }
  }
  if (gitValid) pass('gitignore', 'Los archivos locales sensibles no se versionan por accidente.');

  const firebaseRequirements = [
    ['request.json', ['request.json']],
    ['.env', ['.env']],
    ['.firebase', ['.firebase', '.firebase/**']],
    ['logs', ['*.log']]
  ];
  let firebaseIgnoreValid = true;
  for (const [label, candidates] of firebaseRequirements) {
    if (!hasAny(firebaseignore, candidates)) {
      firebaseIgnoreValid = false;
      fail('firebaseignore', `Falta ignorar ${label}.`);
    }
  }
  if (firebaseIgnoreValid) {
    pass('firebaseignore', 'La carga de Firebase excluye temporales y configuracion local sensible.');
  }
}

function checkRules(firestoreRules, storageRules) {
  if (firestoreRules == null || storageRules == null) return;

  let firestoreValid = true;
  const firestoreRequirements = [
    [/rules_version\s*=\s*['"]2['"]\s*;/, 'Firestore debe usar rules_version 2.'],
    [/request\.auth\s*!=\s*null/, 'Firestore debe exigir autenticacion en sus helpers.'],
    [/\.keys\(\)\.has(?:Only|All)\s*\(/, 'Firestore debe validar esquemas o campos requeridos.'],
    [/\.diff\s*\([^)]*\)\.affectedKeys\(\)[\s\S]{0,120}?\.hasOnly\s*\(/, 'Firestore debe limitar campos modificables con diff().'],
    [/allow\s+write\s*:\s*if\s+false\s*;/, 'Firestore debe reservar escrituras sensibles para Admin SDK.']
  ];
  for (const [pattern, message] of firestoreRequirements) {
    if (!pattern.test(firestoreRules)) {
      firestoreValid = false;
      fail('firestore-rules', message);
    }
  }
  if (/allow\s+(?:read|write|create|update|delete)(?:\s*,\s*(?:read|write|create|update|delete))*\s*:\s*if\s+true\s*;/i.test(firestoreRules)) {
    firestoreValid = false;
    fail('firestore-rules', 'Existe un allow incondicional con if true.');
  }
  if (firestoreValid) {
    pass('firestore-rules', 'Hay autenticacion, validacion de campos y escrituras reservadas al servidor.');
  }

  let storageValid = true;
  const defaultDeny = /match\s+\/\{(?:allPaths|path|document)=\*\*\}\s*\{[\s\S]{0,250}?allow\s+(?:read\s*,\s*write|write\s*,\s*read)\s*:\s*if\s+false\s*;/i;
  const storageRequirements = [
    [/rules_version\s*=\s*['"]2['"]\s*;/, 'Storage debe usar rules_version 2.'],
    [/request\.auth\s*!=\s*null/, 'Storage debe exigir autenticacion.'],
    [/request\.resource\.size\s*</, 'Storage debe limitar el tamano de cargas.'],
    [/request\.resource\.contentType/, 'Storage debe validar tipos de contenido.'],
    [defaultDeny, 'Storage debe terminar con una regla comodin que deniegue lectura y escritura.']
  ];
  for (const [pattern, message] of storageRequirements) {
    if (!pattern.test(storageRules)) {
      storageValid = false;
      fail('storage-rules', message);
    }
  }
  if (/allow\s+(?:read|write|create|update|delete)(?:\s*,\s*(?:read|write|create|update|delete))*\s*:\s*if\s+true\s*;/i.test(storageRules)) {
    storageValid = false;
    fail('storage-rules', 'Existe un allow incondicional con if true.');
  }
  if (storageValid) {
    pass('storage-rules', 'Hay autenticacion, limites de carga, tipos permitidos y default deny.');
  }
}

function checkServiceWorker(relativePath, source) {
  if (source == null) return;

  const hasCandidate = /\bconst\s+candidate\s*=\s*new\s+URL\s*\(/.test(source);
  const validatesOrigin = /candidate\.origin\s*===\s*(?:self|root)\.location\.origin/.test(source);
  const hasSafeNavigate = /\.navigate\s*\(\s*targetUrl\s*\)/.test(source);
  const hasSafeOpenWindow = /\bclients\.openWindow\s*\(\s*targetUrl\s*\)/.test(source);
  const navigationCalls = [
    ...source.matchAll(/(?:\.navigate|\bclients\.openWindow)\s*\(\s*([^,)\n]+)/g)
  ];
  const allCallsUseValidatedTarget = navigationCalls.length > 0
    && navigationCalls.every((match) => match[1].trim() === 'targetUrl');

  if (!hasCandidate) fail('service-worker', `${relativePath} no construye una URL candidate.`);
  if (!validatesOrigin) fail('service-worker', `${relativePath} no compara candidate.origin con el origen propio.`);
  if (!hasSafeNavigate) fail('service-worker', `${relativePath} no usa targetUrl al navegar un cliente.`);
  if (!hasSafeOpenWindow) fail('service-worker', `${relativePath} no usa targetUrl al abrir una ventana.`);
  if (!allCallsUseValidatedTarget) {
    fail('service-worker', `${relativePath} contiene una navegacion que no usa targetUrl validado.`);
  }

  if (hasCandidate && validatesOrigin && hasSafeNavigate && hasSafeOpenWindow && allCallsUseValidatedTarget) {
    pass('service-worker', `${relativePath} limita notificationclick al mismo origen.`);
  }
}

function trackedFiles() {
  const result = spawnSync(
    'git',
    ['-c', 'core.excludesFile=', 'ls-files', '-z'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  if (result.error || result.status !== 0) {
    fail('secret-scan', 'No se pudo obtener la lista de archivos trackeados con git ls-files.');
    return null;
  }
  return result.stdout.split('\0').filter(Boolean);
}

function scanTrackedSecrets(files) {
  if (files == null) return;

  const secretPatterns = [
    {
      name: 'clave privada PEM',
      regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE\s+KEY-----/i
    },
    {
      name: 'Google OAuth client secret',
      regex: /GOCSPX-[0-9A-Za-z_-]{20,}/
    },
    {
      name: 'client_secret embebido',
      regex: /["']?client_secret["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i
    },
    {
      name: 'AWS access key',
      regex: /AKIA[0-9A-Z]{16}/
    },
    {
      name: 'GitHub token',
      regex: /(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{20,})/
    },
    {
      name: 'Slack token',
      regex: /xox[baprs]-[0-9A-Za-z-]{20,}/
    },
    {
      name: 'Stripe live secret',
      regex: /(?:sk|rk)_live_[0-9A-Za-z]{16,}/
    },
    {
      name: 'Google API key fuera de config publica',
      regex: /AIza[0-9A-Za-z_-]{30,}/,
      allowedFiles: new Set(['firebase-messaging-sw.js', 'js/core/firebase-config.js'])
    }
  ];

  let scanned = 0;
  let skippedBinary = 0;
  let findings = 0;

  for (const gitPath of files) {
    const relativePath = gitPath.replace(/\\/g, '/');
    const absolutePath = path.resolve(ROOT, relativePath);
    if (absolutePath !== ROOT && !absolutePath.startsWith(`${ROOT}${path.sep}`)) {
      fail('secret-scan', `Ruta trackeada fuera del repositorio: ${relativePath}.`);
      findings += 1;
      continue;
    }

    let stat;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch (_) {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;

    let buffer;
    try {
      buffer = fs.readFileSync(absolutePath);
    } catch (_) {
      fail('secret-scan', `No se pudo inspeccionar ${relativePath}.`);
      findings += 1;
      continue;
    }

    const probe = buffer.subarray(0, Math.min(buffer.length, 8192));
    if (probe.includes(0)) {
      skippedBinary += 1;
      continue;
    }

    const source = buffer.toString('utf8');
    scanned += 1;
    for (const pattern of secretPatterns) {
      if (pattern.allowedFiles && pattern.allowedFiles.has(relativePath)) continue;
      if (pattern.regex.test(source)) {
        findings += 1;
        fail('secret-scan', `${pattern.name} detectado en ${relativePath}; el valor no se muestra.`);
      }
    }
  }

  if (findings === 0) {
    pass('secret-scan', `${scanned} archivos de texto trackeados revisados; ${skippedBinary} binarios omitidos; sin secretos detectados.`);
  }
}

console.log('Security preflight\n');

const firebaseJsonSource = readRequired('firebase.json');
const gitignoreSource = readRequired('.gitignore');
const firebaseignoreSource = readRequired('.firebaseignore');
const firestoreRules = readRequired('firestore.rules');
const storageRules = readRequired('storage.rules');
const serviceWorker = readRequired('sw.js');
const messagingServiceWorker = readRequired('firebase-messaging-sw.js');

checkHosting(parseJson('firebase.json', firebaseJsonSource));
checkIgnoreFiles(gitignoreSource, firebaseignoreSource);
checkRules(firestoreRules, storageRules);
checkServiceWorker('sw.js', serviceWorker);
checkServiceWorker('firebase-messaging-sw.js', messagingServiceWorker);

const forbiddenRootFiles = [
  'request.json',
  'serviceAccountKey.json'
];
// firebase-debug.log / *-debug.log los crea el CLI durante `firebase deploy`
// (antes del predeploy). Ya estan en hosting.ignore / .gitignore / .firebaseignore.
const presentForbiddenFiles = forbiddenRootFiles.filter(file => fs.existsSync(path.join(ROOT, file)));
if (presentForbiddenFiles.length > 0) {
  presentForbiddenFiles.forEach(file => fail('files', `${file} existe dentro de la raiz publica.`));
} else {
  pass('files', 'No hay credenciales ni logs de depuracion dentro de la raiz publica.');
}

scanTrackedSecrets(trackedFiles());

console.log(`\nResultado: ${passCount} PASS, ${failCount} FAIL.`);
if (failCount > 0) process.exitCode = 1;
