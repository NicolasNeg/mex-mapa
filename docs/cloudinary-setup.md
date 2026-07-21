# Cloudinary setup (mex-mapa)

Cloudinary is the **primary** media store for images and uploads.  
Firebase Storage remains **only** for indispensable empresa branding (`empresa_config/logo*`, icons, similar branding assets).

## Architecture

1. Browser calls Cloud Function `getCloudinaryUploadSignature` (auth required).
2. Function signs upload params with `CLOUDINARY_API_SECRET` (never sent to the client).
3. Browser uploads the file directly to Cloudinary.
4. Firestore stores `{ url, publicId, provider: 'cloudinary' }` or at least the HTTPS `url`. Legacy Firebase paths/URLs still resolve via `resolveMediaUrl`.

Client module: `js/core/media-upload.js`  
Functions: `getCloudinaryUploadSignature`, `destroyCloudinaryMedia`, and TTL cleanup in `limpiarFotosReportesPapeletas`.

## Secrets (Functions) — do not commit

Set these in the Functions runtime (production / staging):

| Variable | Purpose |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloud name |
| `CLOUDINARY_API_KEY` | API key (returned to client with signature only) |
| `CLOUDINARY_API_SECRET` | **Server only** — signs uploads / destroy |

### Option A — Firebase Secret Manager (recommended)

```bash
firebase functions:secrets:set CLOUDINARY_CLOUD_NAME --project production
firebase functions:secrets:set CLOUDINARY_API_KEY --project production
firebase functions:secrets:set CLOUDINARY_API_SECRET --project production
```

Then bind them to the Functions runtime (Cloud Console → Cloud Functions → edit → Secrets / env), **or** set the same names as environment variables for the `us-central1` functions. The code reads `process.env.CLOUDINARY_*`.

### Option B — Legacy functions config

```bash
firebase functions:config:set ^
  cloudinary.cloud_name="YOUR_CLOUD_NAME" ^
  cloudinary.api_key="YOUR_API_KEY" ^
  cloudinary.api_secret="YOUR_API_SECRET" ^
  --project production
```

Redeploy functions after changing config:

```bash
npm run deploy:functions
```

### Option C — Local / emulator `.env`

Create `functions/.env` (gitignored) for local testing:

```
CLOUDINARY_CLOUD_NAME=your_cloud
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
```

**Never commit** `.env`, secrets, or real credentials.

## Client-safe config (Firestore)

In `configuracion/empresa` (surfaced as `MEX_CONFIG.media` / `MEX_CONFIG.empresa.media`):

```json
{
  "media": {
    "provider": "cloudinary",
    "cloudName": "YOUR_CLOUD_NAME",
    "baseFolder": "mapgestion/prod"
  }
}
```

- `cloudName` and `baseFolder` are public-safe.
- **Do not** put `apiSecret` in Firestore or any client bundle.

## Folder tree (canonical)

Root: **`mapgestion`** (not `mex`). Default base: `mapgestion/prod`.

Callers pass a **relative** feature folder; `uploadMedia` / `resolveUploadFolder` joins it under `baseFolder` and de-dupes accidental doubles.

```
mapgestion/prod/
├── catalogo_modelos/
├── profile_avatars/{uid}/
├── licencias_choferes/{uid}/
├── papeletas/{id}/
│   ├── zonas/
│   ├── danos/
│   └── firma/
├── papeletas_reportes/{id}/
├── papeletas_ventas/{id}/
├── notas_adjuntos/{id}/
├── evidencias_cuadre/{id}/
├── mensajes_chat/
├── alertas/
├── turnos/
│   ├── checadas/{uid}/
│   └── firmas/{uid}/
└── maps/backgrounds/{viewId}/
```

Staging / dev equivalents: `mapgestion/staging/…`, `mapgestion/dev/…`  
Allowed prefixes on the server: `mapgestion/prod/`, `mapgestion/staging/`, `mapgestion/dev/`.

Cloudinary creates folders on first upload with that prefix — no Admin API bootstrap required.

## What stays on Firebase Storage

- `empresa_config/logo*` and similar branding under `empresa_config/`

## What goes to Cloudinary (new uploads)

Papeletas photos/firma/damage, reportes/ventas, notas adjuntos, evidencias cuadre, avatars, catálogo modelos, map backgrounds, licencias, mensajes, turnos checadas/firmas, alertas images, etc.

Legacy Firebase URLs/paths continue to display via `resolveMediaUrl`.

## If secrets are missing

Uploads fail with a clear `mexAlert`: **“Configura Cloudinary”**. No fake credentials are invented.

## Deploy checklist

1. Set Functions secrets / env vars (above).
2. Set `configuracion/empresa.media.cloudName` (+ `baseFolder: "mapgestion/prod"`).
3. `npm run deploy:functions` (and hosting if client changes): `npm run deploy:full`.
4. Smoke-test one upload (avatar or papeleta foto) while signed in.
