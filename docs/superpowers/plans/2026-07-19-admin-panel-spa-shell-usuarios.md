# Admin Panel SPA Shell + Usuarios — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace iframe-only `/app/admin` with native SPA shell (CONTROLES sidebar) and first LISTAS module: Usuarios (cards + detail).

**Architecture:** `admin-shell.js` mounts chrome + routes section; `usuarios` is native; other sections keep legacy iframe until migrated.

**Tech Stack:** Vanilla ES modules, Firestore via `admin-users-data.js`, CSS `app-admin.css` + chrome tokens.

**Spec:** `docs/superpowers/specs/2026-07-19-admin-panel-reglas-spa-design.md`

---

### Task 1: Admin shell view + router wiring

**Files:** `js/app/views/admin-shell.js` (new), `js/app/router.js`, `css/app-admin.css` (new/extend)

### Task 2: Usuarios LISTAS module

**Files:** `js/app/features/admin/admin-usuarios-view.js` (or inline in shell section), reuse `admin-users-data.js` + `mergeAdminUserBasics`

### Task 3: Legacy fallback iframe for non-migrated tabs

### Task 4: Bump SW + commit + push
