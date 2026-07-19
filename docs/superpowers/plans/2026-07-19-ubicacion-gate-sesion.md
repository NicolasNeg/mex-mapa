# Ubicación gate + sesión anti-loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or implement inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el gate de geolocalización a industrial-minimal y endurecer reload/kick de sesión (anti-loop) en SPA + legacy.

**Architecture:** Parches en `app-bootstrap.js` (UI + caché por usuario + gate mid-sesión) y watcher de perfil en `js/app/main.js` (paridad con anti-loop de `mapa.js`). Sin nuevos módulos salvo necesidad.

**Tech Stack:** Vanilla JS, Firestore onSnapshot, Geolocation API, ESTILO.md tokens.

## Global Constraints

- Visual industrial: card opaca, `#3b82f6`, sin glass/gradient verde.
- Revocación mid-sesión → gate bloqueante inmediato.
- Anti-loop: firma localStorage + limpiar `_reloadRequired` antes de reload.
- Usuario inactivo/eliminado → signOut.
- Caché ubicación keyed por email.

---

### Task 1: Rediseño gate + caché por usuario + revoke mid-session
**Files:** `js/core/app-bootstrap.js`

### Task 2: SPA require location + session reload/kick watcher
**Files:** `js/app/main.js`

### Task 3: Verify + bump SW + commit/push
