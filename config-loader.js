window.MEX_CONFIG = { empresa: {}, listas: {} };

async function inicializarConfiguracion() {
  try {
    const config = await api.obtenerConfiguracion();
    window.MEX_CONFIG = {
      empresa: {
        nombre: "MEX RENT A CAR",
        ...(config && config.empresa ? config.empresa : {})
      },
      listas: {
        ubicaciones: [],
        estados: [],
        gasolinas: [],
        categorias: [],
        ...(config && config.listas ? config.listas : {})
      }
    };

    // Inyectar nombre de empresa en el logo
    const logoEl = document.querySelector('.logo');
    if (logoEl && window.MEX_CONFIG.empresa.nombre) {
      logoEl.innerText = window.MEX_CONFIG.empresa.nombre;
    }

    // Rellenar Selects dinámicamente
    llenarSelectsDinamicos();
  } catch (error) {
    console.error("Error cargando configuración:", error);
  }
}

function llenarSelectsDinamicos() {
  const { ubicaciones, estados, gasolinas, categorias } = window.MEX_CONFIG.listas;

  // Utilidad para inyectar options
  const rellenar = (selectId, array, includeAll = false, placeholder = "Seleccionar...") => {
    const select = document.getElementById(selectId);
    if (!select) return;
    let html = includeAll ? `<option value="">${placeholder}</option>` : `<option value="">${placeholder}</option>`;
    
    array.forEach(item => {
      const val = typeof item === 'object' ? item.id : item;
      html += `<option value="${val}">${val}</option>`;
    });
    select.innerHTML = html;
  };

  // 1. Modales de Edición / Alta (Consola de Patio)
  rellenar('f_ubi', ubicaciones);
  rellenar('f_est', estados.map(e => e.id));
  rellenar('f_gas', gasolinas);
  
  // Modal Admin Global
  rellenar('a_ins_ubi', ubicaciones);
  rellenar('a_ins_est', estados.map(e => e.id));
  rellenar('a_ins_gas', gasolinas);
  rellenar('a_mod_ubi', ubicaciones);
  rellenar('a_mod_est', estados.map(e => e.id));
  rellenar('a_mod_gas', gasolinas);

  // 2. Filtros de la Tabla de Flota (los tipo Excel)
  rellenar('filter-ubi', ubicaciones, true, "UBICACION (ALL)");
  rellenar('filter-est', estados.map(e => e.id), true, "ESTADO (ALL)");
  rellenar('filter-cat', categorias, true, "CATEGORIA (ALL)");
}

// Llamarlo cuando inicie la app (puedes ponerlo justo antes de tu lógica de Login)
document.addEventListener("DOMContentLoaded", () => {
    inicializarConfiguracion();
});
