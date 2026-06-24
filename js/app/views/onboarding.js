import { TIPOS_NEGOCIO } from '/js/app/features/onboarding/onboarding-config.js';
import {
  configurarTipoNegocio,
  guardarPlazas,
  completarOnboarding,
  getEstadoOnboarding,
  registrarImportacion,
} from '/js/app/features/onboarding/onboarding-data.js';
import { importarDesdeArchivo, generarTemplateCsv } from '/js/app/features/unidades/unidades-data.js';

let _container = null;
let _navigate = null;
let _empresaId = null;
let _step = 'tipo';
let _tipoSeleccionado = null;
let _plazas = [];
let _importResult = null;

const STEPS = ['tipo', 'plazas', 'unidades', 'done'];

function _empresaIdFromCtx() {
  return String(window.MEX_CONFIG?.empresa?.id || '').trim();
}

function _esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _stepIndex(step) {
  return STEPS.indexOf(step);
}

function _renderStepIndicator(activeStep) {
  const labels = ['Tipo de negocio', 'Plazas', 'Unidades', 'Listo'];
  return `
    <div style="display:flex;align-items:center;gap:0;margin-bottom:32px;justify-content:center;">
      ${STEPS.map((s, i) => {
        const active = s === activeStep;
        const done = _stepIndex(activeStep) > i;
        const bg = done ? '#22c55e' : active ? '#0f172a' : '#e2e8f0';
        const color = (done || active) ? '#fff' : '#94a3b8';
        const labelColor = active ? '#0f172a' : done ? '#22c55e' : '#94a3b8';
        return `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${bg};color:${color};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">
              ${done ? '<span class="material-symbols-outlined" style="font-size:16px;">check</span>' : i + 1}
            </div>
            <span style="font-size:11px;font-weight:600;color:${labelColor};white-space:nowrap;">${_esc(labels[i])}</span>
          </div>
          ${i < STEPS.length - 1 ? `<div style="flex:1;min-width:24px;height:2px;background:${done ? '#22c55e' : '#e2e8f0'};margin:0 6px;margin-bottom:20px;"></div>` : ''}
        `;
      }).join('')}
    </div>
  `;
}

function _renderTipo() {
  const tipos = Object.values(TIPOS_NEGOCIO);
  return `
    <div style="max-width:680px;margin:0 auto;padding:32px 16px;">
      ${_renderStepIndicator('tipo')}
      <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 6px;">¿Qué tipo de negocio operas?</h1>
      <p style="font-size:14px;color:#64748b;margin:0 0 28px;">Esta selección define cómo se configuran las unidades y la operación.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:32px;" id="tipo-cards">
        ${tipos.map(t => `
          <button
            type="button"
            data-tipo="${_esc(t.id)}"
            style="text-align:left;padding:20px;border-radius:14px;border:2px solid ${_tipoSeleccionado === t.id ? '#0f172a' : '#e2e8f0'};background:${_tipoSeleccionado === t.id ? '#f8fafc' : '#fff'};cursor:pointer;transition:border-color .15s;outline:none;"
          >
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">${_esc(t.label)}</div>
            <div style="font-size:12px;color:#64748b;line-height:1.5;">${_esc(t.descripcion)}</div>
          </button>
        `).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button id="btn-tipo-siguiente" type="button"
          ${!_tipoSeleccionado ? 'disabled' : ''}
          style="padding:10px 28px;border-radius:10px;background:${_tipoSeleccionado ? '#0f172a' : '#e2e8f0'};color:${_tipoSeleccionado ? '#fff' : '#94a3b8'};border:none;font-size:14px;font-weight:700;cursor:${_tipoSeleccionado ? 'pointer' : 'not-allowed'};">
          Siguiente
        </button>
      </div>
    </div>
  `;
}

function _renderPlazas() {
  if (!_plazas.length) {
    const configPlazas = window.MEX_CONFIG?.plazas || [];
    if (Array.isArray(configPlazas) && configPlazas.length) {
      _plazas = configPlazas.map(p => ({
        nombre: String(p.nombre || p.id || p).trim(),
        capacidad: Number(p.capacidad) || 0,
      }));
    }
    if (!_plazas.length) {
      _plazas = [{ nombre: '', capacidad: 0 }];
    }
  }

  return `
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      ${_renderStepIndicator('plazas')}
      <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 6px;">Configura tus plazas</h1>
      <p style="font-size:14px;color:#64748b;margin:0 0 24px;">Las plazas son sucursales u operaciones. Puedes agregar más después.</p>
      <div id="plazas-list" style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;">
        ${_plazas.map((p, i) => `
          <div style="display:flex;gap:8px;align-items:center;" data-plaza-row="${i}">
            <input type="text" placeholder="Nombre de plaza" value="${_esc(p.nombre)}"
              data-plaza-nombre="${i}"
              style="flex:1;padding:10px 12px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:14px;outline:none;"
            />
            <input type="number" placeholder="Cap." value="${p.capacidad || ''}"
              data-plaza-capacidad="${i}"
              style="width:80px;padding:10px 12px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:14px;outline:none;"
              min="0"
            />
            <button type="button" data-plaza-remove="${i}"
              style="padding:8px;border-radius:8px;border:none;background:#fef2f2;color:#ef4444;cursor:pointer;display:flex;align-items:center;">
              <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
            </button>
          </div>
        `).join('')}
      </div>
      <button type="button" id="btn-add-plaza"
        style="display:flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;border:1.5px dashed #cbd5e1;background:transparent;color:#64748b;font-size:13px;cursor:pointer;margin-bottom:32px;">
        <span class="material-symbols-outlined" style="font-size:16px;">add</span>
        Agregar plaza
      </button>
      <div style="display:flex;justify-content:space-between;">
        <button id="btn-plazas-back" type="button"
          style="padding:10px 20px;border-radius:10px;background:#f1f5f9;color:#64748b;border:none;font-size:14px;font-weight:600;cursor:pointer;">
          Atrás
        </button>
        <button id="btn-plazas-siguiente" type="button"
          style="padding:10px 28px;border-radius:10px;background:#0f172a;color:#fff;border:none;font-size:14px;font-weight:700;cursor:pointer;">
          Siguiente
        </button>
      </div>
    </div>
  `;
}

function _templateDownloadLink(tipo) {
  const csv = generarTemplateCsv(tipo);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  return URL.createObjectURL(blob);
}

function _renderUnidades() {
  const esEstacionamiento = _tipoSeleccionado === 'ESTACIONAMIENTO';
  const esRenta = _tipoSeleccionado === 'RENTA_AUTOS';

  if (esEstacionamiento) {
    return `
      <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
        ${_renderStepIndicator('unidades')}
        <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 6px;">Catálogo de unidades</h1>
        <div style="border-radius:14px;border:1.5px solid #e2e8f0;padding:24px;text-align:center;margin-bottom:32px;">
          <span class="material-symbols-outlined" style="font-size:40px;color:#22c55e;display:block;margin-bottom:12px;">check_circle</span>
          <p style="font-size:14px;color:#64748b;margin:0;line-height:1.6;">
            No necesitas importar unidades.<br>
            Tu sistema creará registros temporales durante la operación.
          </p>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <button id="btn-unidades-back" type="button"
            style="padding:10px 20px;border-radius:10px;background:#f1f5f9;color:#64748b;border:none;font-size:14px;font-weight:600;cursor:pointer;">
            Atrás
          </button>
          <button id="btn-unidades-skip" type="button"
            style="padding:10px 28px;border-radius:10px;background:#0f172a;color:#fff;border:none;font-size:14px;font-weight:700;cursor:pointer;">
            Continuar
          </button>
        </div>
      </div>
    `;
  }

  const importHtml = `
    <div id="import-zone"
      style="border:2px dashed #cbd5e1;border-radius:14px;padding:32px;text-align:center;cursor:pointer;margin-bottom:16px;background:#f8fafc;transition:border-color .15s;"
      ondragover="event.preventDefault();this.style.borderColor='#0f172a';"
      ondragleave="this.style.borderColor='#cbd5e1';"
      ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';window._onboardingHandleDrop(event.dataTransfer.files[0]);"
    >
      <span class="material-symbols-outlined" style="font-size:36px;color:#94a3b8;display:block;margin-bottom:8px;">upload_file</span>
      <p style="font-size:14px;color:#64748b;margin:0 0 12px;">Arrastra un archivo CSV aquí o haz clic para seleccionar</p>
      <input type="file" id="csv-file-input" accept=".csv,.txt" style="display:none;" />
      <button type="button" onclick="document.getElementById('csv-file-input').click()"
        style="padding:8px 20px;border-radius:8px;border:1.5px solid #0f172a;background:#fff;color:#0f172a;font-size:13px;font-weight:600;cursor:pointer;">
        Seleccionar archivo
      </button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <a id="template-link" href="#" download="plantilla-unidades.csv"
        style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#3b82f6;text-decoration:none;font-weight:500;">
        <span class="material-symbols-outlined" style="font-size:15px;">download</span>
        Descargar plantilla CSV
      </a>
      <span id="file-name-label" style="font-size:12px;color:#94a3b8;"></span>
    </div>
    <div id="import-progress" style="display:none;padding:12px;border-radius:8px;background:#f1f5f9;margin-bottom:16px;font-size:13px;color:#64748b;">
      Procesando...
    </div>
    <div id="import-result" style="display:none;"></div>
  `;

  return `
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      ${_renderStepIndicator('unidades')}
      <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 6px;">Importar unidades</h1>
      <p style="font-size:14px;color:#64748b;margin:0 0 24px;">
        ${esRenta
          ? 'Importa el catálogo de tu flota. Necesitas al menos 1 unidad para operar.'
          : 'Importa el catálogo de tu flota. Puedes saltar este paso y hacerlo después.'}
      </p>
      ${importHtml}
      <div style="display:flex;justify-content:space-between;margin-top:16px;">
        <button id="btn-unidades-back" type="button"
          style="padding:10px 20px;border-radius:10px;background:#f1f5f9;color:#64748b;border:none;font-size:14px;font-weight:600;cursor:pointer;">
          Atrás
        </button>
        <div style="display:flex;gap:10px;">
          ${!esRenta ? `
          <button id="btn-unidades-skip" type="button"
            style="padding:10px 20px;border-radius:10px;background:#f1f5f9;color:#64748b;border:none;font-size:14px;font-weight:600;cursor:pointer;">
            Saltar por ahora
          </button>
          ` : `
          <button id="btn-unidades-skip" type="button"
            style="padding:10px 20px;border-radius:10px;background:#f1f5f9;color:#64748b;border:none;font-size:14px;font-weight:600;cursor:pointer;">
            Agregar después
          </button>
          `}
          <button id="btn-unidades-siguiente" type="button"
            style="padding:10px 28px;border-radius:10px;background:#0f172a;color:#fff;border:none;font-size:14px;font-weight:700;cursor:pointer;">
            Continuar
          </button>
        </div>
      </div>
    </div>
  `;
}

function _renderDone() {
  return `
    <div style="max-width:480px;margin:0 auto;padding:64px 16px;text-align:center;">
      ${_renderStepIndicator('done')}
      <div style="width:72px;height:72px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
        <span class="material-symbols-outlined" style="font-size:40px;color:#16a34a;">celebration</span>
      </div>
      <h1 style="font-size:24px;font-weight:800;color:#0f172a;margin:0 0 10px;">¡Configuración completa!</h1>
      <p style="font-size:14px;color:#64748b;margin:0 0 32px;line-height:1.6;">
        Tu sistema está listo para operar. Puedes ajustar la configuración en cualquier momento desde el panel de administración.
      </p>
      <button id="btn-ir-dashboard" type="button"
        style="padding:12px 32px;border-radius:12px;background:#0f172a;color:#fff;border:none;font-size:15px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px;">
        <span class="material-symbols-outlined" style="font-size:18px;">home</span>
        Ir al Dashboard
      </button>
    </div>
  `;
}

function _renderImportResult(result) {
  const el = _container && _container.querySelector('#import-result');
  if (!el) return;
  el.style.display = 'block';

  if (!result.ok && result.errorTipo) {
    el.innerHTML = `
      <div style="border-radius:10px;background:#fef2f2;border:1.5px solid #fecaca;padding:14px 16px;color:#dc2626;font-size:13px;">
        <strong>Error:</strong> ${_esc(result.mensaje)}
      </div>
    `;
    return;
  }

  const hasErrors = result.errores && result.errores.length > 0;
  el.innerHTML = `
    <div style="border-radius:10px;background:${result.importados > 0 ? '#f0fdf4' : '#fef9c3'};border:1.5px solid ${result.importados > 0 ? '#bbf7d0' : '#fde68a'};padding:14px 16px;margin-bottom:${hasErrors ? '12px' : '0'};">
      <div style="font-size:13px;font-weight:700;color:${result.importados > 0 ? '#15803d' : '#92400e'};">
        ${result.importados > 0
          ? `<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;margin-right:4px;">check_circle</span>${result.importados} unidad(es) importada(s) de ${result.total}`
          : `<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;margin-right:4px;">warning</span>0 unidades importadas`
        }
      </div>
      ${hasErrors ? `<div style="font-size:12px;color:#dc2626;margin-top:4px;">${result.errores.length} fila(s) con errores</div>` : ''}
    </div>
    ${hasErrors ? `
      <div style="border-radius:10px;border:1.5px solid #fecaca;overflow:hidden;">
        <div style="padding:10px 14px;background:#fef2f2;font-size:12px;font-weight:700;color:#dc2626;">
          Errores de importación
        </div>
        <div style="max-height:200px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Fila</th>
                <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Campo</th>
                <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Error</th>
              </tr>
            </thead>
            <tbody>
              ${result.errores.flatMap(r =>
                r.errores.map(e => `
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:5px 12px;color:#0f172a;">${_esc(String(r.fila))}</td>
                    <td style="padding:5px 12px;color:#0f172a;">${_esc(e.campo)}</td>
                    <td style="padding:5px 12px;color:#dc2626;">${_esc(e.mensaje)}</td>
                  </tr>
                `)
              ).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;
}

function _render() {
  if (!_container) return;
  let html = '';
  if (_step === 'tipo') html = _renderTipo();
  else if (_step === 'plazas') html = _renderPlazas();
  else if (_step === 'unidades') html = _renderUnidades();
  else html = _renderDone();

  _container.innerHTML = `
    <div style="font-family:'Inter',sans-serif;min-height:100%;padding:16px;">
      ${html}
    </div>
  `;

  _bindEvents();
}

function _bindEvents() {
  if (_step === 'tipo') {
    _container.querySelectorAll('[data-tipo]').forEach(btn => {
      btn.addEventListener('click', () => {
        _tipoSeleccionado = btn.dataset.tipo;
        _render();
      });
    });
    const btnSig = _container.querySelector('#btn-tipo-siguiente');
    if (btnSig && !btnSig.disabled) {
      btnSig.addEventListener('click', _onTipoSiguiente);
    }
  }

  if (_step === 'plazas') {
    _container.querySelector('#btn-add-plaza')?.addEventListener('click', () => {
      _syncPlazasFromDom();
      _plazas.push({ nombre: '', capacidad: 0 });
      _render();
    });
    _container.querySelectorAll('[data-plaza-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.plazaRemove, 10);
        _syncPlazasFromDom();
        _plazas.splice(i, 1);
        if (!_plazas.length) _plazas = [{ nombre: '', capacidad: 0 }];
        _render();
      });
    });
    _container.querySelector('#btn-plazas-back')?.addEventListener('click', () => {
      _step = 'tipo';
      _render();
    });
    _container.querySelector('#btn-plazas-siguiente')?.addEventListener('click', _onPlazasSiguiente);
  }

  if (_step === 'unidades') {
    _container.querySelector('#btn-unidades-back')?.addEventListener('click', () => {
      _step = 'plazas';
      _render();
    });
    _container.querySelector('#btn-unidades-skip')?.addEventListener('click', _onUnidadesSkip);
    _container.querySelector('#btn-unidades-siguiente')?.addEventListener('click', _onUnidadesSiguiente);

    const fileInput = _container.querySelector('#csv-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) _handleFileImport(f);
      });
    }

    const templateLink = _container.querySelector('#template-link');
    if (templateLink && _tipoSeleccionado) {
      templateLink.href = _templateDownloadLink(_tipoSeleccionado);
    }

    window._onboardingHandleDrop = (file) => {
      if (file) _handleFileImport(file);
    };
  }

  if (_step === 'done') {
    _container.querySelector('#btn-ir-dashboard')?.addEventListener('click', () => {
      if (_navigate) _navigate('/app/dashboard');
    });
  }
}

function _syncPlazasFromDom() {
  const rows = _container.querySelectorAll('[data-plaza-row]');
  rows.forEach((row, i) => {
    const nombreInput = row.querySelector(`[data-plaza-nombre="${i}"]`);
    const capInput = row.querySelector(`[data-plaza-capacidad="${i}"]`);
    if (!_plazas[i]) _plazas[i] = { nombre: '', capacidad: 0 };
    if (nombreInput) _plazas[i].nombre = nombreInput.value.trim();
    if (capInput) _plazas[i].capacidad = Number(capInput.value) || 0;
  });
}

async function _onTipoSiguiente() {
  if (!_tipoSeleccionado) return;
  try {
    await configurarTipoNegocio(_empresaId, _tipoSeleccionado);
    _step = 'plazas';
    _render();
  } catch (err) {
    console.error('[onboarding] configurarTipoNegocio:', err);
    alert('Error al guardar el tipo de negocio. Intenta de nuevo.');
  }
}

async function _onPlazasSiguiente() {
  _syncPlazasFromDom();
  try {
    await guardarPlazas(_empresaId, _plazas);
    _step = 'unidades';
    _importResult = null;
    _render();
  } catch (err) {
    console.error('[onboarding] guardarPlazas:', err);
    alert('Error al guardar las plazas. Intenta de nuevo.');
  }
}

async function _onUnidadesSkip() {
  await _finalizarOnboarding();
}

async function _onUnidadesSiguiente() {
  await _finalizarOnboarding();
}

async function _finalizarOnboarding() {
  try {
    await completarOnboarding(_empresaId);
    _step = 'done';
    _render();
  } catch (err) {
    console.error('[onboarding] completarOnboarding:', err);
    alert('Error al completar la configuración. Intenta de nuevo.');
  }
}

async function _handleFileImport(file) {
  const labelEl = _container.querySelector('#file-name-label');
  const progressEl = _container.querySelector('#import-progress');
  const resultEl = _container.querySelector('#import-result');

  if (labelEl) labelEl.textContent = file.name;
  if (progressEl) progressEl.style.display = 'block';
  if (resultEl) resultEl.style.display = 'none';

  try {
    const result = await importarDesdeArchivo(_empresaId, file, _tipoSeleccionado);
    _importResult = result;
    if (progressEl) progressEl.style.display = 'none';
    _renderImportResult(result);

    if (result.ok && result.importados > 0) {
      try {
        await registrarImportacion(_empresaId, result);
      } catch (_) {}
    }
  } catch (err) {
    if (progressEl) progressEl.style.display = 'none';
    _importResult = { ok: false, errorTipo: 'error', mensaje: err.message || 'Error inesperado', total: 0, importados: 0, errores: [] };
    _renderImportResult(_importResult);
  }
}

export async function mount(ctx) {
  _container = ctx.container;
  _navigate = ctx.navigate;
  _empresaId = _empresaIdFromCtx();

  if (!_empresaId) {
    _container.innerHTML = `
      <div style="padding:48px 24px;text-align:center;font-family:'Inter',sans-serif;">
        <p style="color:#ef4444;font-size:14px;">No se encontró el contexto de empresa. Recarga la página.</p>
      </div>
    `;
    return;
  }

  _step = 'tipo';
  _tipoSeleccionado = null;
  _plazas = [];
  _importResult = null;

  try {
    const estado = await getEstadoOnboarding(_empresaId);
    if (estado?.tipo_negocio) {
      _tipoSeleccionado = estado.tipo_negocio;
    }
    if (estado?.onboarding_paso === 'tipo') {
      _step = 'plazas';
    } else if (estado?.onboarding_paso === 'plazas') {
      _step = 'unidades';
    }
  } catch (_) {}

  _render();
}

export function unmount() {
  _container = null;
  _navigate = null;
  try { delete window._onboardingHandleDrop; } catch (_) {}
}
