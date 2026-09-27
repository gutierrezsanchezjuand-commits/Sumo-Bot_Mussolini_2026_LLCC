// node pruebas/correr.js archivo(s) [--rival=caja] [--ronda=1] [--seg=30] [--log=40] [--semilla=1]
const fs = require('fs'), path = require('path');
const S = require('../simcore.js');
const opt = {}; const archivos = [];
for (const a of process.argv.slice(2)) { const m = /^--(\w+)=(.*)$/.exec(a); if (m) opt[m[1]] = m[2]; else archivos.push(a); }
const arch = archivos.map(f => ({ nombre: path.basename(f), texto: fs.readFileSync(f, 'utf8') }));
const prog = S.programaDesdeArchivos(arch, arch[0].nombre);
const t0 = Date.now();
let sim;
try { sim = new S.Simulacion({ programa: prog, rival: opt.rival || 'caja', ronda: +(opt.ronda || 1), semilla: +(opt.semilla || 1) }); }
catch (x) { console.log('NO ARRANCA:', x.message); process.exit(1); }
console.log('tipo', prog.tipo, '| plan:', sim.plan ? JSON.stringify(sim.plan.acciones.map(a => a.tipo)) + ' salida=' + sim.plan.salida : sim.plan, '| armado', Date.now() - t0, 'ms');
const t1 = Date.now();
while (sim.tCombate === null && sim.mundo.t < 60e6 && !sim.hw.detenido) sim.avanzar(20000);
console.log('combate en', sim.tCombate === null ? 'NUNCA' : (sim.tCombate / 1e6).toFixed(3) + ' s', sim.hw.detenido ? JSON.stringify(sim.hw.detenido) : '');
const seg = +(opt.seg || 30);
const R = sim.mundo.robot, O = sim.mundo.rival;
let recorrido = 0, activos = 0, muestras = 0, contacto = 0, px = R.x, py = R.y, dmin = Infinity;
while (sim.tCombate !== null && !sim.fin && sim.rivalFueraEn === null && sim.tiempoCombate() < seg && !sim.hw.detenido) {
  sim.avanzar(20000);
  recorrido += Math.hypot(R.x - px, R.y - py); px = R.x; py = R.y;
  muestras++; if (R.uIzq || R.uDer) activos++; if (sim.mundo.contacto) contacto++;
  if (O) dmin = Math.min(dmin, Math.hypot(R.x - O.x, R.y - O.y));
}
console.log(`recorrido ${(recorrido * 100).toFixed(0)} cm | motores activos ${(100 * activos / Math.max(1, muestras)).toFixed(0)} % | en contacto ${(contacto * 0.02).toFixed(1)} s | distancia minima al rival ${(dmin * 100).toFixed(0)} cm | rival fuera ${sim.rivalFueraEn !== null}`);
const r = sim.fin ? 'PIERDE ' + sim.tiempoCombate().toFixed(2) : sim.rivalFueraEn !== null ? 'GANA ' + ((sim.rivalFueraEn - sim.tCombate) / 1e6).toFixed(2) : 'empate/sin fin';
console.log('resultado', r, '| CPU', Date.now() - t1, 'ms | t mundo', (sim.mundo.t / 1e6).toFixed(1), 's', sim.hw.detenido ? JSON.stringify(sim.hw.detenido) : '');
const n = +(opt.log || 40);
for (const e of sim.registro.entradas.slice(0, n)) console.log(String(e.ms).padStart(6), e.tipo.padEnd(9), e.titulo, e.detalle ? '· ' + e.detalle : '');
if (opt.serial) for (const l of sim.registro.serial.slice(0, +opt.serial)) console.log('   |', (l.t / 1000).toFixed(0).padStart(6), l.texto);
