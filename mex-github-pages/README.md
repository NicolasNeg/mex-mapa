# MEX MAPA — GitHub Pages + Firebase

## Archivos del proyecto

```
mex-mapa/
├── index.html          ← Tu app completa
├── mex-api.js          ← Adaptador Firebase (reemplaza google.script.run)
├── firestore.rules     ← Reglas de seguridad (pegar en Firebase Console)
├── MIGRAR_A_FIREBASE.gs ← Script de migración (pegar en Apps Script)
└── img/
    └── no-model.svg    ← Placeholder de imagen de autos
```

## Pasos de configuración

### 1. Crear proyecto en Firebase
- Ve a https://console.firebase.google.com
- Crea un proyecto
- Habilita Firestore Database en modo producción
- Ve a Configuración > Configuración del proyecto > SDK de la web
- Copia apiKey, projectId y appId

### 2. Editar mex-api.js
Busca el bloque FIREBASE_CONFIG al inicio del archivo y reemplaza los valores.

### 3. Migrar datos desde Google Sheets
- Abre tu proyecto de Apps Script
- Crea un archivo nuevo
- Pega el contenido de MIGRAR_A_FIREBASE.gs
- Reemplaza FIREBASE_PROJECT_ID y FIREBASE_API_KEY
- Ejecuta MIGRAR_TODO()

### 4. Subir a GitHub Pages
- Crea un repositorio en GitHub
- Sube todos los archivos
- Activa Pages en Settings > Pages > main branch

### 5. Copiar reglas de Firestore
- Firebase Console > Firestore > Reglas
- Pega el contenido de firestore.rules
