// domain/traslado.model.js - logica pura de traslados (sin Firebase).

export const TRASLADO_ESTADOS = Object.freeze(["ABIERTO", "CERRADO"]);

export const TIPOS_TRASLADO_DEFAULT = Object.freeze([
  { codigo: "CORT", etiqueta: "Cortesia" },
  { codigo: "GAS", etiqueta: "Carga de gasolina" },
  { codigo: "TRANS", etiqueta: "Transporte de personal" },
  { codigo: "DROP", etiqueta: "Retorno por drop off" },
  { codigo: "INTER", etiqueta: "Intercambio" },
  { codigo: "NOCOM", etiqueta: "No comercial" },
]);

export function toMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function estadoOperativoTraslado({ estado = "ABIERTO", fechaSalida, now = Date.now() } = {}) {
  const est = String(estado || "ABIERTO").toUpperCase().trim();
  if (est === "CERRADO") return "CERRADO";
  const salidaMs = toMs(fechaSalida);
  return salidaMs && salidaMs > toMs(now) ? "PROGRAMADO" : "ABIERTO";
}

export function licenciaVigente(licenciaVencimiento, now = Date.now()) {
  if (!licenciaVencimiento) return false;
  const vencimiento = toMs(licenciaVencimiento);
  if (!vencimiento) return false;
  const today = new Date(toMs(now));
  today.setHours(0, 0, 0, 0);
  const end = new Date(vencimiento);
  end.setHours(23, 59, 59, 999);
  return end.getTime() >= today.getTime();
}

export function choferElegible(usuario = {}, now = Date.now()) {
  return usuario?.isChofer === true && licenciaVigente(usuario?.licenciaVencimiento, now);
}

export function validarCierreTraslado({ kmSalida, kmLlegada, fechaCierre, fechaSalida, now = Date.now() } = {}) {
  const salida = Number(kmSalida);
  const llegada = Number(kmLlegada);
  if (!Number.isFinite(llegada) || llegada < 0) return { ok: false, code: "KM_INVALIDO", message: "Kilometraje de llegada invalido" };
  if (Number.isFinite(salida) && llegada < salida) return { ok: false, code: "KM_MENOR_SALIDA", message: "El km de llegada no puede ser menor al de salida" };

  const nowMs = toMs(now);
  const cierreMs = toMs(fechaCierre || nowMs);
  if (!cierreMs) return { ok: false, code: "FECHA_INVALIDA", message: "Fecha de cierre invalida" };
  if (cierreMs > nowMs) return { ok: false, code: "CIERRE_FUTURO", message: "El cierre no puede estar en el futuro" };
  if (cierreMs < nowMs - 5 * 60 * 1000) return { ok: false, code: "CIERRE_ANTIGUO", message: "El cierre no puede ser anterior a 5 minutos" };
  const salidaMs = toMs(fechaSalida);
  if (salidaMs && cierreMs < salidaMs) return { ok: false, code: "CIERRE_ANTES_SALIDA", message: "El cierre no puede ser anterior a la salida" };
  return { ok: true, code: "OK", message: "OK" };
}

export function normalizarTipoTraslado(value, tipos = TIPOS_TRASLADO_DEFAULT) {
  const raw = String(value || "").toUpperCase().trim();
  const list = Array.isArray(tipos) && tipos.length ? tipos : TIPOS_TRASLADO_DEFAULT;
  const found = list.find(item => String(item?.codigo || item?.id || item?.valor || item).toUpperCase().trim() === raw);
  return found ? String(found.codigo || found.id || found.valor || found).toUpperCase().trim() : raw;
}
