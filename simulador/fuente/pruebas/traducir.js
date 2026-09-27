// node pruebas/traducir.js archivo.ino [otro.ino ...]  -> muestra errores y el JS generado (--js)
const fs = require('fs'), path = require('path');
const S = require('../simcore.js');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const archivos = args.map(f => ({ nombre: path.basename(f), texto: fs.readFileSync(f, 'utf8') }));
const t0 = Date.now();
const r = S.traducirArduino(archivos, { defines: {} });
console.log('ok:', r.ok, 'ms:', Date.now() - t0);
for (const e of r.errores) console.log('ERROR', e.archivo + ':' + e.linea, e.msg);
for (const e of r.avisos) console.log('aviso', e.archivo + ':' + e.linea, e.msg);
if (r.ok && process.argv.includes('--js')) console.log(r.codigo);
if (r.ok) { try { new Function('__api', r.codigo); console.log('JS valido,', r.codigo.split('\n').length, 'lineas'); } catch (x) { console.log('JS INVALIDO:', x.message); } }
