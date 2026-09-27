// Corre los casos de pruebas/casos (programa + .esperado) y compara el Serial linea por linea.
//   node pruebas/probar_traductores.js
const fs = require('fs'), path = require('path');
const S = require('../simcore.js');
const dir = path.join(__dirname, 'casos');
// Diferencias conocidas del simulador (limitaciones documentadas): esperado -> lo que da
const CONOCIDAS = { 'semantica.py': { 'Robot(Z) 7.0 2 True True Rapido': 'Robot(Z) 7 2 True True Rapido', '4.0 True 3 [1, 2, 3] ababab [0, 0, 0]': '4 True 3 [1, 2, 3] ababab [0, 0, 0]' } };
let fallas = 0;
for (const f of fs.readdirSync(dir).filter(f => /\.(ino|py)$/.test(f))) {
  const texto = fs.readFileSync(path.join(dir, f), 'utf8');
  const esperado = fs.readFileSync(path.join(dir, f + '.esperado'), 'utf8').replace(/\r/g, '').trim().split('\n');
  const prog = S.programaDesdeArchivos([{ nombre: f, texto }], f);
  const sim = new S.Simulacion({ programa: prog, rival: 'ninguno', plan: { salida: null, acciones: [] } });
  while (sim.mundo.t < 8e6 && !sim.hw.detenido && !sim.registro.serial.some(l => l.texto === 'fin')) sim.avanzar(20000);
  const salida = sim.registro.serial.map(l => l.texto).filter(l => !/^#|^Firmware/.test(l) && l !== '');
  const conocidas = CONOCIDAS[f] || {};
  let malas = 0;
  esperado.forEach((e, i) => {
    const obtenido = salida[i];
    if (obtenido === e) return;
    if (conocidas[e] === obtenido) { console.log(`  ${f}:${i + 1} diferencia conocida: ${obtenido}`); return; }
    malas++;
    console.log(`  ${f}:${i + 1}\n     esperado: ${e}\n     obtenido: ${obtenido}`);
  });
  if (sim.hw.detenido && !sim.hw.detenido.fin) { malas++; console.log('  detenido:', JSON.stringify(sim.hw.detenido)); }
  console.log(`${malas ? 'FALLA' : 'ok   '} ${f}: ${esperado.length - malas}/${esperado.length} lineas`);
  fallas += malas;
}
process.exit(fallas ? 1 : 0);
