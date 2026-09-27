// Arma los simuladores en un solo archivo HTML cada uno (se abren con doble clic, sin internet):
//   ../simulador.html          copia interna (con los firmwares propios)
//   ../publico/simulador.html  la que se comparte (solo el simulador y los ejemplos)
// Antes corre nucleo/armar.js, que junta el nucleo.
const fs = require('fs'), path = require('path');
const d = __dirname;
require('./nucleo/armar.js');
const ui = fs.readFileSync(path.join(d, 'ui.js'), 'utf8');
const plantilla = fs.readFileSync(path.join(d, 'ui.html'), 'utf8');
function documento(core) {
  if (/<\/script/i.test(core + ui)) throw new Error('hay </script> dentro del JS');
  const html = plantilla.replace('/*__SIMCORE__*/', () => core).replace('/*__UI__*/', () => ui);
  const cuerpo = html.replace(/^<meta charset="utf-8">\r?\n/, '');
  const corte = cuerpo.indexOf('</style>') + '</style>'.length;
  return ['<!doctype html>', '<html lang="es">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    cuerpo.slice(0, corte), '</head>', '<body>', cuerpo.slice(corte), '</body>', '</html>', ''].join('\n');
}
const conFirmwares = ['fw_base.js', 'fw_encarar.js', 'fw_plan.js'].some(f => fs.existsSync(path.join(d, 'nucleo', f)));
const publico = documento(fs.readFileSync(path.join(d, 'simcore_publico.js'), 'utf8'));
if (conFirmwares) {
  // copia interna: el simulador con los firmwares propios, y aparte el publico
  const interno = documento(fs.readFileSync(path.join(d, 'simcore.js'), 'utf8'));
  fs.writeFileSync(path.join(d, '..', 'simulador.html'), interno);
  fs.mkdirSync(path.join(d, '..', 'publico'), { recursive: true });
  fs.writeFileSync(path.join(d, '..', 'publico', 'simulador.html'), publico);
  console.log(`simulador.html ${(interno.length / 1024).toFixed(0)} KB (interno) · publico/simulador.html ${(publico.length / 1024).toFixed(0)} KB`);
} else {
  fs.writeFileSync(path.join(d, '..', 'simulador.html'), publico);
  console.log(`simulador.html ${(publico.length / 1024).toFixed(0)} KB`);
}
