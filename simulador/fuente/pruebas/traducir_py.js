// node pruebas/traducir_py.js archivo.py [--js]
const fs = require('fs');
const S = require('../simcore.js');
const f = process.argv[2];
const r = S.traducirPython(fs.readFileSync(f, 'utf8'));
console.log('ok:', r.ok);
for (const e of r.errores) console.log('ERROR linea', e.linea, e.msg);
if (r.ok) { try { new Function('__py', r.codigo); console.log('JS valido,', r.codigo.split('\n').length, 'lineas'); } catch (x) { console.log('JS INVALIDO:', x.message); } }
if (r.ok && process.argv.includes('--js')) console.log(r.codigo);
