
/* ==========================================================================
   OPERADOR: la persona que aprieta BOOT durante el arranque. Lee el
   Serial como lo haria un humano y responde con pulsaciones realistas.
   Durante la calibracion "sostiene" el robot sobre negro y blanco. Con dos
   robots, el BOOT final se da a los dos a la vez (como cuando el juez da la
   salida).
   ========================================================================== */
class Operador {
  constructor(sim, hw, auto) { this.sim = sim; this.hw = hw; this.auto = auto; this.listo = false; }
  alSerial(l) {
    const hw = this.hw, reg = hw.registro, auto = this.auto();
    if (l.startsWith('PASO 1')) {
      hw.superficieCalib = 'negro';
      reg.agregar('arranque', 'Operador sostiene los sensores sobre NEGRO', '');
      if (auto) this.pulsar(700);
    } else if (l.startsWith('PASO 2')) {
      hw.superficieCalib = 'blanco';
      reg.agregar('arranque', 'Operador sostiene los sensores sobre BLANCO', '');
      if (auto) this.pulsar(700);
    } else if (l.startsWith('Calibracion exitosa')) {
      hw.superficieCalib = null;
      reg.agregar('arranque', 'Operador deja el robot en su posición del dojo', '');
      if (auto) this.pulsar(700);
    } else if (l.startsWith('Selecciona la RONDA')) {
      if (auto) this.pulsarVeces(this.sim.cfg.ronda, 700);
    } else if (l.startsWith('Coloca el robot')) {
      this.listo = true;
      if (auto) this.sim.salidaSiTodosListos();
    }
  }
  pulsar(retardoMs) {
    const m = this.sim.mundo, t = m.t + retardoMs * 1000;
    m.programar(t, () => this.hw.fijarBoton(true, 'auto'));
    m.programar(t + 120000, () => this.hw.fijarBoton(false, 'auto'));
  }
  pulsarVeces(n, retardoMs) {
    const m = this.sim.mundo;
    let t = m.t + retardoMs * 1000;
    for (let i = 0; i < n; i++) {
      m.programar(t, () => this.hw.fijarBoton(true, 'auto'));
      m.programar(t + 100000, () => this.hw.fijarBoton(false, 'auto'));
      t += 320000;
    }
  }
}

/* ==========================================================================
   OPERADOR GENERICO: sirve para cualquier programa. Se da cuenta de que el
   programa espera el BOOT (lo lee una y otra vez sin mover los motores ni
   leer sensores) y mira la ultima linea que imprimio para saber que hacer:
     "negro"/"black"   sostiene los sensores sobre negro y aprieta
     "blanco"/"white"  sobre blanco y aprieta
     "ronda"/"round"   aprieta tantas veces como la ronda elegida
     otra cosa         aprieta una vez
   Cual de esas esperas es la SALIDA del combate lo averigua antes con un
   ensayo del arranque (ensayarArranque): es la ultima antes de que el
   programa se ponga a pelear. El combate empieza al soltar ese BOOT.
   ========================================================================== */
const RE_NEGRO = /\b(negro|negra|black|oscuro|dark)\b/;
const RE_BLANCO = /\b(blanco|blanca|white)\b/;
const RE_RONDA = /\b(ronda|round)\b/;
const RE_PIDE = /(boot|presion|puls|press|boton|button|aprieta|toca)/;
const RE_SALIDA = /(combate|pelea|inici|comenz|empez|salida|start|fight|begin)/;
function sinTildes(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function clasificarAviso(txt) {
  const s = sinTildes(txt || '');
  const iN = s.search(RE_NEGRO), iB = s.search(RE_BLANCO);
  if (iN >= 0 && (iB < 0 || iN < iB)) return 'negro';
  if (iB >= 0) return 'blanco';
  if (RE_RONDA.test(s)) return 'ronda';
  return 'paso';
}

class OperadorGenerico {
  constructor(sim, hw, auto, plan) {
    this.sim = sim; this.hw = hw; this.auto = auto;
    this.plan = plan;            // { salida } del ensayo, 'ensayo' mientras se ensaya, o null
    this.listo = false;          // en la salida, esperando que el juez de la largada
    this.enCombate = false;
    this.esperas = 0;
    this.acciones = [];
    this.lineas = [];
    this.tUltLinea = -1e12;
    this.tUltAccion = -1e12;
    this.ocupadoHasta = 0;
    this.movioDespues = false;
    this.tUltPulsoManual = null;
    this.tUltPedido = -1e12;
    this.tipoSalida = 'paso';
    this.pulsosSalida = 1;
  }
  alSerial(l) {
    if (!l.trim()) return;
    this.lineas.push(l);
    if (this.lineas.length > 40) this.lineas.shift();
    this.tUltLinea = this.hw.t;
    if (RE_PIDE.test(sinTildes(l))) { this.tUltPedido = this.hw.t; this.hw.rachaNueva = true; }
    // En manual la persona aprieta; el operador solo acomoda el robot segun lo que pide.
    if (!this.auto() && this.plan !== 'ensayo' && !this.enCombate && RE_PIDE.test(sinTildes(l))) {
      const tipo = clasificarAviso(l);
      this.hw.superficieCalib = tipo === 'negro' || tipo === 'blanco' ? tipo : null;
    }
  }
  aviso() {
    for (let i = this.lineas.length - 1; i >= 0; i--) if (RE_PIDE.test(sinTildes(this.lineas[i]))) return this.lineas[i];
    return this.lineas.length ? this.lineas[this.lineas.length - 1] : '';
  }
  revisar(t) {
    const hw = this.hw;
    if (this.enCombate) return;
    if (hw.motoresActivos && t > this.ocupadoHasta) {
      this.movioDespues = true;
      if (!this.auto() && this.plan !== 'ensayo' && hw.op.principal && this.sim.tCombate === null) {
        // Manual: el combate empieza cuando el robot arranca, contado desde el ultimo BOOT.
        this.enCombate = true;
        this.sim.iniciarCombate(true, this.tUltPulsoManual);
        return;
      }
    }
    if (!this.auto() && this.plan !== 'ensayo') return;
    if (this.listo || t < this.ocupadoHasta) return;
    // Espera el BOOT si lo esta leyendo una y otra vez desde hace 150 ms, y
    // empezo a hacerlo despues de pedirlo (no justo cuando termina de esperar).
    if (t - hw.tUltBoot > 20000 || hw.motoresActivos || t - hw.tInicioRachaBoot < 150000) return;
    const pidio = this.tUltPedido > this.tUltAccion;
    const ref = pidio ? this.tUltPedido : (this.lineas.length ? this.tUltLinea : this.tUltAccion);
    if (hw.tInicioRachaBoot + 1000 < ref) return;
    const quieto = t - hw.tUltActividad > 150000;
    if (!quieto && !(pidio && t - this.tUltPedido > 300000)) return;
    if (!(this.lineas.length > 0 || this.esperas === 0 || t - this.tUltAccion > 3e6)) return;
    this.atender(t);
  }
  atender(t) {
    const hw = this.hw, reg = hw.registro, sim = this.sim;
    const idx = this.esperas++;
    const texto = this.aviso();
    this.lineas = [];
    this.tUltAccion = t;
    this.movioDespues = false;
    let tipo = clasificarAviso(texto);
    const salida = this.plan === 'ensayo' ? false
      : (this.plan ? idx === this.plan.salida : (tipo === 'paso' && RE_SALIDA.test(sinTildes(texto))));
    if (salida) tipo = 'salida';
    this.acciones.push({ t, idx, tipo, texto });
    const cita = texto ? `el programa pide: "${texto.trim().slice(0, 100)}"` : 'el programa espera el BOOT sin decir nada';
    switch (tipo) {
      case 'salida': {
        // La salida puede ser tambien un paso de calibracion o la eleccion de la ronda.
        const clase = clasificarAviso(texto);
        this.tipoSalida = clase;
        hw.superficieCalib = clase === 'negro' || clase === 'blanco' ? clase : null;
        this.listo = true;
        const como = clase === 'negro' || clase === 'blanco' ? ` (con los sensores sobre ${clase.toUpperCase()})` : (clase === 'ronda' ? ` (elige la ronda ${sim.cfg.ronda})` : '');
        reg.agregar('arranque', `Operador deja el robot listo para la salida${como}`, cita);
        sim.salidaSiTodosListos();
        return;
      }
      case 'negro': case 'blanco':
        hw.superficieCalib = tipo;
        reg.agregar('arranque', `Operador sostiene los sensores sobre ${tipo.toUpperCase()}`, cita);
        this.pulsar(700);
        return;
      case 'ronda':
        hw.superficieCalib = null;
        reg.agregar('arranque', `Operador elige la ronda ${sim.cfg.ronda}`, cita);
        this.pulsarVeces(sim.cfg.ronda, 700);
        return;
      default:
        hw.superficieCalib = null;
        reg.agregar('arranque', 'El programa espera el BOOT', cita);
        this.pulsar(700);
    }
  }
  pulsar(retardoMs) {
    const m = this.sim.mundo, t = m.t + retardoMs * 1000;
    m.programar(t, () => this.hw.fijarBoton(true, 'auto'));
    m.programar(t + 120000, () => this.hw.fijarBoton(false, 'auto'));
    this.ocupadoHasta = t + 120000 + 250000;
  }
  pulsarVeces(n, retardoMs) {
    const m = this.sim.mundo;
    let t = m.t + retardoMs * 1000;
    for (let i = 0; i < n; i++) {
      m.programar(t, () => this.hw.fijarBoton(true, 'auto'));
      m.programar(t + 100000, () => this.hw.fijarBoton(false, 'auto'));
      t += 320000;
    }
    this.ocupadoHasta = t + 250000;
  }
  // La largada: las pulsaciones de la salida (una, o las de la ronda).
  hacerSalida(t) {
    const n = this.tipoSalida === 'ronda' ? this.sim.cfg.ronda : 1;
    this.pulsosSalida = n;
    const m = this.sim.mundo;
    for (let i = 0; i < n; i++) {
      m.programar(t, () => this.hw.fijarBoton(true, 'auto'));
      m.programar(t + (n > 1 ? 100000 : 120000), () => this.hw.fijarBoton(false, 'auto'));
      t += 320000;
    }
  }
  alSoltar() {
    if (!this.auto() && this.plan !== 'ensayo') this.tUltPulsoManual = this.sim.mundo.t;
    if (!this.listo || this.enCombate) return;
    if (this.auto() && --this.pulsosSalida > 0) return;
    this.enCombate = true;
    // si la salida era un paso de calibracion, el programa todavia lee los sensores un momento
    if (this.hw.superficieCalib) { const hw = this.hw; this.sim.mundo.programar(this.sim.mundo.t + 400000, () => { hw.superficieCalib = null; }); }
    if (this.hw.op.principal) this.sim.iniciarCombate(true);
  }
}

// Ensayo del arranque: corre el programa solo, con el operador apretando BOOT
// cada vez que lo pide, y anota cual fue la ultima espera antes de pelear.
const ENSAYOS = new Map();
function ensayarArranque(cfg, prog, pines) {
  const clave = [prog.clave, cfg.ronda, !!cfg.imuAusente, JSON.stringify(pines || null), cfg.perfilIR].join('|');
  if (ENSAYOS.has(clave)) return ENSAYOS.get(clave);
  let plan = null;
  try {
    const s = new Simulacion(Object.assign({}, cfg, {
      rival: 'ninguno', ensayo: true, operadorAuto: true, programa: prog, firmware: null, pines, posiciones: null, plan: null,
    }));
    const op = s.hw.operador;
    while (s.mundo.t < 60e6 && !s.hw.detenido) {
      s.avanzar(20000);
      const t = s.mundo.t;
      if (!op.acciones.length) { if (t > 15e6) break; continue; }
      const desde = t - Math.max(op.tUltAccion, op.ocupadoHasta);
      if (desde > 3e6 && op.movioDespues) break;
      if (desde > 8e6) break;
    }
    plan = { salida: op.acciones.length ? op.acciones[op.acciones.length - 1].idx : null,
      acciones: op.acciones.map(a => ({ tipo: a.tipo, texto: a.texto, ms: Math.round(a.t / 1000) })) };
    if (plan.acciones.length) plan.acciones[plan.acciones.length - 1].tipo = 'salida';
  } catch (x) {
    plan = null;
  }
  ENSAYOS.set(clave, plan);
  return plan;
}

/* ==========================================================================
   INFORME: lo que se muestra en la barra lateral.
   ========================================================================== */
const NOMBRES_LED = [
  { rgb: [0, 0, 0], nombre: 'Apagado' }, { rgb: [255, 0, 0], nombre: 'Rojo' }, { rgb: [255, 165, 0], nombre: 'Naranja' },
  { rgb: [255, 80, 0], nombre: 'Naranja rojizo' }, { rgb: [0, 0, 255], nombre: 'Azul' }, { rgb: [255, 0, 255], nombre: 'Violeta' },
  { rgb: [255, 0, 128], nombre: 'Magenta' }, { rgb: [0, 255, 128], nombre: 'Verde agua' }, { rgb: [255, 255, 0], nombre: 'Amarillo' },
  { rgb: [0, 255, 255], nombre: 'Cian' }, { rgb: [0, 255, 0], nombre: 'Verde' }, { rgb: [255, 255, 255], nombre: 'Blanco' },
];
// Que significa cada color: solo lo saben los firmwares propios (copia interna).
const USOS_LED = typeof USOS_LED_FW !== 'undefined' ? USOS_LED_FW : null;
for (const n of NOMBRES_LED) n.uso = USOS_LED ? (USOS_LED[n.rgb.join(',')] || '') : '';
// Nombre de un color cualquiera: exacto si es uno comun, si no por el tono.
function nombreLed(rgb) {
  const e = NOMBRES_LED.find(n => n.rgb[0] === rgb[0] && n.rgb[1] === rgb[1] && n.rgb[2] === rgb[2]);
  if (e) return e.nombre;
  const [r, g, b] = rgb, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max === 0) return 'Apagado';
  if (d < 0.18 * max) return max > 170 ? 'Blanco' : 'Gris';
  let h = max === r ? ((g - b) / d) % 6 : (max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  h = (h * 60 + 360) % 360;
  const tonos = [[12, 'Rojo'], [45, 'Naranja'], [70, 'Amarillo'], [155, 'Verde'], [195, 'Cian'], [255, 'Azul'], [290, 'Violeta'], [340, 'Magenta'], [361, 'Rojo']];
  const n = tonos.find(t => h < t[0])[1];
  return max < 110 ? n + ' tenue' : n;
}

const NOMBRES_ESTADO = {
  INIT: 'Arranque', AVANCE: 'Avanza a ciegas', BUSCA: 'Busca girando', TRACK: 'Persigue al rival',
  ATAQUE: 'Ataca a fondo', BORDE: 'Escape de borde', LEVANTADO: 'Levantado', EMPUJADO: 'Empujado',
  FLANQUEO: 'Flanqueo',
};

function describirManiobra(izq, der, ms, vigilar) {
  const V = ['sin vigilar', 'vigila adelante', 'vigila atrás', 'vigila los 4 IR'][vigilar] || '';
  let q;
  if (izq === der) q = izq > 0 ? `Retrocede a ${Math.abs(izq).toFixed(2)}` : `Avanza a ${Math.abs(izq).toFixed(2)}`;
  else if (izq === -der) q = izq > 0 ? 'Pivotea a la izquierda (por tiempo)' : 'Pivotea a la derecha (por tiempo)';
  else if (izq < 0 && der < 0) q = Math.abs(izq) < Math.abs(der) ? 'Curva hacia la izquierda' : 'Curva hacia la derecha';
  else q = `Motores ${izq.toFixed(2)} / ${der.toFixed(2)}`;
  return { titulo: `${q} · ${ms} ms`, vig: V };
}

class Registro {
  constructor(sim) {
    this.sim = sim;
    this.hw = null;
    this.entradas = [];
    this.lineasE = [];
    this.serial = [];
    this.led = [{ t: 0, rgb: [0, 0, 0] }];
    this.version = 0;
    this.estadoActual = 'INIT'; this.estadoDesde = 0;
    this.tiempoEstado = {};
    this.contadores = { ESCAPE: 0, GIRO: 0, PERDIDO: 0, GOLPE: 0, LEVANTADO_DET: 0, EMPUJE_PERDIDO: 0, EMPUJE_LATERAL: 0,
      GIRO_CORTADO: 0, GIRO_TIMEOUT: 0, PIVOTE_TRABADO: 0, GIRO_TRABADO: 0, EMPUJE_FINAL: 0, DESVIO: 0, ENCARAR: 0 };
    this.escapesPorTipo = {};
    this.otrosEventos = {};
    this.destellos = 0;
    this.fantasmas = 0;
    this.ventanaT = -1e12; this.enVentana = 0; this.omitidas = 0;
  }
  // Hasta 25 lineas del Serial por segundo en el informe; todas quedan en el monitor.
  dejarLinea(t) {
    if (t - this.ventanaT > 1e6) {
      if (this.omitidas) { const o = this.omitidas; this.omitidas = 0; this.agregar('serial', `… ${o} líneas más del Serial en ese segundo (están todas en el monitor)`, ''); }
      this.ventanaT = t; this.enVentana = 0;
    }
    if (this.enVentana++ < 25) return true;
    this.omitidas++;
    return false;
  }
  agregar(tipo, titulo, detalle, extra) {
    const hw = this.hw;
    const t = hw ? hw.t : 0;
    const e = Object.assign({ n: this.entradas.length, t, ms: Math.floor(t / 1000), tipo, titulo, detalle: detalle || '', led: hw ? hw.led.slice() : [0, 0, 0], nivel: 0 }, extra || {});
    this.entradas.push(e);
    this.version++;
    return e;
  }
  ultima() { return this.entradas[this.entradas.length - 1]; }
  evento(nombre, detalle) {
    const hw = this.hw;
    this.lineasE.push(`E,${Math.floor(hw.t / 1000)},${nombre},${detalle}`);
    if (nombre in this.contadores) this.contadores[nombre]++;
    else this.otrosEventos[nombre] = (this.otrosEventos[nombre] || 0) + 1;
    const p = String(detalle).split(';');
    let titulo = nombre, det = detalle, nivel = 0, tipo = 'evento';
    switch (nombre) {
      case 'GIRO_INICIAL': titulo = `Giro inicial de la ronda ${p[0]}`; det = `${p[1]} ms en total`; break;
      case 'PERDIDO': titulo = `Perdió al rival: busca hacia la ${p[0] === 'busca_izq' ? 'izquierda' : 'derecha'}`; det = ''; break;
      case 'GOLPE': titulo = `Golpe de ${p[0]} g`; det = `lateral ${p[1]} g · frontal ${p[2]} g · durante ${p[3]}`; tipo = 'golpe'; break;
      case 'GIRO': {
        const pedido = parseFloat(p[0]);
        titulo = `Giro ${pedido > 0 ? '+' : ''}${p[0]}° (${pedido > 0 ? 'izquierda' : 'derecha'})`;
        det = `midió ${p[1]}° en ${p[2]} ms`; nivel = 1; tipo = 'giro'; break;
      }
      case 'GIRO_TIMEOUT': titulo = 'Giro cortado por tiempo (3 s)'; det = `${p[0]}° de ${p[1]}°`; nivel = 1; tipo = 'alerta'; break;
      case 'GIRO_CORTADO': titulo = 'Giro cortado: un IR cruzó a blanco'; det = `${p[0]}° de ${p[1]}°`; nivel = 1; tipo = 'alerta'; break;
      case 'GIRO_TRABADO': titulo = 'Giro trabado: no avanza, se corta'; det = `${p[0]}° de ${p[1]}° en ${p[2]} ms`; nivel = 1; tipo = 'alerta'; break;
      case 'LEVANTADO_DET': titulo = `Detecta levantamiento: ${p[0]}°`; det = `Δx ${p[1]} g · Δy ${p[2]} g`; tipo = 'alerta'; break;
      case 'ESCAPE': {
        this.escapesPorTipo[p[0]] = (this.escapesPorTipo[p[0]] || 0) + 1;
        titulo = `Borde ${p[0]} → escape`;
        const partes = [];
        if (p[1] === 'ANTIBUCLE') partes.push('anti-bucle: invierte el sentido y suma 45°');
        const i = this.sim.mundo.destelloActivo(hw.cuerpo);
        if (i >= 0) { this.fantasmas++; partes.push(`con un destello activo en el sensor ${i}: probable escape fantasma`); }
        det = partes.join(' · '); tipo = 'borde'; break;
      }
      case 'LEVANTADO_REACCION': titulo = 'Reacción al levantamiento'; det = `retrocede y gira a la ${p[0] === 'giro_izq' ? 'izquierda' : 'derecha'}`; tipo = 'alerta'; break;
      case 'EMPUJE_PERDIDO': titulo = p[0] === 'rotado' ? 'Empuje perdido: lo están rotando' : 'Empuje perdido: más de 4 s empujando';
        det = `${p[1]} °/s al detectar → flanquea`; tipo = 'alerta'; break;
      case 'EMPUJE_LATERAL': titulo = 'Empuje o golpe fuera de ataque'; det = `${p[0]} °/s · Δx ${p[1]} g · Δy ${p[2]} g → escapa hacia adelante 350 ms`; tipo = 'alerta'; break;
      case 'PIVOTE_TRABADO': titulo = 'Búsqueda trabada: manda girar y no gira'; det = `giró ${p[0]}° en ${p[1]} ms → sale hacia adelante`; tipo = 'alerta'; break;
      case 'DESVIO': titulo = 'Empuje trabado: empuja en curva para sacarlo de la línea'; det = `hacia la ${p[0]} · ${p[1]} ms`; tipo = 'alerta'; break;
      case 'ENCARAR': { const a = parseFloat(p[0]); titulo = `Encara al atacante: gira ${Math.abs(a).toFixed(0)}° a la ${a > 0 ? 'izquierda' : 'derecha'}`; det = 'el golpe vino de ese lado'; tipo = 'alerta'; break; }
      case 'EMPUJE_FINAL': titulo = 'Empuje final: rival pegado sobre la línea'; det = `borde ${p[0]} con el rival a ${p[1]} cm → empuja ${p[2]} ms más`; tipo = 'alerta'; break;
    }
    this.agregar(tipo, titulo, det, { nivel, codigo: nombre, crudo: `${nombre},${detalle}` });
  }
  estado(s) {
    if (s === this.estadoActual) return;
    const hw = this.hw;
    this.tiempoEstado[this.estadoActual] = (this.tiempoEstado[this.estadoActual] || 0) + (hw.t - this.estadoDesde);
    this.estadoActual = s; this.estadoDesde = hw.t;
    const u = this.ultima();
    // Cambios rapidos seguidos (TRACK <-> ATAQUE a 40 cm) se juntan en un renglon.
    if (u && u.tipo === 'estado' && hw.t - u.tFin < 200000) {
      u.cadena.push(s); u.tFin = hw.t; u.veces++;
      const c = u.cadena.length > 5 ? [...u.cadena.slice(0, 2), '…', ...u.cadena.slice(-2)] : u.cadena;
      u.titulo = c.join(' → ');
      u.detalle = `${u.veces} cambios en ${((hw.t - u.t) / 1000).toFixed(0)} ms`;
      u.led = hw.led.slice();
      this.version++;
      return;
    }
    this.agregar('estado', s, NOMBRES_ESTADO[s] || '', { cadena: [s], tFin: hw.t, veces: 1 });
  }
  cambioLed(rgb) {
    const hw = this.hw;
    this.led.push({ t: hw.t, rgb: rgb.slice() });
    if (this.led.length > 20000) this.led.splice(0, 5000);
    const u = this.ultima();
    if (u && u.tipo === 'led' && hw.t - u.tFin < 120000) {
      u.cadena.push(nombreLed(rgb)); u.tFin = hw.t; u.led = rgb.slice();
      const c = u.cadena.length > 5 ? [...u.cadena.slice(0, 2), '…', ...u.cadena.slice(-2)] : u.cadena;
      u.titulo = 'LED ' + c.join(' → ');
      this.version++;
      return;
    }
    this.agregar('led', 'LED ' + nombreLed(rgb), '', { cadena: [nombreLed(rgb)], tFin: hw.t });
  }
  maniobra(izq, der, ms, vigilar, cortado, real) {
    const d = describirManiobra(izq, der, ms, vigilar);
    this.agregar('maniobra', d.titulo, cortado ? `${d.vig} · CORTADA a los ${real} ms: un IR cruzó a blanco` : `${d.vig} · completa`, { nivel: 1, cortada: cortado });
  }
  resumen() {
    const hw = this.hw;
    const te = Object.assign({}, this.tiempoEstado);
    te[this.estadoActual] = (te[this.estadoActual] || 0) + (hw.t - this.estadoDesde);
    return { contadores: this.contadores, escapesPorTipo: this.escapesPorTipo, otrosEventos: this.otrosEventos, tiempoEstado: te, destellos: this.destellos, fantasmas: this.fantasmas };
  }
}

/* ==========================================================================
   SIMULACION: arma todo y lo hace avanzar.
   ========================================================================== */
// Firmwares escritos a mano: solo en la copia interna (fw_registro.js); la publica no trae ninguno.
const FIRMWARES = typeof FIRMWARES_PROPIOS !== 'undefined' ? FIRMWARES_PROPIOS : {};
for (const [id, f] of Object.entries(FIRMWARES)) registrarPrograma(programaNativo(id, f.nombre, f.crear));
const EJEMPLO_DEF = Object.keys(PROGRAMAS).find(k => /^ejemplo_.*_ino$/.test(k)) || Object.keys(PROGRAMAS)[0];
const PROGRAMA_DEF = typeof FIRMWARE_DEF !== 'undefined' ? FIRMWARE_DEF : EJEMPLO_DEF;
const PROGRAMA_RIVAL_DEF = typeof FIRMWARE_RIVAL_DEF !== 'undefined' ? FIRMWARE_RIVAL_DEF : EJEMPLO_DEF;

const CFG_DEF = {
  ronda: 1, rival: 'caja', dojo: 'oficial', perfilIR: 'brillante', destellos: true,
  imuAusente: false, operadorAuto: true, esperaInicioMs: 900,
  v0: ROBOT.v0, desbalance: ROBOT.desbalance, fuerzaRival: 1.0, masaCaja: 0.30, perdidaEcoContacto: 0.06,
  semilla: 2026, posiciones: null, duracionCombate: 90,
  programa: null, programaRival: null,   // id de PROGRAMAS, un programa, o { archivos: [...] }
  firmware: null, firmwareRival: null,   // nombres viejos de lo mismo
  pines: null, pinesRival: null,         // otro cableado (ver PINES_KIT)
  opc: null, opcRival: null, desbalanceRival: null,
  modeloIMU: 'real', imuParams: null,   // fisica 3; 'limpio' = fisica 2
};

class Simulacion {
  constructor(cfg) { this.reiniciar(cfg); }
  reiniciar(cfg) {
    this.cfg = Object.assign({}, CFG_DEF, cfg || {});
    const s = this.cfg.semilla >>> 0;
    this.azar = {
      imu: crearAzar(s ^ 0x9E3779B1), ir: crearAzar(s ^ 0x85EBCA6B), sonar: crearAzar(s ^ 0xC2B2AE35),
      i2c: crearAzar(s ^ 0x27D4EB2F), rival: crearAzar(s ^ 0x165667B1), destellos: crearAzar(s ^ 0xD3A2646C),
      imuRival: crearAzar(s ^ 0x2545F491), irRival: crearAzar(s ^ 0x9FB21C65), sonarRival: crearAzar(s ^ 0x4F1BBCDD),
      i2cRival: crearAzar(s ^ 0x7A3C9E21), destellosRival: crearAzar(s ^ 0x3C6EF372),
    };
    this.hw = null; this.hwRival = null; this.fw = null; this.fwRival = null;
    this.firmwares = [];
    this.fase = 'arranque';
    this.tCombate = null;
    this.combateEnCurso = false;
    this.fin = null;
    this.rivalFueraEn = null;
    this.avisoTiempo = false;
    this.oyentes = this.oyentes || {};
    this.registro = new Registro(this);
    this.registroRival = null;
    this.salidaProgramada = false;
    this.estadisticas = { contactoUs: 0 };
    this.programa = resolverPrograma(this.cfg.programa || this.cfg.firmware || PROGRAMA_DEF);
    this.plan = null;
    if (this.programa.tipo !== 'nativo')
      this.plan = this.cfg.ensayo ? 'ensayo' : (this.cfg.plan !== undefined && this.cfg.plan !== null ? this.cfg.plan : ensayarArranque(this.cfg, this.programa, this.cfg.pines));
    this.programaRival = null; this.planRival = null;
    if (this.cfg.rival === 'espejo') {
      this.programaRival = resolverPrograma(this.cfg.programaRival || this.cfg.firmwareRival || PROGRAMA_RIVAL_DEF);
      if (this.programaRival.tipo !== 'nativo') this.planRival = ensayarArranque(this.cfg, this.programaRival, this.cfg.pinesRival);
    }
    this.mundo = new Mundo(this);
    this.hw = this.crearUnidad(this.mundo.robot, this.registro, {
      imuAusente: this.cfg.imuAusente, principal: true, programa: this.programa, plan: this.plan, opc: this.cfg.opc,
      pines: this.cfg.pines, azarSonar: this.azar.sonar, azarI2C: this.azar.i2c, auto: () => this.cfg.operadorAuto,
    });
    this.fw = this.hw.fw;
    if (this.cfg.rival === 'espejo') {
      this.registroRival = new Registro(this);
      this.hwRival = this.crearUnidad(this.mundo.rival, this.registroRival, {
        imuAusente: false, principal: false, programa: this.programaRival, plan: this.planRival, opc: this.cfg.opcRival,
        pines: this.cfg.pinesRival, azarSonar: this.azar.sonarRival, azarI2C: this.azar.i2cRival, auto: () => true,
      });
      this.fwRival = this.hwRival.fw;
    }
    this.gen = this.hw.gen;
    this.registro.agregar('arranque', 'Encendido', `Programa: ${this.programa.nombre} · Ronda ${this.cfg.ronda} · ${DOJOS[this.cfg.dojo].nombre} · ${PERFILES_IR[this.cfg.perfilIR].nombre}`);
    if (this.plan && this.plan.salida === null) this.iniciarCombate(true);
  }
  crearUnidad(cuerpo, registro, op) {
    const hw = new Hardware(this, cuerpo, registro, op);
    registro.hw = hw;
    hw.programa = op.programa;
    const nativo = op.programa.tipo === 'nativo';
    hw.operador = nativo ? new Operador(this, hw, op.auto) : new OperadorGenerico(this, hw, op.auto, op.plan);
    const self = this;
    const ins = {
      evento: (n, d) => registro.evento(n, d),
      estado: s2 => registro.estado(s2),
      maniobra: (a, b, c, d, e, f) => registro.maniobra(a, b, c, d, e, f),
      inicioCombate: () => { if (op.principal) self.iniciarCombate(); else hw.superficieCalib = null; },
    };
    const u = op.programa.crear(hw, ins, op.opc || {});
    hw.fw = { vars: u.vars || (() => ({})), tipos: u.tipos || null, nativo: u.fw || null };
    hw.gen = u.gen;
    this.firmwares.push(hw);
    return hw;
  }
  falloPrograma(hw, x) {
    const propio = x instanceof FalloPrograma;
    const linea = hw.programa && hw.programa.lineaDeError ? hw.programa.lineaDeError(x) : null;
    hw.detenido = { msg: x.message, linea, propio };
    hw.cuerpo.fijarMotores(0, 0);
    hw.motoresActivos = false;
    const donde = linea ? ` (linea ${linea})` : '';
    const python = hw.programa && hw.programa.tipo === 'python';
    hw.registro.agregar('fuera', propio ? `El programa se detuvo${donde}: ${x.message}` : `El programa fallo${donde}: ${x.message}`,
      propio ? (python ? 'CircuitPython muestra el error y el robot queda quieto' : 'en el robot real el ESP32 se reiniciaria') : 'error al ejecutar el programa traducido: avisale a quien mantiene el simulador');
    if (hw.op.principal) this.emitir('fallo', hw.detenido);
  }
  // Salida simultanea: cuando todos los firmwares piden el BOOT final, el
  // operador se lo da a todos en el mismo instante.
  salidaSiTodosListos() {
    if (!this.firmwares.every(h => h.operador.listo || h.detenido)) return;
    if (!this.firmwares.every(h => h.detenido || h.operador.auto())) return;
    if (this.salidaProgramada) return;
    this.salidaProgramada = true;
    const m = this.mundo, t = m.t + this.cfg.esperaInicioMs * 1000;
    for (const h of this.firmwares) {
      if (h.detenido) continue;
      if (h.operador.hacerSalida) { h.operador.hacerSalida(t); continue; }
      m.programar(t, () => h.fijarBoton(true, 'auto'));
      m.programar(t + 120000, () => h.fijarBoton(false, 'auto'));
    }
  }
  avanzar(dtUs) {
    if (this.fin) return;
    const objetivo = this.mundo.t + dtUs;
    while (this.mundo.t < objetivo && !this.fin) {
      const T = this.mundo.t + DT_US;
      for (const hw of this.firmwares) {
        if (hw.detenido) { hw.t = Math.max(hw.t, T); continue; }
        hw.limite = T;
        try {
          while (hw.t < T) {
            const r = hw.gen.next();
            if (r.done) { hw.detenido = { msg: 'el programa termino', fin: true }; hw.t = T; hw.registro.agregar('arranque', 'El programa termino', 'ya no hace nada mas'); break; }
          }
        } catch (x) { this.falloPrograma(hw, x); hw.t = Math.max(hw.t, T); }
        hw.ceder = false;
      }
      this.mundo.avanzarHasta(T);
      if (this.mundo.contacto && this.combateEnCurso) this.estadisticas.contactoUs += DT_US;
      for (const hw of this.firmwares) if (hw.operador.revisar) hw.operador.revisar(this.mundo.t);
    }
    if (this.combateEnCurso && !this.avisoTiempo && this.tiempoCombate() >= this.cfg.duracionCombate) {
      this.avisoTiempo = true;
      this.registro.agregar('mundo', 'Se cumplió 1:30', 'Fin del tiempo reglamentario del combate');
      this.emitir('tiempo');
    }
  }
  tiempoCombate() { return this.tCombate === null ? 0 : (this.mundo.t - this.tCombate) / 1e6; }
  fijarBoton(v, quien) { this.hw.fijarBoton(v, quien); }
  iniciarCombate(generico, tDesde) {
    if (this.tCombate !== null) return;
    this.tCombate = generico ? (tDesde !== undefined && tDesde !== null ? tDesde : this.mundo.t) : this.hw.t;
    this.combateEnCurso = true;
    this.fase = 'combate';
    this.hw.superficieCalib = null;
    this.registro.agregar('mundo', 'Comienza el combate', 'se soltó el BOOT final: t = 0.000 s');
    this.emitir('combate');
  }
  robotFuera() {
    this.fin = { motivo: 'fuera', t: this.mundo.t };
    this.fase = 'fin';
    this.registro.agregar('fuera', 'El robot salió completamente del círculo negro', 'derrota según el reglamento');
    this.emitir('fin');
  }
  rivalFuera() {
    if (this.rivalFueraEn !== null) return;
    this.rivalFueraEn = this.mundo.t;
    this.registro.agregar('victoria', 'El rival salió del círculo negro', 'victoria según el reglamento');
    this.emitir('victoria');
  }
  emitir(tipo, dato) { const f = this.oyentes[tipo]; if (f) f(dato); }
  // ── pruebas manuales sobre el robot ──
  golpe(lado) {
    const m = this.mundo, t = m.t, s = lado === 'izq' ? -1 : 1;   // viene de la izquierda: empuja hacia la derecha
    m.acciones.push({ tipo: 'fuerza', desde: t, hasta: t + 25000, fuerza: [0, s * 5.0], punto: [0.03, -s * ROBOT.hw] });
    this.registro.agregar('prueba', `Prueba: golpe desde la ${lado === 'izq' ? 'izquierda' : 'derecha'}`, '5 N durante 25 ms, 3 cm adelante del centro');
  }
  empujar(lado) {
    const m = this.mundo, t = m.t, s = lado === 'izq' ? -1 : 1;
    m.acciones.push({ tipo: 'fuerza', desde: t, hasta: t + 1000000, fuerza: [0, s * 3.2], punto: [0.045, -s * ROBOT.hw] });
    this.registro.agregar('prueba', `Prueba: empuje sostenido desde la ${lado === 'izq' ? 'izquierda' : 'derecha'}`, '3.2 N durante 1 s sobre la esquina delantera');
  }
  levantar(ms) {
    const m = this.mundo, t = m.t;
    m.acciones.push({ tipo: 'levantar', desde: t, hasta: t + ms * 1000 });
    this.registro.agregar('prueba', `Prueba: levantar el frente ${(ms / 1000).toFixed(1)} s`, 'inclinación 25°, ruedas sin apoyo');
  }
}

const API = {
  Simulacion, posicionesRonda, DOJOS, PERFILES_IR, ROBOT, SONAR, IMU, COSTO, NOMBRES_LED, NOMBRES_ESTADO,
  nombreLed, USOS_LED, CFG_DEF, GRAD, FIRMWARES, TIPOS_RIVAL, VERSION_FISICA, PINES_KIT,
  PROGRAMAS, PROGRAMA_DEF, PROGRAMA_RIVAL_DEF, registrarPrograma, programaArduino, programaPython, programaDesdeArchivos, resolverPrograma,
  traducirArduino, traducirPython: typeof traducirPython === 'function' ? traducirPython : null, clasificarAviso, ensayarArranque,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else global.SimSumo = API;
})(typeof window !== 'undefined' ? window : globalThis);
