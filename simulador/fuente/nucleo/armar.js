// Arma el nucleo del simulador en un solo archivo (va adentro del HTML):
//   ../simcore.js          copia interna: con los firmwares escritos a mano (fw_*.js)
//   ../simcore_publico.js  la que se comparte: solo el simulador y los ejemplos
// Los ejemplos (../ejemplos/*.ino y *.py) se incrustan como programas.
const fs = require('fs'), path = require('path');
const d = __dirname;
const leer = f => fs.readFileSync(path.join(d, f), 'utf8');
const existe = f => fs.existsSync(path.join(d, f));

// ejemplos: en la copia interna estan en fuente/ejemplos; en el paquete publico, en simulador/ejemplos
const dirEj = [path.join(d, '..', 'ejemplos'), path.join(d, '..', '..', 'ejemplos')].find(x => fs.existsSync(x)) || path.join(d, '..', 'ejemplos');
const ejemplos = fs.existsSync(dirEj) ? fs.readdirSync(dirEj).filter(f => /\.(ino|py)$/i.test(f)).sort() : [];
const lineasEj = ['// Programas de ejemplo (generado por armar.js desde ../ejemplos)'];
for (const f of ejemplos) {
  const texto = fs.readFileSync(path.join(dirEj, f), 'utf8').replace(/\r\n/g, '\n');
  const primera = (texto.match(/^\s*(?:\/\/|#)\s*(.+)$/m) || [, f])[1].trim();
  const id = 'ejemplo_' + f.replace(/^\d+_/, '').replace(/[^\w]/g, '_');   // ejemplo_sumo_basico_ino
  const nombre = 'Ejemplo: ' + primera.replace(/^Ejemplo:\s*/i, '');
  if (/\.py$/i.test(f)) lineasEj.push(`registrarPrograma(programaPython(${JSON.stringify(id)}, ${JSON.stringify(nombre)}, ${JSON.stringify(texto)}, { ejemplo: true, archivo: ${JSON.stringify(f)} }));`);
  else lineasEj.push(`registrarPrograma(programaArduino(${JSON.stringify(id)}, ${JSON.stringify(nombre)}, [{ nombre: ${JSON.stringify(f)}, texto: ${JSON.stringify(texto)} }], { ejemplo: true, archivo: ${JSON.stringify(f)} }));`);
}
const ejemplosJs = lineasEj.join('\n') + '\n';

const base = ['motor_a.js', 'traductor_arduino.js', 'traductor_arduino_parser.js', 'traductor_arduino_generador.js', 'api_arduino.js']
  .concat(['traductor_python.js', 'traductor_python_parser.js', 'traductor_python_generador.js', 'api_python.js'].filter(existe))
  .concat(['programas.js']);
const firmwares = ['fw_base.js', 'fw_encarar.js', 'fw_plan.js', 'fw_registro.js'].filter(existe);

function armar(conFirmwares) {
  const partes = base.map(leer);
  partes.push(ejemplosJs);
  if (conFirmwares) for (const f of firmwares) partes.push(leer(f));
  partes.push(leer('motor_b.js'));
  return partes.join('\n');
}
const interno = armar(true), publico = armar(false);
fs.writeFileSync(path.join(d, '..', 'simcore.js'), interno);
fs.writeFileSync(path.join(d, '..', 'simcore_publico.js'), publico);
console.log(`simcore.js ${interno.split('\n').length} lineas (con ${firmwares.length} firmwares propios); simcore_publico.js ${publico.split('\n').length} lineas; ${ejemplos.length} ejemplos`);
