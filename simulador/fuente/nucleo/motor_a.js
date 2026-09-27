/* ==========================================================================
   NUCLEO DEL SIMULADOR DE SUMOBOT (kit IdeaBoard, ESP32)
   Sin DOM: corre igual en el navegador y en node (pruebas).

   Tres capas:
     1. Mundo      fisica 2D del dojo, los robots, el IMU y los IR de cada uno.
                   Ajustada contra mediciones de un robot real del kit.
     2. Hardware   lo que cada programa ve: pines, ADC, PWM, el sonar, el
                   NeoPixel, el IMU LSM6DS3TRC, el boton BOOT y el Serial.
     3. Programa   el codigo del robot traducido a JavaScript (Arduino o
                   CircuitPython, ver traductor_*.js). Las funciones que
                   esperan tiempo son generadores (function*) y se llaman con
                   yield*: asi el simulador puede pausar el programa en
                   cualquier punto sin cambiar su logica.

   Puede correr DOS programas a la vez (rival "espejo"): cada uno con su
   hardware, su reloj y su operador, sincronizados con el mundo cada 250 us.
   ========================================================================== */
(function (global) {
'use strict';

const G = 9.81;
const GRAD = Math.PI / 180;
const DT_US = 250;            // paso de fisica: 4 kHz
const DT = DT_US * 1e-6;
const VERSION_FISICA = 'física 3.1 (IMU real 26-09; caerse de la tarima cuenta como salir, 27-09)';

// Costo en microsegundos de cada llamada del firmware. Sale de lo medido:
// el loop sin sonar dura ~0.9 ms y la calibracion del giroscopio junta
// 400 muestras en 2 s (getEvent ~0.45 ms + delay(5) cuantizado a ticks).
const COSTO = {
  analogRead: 60, digitalRead: 0.3, digitalWrite: 0.3, pinMode: 0.5,
  ledcWrite: 2, i2cEvento: 450, i2cConfig: 150, i2cBegin: 1200,
  neopixel: 45, latchNeopixel: 300, serial: 5, loopCore: 2,
};

// Ultrasonico HC-SR05 (compatible SR04 en modo trigger/echo).
const SONAR = {
  retardoRafaga: 460,    // us entre la bajada de TRIG y la subida de ECHO
  usPorCm: 58.3,         // ida y vuelta a 343 m/s
  ecoPerdido: 38000,     // sin eco, ECHO queda en alto ~38 ms
  semiAngulo: 15 * GRAD, // cono de +-15 grados
  rayos: 13,
  alcance: 4.0,          // m
  xMontaje: 0.010,       // m sobre el eje, 4 cm detras de la pala
  desfaseUs: 175,        // us extra del modulo: pegado a la caja lee ~7 cm, como el real
  // Pegado al rival se pierden ecos. El 20-09 se vio hasta la mitad, pero con
  // eso dos perdidas seguidas (>80 ms sin eco) reinician el reloj de 4 s y
  // EMPUJE_PERDIDO,tiempo nunca saldria; en el robot real si salio (x2). Por
  // defecto 6 %; se puede cambiar en la pantalla.
  distCerca: 0.09,
  perdidaNormal: 0.02,
};

// LSM6DS3TRC. Ejes medidos en el robot: Z arriba, Y adelante, X derecha.
const IMU = {
  odr: 416,
  montaje: { x: 0.021, y: -0.034, z: 1.035 },  // reposo en g: el robot no esta nivelado
  sesgoGiro: 0.40 * GRAD,                      // medido 0.33-0.46 grados/s
  ruidoGiroReposo: 0.15 * GRAD,
  ruidoGiroMotor: 8 * GRAD,                    // medido: +-10-20 grados/s manejando
  ruidoAccReposo: 0.010,                       // g
  ruidoAccMotor: 0.035,                        // modelo "limpio" (fisica 2)
  fallaI2C: 0.03,                              // prob. de lectura basura en choques fuertes
  cabeceoLevantado: 25 * GRAD,                 // medido: levantar a mano lee 22-27 grados
  // Modelo "real" (fisica 3). El limpio no tenia los sacudones del chasis y
  // aprobo "encarar", que en el robot se disparo solo (25-09). Estos valores
  // se ajustaron contra las capturas reales (capturas\, imu_estadisticas.js):
  // inclinacion aparente por tipo de movimiento, GOLPE por minuto en cada
  // estado, cuando y hacia donde salen. Desvio en g sobre el eje Y (el
  // cabeceo del chasis); el X lleva una fraccion (ejeX).
  vibRecta: 0.040,               // vibracion de fondo por unidad de avance mandado
  vibGiro: 0.023,                // por unidad de giro mandado
  vibAire: 0.32,                 // en el aire, por unidad de vibracion (ruedas libres)
  ejeX: 0.375,                   // X / Y: el sacudon es sobre todo cabeceo
  sacudonComun: 0.10,            // energia de sacudon por unidad de cambio de la orden de avance
  sacudonDif: 0.05,              // idem, orden de giro
  sesgoArranque: 0.25,           // el sacudon del avance empuja la media hacia donde se acelera (+Y al arrancar)
  tauSacudon: 0.20,              // s: cuanto dura un sacudon
  tasaBache: 2.0,                // baches al azar por segundo, por unidad de orden (andando)
  bache: 0.10,                   // energia media de un bache (exponencial)
};

// Parametros fisicos por defecto. El pivote se ajusto con una busqueda de
// parametros contra lo medido en el robot (20-09): giro inicial 407-467 ms
// terminando en 91-94 grados, escapes que cortan en 86 y terminan en 92-95
// por inercia, busqueda a 0.75 ~90 grados/s, a 0.45 se frena. Resultado del
// ajuste: 456 ms / 90.4, 441 ms / 94.3, 95 grados/s con y sin impulso, se
// frena. La velocidad recta NO esta medida.
const ROBOT = {
  masa: 0.30,               // kg (limite del reglamento: 315 g)
  hl: 0.050, hw: 0.0475,    // medio largo / medio ancho (base de 100 x 95 mm)
  via: 0.085,               // m entre ruedas
  v0: 0.20,                 // m/s recto a fondo. Medido 26-09 en las capturas: acercamiento a 19 cm/s (por USB; con pilas puede ser mas)
  // Pivote: ajuste empirico contra lo medido (ver arriba).
  fStall: 1.21,             // N por rueda a fondo y parado (la traccion corta en 1.18)
  v0Giro: 0.623,            // referencia de contra-fem del pivote
  roceGiro: 0.0683,         // N*m de roce al pivotear (Coulomb)
  roceEstatico: 1.0,        // sin extra al arrancar: el ajuste no lo necesito
  inercia: 9.9e-4,          // kg*m2 (pilas y motores lejos del centro)
  roceLibreGiro: 0.078,     // N por rueda con el motor suelto, parte de giro
  roceLibreRecta: 0.60,     // N por rueda con el motor suelto, parte de avance (reductor N20)
  mu: 0.80,                 // traccion
  radioRoce: 0.030,
  vEps: 0.004,
  desbalance: 0.11,         // rueda derecha 11 % mas fuerte: sin correccion curva ~20 grados/s (medido 15-30)
  sensoresIR: [[0.040, 0.036], [0.040, -0.036], [-0.040, 0.036], [-0.040, -0.036]],
  // Fisica 3: el avance en recto tarda en tomar velocidad. Medido en las
  // capturas (25-09): al pasar de buscar a perseguir, la primera lectura da
  // +0.13 g de media y la siguiente ya ~0; el simulador daba +0.27 g y
  // llegaba a la velocidad en 40 ms. Solo afecta a la parte de avance de la
  // orden: el pivote (ajustado contra lo medido) queda igual.
  tauAvance: 0.07,          // s
};

const DOJOS = {
  practica: { nombre: 'Practica: 100 cm, anillo de 10 cm', rTotal: 0.50, rNegro: 0.40 },
  oficial:  { nombre: 'Oficial: 90 cm, anillo de 5 cm',    rTotal: 0.45, rNegro: 0.40 },
};

// Lecturas crudas medidas (ADC 0-4095). Blanco lee BAJO, negro ALTO.
// Los destellos solo existen en superficies brillantes: el dojo mate no los tiene.
const PERFILES_IR = {
  brillante: {
    nombre: 'Dojo brillante (medido 25-09)', destellos: true,
    negro: [3290, 1735, 1450, 1930], ruidoNegro: [60, 30, 90, 60],
    blanco: [78, 24, 19, 22],        ruidoBlanco: [3, 2, 1, 1],
    caidaVibracion: 0.10,
  },
  mate: {
    nombre: 'Dojo mate (medido 20-09)', destellos: false,
    negro: [3480, 2525, 2090, 2540], ruidoNegro: [50, 90, 60, 50],
    blanco: [1770, 56, 36, 44],      ruidoBlanco: [300, 5, 2, 2],
    caidaVibracion: 0.12,
  },
};

// Destellos especulares del negro brillante (medido 25-09): la lectura
// cae a 230-806 unos milisegundos, andando. ~0.3 por segundo en total.
// Profundidad relativa al negro de cada sensor: 230-806 sobre un negro de
// ~1750 es 0.13-0.46. Con 0.10 solo 1 de 70 destellos cruzaba el umbral.
const DESTELLO = { tasaPorSensor: 0.075, fracMin: 0.13, fracMax: 0.46, colaMin: 0.085, probCola: 0.015, durMin: 3000, durMax: 15000 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function angNorm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

// ─────────────────────────── azar con semilla ───────────────────────────
function crearAzar(semilla) {
  let a = (semilla >>> 0) || 1;
  let guardado = null;
  function sig() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss() {
    if (guardado !== null) { const g = guardado; guardado = null; return g; }
    let u = 0; while (u === 0) u = sig();
    const v = sig(), r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
    guardado = r * Math.sin(th);
    return r * Math.cos(th);
  }
  return { sig, gauss, rango: (x, y) => x + (y - x) * sig(), prob: p => sig() < p };
}

// ─────────────────────────── cuerpos ───────────────────────────
class Cuerpo {
  constructor(o) {
    this.tipo = o.tipo;
    this.x = o.x; this.y = o.y; this.th = o.th;
    this.vx = 0; this.vy = 0; this.w = 0;
    this.hl = o.hl; this.hw = o.hw;
    this.radio = Math.hypot(this.hl, this.hw);
    this.m = o.m || 0.3;
    this.I = this.m * ((2 * this.hl) ** 2 + (2 * this.hw) ** 2) / 12;
    this.estatico = !!o.estatico;
    this.mu = o.mu || 0.35;
    this.rRoce = (2 / 3) * this.radio;
    this.fx = 0; this.fy = 0; this.tq = 0;
    this.fuera = false;   // completamente fuera del circulo negro
    this.caido = false;   // se cayo del dojo: sale de la fisica
    this._esq = [[0, 0], [0, 0], [0, 0], [0, 0]]; this._ex = NaN; this._ey = NaN; this._eth = NaN;
  }
  // Las esquinas se recalculan solo si el cuerpo se movio (se reusa el arreglo:
  // quien las pide las usa en el momento y no las guarda).
  esquinas() {
    if (this._ex === this.x && this._ey === this.y && this._eth === this.th) return this._esq;
    const c = Math.cos(this.th), s = Math.sin(this.th), hl = this.hl, hw = this.hw, r = this._esq;
    r[0][0] = this.x + c * hl - s * hw; r[0][1] = this.y + s * hl + c * hw;
    r[1][0] = this.x - c * hl - s * hw; r[1][1] = this.y - s * hl + c * hw;
    r[2][0] = this.x - c * hl + s * hw; r[2][1] = this.y - s * hl - c * hw;
    r[3][0] = this.x + c * hl + s * hw; r[3][1] = this.y + s * hl - c * hw;
    this._ex = this.x; this._ey = this.y; this._eth = this.th;
    return r;
  }
  puntoCuerpo(f, l) {
    const c = Math.cos(this.th), s = Math.sin(this.th);
    return [this.x + c * f - s * l, this.y + s * f + c * l];
  }
  velEn(px, py) { return [this.vx - this.w * (py - this.y), this.vy + this.w * (px - this.x)]; }
  aplicar(fx, fy, px, py) {
    if (this.estatico) return;
    this.fx += fx; this.fy += fy;
    this.tq += (px - this.x) * fy - (py - this.y) * fx;
  }
  integrar(dt) {
    if (this.estatico || this.caido) { this.fx = this.fy = this.tq = 0; return; }
    this.vx += this.fx / this.m * dt; this.vy += this.fy / this.m * dt; this.w += this.tq / this.I * dt;
    const sp = Math.hypot(this.vx, this.vy), dv = this.mu * G * dt;
    if (sp <= dv) { this.vx = 0; this.vy = 0; } else { const k = (sp - dv) / sp; this.vx *= k; this.vy *= k; }
    const dw = this.mu * this.m * G * this.rRoce / this.I * dt;
    this.w = Math.abs(this.w) <= dw ? 0 : this.w - Math.sign(this.w) * dw;
    this.x += this.vx * dt; this.y += this.vy * dt; this.th += this.w * dt;
    this.fx = this.fy = this.tq = 0;
  }
}

class Robot extends Cuerpo {
  constructor(o, p) {
    super(Object.assign({ hl: p.hl, hw: p.hw, m: p.masa }, o));
    this.p = p;
    this.I = p.inercia;
    this.uIzq = 0; this.uDer = 0;   // +1 = rueda hacia adelante
    this.cEf = 0;                   // parte de avance ya aplicada (fisica 3: tarda tauAvance)
    this.levantado = false;
    this.cabeceo = 0;
    this.fRuedas = [0, 0];
    this.destellos = [0, 1, 2, 3].map(() => ({ hasta: 0, valor: 0 }));
    this.imu = null;
    this.hard = null;               // el hardware virtual que lo maneja, si corre firmware
  }
  fijarMotores(uIzq, uDer) { this.uIzq = uIzq; this.uDer = uDer; }
  vibracion() { return Math.min(1, (Math.abs(this.uIzq) + Math.abs(this.uDer)) / 2); }
  // vRecta: parte de la velocidad de la rueda que viene del avance;
  // vGiro: la que viene del giro. Por separado para que la velocidad recta
  // (sin medir) se pueda cambiar sin romper el pivote (medido).
  fuerzaRueda(u, vRecta, vGiro, lim) {
    const P = this.p;
    if (u === 0)   // motor suelto: solo el roce del reductor
      return clamp(-P.roceLibreRecta * Math.tanh(vRecta / 0.004) - P.roceLibreGiro * Math.tanh(vGiro / 0.004), -lim, lim);
    // Ajuste empirico: el avance sigue a un motor DC comun (velocidad ~ PWM)
    // y el giro al "fast decay" del puente H (el PWM escala el torque). Asi
    // salen juntos el pivote medido y una velocidad recta proporcional.
    return clamp(P.fStall * (u - vRecta / P.v0 - Math.abs(u) * vGiro / P.v0Giro), -lim, lim);
  }
  integrar(dt) {
    if (this.caido) { this.fx = this.fy = this.tq = 0; return; }
    if (this.levantado) {
      // en la mano: las ruedas no apoyan; se frena en ~40 ms, sin tiron artificial
      const k = Math.exp(-dt / 0.04);
      this.vx *= k; this.vy *= k; this.w *= k;
      this.x += this.vx * dt; this.y += this.vy * dt; this.th += this.w * dt;
      this.fx = this.fy = this.tq = 0;
      this.fRuedas[0] = 0; this.fRuedas[1] = 0;
      return;
    }
    const P = this.p, c = Math.cos(this.th), s = Math.sin(this.th);
    let vf = this.vx * c + this.vy * s, vl = -this.vx * s + this.vy * c, w = this.w;
    const Ffe = this.fx * c + this.fy * s, Fle = -this.fx * s + this.fy * c;
    const b2 = P.via / 2, lim = P.mu * this.m * G / 2;
    // Orden efectiva: la parte de giro llega ya; la de avance sigue a la orden
    // con tauAvance. Motores sueltos (orden 0 en las dos ruedas): sin retardo.
    let uI = this.uIzq, uD = this.uDer;
    if (P.tauAvance > 0) {
      if (uI === 0 && uD === 0) this.cEf = 0;
      else {
        const c = (uI + uD) / 2, d = (uD - uI) / 2;
        this.cEf += (c - this.cEf) * (1 - Math.exp(-dt / P.tauAvance));
        uI = this.cEf - d; uD = this.cEf + d;
      }
    }
    const FL = this.fuerzaRueda(uI * (1 - P.desbalance / 2), vf, -w * b2, lim);
    const FR = this.fuerzaRueda(uD * (1 + P.desbalance / 2), vf, w * b2, lim);
    this.fRuedas[0] = FL; this.fRuedas[1] = FR;
    vf += (FL + FR + Ffe) / this.m * dt;
    vl += Fle / this.m * dt;
    const dvl = P.mu * G * dt;
    vl = Math.abs(vl) <= dvl ? 0 : vl - Math.sign(vl) * dvl;
    w += ((FR - FL) * b2 + this.tq) / this.I * dt;
    // arrastre al girar: pleno pivoteando en el lugar, casi nulo si avanza
    // (bajo 2 cm/s de avance cuenta como quieto: un arrastre lento no suelta el roce)
    const vfEf = Math.max(0, Math.abs(vf) - 0.02);
    const g = (Math.abs(w) * P.radioRoce + P.vEps) / (Math.hypot(w * P.radioRoce, vfEf) + P.vEps);
    const Tr = P.roceGiro * (this.w === 0 ? P.roceEstatico : 1);   // quieto: roce estatico
    const dw = Tr * g / this.I * dt;
    w = Math.abs(w) <= dw ? 0 : w - Math.sign(w) * dw;
    this.vx = vf * c - vl * s; this.vy = vf * s + vl * c; this.w = w;
    this.x += this.vx * dt; this.y += this.vy * dt; this.th += w * dt;
    this.fx = this.fy = this.tq = 0;
  }
}

function dentroDe(C, p) {
  const c = Math.cos(C.th), s = Math.sin(C.th), dx = p[0] - C.x, dy = p[1] - C.y;
  return Math.abs(dx * c + dy * s) <= C.hl && Math.abs(-dx * s + dy * c) <= C.hw;
}

function radioProy(C, ex, ey) {
  const c = Math.cos(C.th), s = Math.sin(C.th);
  return C.hl * Math.abs(c * ex + s * ey) + C.hw * Math.abs(-s * ex + c * ey);
}

// Separacion de ejes entre dos rectangulos orientados.
function contactoOBB(A, B) {
  const dx = B.x - A.x, dy = B.y - A.y, rr = A.radio + B.radio;
  if (dx * dx + dy * dy > rr * rr) return null;          // ni los circulos que los encierran se tocan
  const cA = Math.cos(A.th), sA = Math.sin(A.th), cB = Math.cos(B.th), sB = Math.sin(B.th);
  const ejes = [[cA, sA], [-sA, cA], [cB, sB], [-sB, cB]];
  let min = Infinity, n = null;
  for (const [ex, ey] of ejes) {
    const d = dx * ex + dy * ey;
    const solape = radioProy(A, ex, ey) + radioProy(B, ex, ey) - Math.abs(d);
    if (solape <= 0) return null;
    if (solape < min) { min = solape; n = d >= 0 ? [ex, ey] : [-ex, -ey]; }
  }
  const caraA = A.x * n[0] + A.y * n[1] + radioProy(A, n[0], n[1]);
  const caraB = B.x * n[0] + B.y * n[1] - radioProy(B, n[0], n[1]);
  const puntos = [];
  for (const p of B.esquinas()) if (dentroDe(A, p)) puntos.push([p[0], p[1], Math.min(min, caraA - (p[0] * n[0] + p[1] * n[1]))]);
  for (const p of A.esquinas()) if (dentroDe(B, p)) puntos.push([p[0], p[1], Math.min(min, (p[0] * n[0] + p[1] * n[1]) - caraB)]);
  if (!puntos.length) {
    const r = radioProy(A, n[0], n[1]) - min / 2;
    puntos.push([A.x + n[0] * r, A.y + n[1] * r, min]);
  }
  return { n, puntos, solape: min };
}

const K_CONTACTO = 6000, C_CONTACTO = 12, MU_CONTACTO = 0.4;
function aplicarContacto(A, B, k) {
  const n = k.n;
  let total = 0;
  for (const [px, py, prof] of k.puntos) {
    if (prof <= 0) continue;
    const va = A.velEn(px, py), vb = B.velEn(px, py);
    const rvx = vb[0] - va[0], rvy = vb[1] - va[1];
    const vn = rvx * n[0] + rvy * n[1];
    const Fn = K_CONTACTO * prof - C_CONTACTO * vn;
    if (Fn <= 0) continue;
    const tx = rvx - vn * n[0], ty = rvy - vn * n[1], vt = Math.hypot(tx, ty);
    const Ft = MU_CONTACTO * Fn * vt / (vt + 0.01);
    const fx = Fn * n[0] - (vt > 0 ? Ft * tx / vt : 0);
    const fy = Fn * n[1] - (vt > 0 ? Ft * ty / vt : 0);
    B.aplicar(fx, fy, px, py); A.aplicar(-fx, -fy, px, py);
    total += Fn;
  }
  return total;
}

// Rayos del cono del sonar contra un rectangulo: devuelve la distancia minima.
function rayoContraCuerpo(ox, oy, dx, dy, C) {
  const pts = C.esquinas();
  let mejor = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
    const u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < mejor) mejor = t;
  }
  return mejor;
}

// ─────────────────────────── rivales sin firmware ───────────────────────────
// "Embiste": sabe siempre donde esta nuestro robot, apunta y empuja. Retrocede
// si pisa el blanco. Es idealizado: sirve para producir empujes fuertes.
class IAEmbiste {
  constructor(rob, azar) { this.r = rob; this.azar = azar; this.modo = 'espera'; this.hasta = 0; this.giro = 1; }
  actualizar(m, t) {
    const R = this.r, yo = m.otro(R);
    if (!m.sim.combateEnCurso || !yo || yo.caido) { R.fijarMotores(0, 0); return; }
    const dojo = m.dojo;
    const f1 = R.puntoCuerpo(R.hl * 0.8, R.hw * 0.7), f2 = R.puntoCuerpo(R.hl * 0.8, -R.hw * 0.7);
    const pisaBlanco = Math.hypot(f1[0], f1[1]) > dojo.rNegro || Math.hypot(f2[0], f2[1]) > dojo.rNegro;
    if (this.modo === 'atras' && t < this.hasta) { R.fijarMotores(-1, -1); return; }
    if (this.modo === 'atras') { this.modo = 'girar'; this.hasta = t + 280000; }
    if (this.modo === 'girar' && t < this.hasta) { R.fijarMotores(-this.giro, this.giro); return; }
    if (pisaBlanco) {
      this.modo = 'atras'; this.hasta = t + 220000;
      const haciaCentro = angNorm(Math.atan2(-R.y, -R.x) - R.th);
      this.giro = haciaCentro > 0 ? 1 : -1;
      R.fijarMotores(-1, -1); return;
    }
    this.modo = 'cazar';
    const e = angNorm(Math.atan2(yo.y - R.y, yo.x - R.x) - R.th);
    if (Math.abs(e) > 0.45) { const s = e > 0 ? 1 : -1; R.fijarMotores(-s, s); return; }
    const k = clamp(e * 1.2, -0.5, 0.5);
    R.fijarMotores(clamp(1 - k, -1, 1), clamp(1 + k, -1, 1));
  }
}

// "Tipico": lo que suele programar un equipo con el mismo kit. Usa SUS
// sensores (sonar con cono y ecos perdidos, 4 IR), busca girando, embiste al
// ver algo a menos de 60 cm, y esquiva el borde por tiempo. Sin giroscopio.
class IATipico {
  constructor(rob, azar, ronda) {
    this.r = rob; this.azar = azar; this.ronda = ronda;
    this.modo = 'espera'; this.hasta = 0; this.dir = 1; this.dirBusca = azar.prob(0.5) ? 1 : -1;
    this.proxPing = 0; this.visto = false; this.tVisto = -1e12; this.inicio = null;
  }
  actualizar(m, t) {
    const R = this.r;
    if (!m.sim.combateEnCurso) { R.fijarMotores(0, 0); return; }
    if (this.inicio === null) {
      this.inicio = t;
      if (this.ronda === 2) { this.modo = 'giroInicial'; this.hasta = t + 500000; }
      else if (this.ronda === 3) { this.modo = 'giroInicial'; this.hasta = t + 1000000; }
    }
    if (t >= this.proxPing) {                       // sonar cada 50 ms (CircuitPython)
      this.proxPing = t + 50000;
      const d = m.medirSonar(R).d;
      if (d < 0.60 && !this.azar.prob(0.05)) { this.visto = true; this.tVisto = t; }
      else if (t - this.tVisto > 150000) this.visto = false;
    }
    const s = ROBOT.sensoresIR.map(([f, l]) => { const p = R.puntoCuerpo(f, l); return m.blancura(p[0], p[1]) > 0.5; });
    const frente = s[0] || s[1], atras = s[2] || s[3];
    if (this.modo === 'giroInicial' && t < this.hasta) { R.fijarMotores(1, -1); return; }   // a la derecha
    if (this.modo === 'atras' && t < this.hasta) { R.fijarMotores(-0.9, -0.9); return; }
    if (this.modo === 'atras') { this.modo = 'girar'; this.hasta = t + 400000; this.dir = this.azar.prob(0.5) ? 1 : -1; }
    if (this.modo === 'girar' && t < this.hasta) { R.fijarMotores(-this.dir, this.dir); return; }
    if (this.modo === 'adelante' && t < this.hasta) { R.fijarMotores(1, 1); return; }
    if (frente) { this.modo = 'atras'; this.hasta = t + 300000; R.fijarMotores(-0.9, -0.9); return; }
    if (atras) { this.modo = 'adelante'; this.hasta = t + 300000; R.fijarMotores(1, 1); return; }
    if (this.visto) { this.modo = 'ataque'; R.fijarMotores(1, 1); return; }
    this.modo = 'busca';
    R.fijarMotores(-0.85 * this.dirBusca, 0.85 * this.dirBusca);
  }
}

// ─────────────────────────── IMU virtual ───────────────────────────
class IMUVirtual {
  constructor(m, cuerpo, azar) {
    this.m = m; this.c = cuerpo; this.azar = azar;
    this.P = m.imuP || IMU;
    this.periodo = 1e6 / IMU.odr;
    this.proxima = 0; this.tAnt = 0; this.vAx = 0; this.vAy = 0;
    this.sacudon = 0; this.sacC = 0; this.dirC = 0; this.cAnt = 0; this.dAnt = 0;
    this.muestra = { ax: IMU.montaje.x * G, ay: IMU.montaje.y * G, az: IMU.montaje.z * G, gx: 0, gy: 0, gz: 0, fuerte: false, t: 0 };
  }
  paso() {
    const m = this.m;
    if (m.t < this.proxima) return;
    this.proxima += this.periodo;
    const r = this.c, az = this.azar, P = this.P;
    const T = (m.t - this.tAnt) * 1e-6;
    let axw = 0, ayw = 0;
    if (T > 0) { axw = (r.vx - this.vAx) / T; ayw = (r.vy - this.vAy) / T; }
    this.vAx = r.vx; this.vAy = r.vy; this.tAnt = m.t;
    const c = Math.cos(r.th), s = Math.sin(r.th);
    const aDer = axw * s - ayw * c, aAde = axw * c + ayw * s;
    const vib = r.vibracion();
    let sx, sy, my = 0;
    if (P.modelo === 'real') {
      // Vibracion segun lo que se manda (avance, giro, ruedas en el aire) y
      // un sacudon del chasis cada vez que cambia la orden, que se apaga con
      // tauSacudon. La orden se compara entre muestras (cada 2.4 ms): los
      // estados intermedios de escribir los cuatro canales no cuentan.
      const oc = (r.uIzq + r.uDer) / 2, od = (r.uDer - r.uIzq) / 2;
      const ac = Math.abs(oc), ad = Math.abs(od), dc = oc - this.cAnt;
      if (T > 0) { const k = Math.exp(-T / P.tauSacudon); this.sacudon *= k; this.sacC *= k; }
      if (dc !== 0) { this.sacC += P.sacudonComun * Math.abs(dc); this.dirC = Math.sign(dc); }
      this.sacudon += P.sacudonDif * Math.abs(od - this.dAnt);
      this.cAnt = oc; this.dAnt = od;
      // baches: golpecitos del piso y del reductor mientras anda
      if (!r.levantado && T > 0 && az.prob(P.tasaBache * (ac + ad) * T)) this.sacudon += -Math.log(1 - az.sig()) * P.bache;
      const aire = r.levantado ? vib : 0;
      sy = (P.ruidoAccReposo + P.vibRecta * ac + P.vibGiro * ad + P.vibAire * aire + this.sacudon + this.sacC) * G;
      sx = sy * P.ejeX;
      my = P.sesgoArranque * this.sacC * this.dirC * G;   // arrancar hacia adelante: la media sube en +Y
    } else {
      sx = sy = (P.ruidoAccReposo + P.ruidoAccMotor * vib) * G;
    }
    const sa = (P.ruidoAccReposo + P.ruidoAccMotor * vib) * G;
    const sg = IMU.ruidoGiroReposo + IMU.ruidoGiroMotor * vib;
    const p = r.cabeceo;
    const M = this.muestra;
    M.ax = aDer + G * IMU.montaje.x + az.gauss() * sx;
    M.ay = aAde + G * IMU.montaje.y + G * IMU.montaje.z * Math.sin(p) + my + az.gauss() * sy;
    M.az = G * IMU.montaje.z * Math.cos(p) + az.gauss() * sa;
    M.gz = r.w + IMU.sesgoGiro + az.gauss() * sg;
    M.gx = az.gauss() * sg; M.gy = az.gauss() * sg;
    M.fuerte = Math.hypot(aDer, aAde) > 2 * G;
    M.t = m.t;
  }
}

// ─────────────────────────── mundo ───────────────────────────
class Mundo {
  constructor(sim) {
    const cfg = sim.cfg;
    this.sim = sim;
    this.t = 0;
    this.dojo = DOJOS[cfg.dojo] || DOJOS.practica;
    this.perfil = PERFILES_IR[cfg.perfilIR] || PERFILES_IR.brillante;
    // Fisica 3 = IMU con sacudones + avance con retardo. 'limpio' reproduce la
    // fisica 2 exacta (con la que se califico el plan el 25-09).
    const real = cfg.modeloIMU !== 'limpio';
    this.imuP = Object.assign({}, IMU, { modelo: real ? 'real' : 'limpio' }, cfg.imuParams || {});
    this.pr = Object.assign({}, ROBOT, { v0: cfg.v0, desbalance: cfg.desbalance }, real ? {} : { tauAvance: 0 },
                            (cfg.imuParams && cfg.imuParams.tauAvance !== undefined) ? { tauAvance: cfg.imuParams.tauAvance } : {});
    const pos = cfg.posiciones || posicionesRonda(cfg.ronda, cfg.rival);
    this.robot = new Robot({ tipo: 'robot', x: pos.robot.x, y: pos.robot.y, th: pos.robot.th }, this.pr);
    this.robot.imu = new IMUVirtual(this, this.robot, sim.azar.imu);
    this.robot.azarIR = sim.azar.ir; this.robot.azarDest = sim.azar.destellos;
    this.rival = crearRival(cfg, pos.rival, sim);
    if (this.rival && this.rival.p) {
      this.rival.imu = new IMUVirtual(this, this.rival, sim.azar.imuRival);
      this.rival.azarIR = sim.azar.irRival; this.rival.azarDest = sim.azar.destellosRival;
    }
    this.robots = [this.robot].concat(this.rival && this.rival.p ? [this.rival] : []);
    this.eventos = [];
    this.acciones = [];
    this.proxIA = 0;
    this.contacto = null;
    this.fuerzaContacto = 0;
    this.rastro = []; this.rastroRival = []; this.proxRastro = 0;
  }
  otro(c) { return c === this.robot ? this.rival : this.robot; }
  programar(t, fn) {
    let i = this.eventos.length;
    while (i > 0 && this.eventos[i - 1].t > t) i--;
    this.eventos.splice(i, 0, { t, fn });
  }
  proximoEvento() { return this.eventos.length ? this.eventos[0].t : Infinity; }
  avanzarHasta(tUs) { while (this.t + DT_US <= tUs) this.paso(); }
  paso() {
    const t = this.t + DT_US;
    while (this.eventos.length && this.eventos[0].t <= t) this.eventos.shift().fn();
    const R = this.robot, O = this.rival;
    if (O && O.ia && t >= this.proxIA) { O.ia.actualizar(this, t); this.proxIA = t + 5000; }
    this.aplicarAcciones(t);
    this.contacto = null; this.fuerzaContacto = 0;
    if (O && !O.caido && !R.caido) {
      const k = contactoOBB(R, O);
      if (k) { this.fuerzaContacto = aplicarContacto(R, O, k); this.contacto = k; }
    }
    R.integrar(DT);
    if (O) O.integrar(DT);
    this.t = t;
    for (const c of this.robots) { c.imu.paso(); this.pasoDestellos(c); }
    this.revisarLimites();
    if (t >= this.proxRastro) {
      this.proxRastro = t + 25000;
      this.rastro.push([R.x, R.y, this.sim.hw ? this.sim.hw.led.slice() : [0, 0, 0], t]);
      if (this.rastro.length > 2400) this.rastro.shift();
      if (O && !O.estatico && !O.caido) { this.rastroRival.push([O.x, O.y]); if (this.rastroRival.length > 2400) this.rastroRival.shift(); }
    }
  }
  aplicarAcciones(t) {
    const R = this.robot;
    if (!this.acciones.length) { R.cabeceo = 0; R.levantado = false; return; }
    let cab = 0, lev = false;
    this.acciones = this.acciones.filter(a => t < a.hasta + 200000);
    for (const a of this.acciones) {
      if (t < a.desde) continue;
      if (a.tipo === 'fuerza' && t < a.hasta) {
        const c = Math.cos(R.th), s = Math.sin(R.th);
        const [ff, fl] = a.fuerza, [pf, pl] = a.punto;
        const [px, py] = R.puntoCuerpo(pf, pl);
        R.aplicar(c * ff - s * fl, s * ff + c * fl, px, py);
      } else if (a.tipo === 'levantar') {
        const rampa = 150000;
        let f = 0;
        if (t < a.desde + rampa) f = (t - a.desde) / rampa;
        else if (t < a.hasta) f = 1;
        else if (t < a.hasta + rampa) f = 1 - (t - a.hasta) / rampa;
        cab = Math.max(cab, f * IMU.cabeceoLevantado);
        if (t < a.hasta + rampa) lev = true;
      }
    }
    R.cabeceo = cab;
    R.levantado = lev;
  }
  blancura(x, y) {
    const r = Math.hypot(x, y), a = this.dojo.rNegro, b = this.dojo.rTotal, h = 0.002;
    const s1 = clamp((r - (a - h)) / (2 * h), 0, 1);
    const s2 = clamp((r - (b - h)) / (2 * h), 0, 1);
    return s1 * (1 - s2);
  }
  leerIR(C, i, forzado) {
    const P = this.perfil, az = C.azarIR;
    if (forzado === 'negro') return adc(P.negro[i] + az.gauss() * P.ruidoNegro[i]);
    if (forzado === 'blanco') return adc(P.blanco[i] + az.gauss() * P.ruidoBlanco[i]);
    if (C.cabeceo > 5 * GRAD) {  // en el aire: no vuelve reflejo, lee como negro o mas alto
      const alto = i < 2 ? 1.15 : 1.05;
      return adc(P.negro[i] * alto + az.gauss() * P.ruidoNegro[i]);
    }
    const [sf, sl] = ROBOT.sensoresIR[i];
    const [px, py] = C.puntoCuerpo(sf, sl);
    const w = this.blancura(px, py);
    let negro = P.negro[i] * (1 - P.caidaVibracion * C.vibracion() * az.sig()) + az.gauss() * P.ruidoNegro[i];
    if (C.destellos[i].hasta > this.t) negro = C.destellos[i].valor;
    const blanco = P.blanco[i] + az.gauss() * P.ruidoBlanco[i];
    return adc(w * blanco + (1 - w) * negro);
  }
  pasoDestellos(C) {
    if (!this.sim.cfg.destellos || !this.perfil.destellos) return;
    const andando = Math.hypot(C.vx, C.vy) > 0.03 || Math.abs(C.w) > 0.3;
    if (!andando || C.levantado) return;
    const p = DESTELLO.tasaPorSensor * DT, az = C.azarDest;
    for (let i = 0; i < 4; i++) {
      const d = C.destellos[i];
      if (d.hasta > this.t) continue;
      if (!az.prob(p)) continue;
      const [sf, sl] = ROBOT.sensoresIR[i];
      const [px, py] = C.puntoCuerpo(sf, sl);
      if (this.blancura(px, py) > 0.02) continue;
      d.hasta = this.t + az.rango(DESTELLO.durMin, DESTELLO.durMax);
      const frac = az.prob(DESTELLO.probCola) ? az.rango(DESTELLO.colaMin, DESTELLO.fracMin)
                                              : az.rango(DESTELLO.fracMin, DESTELLO.fracMax);
      d.valor = this.perfil.negro[i] * frac;
      if (C.hard) C.hard.registro.destellos++;
    }
  }
  destelloActivo(C) {
    if (!C || !C.destellos) return -1;
    for (let i = 0; i < 4; i++) if (C.destellos[i].hasta > this.t - 3000) return i;
    return -1;
  }
  estaFuera(C) {
    // centro bien adentro: ninguna esquina puede estar afuera (atajo exacto)
    if (Math.hypot(C.x, C.y) + C.radio <= this.dojo.rNegro) return false;
    return C.esquinas().every(p => Math.hypot(p[0], p[1]) > this.dojo.rNegro);
  }
  // Afuera = ninguna esquina sobre el negro. Caerse de la tarima (el centro
  // pasa el borde exterior) tambien es afuera: un cuerpo girado en diagonal
  // puede caerse con una esquina todavia sobre el negro (corregido 27-09:
  // antes quedaba congelado en el borde y el combate seguia empatado).
  revisarLimites() {
    const R = this.robot, O = this.rival;
    if (!R.fuera && this.estaFuera(R)) { R.fuera = true; this.sim.robotFuera(); }
    if (!R.caido && Math.hypot(R.x, R.y) > this.dojo.rTotal) {
      R.caido = true; R.vx = R.vy = R.w = 0;
      if (!R.fuera) { R.fuera = true; this.sim.robotFuera(); }
    }
    if (O && !O.estatico) {
      if (!O.fuera && this.estaFuera(O)) { O.fuera = true; this.sim.rivalFuera(); }
      if (!O.caido && Math.hypot(O.x, O.y) > this.dojo.rTotal) {
        O.caido = true; O.vx = O.vy = O.w = 0; if (O.fijarMotores) O.fijarMotores(0, 0);
        if (!O.fuera) { O.fuera = true; this.sim.rivalFuera(); }
      }
    }
  }
  medirSonar(C) {
    const O = this.otro(C);
    const [ox, oy] = C.puntoCuerpo(SONAR.xMontaje, 0);
    let mejor = Infinity, angMejor = 0;
    if (O && !O.caido) {
      for (let k = 0; k < SONAR.rayos; k++) {
        const a = C.th - SONAR.semiAngulo + 2 * SONAR.semiAngulo * k / (SONAR.rayos - 1);
        const d = rayoContraCuerpo(ox, oy, Math.cos(a), Math.sin(a), O);
        if (d < mejor) { mejor = d; angMejor = a; }
      }
    }
    return { d: mejor, angulo: angMejor, origen: [ox, oy] };
  }
}

function adc(v) { return clamp(Math.round(v), 0, 4095); }

const TIPOS_RIVAL = {
  caja: 'Caja (se deja empujar)', pared: 'Pared (no se mueve)', rival: 'Rival que embiste (idealizado)',
  tipico: 'Rival típico (sonar, sin giroscopio)', espejo: 'Espejo: el firmware en el otro robot', ninguno: 'Sin rival',
};

function crearRival(cfg, pos, sim) {
  if (cfg.rival === 'ninguno') return null;
  if (cfg.rival === 'pared') {
    return new Cuerpo({ tipo: 'pared', x: pos.x, y: pos.y, th: pos.th, hl: 0.15, hw: 0.02, m: 100, estatico: true });
  }
  if (cfg.rival === 'rival' || cfg.rival === 'tipico' || cfg.rival === 'espejo') {
    // Todo robot del kit tiene algun desbalance de motores: al rival se le
    // sortea uno de hasta +-11 % (el medido en el nuestro), salvo que se fije.
    const des = (cfg.desbalanceRival !== null && cfg.desbalanceRival !== undefined)
      ? cfg.desbalanceRival : (sim.azar.rival.sig() * 2 - 1) * 0.11;
    const p = Object.assign({}, ROBOT, {
      v0: cfg.v0 * cfg.fuerzaRival, fStall: ROBOT.fStall * cfg.fuerzaRival,
      masa: ROBOT.masa, desbalance: des,
    });
    const r = new Robot({ tipo: cfg.rival, x: pos.x, y: pos.y, th: pos.th }, p);
    if (cfg.rival === 'rival') r.ia = new IAEmbiste(r, sim.azar.rival);
    if (cfg.rival === 'tipico') r.ia = new IATipico(r, sim.azar.rival, cfg.ronda);
    return r;
  }
  return new Cuerpo({ tipo: 'caja', x: pos.x, y: pos.y, th: pos.th, hl: 0.05, hw: 0.05, m: cfg.masaCaja, mu: 0.35 });
}

// Disposicion inicial del reglamento. Nuestro robot mira al norte.
function posicionesRonda(ronda, rival) {
  const N = Math.PI / 2, S = -Math.PI / 2;
  if (rival === 'pared') {
    const r = { robot: { x: 0, y: -0.20, th: N }, rival: { x: 0, y: 0.22, th: 0 } };
    if (ronda === 2) r.robot.th = Math.PI;       // la pared queda a la derecha
    if (ronda === 3) r.robot.th = S;
    return r;
  }
  if (ronda === 2) return { robot: { x: -0.10, y: 0, th: N }, rival: { x: 0.10, y: 0, th: S } };
  if (ronda === 3) return { robot: { x: 0, y: -0.08, th: S }, rival: { x: 0, y: 0.08, th: N } };
  return { robot: { x: 0, y: -0.30, th: N }, rival: { x: 0, y: 0.30, th: S } };
}

// ─────────────────────────── hardware virtual ───────────────────────────
// Pines del kit IdeaBoard (los de los codigos de ejemplo del torneo). Se
// pueden cambiar en la configuracion para un robot cableado distinto.
const PINES_KIT = {
  motorIzq: [12, 14], motorDer: [13, 15],   // IN1, IN2: IN1 en alto = la rueda avanza
  invertirIzq: false, invertirDer: false,
  trig: 25, echo: 26, ir: [36, 39, 34, 35],  // IR: frontal izq, frontal der, trasero izq, trasero der
  boot: 0, neopixel: 2, imuDir: 0x6B,
};

class FalloPrograma extends Error {}

// Uno por programa. Maneja un cuerpo del mundo; su sonar ve al otro cuerpo.
class Hardware {
  constructor(sim, cuerpo, registro, op) {
    this.sim = sim;
    this.cuerpo = cuerpo;
    this.registro = registro;
    this.op = op;                 // { imuAusente, azarSonar, azarI2C, principal, pines }
    this.t = 0;
    this.limite = Infinity;
    this.ceder = false;
    this.ledc = {};
    this.boton = false;
    this.superficieCalib = null;
    this.trigDesde = -1;
    this.eco = { subida: -1, bajada: -1, ocupadoHasta: 0 };
    this.ultimoPing = null;
    this.led = [0, 0, 0];
    this.ledPend = [0, 0, 0];
    this.finShow = -1e12;
    this.lineaSerial = '';
    this._api = null;
    // Estado de los pines para las API genericas (Arduino y CircuitPython).
    this.pines = Object.assign({}, PINES_KIT, op.pines || {});
    this.pinesMotor = new Set([...this.pines.motorIzq, ...this.pines.motorDer]);
    this.pinFrac = {}; this.pinModo = {}; this.pinSalida = {};
    this.ledcCanal = {}; this.ledcCanal3 = {}; this.ledcBitsPin = {}; this.ledcModo2 = false;
    this.bitsAdc = 12; this.bitsAnalogWrite = {};
    this.baudios = 115200; this.uartLibre = 0;
    this.neoPrincipal = null;
    this.imuRegs = new Uint8Array(128);
    this.pyMotor = [0, 0];
    const s = ((sim.cfg.semilla >>> 0) ^ (op.principal ? 0x1B873593 : 0x68E31DA4)) >>> 0;
    this.azarProg = crearAzar(s ^ 0x2F6B3A1D);
    this.azarVario = crearAzar(s ^ 0x51ED2701);
    this.ticks = 0;
    this.tUltBoot = -1e12; this.tInicioRachaBoot = -1e12; this.rachaNueva = false;
    this.tUltActividad = 0;
    this.motoresActivos = false;
    this.ultIR = [0, 0, 0, 0];
    this.avisos = new Set();
    this.detenido = null;
    cuerpo.hard = this;
  }
  // API de los firmwares escritos a mano (fw_*.js): se crea solo si se usa.
  get api() { return this._api || (this._api = this.crearApi()); }
  // El reloj del firmware avanza; el mundo lo avanza la simulacion en pasos
  // de 250 us cuando todos los firmwares llegaron a ese instante.
  avanzar(us) {
    this.t += us;
    this.ticks = 0;
    if (this.t >= this.limite) this.ceder = true;
  }
  // Una vuelta de un bucle del programa: casi no cuesta tiempo, pero si el
  // bucle no llama a nada (espera activa) el reloj igual tiene que avanzar.
  tick() {
    this.ticks++;
    this.t += this.ticks > 100000 ? 1 : 0.05;
    return this.t >= this.limite;
  }
  fallo(msg) { throw new FalloPrograma(msg); }
  avisoPrograma(msg) {
    if (this.avisos.has(msg)) return;
    this.avisos.add(msg);
    this.registro.agregar('alerta', msg, 'aviso del simulador');
  }
  fijarBoton(v, quien) {
    if (this.boton === v) return;
    this.boton = v;
    if (this.alCambiarBoton) this.alCambiarBoton(v);
    if (v) this.registro.agregar('arranque', quien === 'auto' ? 'Operador presiona BOOT' : 'Presionaste BOOT', '');
    else if (this.operador && this.operador.alSoltar) this.operador.alSoltar();
  }
  // ── primitivas de las API genericas ──
  escribirDigital(pin, v) {
    this.pinSalida[pin] = v;
    if (pin === this.pines.trig) this.escribirTrig(v);
    this.escribirFrac(pin, v);
  }
  escribirFrac(pin, f) {
    if (this.pinFrac[pin] === f) return;
    this.pinFrac[pin] = f;
    if (this.pinesMotor.has(pin)) this.motoresDesdePines();
  }
  motoresDesdePines() {
    const P = this.pines, f = p => this.pinFrac[p] || 0;
    this.fijarMotoresPrograma(f(P.motorIzq[0]) - f(P.motorIzq[1]), f(P.motorDer[0]) - f(P.motorDer[1]));
  }
  fijarMotorPy(i, u) {
    this.pyMotor[i] = clamp(Number(u) || 0, -1, 1);
    this.fijarMotoresPrograma(this.pyMotor[0], this.pyMotor[1]);
  }
  fijarMotoresPrograma(izq, der) {
    if (this.pines.invertirIzq) izq = -izq;
    if (this.pines.invertirDer) der = -der;
    this.cuerpo.fijarMotores(izq, der);
    this.motoresActivos = izq !== 0 || der !== 0;
    if (this.motoresActivos) this.tUltActividad = this.t;
  }
  leerBoot() {
    // empieza una racha de lecturas del BOOT (o una nueva, si el programa volvio a pedirlo)
    if (this.rachaNueva || this.t - this.tUltBoot > 50000) { this.tInicioRachaBoot = this.t; this.rachaNueva = false; }
    this.tUltBoot = this.t;
    return this.boton ? 0 : 1;
  }
  leerDigital(pin) {
    const P = this.pines;
    if (pin === P.boot) return this.leerBoot();
    if (pin === P.echo) return this.nivelEco(this.t);
    if (P.ir.includes(pin)) return this.leerAnalogico(pin) >= 2048 ? 1 : 0;
    if (pin in this.pinSalida) return this.pinSalida[pin];
    return this.pinModo[pin] === 5 ? 1 : 0;       // INPUT_PULLUP lee alto; un pin suelto, bajo
  }
  leerAnalogico(pin) {
    const i = this.pines.ir.indexOf(pin);
    if (i >= 0) {
      this.tUltActividad = this.t;
      const v = this.sim.mundo.leerIR(this.cuerpo, i, this.superficieCalib);
      this.ultIR[i] = v;
      return v;
    }
    return adc(Math.abs(this.azarVario.gauss()) * 40);   // pin sin nada: ruido cerca de 0
  }
  ledNeo(rgb) {
    if (rgb[0] === this.led[0] && rgb[1] === this.led[1] && rgb[2] === this.led[2]) return;
    this.led = rgb.slice();
    this.registro.cambioLed(this.led);
  }
  *dispararSonar(pinTrig) {
    this.avanzar(3); this.escribirDigital(pinTrig, 0);
    this.avanzar(3); this.escribirDigital(pinTrig, 1);
    this.avanzar(10); this.escribirDigital(pinTrig, 0);
    this.tUltActividad = this.t;
    if (this.ceder) { this.ceder = false; yield; }
  }
  imuPresente(dir) { return !this.op.imuAusente && dir === this.pines.imuDir; }
  fijarOdrImu(hz) { if (hz > 0) this.cuerpo.imu.periodo = 1e6 / hz; }
  imuEscribirRegistro(r, v) {
    r &= 127; this.imuRegs[r] = v & 255;
    if (r === 0x10 || r === 0x11) {
      const hz = [0, 12.5, 26, 52, 104, 208, 416, 833, 1660, 3330, 6660][Math.max(this.imuRegs[0x10] >> 4, this.imuRegs[0x11] >> 4)] || 0;
      this.fijarOdrImu(hz);
    }
  }
  imuLeerRegistro(r) {
    r &= 127;
    if (r === 0x0F) return 0x6A;                // WHO_AM_I del LSM6DS3TR-C
    if (r === 0x1E) return 0x07;                // STATUS_REG: datos listos
    if (r >= 0x20 && r <= 0x2D) {
      this.tUltActividad = this.t;
      const M = this.cuerpo.imu.muestra;
      let v = 0;
      if (r <= 0x21) v = Math.round((27.5 - 25) * 256);
      else if (r <= 0x27) {
        const c2 = this.imuRegs[0x11];
        if (c2 >> 4) {
          const fs = (c2 & 2) ? 4.375 : [8.75, 17.5, 35, 70][(c2 >> 2) & 3];
          v = Math.round([M.gx, M.gy, M.gz][(r - 0x22) >> 1] / GRAD / (fs / 1000));
        }
      } else {
        const c1 = this.imuRegs[0x10];
        if (c1 >> 4) {
          const fs = [0.061, 0.488, 0.122, 0.244][(c1 >> 2) & 3];
          v = Math.round([M.ax, M.ay, M.az][(r - 0x28) >> 1] / G / (fs / 1000));
        }
      }
      v = clamp(v, -32768, 32767) & 0xFFFF;
      return (r & 1) ? (v >> 8) : (v & 255);
    }
    return this.imuRegs[r];
  }
  // Puerto serie a su velocidad: el FIFO del ESP32 guarda 128 bytes; si se
  // llena, print() espera a que salgan (imprimir mucho frena el programa).
  *escribirSerial(txt) {
    const n = txt.length;
    this.avanzar(COSTO.serial + n * 0.05);
    const byteUs = 10e6 / (this.baudios || 115200);
    const pend = Math.max(0, (this.uartLibre - this.t) / byteUs);
    if (pend + n > 128) {
      const fin = this.t + (pend + n - 128) * byteUs;
      while (this.t < fin) { this.avanzar(Math.min(1000, fin - this.t)); if (this.ceder) { this.ceder = false; yield; } }
    }
    this.uartLibre = Math.max(this.uartLibre, this.t) + n * byteUs;
    this.emitirTexto(txt);
    if (this.ceder) { this.ceder = false; yield; }
  }
  emitirTexto(txt) {
    this.lineaSerial += txt;
    let k;
    while ((k = this.lineaSerial.indexOf('\n')) >= 0) {
      const l = this.lineaSerial.slice(0, k).replace(/\r$/, '');
      this.lineaSerial = this.lineaSerial.slice(k + 1);
      this.alSerial(l);
    }
    if (this.lineaSerial.length > 2000) { const l = this.lineaSerial; this.lineaSerial = ''; this.alSerial(l); }
  }
  nivelEco(t) { return (t >= this.eco.subida && t < this.eco.bajada) ? 1 : 0; }
  proximoCambioEco(t) {
    if (t < this.eco.subida) return this.eco.subida;
    if (t < this.eco.bajada) return this.eco.bajada;
    return Infinity;
  }
  escribirTrig(v) {
    if (v) { this.trigDesde = this.t; return; }
    if (this.trigDesde < 0) return;
    const ancho = this.t - this.trigDesde;
    this.trigDesde = -1;
    if (ancho < 10 || this.t < this.eco.ocupadoHasta) return;   // ocupado: ignora el TRIG
    const med = this.sim.mundo.medirSonar(this.cuerpo), az = this.op.azarSonar;
    let hay = med.d < SONAR.alcance;
    if (hay) hay = !az.prob(med.d < SONAR.distCerca ? this.sim.cfg.perdidaEcoContacto : SONAR.perdidaNormal);
    this.eco.subida = this.t + SONAR.retardoRafaga;
    this.eco.bajada = this.eco.subida + (hay ? med.d * 100 * SONAR.usPorCm + SONAR.desfaseUs : SONAR.ecoPerdido);
    this.eco.ocupadoHasta = this.eco.bajada + 20;
    this.ultimoPing = { t: this.t, hay, d: med.d, angulo: med.angulo, perdido: med.d < SONAR.alcance && !hay };
  }
  actualizarMotores() {
    const d = p => this.ledc[p] || 0;
    const izq = (d(12) - d(14)) / 255, der = (d(13) - d(15)) / 255;
    this.cuerpo.fijarMotores(izq, der);
    this.motoresActivos = izq !== 0 || der !== 0;
  }
  emitirSerial(texto, finLinea) {
    this.lineaSerial += texto;
    if (finLinea) { const l = this.lineaSerial; this.lineaSerial = ''; this.alSerial(l); }
  }
  alSerial(linea) {
    const reg = this.registro;
    reg.serial.push({ t: this.t, texto: linea });
    if (reg.serial.length > 5000) reg.serial.splice(0, 1000);
    const nativo = !this.programa || this.programa.tipo === 'nativo';
    // Convencion opcional para cualquier programa: "E,<ms>,<EVENTO>,<detalle>" es un evento.
    const m = nativo ? null : /^E,(\d+),([A-Za-z_][A-Za-z_0-9]*),?(.*)$/.exec(linea);
    if (m) reg.evento(m[2], m[3]);
    else if (linea.trim() && !linea.startsWith('Sensor ') && !linea.startsWith('---') && reg.dejarLinea(this.t)) reg.agregar('serial', linea, '');
    if (this.operador) this.operador.alSerial(linea);
    if (this.op.principal) this.sim.emitir('serial', linea);
  }
  crearApi() {
    const hw = this;
    const IDX_IR = { 36: 0, 39: 1, 34: 2, 35: 3 };
    function* ceder() { if (hw.ceder) { hw.ceder = false; yield; } }
    function fmt(v, dec) {
      if (typeof v === 'number') return dec === undefined ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v.toFixed(dec);
      return String(v);
    }
    const api = {
      LOW: 0, HIGH: 1, INPUT: 1, OUTPUT: 3, INPUT_PULLUP: 5, SDA: 21, SCL: 22, PI: Math.PI,
      millis: () => Math.floor(hw.t / 1000),
      micros: () => Math.floor(hw.t),
      constrain: clamp,
      fabs: Math.abs, abs: Math.abs, sqrt: Math.sqrt, acos: Math.acos,
      pinMode() { hw.avanzar(COSTO.pinMode); },
      digitalWrite(pin, v) { hw.avanzar(COSTO.digitalWrite); if (pin === 25) hw.escribirTrig(v); },
      *digitalRead(pin) {
        if (pin === 0) {
          // Esperas del boton: nada cambia hasta el proximo evento programado,
          // asi que se salta hasta 1 ms por lectura (misma logica, menos vueltas).
          const prox = hw.sim.mundo.proximoEvento();
          hw.avanzar(Math.max(COSTO.digitalRead, Math.min(1000, prox - hw.t, hw.limite - hw.t)));
        } else hw.avanzar(COSTO.digitalRead);
        let v = 0;
        if (pin === 0) v = hw.boton ? 0 : 1;
        else if (pin === 26) v = hw.nivelEco(hw.t);
        yield* ceder();
        return v;
      },
      *analogRead(pin) {
        hw.avanzar(COSTO.analogRead);
        const v = hw.sim.mundo.leerIR(hw.cuerpo, IDX_IR[pin], hw.superficieCalib);
        hw.ultIR[IDX_IR[pin]] = v;
        yield* ceder();
        return v;
      },
      *delay(ms) {
        // FreeRTOS con tick de 1 ms: vTaskDelay(ms) despierta en el tick numero ms
        const fin = (Math.floor(hw.t / 1000) + ms) * 1000;
        while (hw.t < fin) { hw.avanzar(Math.min(1000, fin - hw.t)); yield* ceder(); }
      },
      *delayMicroseconds(us) { hw.avanzar(us); yield* ceder(); },
      *pulseIn(pin, estado, timeout) {
        // Igual que wiring_pulse.c del core ESP32: el timeout cuenta desde
        // la llamada y cubre las tres esperas.
        const limite = hw.t + timeout;
        let fase = 1, inicio = 0;
        for (;;) {
          const nivel = hw.nivelEco(hw.t);
          if (fase === 1 && nivel !== estado) fase = 2;
          if (fase === 2 && nivel === estado) { fase = 3; inicio = hw.t; }
          else if (fase === 3 && nivel !== estado) { yield* ceder(); return Math.floor(hw.t - inicio); }
          if (hw.t - (limite - timeout) > timeout) { yield* ceder(); return 0; }
          const prox = hw.proximoCambioEco(hw.t);
          hw.avanzar(Math.max(0.25, Math.min(prox - hw.t, limite + 0.5 - hw.t, 500)));
          yield* ceder();
        }
      },
      ledcAttach(pin) { hw.ledc[pin] = 0; hw.avanzar(20); return true; },
      ledcWrite(pin, duty) { hw.ledc[pin] = duty; hw.avanzar(COSTO.ledcWrite); hw.actualizarMotores(); },
      Serial: {
        begin() {},
        print(v, dec) { hw.avanzar(COSTO.serial); hw.emitirSerial(fmt(v, dec), false); },
        println(v, dec) { hw.avanzar(COSTO.serial); hw.emitirSerial(v === undefined ? '' : fmt(v, dec), true); },
      },
      Wire: {
        begin() { hw.avanzar(200); }, end() { hw.avanzar(50); },
        setClock() { hw.avanzar(10); }, setTimeOut() { hw.avanzar(5); },
      },
      crearNeoPixel() {
        return {
          begin() {},
          Color(r, g, b) { return [r, g, b]; },
          setPixelColor(i, c) { hw.ledPend = c.slice(); },
          show() {
            const espera = Math.max(0, COSTO.latchNeopixel - (hw.t - hw.finShow));
            hw.avanzar(espera + COSTO.neopixel);
            hw.finShow = hw.t;
            const p = hw.ledPend;
            if (p[0] !== hw.led[0] || p[1] !== hw.led[1] || p[2] !== hw.led[2]) {
              hw.led = p.slice();
              hw.registro.cambioLed(hw.led);
            }
          },
        };
      },
      crearLSM6DS3TRC() {
        return {
          begin_I2C() { hw.avanzar(COSTO.i2cBegin); return !hw.op.imuAusente; },
          setAccelRange() { hw.avanzar(COSTO.i2cConfig); }, setGyroRange() { hw.avanzar(COSTO.i2cConfig); },
          setAccelDataRate() { hw.avanzar(COSTO.i2cConfig); }, setGyroDataRate() { hw.avanzar(COSTO.i2cConfig); },
          *getEvent(accel, gyro) {
            const M = hw.cuerpo.imu.muestra;
            const m = { ax: M.ax, ay: M.ay, az: M.az, gx: M.gx, gy: M.gy, gz: M.gz };
            if (M.fuerte && hw.op.azarI2C.prob(IMU.fallaI2C)) { m.ax = 0; m.ay = 0; m.az = 0; }
            hw.avanzar(COSTO.i2cEvento);
            accel.acceleration = { x: m.ax, y: m.ay, z: m.az };
            gyro.gyro = { x: m.gx, y: m.gy, z: m.gz };
            yield* ceder();
            return !hw.op.imuAusente;
          },
        };
      },
    };
    return api;
  }
}

