# MEX Fleet — Design System

> Leer este archivo antes de escribir cualquier CSS, clase Tailwind, o estilo inline.
> No inventar colores, fuentes, sombras, radios ni espaciados fuera de los definidos aquí.

---

## Fuente

**Una sola fuente: Inter**

```css
font-family: 'Inter', sans-serif;
```

Pesos permitidos: `400` (normal) · `500` (medium) · `600` (semibold) · `700` (bold)

**No usar:** Plus Jakarta Sans, Roboto, system-ui ni ninguna otra fuente.

---

## Escala tipográfica

| Token | Tamaño | Peso | Uso |
|---|---|---|---|
| Display | 24px | 600 | Títulos de página, dashboards |
| Heading 1 | 20px | 600 | Encabezados de sección |
| Heading 2 | 16px | 600 | Subtítulos, encabezados de card |
| Heading 3 | 14px | 600 | Labels de grupo, encabezados de tabla |
| Body | 14px | 400 | Texto general |
| Body Medium | 14px | 500 | Texto con énfasis |
| Caption | 12px | 400 | Texto secundario, metadatos |
| Label | 11px | 500 | Etiquetas en mayúsculas con `letter-spacing: 0.05em` |

---

## Paleta de colores

### Acento principal (Blue — Opción A)

```
--accent:          #3b82f6   ← botones primarios, links, focus rings, estados activos
--accent-hover:    #2563eb   ← hover sobre accent
--accent-light:    #93c5fd   ← texto sobre fondo oscuro, iconos activos
--accent-pale:     rgba(59, 130, 246, 0.12)  ← fondos de highlight, badges
```

### Brand (shell / sidebar — no usar en contenido)

```
--brand-dark:      #07111f   ← fondo del sidebar
--brand-navy:      #0d2a54   ← variante media del brand
--brand-emerald:   #2ecc71   ← SOLO para el sidebar accent, no en contenido
```

### Neutrales — Tailwind Slate (escala completa)

```
--slate-950:   #020617
--slate-900:   #0f172a
--slate-800:   #1e293b
--slate-700:   #334155
--slate-600:   #475569
--slate-500:   #64748b
--slate-400:   #94a3b8
--slate-300:   #cbd5e1
--slate-200:   #e2e8f0
--slate-100:   #f1f5f9
--slate-50:    #f8fafc
```

### Semánticos

```
--color-success:   #10b981
--color-warning:   #f59e0b
--color-error:     #ef4444
--color-info:      #3b82f6   (= --accent)
```

### Status de unidades (fleet)

| Estado | Background | Texto | Hex bg | Hex txt |
|---|---|---|---|---|
| LISTO | verde claro | verde oscuro | `#dcfce7` | `#166534` |
| SUCIO | amarillo claro | amarillo oscuro | `#fef9c3` | `#854d0e` |
| MANTENIMIENTO | rojo claro | rojo oscuro | `#fee2e2` | `#991b1b` |
| TRASLADO | morado claro | morado oscuro | `#f3e8ff` | `#6b21a8` |
| RESGUARDO | café claro | café oscuro | `#f5e6d3` | `#5c4033` |
| VENTA | slate oscuro | blanco | `#1e293b` | `#ffffff` |
| NO ARRENDABLE | cyan | — | `#34fbff` | `#0e7490` |

**No usar otros colores para estos estados.**

---

## Variables de tema (light / dark)

### Light mode (`:root`)

```css
--bg:        #f1f5f9;
--surface:   #ffffff;
--text:      #1e293b;
--text-muted:#64748b;
--border:    #e2e8f0;
--border-md: #cbd5e1;
```

### Dark mode (`body.dark-theme`)

```css
--bg:        #0f172a;
--surface:   #1e293b;
--text:      #f1f5f9;
--text-muted:#94a3b8;
--border:    #334155;
--border-md: #475569;
```

---

## Espaciado

Base unit: **4px**. Solo usar múltiplos:

```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96 px
```

No inventar valores intermedios (ej. 10px, 15px, 22px, 36px de padding).

---

## Border radius

```
--radius-sm:   4px    ← badges pequeños, chips
--radius-md:   8px    ← inputs, botones, cards pequeños
--radius-lg:   12px   ← cards, modales pequeños
--radius-xl:   16px   ← modales grandes, paneles
--radius-full: 9999px ← pills, avatares
```

---

## Sombras

```css
--shadow-sm:  0 1px 3px rgba(0, 0, 0, 0.08);
--shadow-md:  0 4px 12px rgba(0, 0, 0, 0.12);
--shadow-lg:  0 8px 24px rgba(0, 0, 0, 0.16);
--shadow-glass: inset 0 1px 0 rgba(255, 255, 255, 0.10);
```

---

## Componentes base

### Botones

```
Altura:       36px (dense) · 40px (normal)
Padding:      0 16px
Border-radius: --radius-md (8px)
Font:          14px / 500
```

| Variante | Background | Texto |
|---|---|---|
| Primary | `--accent` (#3b82f6) | `#ffffff` |
| Secondary | `--surface` | `--accent` + borde accent |
| Ghost | transparent | `--text` |
| Danger | `#ef4444` | `#ffffff` |

### Inputs / Selects

```
Altura:         36px (dense) · 40px (normal)
Padding:        0 12px
Border-radius:  --radius-md (8px)
Border:         1px solid var(--border-md)
Font:           14px / 400
Focus outline:  2px solid var(--accent), offset 2px
```

### Cards

```
Background:     var(--surface)
Border:         1px solid var(--border)
Border-radius:  --radius-lg (12px)
Shadow:         --shadow-sm
Padding:        16px · 24px
```

### Badges / Pills

```
Height:         20px (sm) · 24px (md)
Padding:        0 8px
Border-radius:  --radius-full
Font:           11px / 500
```

### Modales / Dialogs

```
Border-radius:  --radius-xl (16px)
Shadow:         --shadow-lg
Max-width:      480px (sm) · 640px (md) · 800px (lg)
```

---

## Íconos

**Material Symbols Outlined** — único set de íconos permitido.

```html
<span class="material-symbols-outlined">icon_name</span>
```

Tamaños: `16px · 18px · 20px · 24px` (font-size sobre el span).

No usar emojis como íconos funcionales en la UI.

---

## Lo que NO se debe hacer

- ❌ No usar fuentes distintas a Inter
- ❌ No inventar colores fuera de esta paleta (ej. `#ff6b35`, `#a855f7` suelto, etc.)
- ❌ No usar `--brand-emerald` (`#2ecc71`) fuera del sidebar
- ❌ No usar spacing fuera de la escala de 4px (ej. `padding: 10px 15px`)
- ❌ No usar border-radius arbitrarios (ej. `border-radius: 6px`, `10px`, `14px`)
- ❌ No hardcodear colores hex en CSS de componentes — usar siempre las variables
- ❌ No crear sombras con valores distintos a los definidos
- ❌ No usar `!important` salvo en overrides de dark-theme documentados
- ❌ No mezclar Tailwind utility classes con estilos inline contradictorios

---

## Archivos fuente

| Archivo | Contenido |
|---|---|
| [css/base.css](css/base.css) | Variables root, dark-theme, animaciones |
| [css/shell.css](css/shell.css) | App shell: sidebar, header, layout |
| [css/prog-panel.css](css/prog-panel.css) | Tema del panel programador |
| [js/tailwind-config.js](js/tailwind-config.js) | Extensiones Tailwind (tokens sincronizados) |

---

*Última actualización: 2026-05-25*
