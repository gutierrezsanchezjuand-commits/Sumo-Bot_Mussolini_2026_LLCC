const fs = require('fs'), path = require('path');
const S = require('../simcore.js');
const dir = path.join(__dirname, 'errores');
for (const f of fs.readdirSync(dir)) {
  const prog = S.programaDesdeArchivos([{ nombre: f, texto: fs.readFileSync(path.join(dir, f), 'utf8') }], f);
  const tr = prog.traducir();
  if (!tr.ok) { console.log(f.padEnd(18), 'TRADUCCION  linea', tr.errores[0].linea + ':', tr.errores[0].msg); continue; }
  const sim = new S.Simulacion({ programa: prog, rival: 'ninguno', plan: { salida: null, acciones: [] } });
  while (sim.mundo.t < 4e6 && !sim.hw.detenido) sim.avanzar(20000);
  console.log(f.padEnd(18), 'EJECUCION  ', sim.hw.detenido ? JSON.stringify(sim.hw.detenido) : 'sin error');
}
