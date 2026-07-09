// ponytail: normaliza cualquier ts (s | ms | {seconds}) a 'YYYY-MM-DD' local.
function tsADia(ts) {
  let ms;
  if (ts && typeof ts === 'object' && 'seconds' in ts) ms = ts.seconds * 1000;
  else if (typeof ts === 'number') ms = ts < 1e12 ? ts * 1000 : ts; // <1e12 => segundos
  else ms = new Date(ts).getTime();
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const assert = require('assert');
const base = new Date(2026, 6, 9, 15, 30); // 2026-07-09 15:30 local
const secs = Math.floor(base.getTime()/1000);
assert.equal(tsADia(secs), '2026-07-09', 'segundos');
assert.equal(tsADia(base.getTime()), '2026-07-09', 'ms');
assert.equal(tsADia({ seconds: secs }), '2026-07-09', 'firestore ts');
console.log('OK fecha-dia');
module.exports = { tsADia };
