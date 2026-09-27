
/* ==========================================================================
   RUNTIME DE CIRCUITPYTHON para los programas traducidos
   (traductor_python*.js). Dos partes:
     1. Python: tipos (tupla, dict, set, range), operadores con la semantica
        de Python, str/repr/format, clases, excepciones con su nombre real.
     2. Los modulos del kit: board, digitalio, analogio, pwmio, time, random,
        math, keypad, neopixel, ideaboard, hcsr04, adafruit_hcsr04, busio,
        adafruit_lsm6ds, adafruit_motor, supervisor, gc, microcontroller, sys.
   Lo que espera tiempo es un generador. Los ayudantes empiezan con $.
   ========================================================================== */
const PY_MODULOS_NOMBRES = {
  board: [], digitalio: ['DigitalInOut', 'Direction', 'Pull', 'DriveMode'], analogio: ['AnalogIn', 'AnalogOut'],
  pwmio: ['PWMOut'], time: ['sleep', 'monotonic', 'monotonic_ns', 'time', 'localtime', 'struct_time'],
  random: ['random', 'randint', 'uniform', 'choice', 'randrange', 'seed', 'getrandbits'],
  math: ['pi', 'e', 'tau', 'inf', 'nan', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'degrees', 'radians', 'floor',
    'ceil', 'trunc', 'fabs', 'pow', 'exp', 'log', 'log10', 'log2', 'isnan', 'isinf', 'isfinite', 'copysign', 'hypot', 'fmod', 'modf', 'frexp'],
  keypad: ['Keys', 'Event', 'EventQueue'], neopixel: ['NeoPixel', 'GRB', 'RGB', 'GRBW', 'RGBW'], ideaboard: ['IdeaBoard'],
  hcsr04: ['HCSR04'], adafruit_hcsr04: ['HCSR04'], busio: ['I2C'], adafruit_lsm6ds: ['Rate', 'AccelRange', 'GyroRange'],
  'adafruit_lsm6ds.lsm6ds3trc': ['LSM6DS3TRC'], 'adafruit_lsm6ds.lsm6ds3': ['LSM6DS3'], 'adafruit_lsm6ds.lsm6dsox': ['LSM6DSOX'],
  'adafruit_lsm6ds.lsm6ds33': ['LSM6DS33'], 'adafruit_lsm6ds.ism330dhcx': ['ISM330DHCX'],
  adafruit_motor: ['motor'], 'adafruit_motor.motor': ['DCMotor', 'FAST_DECAY', 'SLOW_DECAY'],
  supervisor: ['ticks_ms', 'runtime', 'reload'], gc: ['collect', 'mem_free', 'mem_alloc', 'enable', 'disable'],
  microcontroller: ['cpu', 'reset', 'pin'], sys: ['exit', 'platform', 'implementation', 'version', 'print_exception', 'stdout'],
  os: ['getenv', 'listdir', 'uname'],
};
for (let i = 0; i <= 39; i++) PY_MODULOS_NOMBRES.board.push('IO' + i);
PY_MODULOS_NOMBRES.board.push('SDA', 'SCL', 'NEOPIXEL', 'LED', 'TX', 'RX', 'MOSI', 'MISO', 'SCK', 'I2C', 'STEMMA_I2C', 'board_id');

class SalidaPrograma extends Error {}       // sys.exit(): termina el programa sin error

function crearRuntimePython(hw) {
  const P = hw.pines;
  function* ceder() { if (hw.ceder) { hw.ceder = false; yield; } }
  function* esperar(us) { const fin = hw.t + us; while (hw.t < fin) { hw.avanzar(Math.min(1000, fin - hw.t)); yield* ceder(); } }
  const azar = () => hw.azarProg.sig();

  // ─────────────── tipos de Python ───────────────
  class Tupla extends Array {}
  const tupla = a => Tupla.from(a);
  function clave(k) {
    if (typeof k === 'boolean') return +k;
    if (k instanceof Tupla) return 't' + JSON.stringify(k.map(clave));
    if (Array.isArray(k)) throw exc('TypeError', "unhashable type: 'list'");
    if (k instanceof Dict) throw exc('TypeError', "unhashable type: 'dict'");
    return k;
  }
  class Dict {
    constructor(pares) { this.m = new Map(); if (pares) for (const [k, v] of pares) this.set(k, v); }
    set(k, v) { this.m.set(clave(k), [k, v]); }
    tiene(k) { return this.m.has(clave(k)); }
    obtener(k) { const e = this.m.get(clave(k)); if (!e) throw exc('KeyError', k); return e[1]; }
    get size() { return this.m.size; }
    claves() { return [...this.m.values()].map(e => e[0]); }
    [Symbol.iterator]() { return this.claves()[Symbol.iterator](); }
  }
  class PySet {
    constructor(it) { this.m = new Map(); if (it) for (const x of it) this.add(x); }
    add(x) { this.m.set(clave(x), x); }
    has(x) { return this.m.has(clave(x)); }
    get size() { return this.m.size; }
    [Symbol.iterator]() { return this.m.values(); }
  }
  class Rango {
    constructor(a, b, c) {
      if (b === undefined) { b = a; a = 0; }
      c = c === undefined ? 1 : c;
      for (const x of [a, b, c]) if (typeof x !== 'boolean' && !Number.isInteger(x)) throw exc('TypeError', `'${nombreTipo(x)}' object cannot be interpreted as an integer`);
      if (c === 0) throw exc('ValueError', 'range() arg 3 must not be zero');
      this.a = +a; this.b = +b; this.c = +c;
    }
    get length() { const n = this.c > 0 ? Math.ceil((this.b - this.a) / this.c) : Math.ceil((this.a - this.b) / -this.c); return Math.max(0, n); }
    *[Symbol.iterator]() { if (this.c > 0) for (let i = this.a; i < this.b; i += this.c) yield i; else for (let i = this.a; i > this.b; i += this.c) yield i; }
  }
  const Ellipsis = { $esEllipsis: true };

  // ─────────────── clases y excepciones ───────────────
  let nId = 0;
  const ids = new WeakMap();
  const Objeto = { $esClase: true, $nombre: 'object', $bases: [], prototype: { $esInstancia: true } };
  Objeto.prototype.$clase = Objeto;
  function claseNativa(nombre, base, metodos) {
    const K = { $esClase: true, $nombre: nombre, $bases: base ? [base] : [Objeto], prototype: Object.create((base || Objeto).prototype) };
    K.prototype.$clase = K;
    Object.assign(K.prototype, metodos || {});
    return K;
  }
  function* initExc(self, args) { self.args = tupla(args || []); return null; }
  initExc.$params = [{ n: 'self', t: 'normal' }, { n: 'args', t: '*' }];
  initExc.$varArgs = true;
  const EXC = {};
  const BaseException = EXC.BaseException = claseNativa('BaseException', null, { __init__: initExc });
  const jerarquia = [['Exception', 'BaseException'], ['SystemExit', 'BaseException'], ['KeyboardInterrupt', 'BaseException'],
    ['ArithmeticError', 'Exception'], ['ZeroDivisionError', 'ArithmeticError'], ['OverflowError', 'ArithmeticError'],
    ['AssertionError', 'Exception'], ['AttributeError', 'Exception'], ['EOFError', 'Exception'], ['ImportError', 'Exception'],
    ['ModuleNotFoundError', 'ImportError'], ['LookupError', 'Exception'], ['IndexError', 'LookupError'], ['KeyError', 'LookupError'],
    ['MemoryError', 'Exception'], ['NameError', 'Exception'], ['UnboundLocalError', 'NameError'], ['OSError', 'Exception'],
    ['TimeoutError', 'OSError'], ['ConnectionError', 'OSError'], ['RuntimeError', 'Exception'], ['NotImplementedError', 'RuntimeError'],
    ['RecursionError', 'RuntimeError'], ['StopIteration', 'Exception'], ['SyntaxError', 'Exception'], ['IndentationError', 'SyntaxError'],
    ['TypeError', 'Exception'], ['ValueError', 'Exception']];
  for (const [n, b] of jerarquia) EXC[n] = claseNativa(n, EXC[b]);
  function exc(tipo, msg) {
    const o = Object.create(EXC[tipo].prototype);
    o.args = msg === undefined || msg === null ? tupla([]) : tupla([msg]);
    o.$pila = new Error().stack;
    return o;
  }
  function esInstancia(o, K) { return o !== null && typeof o === 'object' && K.prototype.isPrototypeOf(o); }
  function* nuevo(K, pos, kw) {
    const o = Object.create(K.prototype);
    if (esInstancia(o, BaseException)) o.$pila = new Error().stack;
    const init = o.__init__;
    if (init) { const r = yield* invocar(init, [o, ...pos], kw); if (r !== null && r !== undefined) throw exc('TypeError', '__init__() should return None'); }
    else if (pos.length) throw exc('TypeError', `${K.$nombre}() takes no arguments`);
    return o;
  }
  function* clase(nombre, bases, cuerpo) {
    const base = bases.length ? bases[0] : Objeto;
    if (!base || !base.$esClase) throw exc('TypeError', `no se puede heredar de ${repr(base)}`);
    const K = { $esClase: true, $nombre: nombre, $bases: bases.length ? bases : [Objeto], prototype: Object.create(base.prototype) };
    K.prototype.$clase = K;
    const ns = {};
    yield* cuerpo(ns);
    for (const k of Object.keys(ns)) K.prototype[k] = ns[k];
    return K;
  }
  function metadatos(f) { return f.$params || null; }
  function funcion(nombre, params, gen) { gen.$nombre = nombre; gen.$params = params; return gen; }
  function estatico(f) { f.$estatico = true; return f; }
  function declase(f) { f.$declase = true; return f; }
  function propiedad(f) { return { $propiedad: true, fget: f }; }
  function enlazar(f, o) {
    const b = function* (...a) { return yield* invocar(f, [o, ...a.slice(0, -1)], a[a.length - 1]); };
    b.$enlazado = true; b.$f = f; b.$o = o; b.$nombre = f.$nombre;
    return b;
  }
  // Pasa argumentos por nombre a las posiciones de una funcion de Python.
  function mapear(f, pos, kw) {
    const ps = f.$params;
    const normales = ps.filter(p => p.t === 'normal'), estrella = ps.find(p => p.t === '*'), kwsolo = ps.filter(p => p.t === 'kw'), dobles = ps.find(p => p.t === '**');
    const vals = new Array(normales.length).fill(undefined);
    const extra = [];
    for (let i = 0; i < pos.length; i++) {
      if (i < normales.length) vals[i] = pos[i];
      else if (estrella) extra.push(pos[i]);
      else throw exc('TypeError', `${f.$nombre}() takes ${normales.length} positional argument${normales.length === 1 ? '' : 's'} but ${pos.length} were given`);
    }
    const kwv = {}, sobran = new Dict();
    if (kw) for (const k of Object.keys(kw)) {
      const i = normales.findIndex(p => p.n === k);
      if (i >= 0) { if (vals[i] !== undefined) throw exc('TypeError', `${f.$nombre}() got multiple values for argument '${k}'`); vals[i] = kw[k]; }
      else if (kwsolo.some(p => p.n === k)) kwv[k] = kw[k];
      else if (dobles) sobran.set(k, kw[k]);
      else throw exc('TypeError', `${f.$nombre}() got an unexpected keyword argument '${k}'`);
    }
    normales.forEach((p, i) => { if (vals[i] === undefined && !p.d) throw exc('TypeError', `${f.$nombre}() missing required positional argument: '${p.n}'`); });
    kwsolo.forEach(p => { if (kwv[p.n] === undefined && !p.d) throw exc('TypeError', `${f.$nombre}() missing required keyword-only argument: '${p.n}'`); });
    const r = vals.slice();
    if (estrella) r.push(extra);
    for (const p of kwsolo) r.push(kwv[p.n]);
    if (dobles) r.push(sobran);
    return r;
  }
  const esGenerador = r => r !== null && typeof r === 'object' && typeof r.next === 'function' && typeof r.throw === 'function';
  function* invocar(f, pos, kw) {
    hw.avanzar(6);
    if (f.$enlazado) return yield* invocar(f.$f, [f.$o, ...pos], kw);
    if (f.$params) {
      const tieneKw = kw && Object.keys(kw).length;
      const args = (tieneKw || f.$params.some(p => p.t !== 'normal') || pos.length > f.$params.length) ? mapear(f, pos, kw) : pos;
      return yield* f(...args);
    }
    let r;
    if (f.$conKw) r = f(...pos, kw || {});
    else { if (kw && Object.keys(kw).length) throw exc('TypeError', `${f.$nombre || f.name || 'la funcion'}() no acepta argumentos por nombre (${Object.keys(kw).join(', ')})`); r = f(...pos); }
    if (esGenerador(r)) return yield* r;
    return r === undefined ? null : r;
  }
  function* llamar(f, pos, kw) {
    if (f === null || f === undefined) throw exc('TypeError', "'NoneType' object is not callable");
    if (f.$esClase) {
      if (f.$crear) return yield* invocar(f.$crear, pos, kw);
      return yield* nuevo(f, pos, kw);
    }
    if (typeof f !== 'function') {
      if (f.$esInstancia && f.__call__) return yield* invocar(f.__call__, [f, ...pos], kw);
      throw exc('TypeError', `'${nombreTipo(f)}' object is not callable`);
    }
    return yield* invocar(f, pos, kw);
  }
  function* metodo(o, n, pos, kw) {
    if (o === null || o === undefined) throw exc('AttributeError', `'NoneType' object has no attribute '${n}'`);
    if (typeof o === 'string') return yield* invocar(metodoTexto(o, n), pos, kw);
    if (Array.isArray(o)) return yield* metodoLista(o, n, pos, kw);
    if (o instanceof Dict) return yield* metodoDict(o, n, pos, kw);
    if (o instanceof PySet) return yield* invocar(metodoSet(o, n), pos, kw);
    if (typeof o === 'number' || typeof o === 'boolean') return yield* invocar(metodoNumero(o, n), pos, kw);
    if (o.$esInstancia) {
      const f = o[n];
      if (f === undefined) throw exc('AttributeError', `'${o.$clase.$nombre}' object has no attribute '${n}'`);
      if (Object.prototype.hasOwnProperty.call(o, n) || f.$estatico) return yield* llamar(f, pos, kw);
      if (f.$declase) return yield* invocar(f, [o.$clase, ...pos], kw);
      if (f.$propiedad) return yield* llamar(yield* invocar(f.fget, [o], null), pos, kw);
      if (typeof f === 'function' && f.$params) return yield* invocar(f, [o, ...pos], kw);
      return yield* llamar(f, pos, kw);
    }
    if (o.$esClase) {
      const f = o.prototype[n];
      if (f === undefined) throw exc('AttributeError', `type object '${o.$nombre}' has no attribute '${n}'`);
      if (f.$declase) return yield* invocar(f, [o, ...pos], kw);
      return yield* llamar(f, pos, kw);
    }
    const f = o[n];
    if (typeof f !== 'function' && !(f && f.$esClase)) {
      if (f === undefined) throw exc('AttributeError', `'${nombreTipo(o)}' object has no attribute '${n}'`);
      throw exc('TypeError', `'${nombreTipo(f)}' object is not callable`);
    }
    if (f.$esClase) return yield* llamar(f, pos, kw);
    hw.avanzar(6);
    let r;
    if (f.$conKw) r = f.apply(o, [...pos, kw || {}]);
    else { if (kw && Object.keys(kw).length) throw exc('TypeError', `${n}() no acepta argumentos por nombre (${Object.keys(kw).join(', ')})`); r = f.apply(o, pos); }
    if (esGenerador(r)) return yield* r;
    return r === undefined ? null : r;
  }
  function* superMetodo(K, self, n, pos, kw) {
    const base = K.$bases[0] || Objeto;
    const f = base.prototype[n];
    if (f === undefined) { if (n === '__init__') return null; throw exc('AttributeError', `'super' object has no attribute '${n}'`); }
    return yield* invocar(f, [self, ...pos], kw);
  }
  // Correr un generador hasta el final sin ceder (para __str__ y parecidos).
  function sinCeder(g) { let r; do { r = g.next(); } while (!r.done); return r.value; }

  // ─────────────── atributos e indices ───────────────
  function nombreTipo(x) {
    if (x === null || x === undefined) return 'NoneType';
    if (typeof x === 'boolean') return 'bool';
    if (typeof x === 'number') return Number.isInteger(x) ? 'int' : 'float';
    if (typeof x === 'string') return 'str';
    if (x instanceof Tupla) return 'tuple';
    if (Array.isArray(x)) return 'list';
    if (x instanceof Dict) return 'dict';
    if (x instanceof PySet) return 'set';
    if (x instanceof Rango) return 'range';
    if (x.$esClase) return 'type';
    if (x.$esInstancia) return x.$clase.$nombre;
    if (x.$esModulo) return 'module';
    if (typeof x === 'function') return 'function';
    return x.$tipo || 'object';
  }
  function leer(o, n) {
    if (o === null || o === undefined) throw exc('AttributeError', `'NoneType' object has no attribute '${n}'`);
    if (o.$esInstancia) {
      const v = o[n];
      if (v === undefined) {
        if (n === '__class__') return o.$clase;
        if (n === 'args' && esInstancia(o, BaseException)) return tupla([]);
        throw exc('AttributeError', `'${o.$clase.$nombre}' object has no attribute '${n}'`);
      }
      if (v && v.$propiedad) return sinCeder(invocar(v.fget, [o], null));
      if (typeof v === 'function' && v.$params && !Object.prototype.hasOwnProperty.call(o, n) && !v.$estatico) return enlazar(v, o);
      return v;
    }
    if (o.$esClase) {
      if (n === '__name__') return o.$nombre;
      const v = o.prototype[n];
      if (v === undefined) throw exc('AttributeError', `type object '${o.$nombre}' has no attribute '${n}'`);
      return v;
    }
    if (typeof o === 'string' || Array.isArray(o) || o instanceof Dict || typeof o === 'number') {
      if (n === 'real') return o; if (n === 'imag') return 0;
      const b = function* (...a) { return yield* metodo(o, n, a.slice(0, -1), a[a.length - 1]); };
      b.$conKw = true;
      return b;
    }
    const v = o[n];
    if (v === undefined) {
      if (o.$esModulo) throw exc('AttributeError', `'module' object has no attribute '${n}' (el simulador no lo tiene)`);
      throw exc('AttributeError', `'${nombreTipo(o)}' object has no attribute '${n}'`);
    }
    if (typeof v === 'function' && !o.$esModulo && !v.$esClase && !v.$params) { const b = v.bind(o); b.$conKw = v.$conKw; b.$nombre = n; return b; }
    return v;
  }
  function* leerG(o, n) {
    if (o !== null && o !== undefined && typeof o['$get_' + n] === 'function') return yield* o['$get_' + n]();
    return leer(o, n);
  }
  function escribir(o, n, v) {
    if (o === null || o === undefined) throw exc('AttributeError', `'NoneType' object has no attribute '${n}'`);
    if (o.$esInstancia || o.$esModulo) { o[n] = v; return; }
    if (o.$esClase) { o.prototype[n] = v; return; }
    if (typeof o['$set_' + n] === 'function') { o['$set_' + n](v); return; }
    if (Object.prototype.hasOwnProperty.call(o, n) && typeof o[n] !== 'function') { o[n] = v; return; }
    throw exc('AttributeError', `'${nombreTipo(o)}' object has no attribute '${n}' (o no se puede cambiar)`);
  }
  function borrarAttr(o, n) { if (o && o.$esInstancia && n in o) { delete o[n]; return; } throw exc('AttributeError', n); }
  function indice(i, n, que) {
    if (typeof i === 'boolean') i = +i;
    if (typeof i !== 'number' || !Number.isInteger(i)) throw exc('TypeError', `${que} indices must be integers, not ${nombreTipo(i)}`);
    const k = i < 0 ? i + n : i;
    if (k < 0 || k >= n) throw exc('IndexError', `${que} index out of range`);
    return k;
  }
  function item(o, i) {
    if (Array.isArray(o)) return o[indice(i, o.length, o instanceof Tupla ? 'tuple' : 'list')];
    if (typeof o === 'string') return o[indice(i, o.length, 'string')];
    if (o instanceof Dict) return o.obtener(i);
    if (o instanceof Rango) { const k = indice(i, o.length, 'range object'); return o.a + k * o.c; }
    if (o && o.$esInstancia && o.__getitem__) return sinCeder(invocar(o.__getitem__, [o, i], null));
    if (o && typeof o.$getitem === 'function') return o.$getitem(i);
    if (o && o.$esSlice) throw exc('TypeError', 'slice');
    throw exc('TypeError', `'${nombreTipo(o)}' object is not subscriptable`);
  }
  function ponerItem(o, i, v) {
    if (o instanceof Tupla) throw exc('TypeError', "'tuple' object does not support item assignment");
    if (Array.isArray(o)) { o[indice(i, o.length, 'list assignment')] = v; return; }
    if (o instanceof Dict) { o.set(i, v); return; }
    if (typeof o === 'string') throw exc('TypeError', "'str' object does not support item assignment");
    if (o && o.$esInstancia && o.__setitem__) { sinCeder(invocar(o.__setitem__, [o, i, v], null)); return; }
    if (o && typeof o.$setitem === 'function') { o.$setitem(i, v); return; }
    throw exc('TypeError', `'${nombreTipo(o)}' object does not support item assignment`);
  }
  function borrarItem(o, i) {
    if (o && o.$esSlice) { const [a, b, c] = limitesCorte(o, o.a, o.b, o.c); if (c !== 1) throw exc('ValueError', 'del con paso no soportado'); o.splice(a, Math.max(0, b - a)); return; }
    if (Array.isArray(o) && !(o instanceof Tupla)) { o.splice(indice(i, o.length, 'list assignment'), 1); return; }
    if (o instanceof Dict) { if (!o.tiene(i)) throw exc('KeyError', i); o.m.delete(clave(i)); return; }
    throw exc('TypeError', `'${nombreTipo(o)}' object doesn't support item deletion`);
  }
  function limitesCorte(o, a, b, c) {
    const n = o.length;
    c = c === null || c === undefined ? 1 : c;
    if (c === 0) throw exc('ValueError', 'slice step cannot be zero');
    const norm = (x, def) => { if (x === null || x === undefined) return def; if (x < 0) x += n; return c > 0 ? Math.min(Math.max(x, 0), n) : Math.min(Math.max(x, -1), n - 1); };
    return [norm(a, c > 0 ? 0 : n - 1), norm(b, c > 0 ? n : -1), c];
  }
  function cortar(o, a, b, c) {
    if (!(Array.isArray(o) || typeof o === 'string' || o instanceof Rango)) throw exc('TypeError', `'${nombreTipo(o)}' object is not subscriptable`);
    const src = o instanceof Rango ? [...o] : o;
    const [i0, i1, p] = limitesCorte(src, a, b, c);
    const r = [];
    if (p > 0) for (let i = i0; i < i1; i += p) r.push(src[i]); else for (let i = i0; i > i1; i += p) r.push(src[i]);
    if (typeof o === 'string') return r.join('');
    return o instanceof Tupla ? tupla(r) : r;
  }
  function ponerCorte(o, a, b, c, v) {
    if (!Array.isArray(o) || o instanceof Tupla) throw exc('TypeError', 'asignar a un corte solo se puede en una lista');
    const [i0, i1, p] = limitesCorte(o, a, b, c);
    if (p !== 1) throw exc('ValueError', 'asignar a un corte con paso no esta soportado');
    o.splice(i0, Math.max(0, i1 - i0), ...iter(v));
  }
  function slice(a, b, c) { return { $esSlice: true, a, b, c }; }
  function iter(x) {
    if (Array.isArray(x) || typeof x === 'string' || x instanceof Rango || x instanceof PySet) return x;
    if (x instanceof Dict) return x.claves();
    if (x && typeof x[Symbol.iterator] === 'function' && !x.$esInstancia) return x;
    if (x && x.$esInstancia && x.__iter__) return iter(sinCeder(invocar(x.__iter__, [x], null)));
    throw exc('TypeError', `'${nombreTipo(x)}' object is not iterable`);
  }
  function desempaquetar(v, n) {
    const a = [...iter(v)];
    if (a.length !== n) throw exc('ValueError', a.length > n ? `too many values to unpack (expected ${n})` : `not enough values to unpack (expected ${n}, got ${a.length})`);
    return a;
  }
  function desempaquetarEstrella(v, antes, despues) {
    const a = [...iter(v)];
    if (a.length < antes + despues) throw exc('ValueError', `not enough values to unpack (expected at least ${antes + despues}, got ${a.length})`);
    return [...a.slice(0, antes), a.slice(antes, a.length - despues), ...a.slice(a.length - despues)];
  }

  // ─────────────── verdad, comparaciones, operadores ───────────────
  function v(x) {
    if (x === true) return true;
    if (x === false || x === null || x === undefined) return false;
    if (typeof x === 'number') return x !== 0;
    if (typeof x === 'string' || Array.isArray(x)) return x.length > 0;
    if (x instanceof Dict || x instanceof PySet) return x.size > 0;
    if (x instanceof Rango) return x.length > 0;
    if (x.$esInstancia) {
      if (x.__bool__) return !!sinCeder(invocar(x.__bool__, [x], null));
      if (x.__len__) return sinCeder(invocar(x.__len__, [x], null)) > 0;
    }
    if (typeof x.$len === 'function') return x.$len() > 0;
    return true;
  }
  const esNum = x => typeof x === 'number' || typeof x === 'boolean';
  function eq(a, b) {
    if (a === b) return true;
    if (esNum(a) && esNum(b)) return +a === +b;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if ((a instanceof Tupla) !== (b instanceof Tupla) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    if (a instanceof Dict && b instanceof Dict) {
      if (a.size !== b.size) return false;
      for (const [k, [ko, va]] of a.m) { const e = b.m.get(k); if (!e || !eq(va, e[1])) return false; }
      return true;
    }
    if (a instanceof PySet && b instanceof PySet) { if (a.size !== b.size) return false; for (const k of a.m.keys()) if (!b.m.has(k)) return false; return true; }
    if (a.$esInstancia && a.__eq__) return v(sinCeder(invocar(a.__eq__, [a, b], null)));
    return false;
  }
  function cmp(a, b, op) {
    if (esNum(a) && esNum(b)) return +a - +b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : (a > b ? 1 : 0);
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) { if (!eq(a[i], b[i])) return cmp(a[i], b[i], op); }
      return a.length - b.length;
    }
    if (a && a.$esInstancia && a.__lt__ && op === '<') return v(sinCeder(invocar(a.__lt__, [a, b], null))) ? -1 : 1;
    throw exc('TypeError', `'${op}' not supported between instances of '${nombreTipo(a)}' and '${nombreTipo(b)}'`);
  }
  const lt = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a < b : cmp(a, b, '<') < 0;
  const le = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a <= b : cmp(a, b, '<=') <= 0;
  function en(x, c) {
    if (typeof c === 'string') { if (typeof x !== 'string') throw exc('TypeError', `'in <string>' requires string as left operand, not ${nombreTipo(x)}`); return c.includes(x); }
    if (Array.isArray(c)) { for (const y of c) if (eq(x, y)) return true; return false; }
    if (c instanceof Dict) return c.tiene(x);
    if (c instanceof PySet) return c.has(x);
    if (c instanceof Rango) return Number.isInteger(x) && (c.c > 0 ? x >= c.a && x < c.b : x <= c.a && x > c.b) && (x - c.a) % c.c === 0;
    if (c && c.$esInstancia && c.__contains__) return v(sinCeder(invocar(c.__contains__, [c, x], null)));
    for (const y of iter(c)) if (eq(x, y)) return true;
    return false;
  }
  const es = (a, b) => a === b || ((a === null || a === undefined) && (b === null || b === undefined));
  function num(x, op, y) {
    if (typeof x === 'boolean') return +x;
    if (typeof x === 'number') return x;
    throw exc('TypeError', `unsupported operand type(s) for ${op}: '${nombreTipo(x)}' and '${nombreTipo(y)}'`);
  }
  function dunder(a, b, n, op) {
    if (a && a.$esInstancia && a[n]) return sinCeder(invocar(a[n], [a, b], null));
    throw exc('TypeError', `unsupported operand type(s) for ${op}: '${nombreTipo(a)}' and '${nombreTipo(b)}'`);
  }
  function add(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    if (typeof a === 'string' && typeof b === 'string') return a + b;
    if (typeof a === 'string') throw exc('TypeError', `can only concatenate str (not "${nombreTipo(b)}") to str`);
    if (Array.isArray(a) && Array.isArray(b)) {
      if ((a instanceof Tupla) !== (b instanceof Tupla)) throw exc('TypeError', `can only concatenate ${a instanceof Tupla ? 'tuple' : 'list'} (not "${nombreTipo(b)}") to ${a instanceof Tupla ? 'tuple' : 'list'}`);
      return a instanceof Tupla ? tupla([...a, ...b]) : [...a, ...b];
    }
    if (esNum(a) && esNum(b)) return +a + +b;
    if (a && a.$esInstancia) return dunder(a, b, '__add__', '+');
    throw exc('TypeError', `unsupported operand type(s) for +: '${nombreTipo(a)}' and '${nombreTipo(b)}'`);
  }
  function sub(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (a instanceof PySet && b instanceof PySet) return new PySet([...a].filter(x => !b.has(x)));
    if (a && a.$esInstancia) return dunder(a, b, '__sub__', '-');
    return num(a, '-', b) - num(b, '-', a);
  }
  function mul(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    const rep = (s, n) => { n = num(n, '*', s); if (!Number.isInteger(n)) throw exc('TypeError', "can't multiply sequence by non-int of type 'float'"); return Math.max(0, n); };
    if (typeof a === 'string' && esNum(b)) return a.repeat(rep(a, b));
    if (typeof b === 'string' && esNum(a)) return b.repeat(rep(b, a));
    if (Array.isArray(a) && esNum(b)) { const n = rep(a, b), r = []; for (let i = 0; i < n; i++) r.push(...a); return a instanceof Tupla ? tupla(r) : r; }
    if (Array.isArray(b) && esNum(a)) return mul(b, a);
    if (a && a.$esInstancia) return dunder(a, b, '__mul__', '*');
    return num(a, '*', b) * num(b, '*', a);
  }
  function div(a, b) {
    const x = num(a, '/', b), y = num(b, '/', a);
    if (y === 0) throw exc('ZeroDivisionError', 'division by zero');
    return x / y;
  }
  function fdiv(a, b) {
    const x = num(a, '//', b), y = num(b, '//', a);
    if (y === 0) throw exc('ZeroDivisionError', 'integer division or modulo by zero');
    return Math.floor(x / y);
  }
  function mod(a, b) {
    if (typeof a === 'string') return formatoPorcentaje(a, b);
    const x = num(a, '%', b), y = num(b, '%', a);
    if (y === 0) throw exc('ZeroDivisionError', 'integer division or modulo by zero');
    const r = x % y;
    return (r !== 0 && (r < 0) !== (y < 0)) ? r + y : r;
  }
  function pow(a, b) {
    const x = num(a, '**', b), y = num(b, '**', a);
    if (x === 0 && y < 0) throw exc('ZeroDivisionError', '0.0 cannot be raised to a negative power');
    return Math.pow(x, y);
  }
  const entero = (x, op) => { const n = num(x, op, 0); if (!Number.isInteger(n)) throw exc('TypeError', `unsupported operand type(s) for ${op}: 'float'`); return n; };
  const lsh = (a, b) => entero(a, '<<') * Math.pow(2, entero(b, '<<'));
  const rsh = (a, b) => Math.floor(entero(a, '>>') / Math.pow(2, entero(b, '>>')));
  const band = (a, b) => (a instanceof PySet) ? new PySet([...a].filter(x => b.has(x))) : (typeof a === 'boolean' && typeof b === 'boolean' ? a && b : entero(a, '&') & entero(b, '&'));
  const bor = (a, b) => (a instanceof PySet) ? new PySet([...a, ...b]) : (a instanceof Dict ? new Dict([...itemsDict(a), ...itemsDict(b)]) : (typeof a === 'boolean' && typeof b === 'boolean' ? a || b : entero(a, '|') | entero(b, '|')));
  const bxor = (a, b) => (typeof a === 'boolean' && typeof b === 'boolean') ? a !== b : entero(a, '^') ^ entero(b, '^');
  const matmul = (a, b) => { throw exc('TypeError', "unsupported operand type(s) for @"); };
  const neg = a => { if (typeof a === 'number') return -a; if (a && a.$esInstancia) return sinCeder(invocar(a.__neg__, [a], null)); return -num(a, 'unary -', a); };
  const pos = a => +num(a, 'unary +', a);
  const inv = a => -entero(a, '~') - 1;
  function iadd(a, b) { if (Array.isArray(a) && !(a instanceof Tupla)) { a.push(...iter(b)); return a; } return add(a, b); }
  function imul(a, b) { if (Array.isArray(a) && !(a instanceof Tupla) && esNum(b)) { const r = mul(a, b); a.length = 0; a.push(...r); return a; } return mul(a, b); }

  // ─────────────── texto ───────────────
  // repr de un float como Python (notacion cientifica si el exponente es < -4 o >= 16).
  // Limite conocido: JS no distingue 5.0 de 5, asi que un float entero se muestra sin ".0".
  function reprFloat(x) {
    if (Number.isNaN(x)) return 'nan';
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (Number.isInteger(x) && Math.abs(x) < 1e16) return String(x);
    const partes = x.toExponential().split('e');
    const exp = +partes[1];
    if (exp < -4 || exp >= 16) return `${partes[0]}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    return String(x);
  }
  function repr(x) {
    if (x === null || x === undefined) return 'None';
    if (x === true) return 'True';
    if (x === false) return 'False';
    if (typeof x === 'number') return reprFloat(x);
    if (typeof x === 'string') {
      const q = x.includes("'") && !x.includes('"') ? '"' : "'";
      return q + x.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(new RegExp(q, 'g'), '\\' + q) + q;
    }
    if (x instanceof Tupla) return x.length === 1 ? `(${repr(x[0])},)` : `(${x.map(repr).join(', ')})`;
    if (Array.isArray(x)) return `[${x.map(repr).join(', ')}]`;
    if (x instanceof Dict) return `{${[...x.m.values()].map(([k, w]) => `${repr(k)}: ${repr(w)}`).join(', ')}}`;
    if (x instanceof PySet) return x.size ? `{${[...x].map(repr).join(', ')}}` : 'set()';
    if (x instanceof Rango) return x.c === 1 ? `range(${x.a}, ${x.b})` : `range(${x.a}, ${x.b}, ${x.c})`;
    if (x.$esEllipsis) return 'Ellipsis';
    if (x.$esClase) return `<class '${x.$nombre}'>`;
    if (x.$esInstancia) {
      if (x.__repr__) return String(sinCeder(invocar(x.__repr__, [x], null)));
      if (esInstancia(x, BaseException)) return `${x.$clase.$nombre}(${x.args.map(repr).join(', ')})`;
      if (!ids.has(x)) ids.set(x, ++nId);
      return `<${x.$clase.$nombre} object at 0x3ffb${(ids.get(x) * 16).toString(16).padStart(4, '0')}>`;
    }
    if (x.$esModulo) return `<module '${x.$nombre}'>`;
    if (typeof x === 'function') return `<function ${x.$nombre || x.name || '?'}>`;
    if (x.$repr) return x.$repr();
    return `<${nombreTipo(x)} object>`;
  }
  function str(x) {
    if (typeof x === 'string') return x;
    if (typeof x === 'number') return reprFloat(x);
    if (x && x.$esInstancia) {
      if (x.__str__) return String(sinCeder(invocar(x.__str__, [x], null)));
      if (esInstancia(x, BaseException)) return x.args.length === 0 ? '' : (x.args.length === 1 ? str(x.args[0]) : repr(x.args));
    }
    if (x && x.$str) return x.$str();
    return repr(x);
  }
  // Mini lenguaje de formato de Python: [[relleno]alineacion][signo][#][0][ancho][,_][.precision][tipo]
  function formato(x, spec) {
    spec = spec || '';
    if (x && x.$esInstancia && x.__format__) return String(sinCeder(invocar(x.__format__, [x, spec], null)));
    const m = /^(?:(.)?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
    if (!m) throw exc('ValueError', `Invalid format specifier '${spec}'`);
    let [, relleno, alin, signo, , alt, cero, ancho, grupo, prec, tipo] = m;
    let s;
    const esN = esNum(x);
    if (typeof x === 'boolean' && !tipo) x = x ? 'True' : 'False';
    if (typeof x === 'string') {
      if (tipo && tipo !== 's') throw exc('ValueError', `Unknown format code '${tipo}' for object of type 'str'`);
      s = prec !== undefined ? x.slice(0, +prec) : x;
      alin = alin || '<';
    } else if (esN) {
      const n = +x;
      const p = prec === undefined ? null : +prec;
      if (tipo === 'd' || tipo === 'n') { if (!Number.isInteger(n)) throw exc('ValueError', "Unknown format code 'd' for object of type 'float'"); s = String(Math.abs(n)); }
      else if (tipo === 'f' || tipo === 'F') s = fijoExacto(Math.abs(n), p === null ? 6 : p);
      else if (tipo === 'e' || tipo === 'E') { s = Math.abs(n).toExponential(p === null ? 6 : p).replace(/e([+-])(\d)$/, 'e$10$2'); if (tipo === 'E') s = s.toUpperCase(); }
      else if (tipo === 'g' || tipo === 'G') { const q = p === null ? 6 : Math.max(1, p); s = String(Number(Math.abs(n).toPrecision(q))); if (/e/.test(s)) s = s.replace(/e([+-])(\d)$/, 'e$10$2'); if (tipo === 'G') s = s.toUpperCase(); }
      else if (tipo === '%') s = fijoExacto(Math.abs(n) * 100, p === null ? 6 : p) + '%';
      else if (tipo === 'x' || tipo === 'X' || tipo === 'o' || tipo === 'b') {
        if (!Number.isInteger(n)) throw exc('ValueError', `Unknown format code '${tipo}' for object of type 'float'`);
        s = Math.abs(n).toString({ x: 16, X: 16, o: 8, b: 2 }[tipo]); if (tipo === 'X') s = s.toUpperCase();
        if (alt) s = { x: '0x', X: '0X', o: '0o', b: '0b' }[tipo] + s;
      } else if (tipo === 'c') s = String.fromCharCode(n);
      else s = p === null ? reprFloat(Math.abs(n)) : String(Number(Math.abs(n).toPrecision(Math.max(1, p))));
      if (grupo && /^\d+/.test(s)) s = s.replace(/^\d+/, d => d.replace(/\B(?=(\d{3})+(?!\d))/g, grupo));
      const neg = n < 0 || Object.is(n, -0) && tipo === 'f';
      const sg = neg ? '-' : (signo === '+' ? '+' : (signo === ' ' ? ' ' : ''));
      if (cero && !alin) { const w = ancho ? +ancho : 0; s = sg + s.padStart(Math.max(0, w - sg.length), '0'); }
      else s = sg + s;
      alin = alin || '>';
    } else {
      s = str(x);
      alin = alin || '<';
    }
    const w = ancho ? +ancho : 0;
    if (s.length < w) {
      const r = relleno || ' ', falta = w - s.length;
      if (alin === '<') s = s + r.repeat(falta);
      else if (alin === '>') s = r.repeat(falta) + s;
      else if (alin === '^') s = r.repeat(Math.floor(falta / 2)) + s + r.repeat(Math.ceil(falta / 2));
      else if (alin === '=') { const sg = /^[+\- ]/.test(s) ? s[0] : ''; s = sg + r.repeat(falta) + s.slice(sg.length); }
    }
    return s;
  }
  function formatoF(x, conv, spec) {
    if (conv === 'r') x = repr(x); else if (conv === 's') x = str(x); else if (conv === 'a') x = repr(x);
    return formato(x, spec);
  }
  function formatoPorcentaje(f, args) {
    const lista = args instanceof Tupla ? [...args] : [args];
    let k = 0;
    const r = f.replace(/%(\([^)]*\))?([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfFgGcrsa%])/g, (m, nombre, flags, ancho, prec, conv) => {
      if (conv === '%') return '%';
      let val;
      if (nombre) { if (!(args instanceof Dict)) throw exc('TypeError', 'format requires a mapping'); val = args.obtener(nombre.slice(1, -1)); }
      else { if (k >= lista.length) throw exc('TypeError', 'not enough arguments for format string'); val = lista[k++]; }
      let s;
      const p = prec === undefined ? undefined : +prec;
      switch (conv) {
        case 'd': case 'i': case 'u': s = String(Math.trunc(num(val, '%', val))); break;
        case 'o': s = Math.trunc(num(val, '%', val)).toString(8); break;
        case 'x': s = Math.trunc(num(val, '%', val)).toString(16); break;
        case 'X': s = Math.trunc(num(val, '%', val)).toString(16).toUpperCase(); break;
        case 'e': case 'E': s = (+val).toExponential(p === undefined ? 6 : p).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break;
        case 'f': case 'F': s = fijoExacto(+num(val, '%', val), p === undefined ? 6 : p); break;
        case 'g': case 'G': s = String(Number((+val).toPrecision(p === undefined ? 6 : Math.max(1, p)))); break;
        case 'c': s = typeof val === 'string' ? val : String.fromCharCode(val); break;
        case 'r': case 'a': s = repr(val); break;
        default: s = str(val); if (p !== undefined) s = s.slice(0, p);
      }
      if (flags.includes('+') && /^\d/.test(s) && 'diufFeEgG'.includes(conv)) s = '+' + s;
      const w = ancho ? +ancho : 0;
      if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : (flags.includes('0') && 'diufFeEgGxXo'.includes(conv) ? (/^[+-]/.test(s) ? s[0] + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0')) : s.padStart(w));
      return s;
    });
    if (!nombreEnArgs(args) && k < lista.length) throw exc('TypeError', 'not all arguments converted during string formatting');
    return r;
  }
  const nombreEnArgs = a => a instanceof Dict;
  function metodoTexto(s, n) {
    const T = {
      upper: () => s.toUpperCase(), lower: () => s.toLowerCase(), capitalize: () => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
      title: () => s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()), swapcase: () => [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''),
      strip: c => c === undefined || c === null ? s.trim() : s.replace(new RegExp(`^[${esc(c)}]+|[${esc(c)}]+$`, 'g'), ''),
      lstrip: c => c === undefined || c === null ? s.replace(/^\s+/, '') : s.replace(new RegExp(`^[${esc(c)}]+`), ''),
      rstrip: c => c === undefined || c === null ? s.replace(/\s+$/, '') : s.replace(new RegExp(`[${esc(c)}]+$`), ''),
      split: (sep, max) => {
        max = max === undefined || max === null ? -1 : max;
        if (sep === undefined || sep === null) { const p = s.trim().split(/\s+/).filter(x => x); if (max >= 0 && p.length > max + 1) { const r = p.slice(0, max); r.push(s.trim().split(/\s+/).slice(max).join(' ')); return r; } return p; }
        if (sep === '') throw exc('ValueError', 'empty separator');
        const p = s.split(sep);
        if (max >= 0 && p.length > max + 1) return [...p.slice(0, max), p.slice(max).join(sep)];
        return p;
      },
      rsplit: (sep, max) => T.split(sep, max), splitlines: () => s.split(/\r?\n/).filter((x, i, a) => i < a.length - 1 || x !== ''),
      join: it => { const a = [...iter(it)]; for (const x of a) if (typeof x !== 'string') throw exc('TypeError', `sequence item: expected str instance, ${nombreTipo(x)} found`); return a.join(s); },
      replace: (a, b, c) => { if (c === undefined || c < 0) return s.split(a).join(b); let r = s; for (let i = 0; i < c; i++) r = r.replace(a, b); return r; },
      startswith: (p, i) => Array.isArray(p) ? p.some(x => s.startsWith(x, i || 0)) : s.startsWith(p, i || 0),
      endswith: p => Array.isArray(p) ? p.some(x => s.endsWith(x)) : s.endsWith(p),
      find: (x, i, j) => { const r = s.slice(0, j === undefined ? s.length : j).indexOf(x, i || 0); return r; },
      rfind: x => s.lastIndexOf(x), index: (x, i) => { const r = s.indexOf(x, i || 0); if (r < 0) throw exc('ValueError', 'substring not found'); return r; },
      rindex: x => { const r = s.lastIndexOf(x); if (r < 0) throw exc('ValueError', 'substring not found'); return r; },
      count: x => x === '' ? s.length + 1 : s.split(x).length - 1,
      isdigit: () => /^\d+$/.test(s), isnumeric: () => /^\d+$/.test(s), isdecimal: () => /^\d+$/.test(s), isalpha: () => /^[A-Za-zÀ-￿]+$/.test(s),
      isalnum: () => /^[A-Za-z0-9À-￿]+$/.test(s), isspace: () => /^\s+$/.test(s), isupper: () => s !== s.toLowerCase() && s === s.toUpperCase(),
      islower: () => s !== s.toUpperCase() && s === s.toLowerCase(),
      zfill: w => { const sg = /^[+-]/.test(s) ? s[0] : ''; return sg + s.slice(sg.length).padStart(w - sg.length, '0'); },
      center: (w, c) => { const f = Math.max(0, w - s.length), r = c || ' '; return r.repeat(Math.floor(f / 2)) + s + r.repeat(Math.ceil(f / 2)); },
      ljust: (w, c) => s.padEnd(w, c || ' '), rjust: (w, c) => s.padStart(w, c || ' '),
      partition: sep => { const i = s.indexOf(sep); return i < 0 ? tupla([s, '', '']) : tupla([s.slice(0, i), sep, s.slice(i + sep.length)]); },
      encode: () => s, decode: () => s,
      format: null,
    };
    if (n === 'format') {
      const f = function (...a) {
        const kw = a.pop();
        let k = 0;
        return s.replace(/\{\{|\}\}|\{([^{}:!]*)(?:!([rsa]))?(?::([^{}]*))?\}/g, (m, campo, conv, spec) => {
          if (m === '{{') return '{'; if (m === '}}') return '}';
          let val;
          if (campo === '') val = a[k++];
          else if (/^\d+$/.test(campo)) val = a[+campo];
          else { const [base, ...resto] = campo.split('.'); val = kw[base]; for (const r of resto) val = leer(val, r); }
          if (val === undefined) throw exc('IndexError', 'Replacement index out of range');
          return formatoF(val, conv || null, spec || '');
        });
      };
      f.$conKw = true;
      return f;
    }
    const f = T[n];
    if (!f) throw exc('AttributeError', `'str' object has no attribute '${n}'`);
    return f;
  }
  const esc = c => c.replace(/[\\\]\[^-]/g, '\\$&');
  function metodoNumero(x, n) {
    if (n === 'is_integer') return () => Number.isInteger(x);
    if (n === 'bit_length') return () => Math.abs(x).toString(2).length * (x !== 0);
    throw exc('AttributeError', `'${nombreTipo(x)}' object has no attribute '${n}'`);
  }
  function* metodoLista(a, n, p, kw) {
    const esT = a instanceof Tupla;
    const L = {
      count: x => a.filter(y => eq(x, y)).length,
      index: x => { for (let i = 0; i < a.length; i++) if (eq(a[i], x)) return i; throw exc('ValueError', `${repr(x)} is not in ${esT ? 'tuple' : 'list'}`); },
    };
    if (!esT) Object.assign(L, {
      append: x => { a.push(x); return null; }, extend: it => { a.push(...iter(it)); return null; },
      insert: (i, x) => { a.splice(i < 0 ? Math.max(0, a.length + i) : Math.min(i, a.length), 0, x); return null; },
      pop: i => { if (!a.length) throw exc('IndexError', 'pop from empty list'); const k = i === undefined ? a.length - 1 : indice(i, a.length, 'pop'); return a.splice(k, 1)[0]; },
      remove: x => { for (let i = 0; i < a.length; i++) if (eq(a[i], x)) { a.splice(i, 1); return null; } throw exc('ValueError', 'list.remove(x): x not in list'); },
      reverse: () => { a.reverse(); return null; }, clear: () => { a.length = 0; return null; }, copy: () => a.slice(),
    });
    if (n === 'sort' && !esT) {
      const k = (kw && kw.key) || null, rev = kw && v(kw.reverse);
      const claves = [];
      for (const x of a) claves.push(k ? yield* llamar(k, [x], null) : x);
      const idx = a.map((_, i) => i).sort((i, j) => { const c = cmp(claves[i], claves[j], '<'); return rev ? -c : c || i - j; });
      const orden = idx.map(i => a[i]);
      a.length = 0; a.push(...orden);
      return null;
    }
    const f = L[n];
    if (!f) throw exc('AttributeError', `'${esT ? 'tuple' : 'list'}' object has no attribute '${n}'`);
    if (kw && Object.keys(kw).length) throw exc('TypeError', `${n}() no acepta argumentos por nombre`);
    hw.avanzar(3);
    return f(...p);
  }
  const itemsDict = d => [...d.m.values()].map(([k, w]) => [k, w]);
  function* metodoDict(d, n, p, kw) {
    hw.avanzar(3);
    switch (n) {
      case 'get': return d.tiene(p[0]) ? d.obtener(p[0]) : (p.length > 1 ? p[1] : null);
      case 'keys': return d.claves();
      case 'values': return [...d.m.values()].map(e => e[1]);
      case 'items': return [...d.m.values()].map(e => tupla(e));
      case 'pop': if (d.tiene(p[0])) { const w = d.obtener(p[0]); d.m.delete(clave(p[0])); return w; } if (p.length > 1) return p[1]; throw exc('KeyError', p[0]);
      case 'popitem': { if (!d.size) throw exc('KeyError', 'popitem(): dictionary is empty'); const e = [...d.m.entries()].pop(); d.m.delete(e[0]); return tupla(e[1]); }
      case 'setdefault': if (!d.tiene(p[0])) d.set(p[0], p.length > 1 ? p[1] : null); return d.obtener(p[0]);
      case 'update': { if (p[0] instanceof Dict) for (const [k, w] of itemsDict(p[0])) d.set(k, w); else if (p[0]) for (const e of iter(p[0])) { const [k, w] = desempaquetar(e, 2); d.set(k, w); } if (kw) for (const k of Object.keys(kw)) d.set(k, kw[k]); return null; }
      case 'clear': d.m.clear(); return null;
      case 'copy': return new Dict(itemsDict(d));
    }
    throw exc('AttributeError', `'dict' object has no attribute '${n}'`);
  }
  function metodoSet(s, n) {
    const S = {
      add: x => { s.add(x); return null; }, remove: x => { if (!s.has(x)) throw exc('KeyError', x); s.m.delete(clave(x)); return null; },
      discard: x => { s.m.delete(clave(x)); return null; }, clear: () => { s.m.clear(); return null; },
      pop: () => { const e = [...s.m.entries()][0]; if (!e) throw exc('KeyError', 'pop from an empty set'); s.m.delete(e[0]); return e[1]; },
      union: o => new PySet([...s, ...iter(o)]), intersection: o => { const b = new PySet(iter(o)); return new PySet([...s].filter(x => b.has(x))); },
      difference: o => { const b = new PySet(iter(o)); return new PySet([...s].filter(x => !b.has(x))); }, copy: () => new PySet(s),
      issubset: o => { const b = new PySet(iter(o)); return [...s].every(x => b.has(x)); },
    };
    if (!S[n]) throw exc('AttributeError', `'set' object has no attribute '${n}'`);
    return S[n];
  }

  // ─────────────── integradas ───────────────
  function longitud(x) {
    if (typeof x === 'string' || Array.isArray(x) || x instanceof Rango) return x.length;
    if (x instanceof Dict || x instanceof PySet) return x.size;
    if (x && x.$esInstancia && x.__len__) return sinCeder(invocar(x.__len__, [x], null));
    if (x && typeof x.$len === 'function') return x.$len();
    throw exc('TypeError', `object of type '${nombreTipo(x)}' has no len()`);
  }
  function aEntero(x, base) {
    if (x === undefined) return 0;
    if (typeof x === 'boolean') return +x;
    if (typeof x === 'number') { if (!Number.isFinite(x)) throw exc(Number.isNaN(x) ? 'ValueError' : 'OverflowError', 'cannot convert float to integer'); return Math.trunc(x); }
    if (typeof x === 'string') {
      const t = x.trim().replace(/_/g, '');
      const b = base === undefined ? 10 : base;
      const re = { 2: /^[+-]?(0b)?[01]+$/i, 8: /^[+-]?(0o)?[0-7]+$/i, 10: /^[+-]?\d+$/, 16: /^[+-]?(0x)?[0-9a-f]+$/i }[b];
      if (!re || !re.test(t)) throw exc('ValueError', `invalid literal for int() with base ${b}: ${repr(x)}`);
      return parseInt(t.replace(/^([+-]?)0[box]/i, '$1'), b);
    }
    if (x && x.$esInstancia && x.__int__) return sinCeder(invocar(x.__int__, [x], null));
    throw exc('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${nombreTipo(x)}'`);
  }
  function aFlotante(x) {
    if (x === undefined) return 0;
    if (esNum(x)) return +x;
    if (typeof x === 'string') {
      const t = x.trim().toLowerCase();
      if (/^[+-]?(inf|infinity)$/.test(t)) return t[0] === '-' ? -Infinity : Infinity;
      if (/^[+-]?nan$/.test(t)) return NaN;
      if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t.replace(/_/g, ''))) throw exc('ValueError', `could not convert string to float: ${repr(x)}`);
      return parseFloat(t.replace(/_/g, ''));
    }
    throw exc('TypeError', `float() argument must be a string or a real number, not '${nombreTipo(x)}'`);
  }
  function redondear(x, n) {
    x = num(x, 'round', x);
    if (!Number.isFinite(x)) { if (n === undefined || n === null) throw exc(Number.isNaN(x) ? 'ValueError' : 'OverflowError', 'cannot convert float to integer'); return x; }
    const k = n === undefined || n === null ? 0 : Math.trunc(n);
    if (k < 0) { const f = Math.pow(10, -k); return Number(fijoExacto(x / f, 0)) * f; }
    return Number(fijoExacto(x, k));
  }
  function* minmax(esMin, args, kw) {
    const clave = kw && kw.key ? kw.key : null;
    let lista = args.length === 1 ? [...iter(args[0])] : args;
    if (!lista.length) { if (kw && 'default' in kw) return kw.default; throw exc('ValueError', `${esMin ? 'min' : 'max'}() arg is an empty sequence`); }
    let mejor = lista[0], cm = clave ? yield* llamar(clave, [mejor], null) : mejor;
    for (let i = 1; i < lista.length; i++) {
      const c = clave ? yield* llamar(clave, [lista[i]], null) : lista[i];
      if (esMin ? lt(c, cm) : lt(cm, c)) { mejor = lista[i]; cm = c; }
    }
    return mejor;
  }
  function tipoInt(x) { return typeof x === 'number' && Number.isInteger(x); }
  function esTipo(x, T) {
    if (T instanceof Tupla || Array.isArray(T)) return T.some(t => esTipo(x, t));
    if (T === B.int) return tipoInt(x) || typeof x === 'boolean';
    if (T === B.float) return typeof x === 'number' && !Number.isInteger(x);
    if (T === B.bool) return typeof x === 'boolean';
    if (T === B.str) return typeof x === 'string';
    if (T === B.list) return Array.isArray(x) && !(x instanceof Tupla);
    if (T === B.tuple) return x instanceof Tupla;
    if (T === B.dict) return x instanceof Dict;
    if (T === B.set) return x instanceof PySet;
    if (T === B.range) return x instanceof Rango;
    if (T === B.object) return true;
    if (T && T.$esClase) return esInstancia(x, T);
    if (T && T.$esTipoApi) return x && x.$tipo === T.$nombre;
    throw exc('TypeError', 'isinstance() arg 2 must be a type or tuple of types');
  }
  function* imprimir(...a) {
    const kw = a.pop() || {};
    const sep = kw.sep === undefined || kw.sep === null ? ' ' : kw.sep, fin = kw.end === undefined || kw.end === null ? '\n' : kw.end;
    const txt = a.map(str).join(sep) + fin;
    hw.avanzar(40 + txt.length * 1.5);
    hw.emitirTexto(txt);
    yield* ceder();
    return null;
  }
  const B = {
    print: imprimir, len: longitud, abs: x => { if (x && x.$esInstancia && x.__abs__) return sinCeder(invocar(x.__abs__, [x], null)); return Math.abs(num(x, 'abs()', x)); },
    int: aEntero, float: aFlotante, bool: x => x === undefined ? false : v(x), str: x => x === undefined ? '' : str(x), repr,
    range: (a, b, c) => new Rango(a, b, c), round: (x, n) => { const r = redondear(x, n); return r; },
    chr: n => String.fromCharCode(n), ord: s => { if (typeof s !== 'string' || s.length !== 1) throw exc('TypeError', 'ord() expected a character'); return s.charCodeAt(0); },
    hex: n => (n < 0 ? '-0x' : '0x') + Math.abs(aEntero(n)).toString(16), bin: n => (n < 0 ? '-0b' : '0b') + Math.abs(aEntero(n)).toString(2),
    oct: n => (n < 0 ? '-0o' : '0o') + Math.abs(aEntero(n)).toString(8),
    divmod: (a, b) => tupla([fdiv(a, b), mod(a, b)]), pow: (a, b, m) => m === undefined ? pow(a, b) : mod(pow(a, b), m),
    sum: (it, ini) => { let s = ini === undefined ? 0 : ini; for (const x of iter(it)) s = add(s, x); return s; },
    min: (...a) => { if (a.length === 1) a = [...iter(a[0])]; if (!a.length) throw exc('ValueError', 'min() arg is an empty sequence'); return a.reduce((m, x) => lt(x, m) ? x : m); },
    max: (...a) => { if (a.length === 1) a = [...iter(a[0])]; if (!a.length) throw exc('ValueError', 'max() arg is an empty sequence'); return a.reduce((m, x) => lt(m, x) ? x : m); },
    any: it => { for (const x of iter(it)) if (v(x)) return true; return false; }, all: it => { for (const x of iter(it)) if (!v(x)) return false; return true; },
    list: it => it === undefined ? [] : [...iter(it)], tuple: it => it === undefined ? tupla([]) : tupla([...iter(it)]),
    dict: (...a) => { const kw = a.pop() || {}; const d = new Dict(); if (a[0] instanceof Dict) for (const [k, w] of itemsDict(a[0])) d.set(k, w); else if (a[0]) for (const e of iter(a[0])) { const [k, w] = desempaquetar(e, 2); d.set(k, w); } for (const k of Object.keys(kw)) d.set(k, kw[k]); return d; },
    set: it => new PySet(it === undefined ? [] : iter(it)), frozenset: it => new PySet(it === undefined ? [] : iter(it)),
    enumerate: (it, ini) => { let i = ini || 0; return [...iter(it)].map(x => tupla([i++, x])); },
    zip: (...a) => { const ls = a.map(x => [...iter(x)]); const n = ls.length ? Math.min(...ls.map(l => l.length)) : 0; const r = []; for (let i = 0; i < n; i++) r.push(tupla(ls.map(l => l[i]))); return r; },
    reversed: it => [...iter(it)].reverse(),
    isinstance: (x, T) => esTipo(x, T), issubclass: (A, T) => A && A.$esClase && T && T.$esClase ? A === T || T.prototype.isPrototypeOf(A.prototype) : false,
    hasattr: (o, n) => { try { leer(o, n); return true; } catch (x) { if (x && x.$esInstancia) return false; throw x; } },
    getattr: (o, n, d) => { try { return leer(o, n); } catch (x) { if (x && x.$esInstancia && d !== undefined) return d; throw x; } },
    setattr: (o, n, w) => { escribir(o, n, w); return null; },
    type: x => { if (x === null || x === undefined) return B.NoneType; if (typeof x === 'boolean') return B.bool; if (typeof x === 'number') return Number.isInteger(x) ? B.int : B.float; if (typeof x === 'string') return B.str; if (x instanceof Tupla) return B.tuple; if (Array.isArray(x)) return B.list; if (x instanceof Dict) return B.dict; if (x instanceof PySet) return B.set; if (x.$esInstancia) return x.$clase; return B.object; },
    callable: x => typeof x === 'function' || !!(x && (x.$esClase || (x.$esInstancia && x.__call__))),
    id: x => { if (x === null || typeof x !== 'object' && typeof x !== 'function') return 1000 + (typeof x === 'number' ? x : String(x).length); if (!ids.has(x)) ids.set(x, ++nId); return 0x3ffb0000 + ids.get(x) * 16; },
    hash: x => { const k = clave(x); if (typeof k === 'number') return Math.trunc(k); let h = 0; for (const c of String(k)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; },
    format: (x, s) => formato(x, s || ''), input: p => { if (p) hw.emitirTexto(str(p)); return ''; },
    open: () => { throw exc('OSError', 'el simulador no tiene archivos'); },
    exit: () => { throw new SalidaPrograma('exit()'); }, quit: () => { throw new SalidaPrograma('quit()'); },
    dir: () => [], vars: () => new Dict(), globals: () => new Dict(), locals: () => new Dict(), help: () => null,
    object: Objeto, NotImplemented: { $repr: () => 'NotImplemented' }, Ellipsis, __name__: '__main__', NoneType: { $esTipoApi: true, $nombre: 'NoneType' },
    staticmethod: estatico, classmethod: declase, property: propiedad,
    iter: x => { const it = iter(x)[Symbol.iterator](); return { $tipo: 'iterator', $it: it, [Symbol.iterator]() { return it; } }; },
    next: (it, d) => { const src = it && it.$it; if (!src) throw exc('TypeError', `'${nombreTipo(it)}' object is not an iterator`); const r = src.next(); if (r.done) { if (d !== undefined) return d; throw exc('StopIteration'); } return r.value; },
    slice: (a, b, c) => b === undefined ? slice(null, a, null) : slice(a, b, c === undefined ? null : c),
    bytes: () => { throw exc('TypeError', 'bytes no esta soportado en el simulador'); }, bytearray: () => { throw exc('TypeError', 'bytearray no esta soportado en el simulador'); },
  };
  for (const [n, K] of Object.entries(EXC)) B[n] = K;
  B.sorted = function* (it, kw) {
    const a = [...iter(it)];
    yield* metodoLista(a, 'sort', [], kw);
    return a;
  };
  B.sorted.$conKw = true;
  B.min = Object.assign(function* (...a) { const kw = a.pop() || {}; return yield* minmax(true, a, kw); }, { $conKw: true });
  B.max = Object.assign(function* (...a) { const kw = a.pop() || {}; return yield* minmax(false, a, kw); }, { $conKw: true });
  B.map = function* (f, ...its) { const ls = its.map(x => [...iter(x)]); const n = Math.min(...ls.map(l => l.length)); const r = []; for (let i = 0; i < n; i++) r.push(yield* llamar(f, ls.map(l => l[i]), null)); return r; };
  B.filter = function* (f, it) { const r = []; for (const x of iter(it)) if (f === null ? v(x) : v(yield* llamar(f, [x], null))) r.push(x); return r; };
  B.print.$conKw = true; B.dict.$conKw = true;
  for (const n of ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set', 'range', 'object']) if (typeof B[n] === 'function') B[n].__name__ = n;
  // version rapida de min/max sin key (el traductor las llama directo)
  const minRapido = (...a) => { if (a.length === 1) a = [...iter(a[0])]; if (!a.length) throw exc('ValueError', 'min() arg is an empty sequence'); return a.reduce((m, x) => lt(x, m) ? x : m); };
  const maxRapido = (...a) => { if (a.length === 1) a = [...iter(a[0])]; if (!a.length) throw exc('ValueError', 'max() arg is an empty sequence'); return a.reduce((m, x) => lt(m, x) ? x : m); };
  const BR = Object.assign(Object.create(B), { min: minRapido, max: maxRapido });

  // ─────────────── los modulos del kit ───────────────
  const pinesUsados = new Map();
  function tomarPin(pin, quien) {
    if (!pin || pin.$tipo !== 'Pin') throw exc('TypeError', `se esperaba un pin (por ejemplo board.IO25) y llego ${repr(pin)}`);
    if (pinesUsados.has(pin.n)) throw exc('ValueError', `${pin.nombre} in use`);
    pinesUsados.set(pin.n, quien);
  }
  const soltarPin = pin => pinesUsados.delete(pin.n);
  const modulo = (nombre, cont) => Object.assign({ $esModulo: true, $nombre: nombre }, cont);
  const board = modulo('board', { board_id: 'ideaboard' });
  const PIN = {};
  for (let i = 0; i <= 39; i++) PIN[i] = board['IO' + i] = { $tipo: 'Pin', n: i, nombre: 'board.IO' + i, $repr() { return this.nombre; } };
  Object.assign(board, { SDA: PIN[21], SCL: PIN[22], NEOPIXEL: PIN[P.neopixel], LED: PIN[P.neopixel], TX: PIN[1], RX: PIN[3], MOSI: PIN[23], MISO: PIN[19], SCK: PIN[18] });
  function lecturaPin(n) {
    // lee el pin como lo veria el ESP32: BOOT, eco del sonar, IR o lo ultimo que se escribio
    if (n === P.boot) {
      const prox = hw.sim.mundo.proximoEvento();
      hw.avanzar(Math.max(8, Math.min(1000, prox - hw.t, hw.limite - hw.t)));
      return hw.leerBoot();
    }
    hw.avanzar(8);
    return hw.leerDigital(n);
  }
  const Direction = { $esModulo: true, $nombre: 'Direction', INPUT: { $repr: () => 'digitalio.Direction.INPUT', d: 'in' }, OUTPUT: { $repr: () => 'digitalio.Direction.OUTPUT', d: 'out' } };
  const Pull = { $esModulo: true, $nombre: 'Pull', UP: { $repr: () => 'digitalio.Pull.UP', p: 5 }, DOWN: { $repr: () => 'digitalio.Pull.DOWN', p: 9 } };
  const DriveMode = { $esModulo: true, $nombre: 'DriveMode', PUSH_PULL: {}, OPEN_DRAIN: {} };
  function DigitalInOut(pin) {
    tomarPin(pin, 'DigitalInOut');
    const o = {
      $tipo: 'DigitalInOut', pin, dir: Direction.INPUT, _pull: null, salida: false,
      direction: Direction.INPUT, pull: null,
      $set_direction(d) { this.dir = d; this.direction = d; if (d === Direction.OUTPUT) hw.escribirDigital(pin.n, this.salida ? 1 : 0); },
      $set_pull(p) { this._pull = p; this.pull = p; hw.pinModo[pin.n] = p ? p.p : 1; },
      *$get_value() {
        if (this.dir === Direction.OUTPUT) { hw.avanzar(3); return this.salida; }
        const r = lecturaPin(pin.n) === 1;
        yield* ceder();
        return r;
      },
      $set_value(x) {
        if (this.dir !== Direction.OUTPUT) throw exc('AttributeError', 'Cannot set value when direction is input.');
        this.salida = v(x); hw.avanzar(3); hw.escribirDigital(pin.n, this.salida ? 1 : 0);
      },
      switch_to_input(...a) { const kw = a.pop() || {}; this.$set_direction(Direction.INPUT); if (kw.pull !== undefined) this.$set_pull(kw.pull); else if (a[0] !== undefined) this.$set_pull(a[0]); return null; },
      switch_to_output(...a) { const kw = a.pop() || {}; this.salida = v(kw.value !== undefined ? kw.value : (a[0] !== undefined ? a[0] : false)); this.$set_direction(Direction.OUTPUT); return null; },
      deinit() { soltarPin(pin); return null; },
    };
    o.switch_to_input.$conKw = true; o.switch_to_output.$conKw = true;
    return o;
  }
  function AnalogIn(pin) {
    tomarPin(pin, 'AnalogIn');
    return {
      $tipo: 'AnalogIn', reference_voltage: 3.3,
      *$get_value() {
        hw.avanzar(45);
        const r = hw.leerAnalogico(pin.n);
        yield* ceder();
        return (r << 4) | (r >> 8);      // 12 bits -> 16 bits, como CircuitPython
      },
      deinit() { soltarPin(pin); return null; },
    };
  }
  function PWMOut(pin, ...a) {
    const kw = a.pop() || {};
    tomarPin(pin, 'PWMOut');
    const o = {
      $tipo: 'PWMOut', duty: 0, frequency: kw.frequency || a[1] || 500, pin,
      get duty_cycle() { return this.duty; },
      $set_duty_cycle(d) { d = aEntero(d); if (d < 0 || d > 65535) throw exc('ValueError', 'duty_cycle must be between 0 and 65535'); this.duty = d; hw.avanzar(15); hw.escribirFrac(pin.n, d / 65535); },
      $set_frequency(f) { this.frequency = f; },
      deinit() { hw.escribirFrac(pin.n, 0); soltarPin(pin); return null; },
    };
    Object.defineProperty(o, 'duty_cycle', { get() { return o.duty; }, enumerable: true });
    o.$set_duty_cycle(kw.duty_cycle !== undefined ? kw.duty_cycle : (a[0] || 0));
    return o;
  }
  PWMOut.$conKw = true;
  const time = modulo('time', {
    *sleep(s) {
      s = num(s, 'sleep', s);
      if (s < 0) throw exc('ValueError', 'sleep length must be non-negative');
      yield* esperar(Math.max(1, s * 1e6));
      return null;
    },
    monotonic() { hw.avanzar(4); return hw.t / 1e6; },
    monotonic_ns() { hw.avanzar(4); return Math.floor(hw.t * 1000); },
    time() { hw.avanzar(4); return 946684800 + Math.floor(hw.t / 1e6); },
    localtime() { const s = 946684800 + hw.t / 1e6, d = new Date(s * 1000); return tupla([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), (d.getUTCDay() + 6) % 7, 1, -1]); },
    struct_time: x => tupla([...iter(x)]),
  });
  const random = modulo('random', {
    random: () => azar(),
    randint: (a, b) => a + Math.floor(azar() * (b - a + 1)),
    uniform: (a, b) => a + (b - a) * azar(),
    choice: s => { const a = [...iter(s)]; if (!a.length) throw exc('IndexError', 'Cannot choose from an empty sequence'); return a[Math.floor(azar() * a.length)]; },
    randrange: (a, b, c) => { const r = new Rango(a, b, c); const n = r.length; if (!n) throw exc('ValueError', 'empty range for randrange()'); return r.a + Math.floor(azar() * n) * r.c; },
    seed: s => { hw.azarProg = crearAzar((Number(s) >>> 0) ^ 0x5DEECE66); return null; },
    getrandbits: k => Math.floor(azar() * Math.pow(2, k)),
  });
  const math = modulo('math', {
    pi: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity, nan: NaN,
    sqrt: x => { x = num(x, 'sqrt', x); if (x < 0) throw exc('ValueError', 'math domain error'); return Math.sqrt(x); },
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    degrees: x => x * 180 / Math.PI, radians: x => x * Math.PI / 180, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
    fabs: Math.abs, pow: Math.pow, exp: Math.exp, log: (x, b) => { if (x <= 0) throw exc('ValueError', 'math domain error'); return b === undefined ? Math.log(x) : Math.log(x) / Math.log(b); },
    log10: Math.log10, log2: Math.log2, isnan: Number.isNaN, isinf: x => x === Infinity || x === -Infinity, isfinite: Number.isFinite,
    copysign: (a, b) => Math.abs(a) * (b < 0 || Object.is(b, -0) ? -1 : 1), hypot: Math.hypot, fmod: (a, b) => a % b,
    modf: x => tupla([x - Math.trunc(x), Math.trunc(x)]), frexp: x => { if (x === 0) return tupla([0, 0]); const e = Math.floor(Math.log2(Math.abs(x))) + 1; return tupla([x / Math.pow(2, e), e]); },
  });
  // keypad: CircuitPython revisa los botones cada 20 ms en segundo plano y guarda los eventos.
  const colasTeclas = [];
  hw.alCambiarBoton = (presionado) => {
    for (const q of colasTeclas) {
      const pulsado = q.alPresionar ? presionado : !presionado;
      const t = Math.ceil((hw.sim.mundo.t + 1) / q.intervalo) * q.intervalo;
      if (q.eventos.length < q.max) q.eventos.push({ t, pressed: pulsado, key_number: q.clave });
      else q.overflowed = true;
    }
  };
  function Evento(n, presionado, t) {
    return { $tipo: 'Event', key_number: n, pressed: presionado, released: !presionado, timestamp: t,
      $repr() { return `<Event: key_number ${n} ${presionado ? 'pressed' : 'released'}>`; }, __eq__: undefined };
  }
  function Keys(pins, ...a) {
    const kw = a.pop() || {};
    const lista = [...iter(pins)];
    for (const p of lista) tomarPin(p, 'keypad.Keys');
    const vwp = kw.value_when_pressed;
    if (vwp === undefined) throw exc('TypeError', "Keys() falta el argumento value_when_pressed");
    const cola = { eventos: [], max: kw.max_events || 64, intervalo: Math.round((kw.interval || 0.02) * 1e6), overflowed: false, alPresionar: !v(vwp), clave: 0 };
    const boot = lista.findIndex(p => p.n === P.boot);
    if (boot >= 0) { cola.clave = boot; colasTeclas.push(cola); }
    const events = {
      $tipo: 'EventQueue',
      *get() {
        const prox = hw.sim.mundo.proximoEvento();
        hw.avanzar(Math.max(10, Math.min(1000, prox - hw.t, hw.limite - hw.t)));
        if (boot >= 0) hw.leerBoot();
        yield* ceder();
        const e = cola.eventos[0];
        if (e && e.t <= hw.t) { cola.eventos.shift(); return Evento(e.key_number, e.pressed, Math.floor(e.t / 1000)); }
        return null;
      },
      get_into(ev) { const e = cola.eventos[0]; if (e && e.t <= hw.t) { cola.eventos.shift(); ev.key_number = e.key_number; ev.pressed = e.pressed; ev.released = !e.pressed; return true; } return false; },
      clear() { cola.eventos.length = 0; cola.overflowed = false; return null; },
      $len() { return cola.eventos.filter(e => e.t <= hw.t).length; },
      get overflowed() { return cola.overflowed; },
    };
    return { $tipo: 'Keys', events, key_count: lista.length, deinit() { lista.forEach(soltarPin); return null; }, reset() { cola.eventos.length = 0; return null; } };
  }
  Keys.$conKw = true;
  const keypad = modulo('keypad', { Keys, Event: (n, p) => Evento(n || 0, p === undefined ? true : v(p), 0), EventQueue: null });
  function colorDe(c) {
    if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const a = [...iter(c)];
    if (a.length < 3) throw exc('ValueError', 'un color es (r, g, b)');
    return a.slice(0, 3).map(x => { x = aEntero(x); if (x < 0 || x > 255) throw exc('ValueError', 'cada color va de 0 a 255'); return x; });
  }
  function NeoPixel(pin, n, ...a) {
    const kw = a.pop() || {};
    tomarPin(pin, 'NeoPixel');
    const px = Array.from({ length: n }, () => tupla([0, 0, 0]));
    const o = {
      $tipo: 'NeoPixel', n, brillo: kw.brightness === undefined ? 1 : kw.brightness, auto: kw.auto_write === undefined ? true : v(kw.auto_write),
      get brightness() { return o.brillo; },
      $set_brightness(b) { o.brillo = Math.max(0, Math.min(1, b)); if (o.auto) o.show(); },
      $set_auto_write(x) { o.auto = v(x); },
      $getitem(i) { return px[indice(i, n, 'NeoPixel')]; },
      $setitem(i, c) { px[indice(i, n, 'NeoPixel')] = tupla(colorDe(c)); if (o.auto) o.show(); },
      $len() { return n; },
      fill(c) { const k = colorDe(c); for (let i = 0; i < n; i++) px[i] = tupla(k); if (o.auto) o.show(); return null; },
      show() {
        hw.avanzar(60 + 30 * n);
        if (pin.n === P.neopixel) hw.ledNeo(px[0].map(x => Math.round(x * o.brillo)));
        return null;
      },
      deinit() { soltarPin(pin); return null; },
    };
    return o;
  }
  NeoPixel.$conKw = true;
  const neopixel = modulo('neopixel', { NeoPixel, GRB: 'GRB', RGB: 'RGB', GRBW: 'GRBW', RGBW: 'RGBW' });
  // Motores del kit (IdeaBoard): throttle de -1 a 1; None = sueltos.
  function Motor(i) {
    let th = 0;
    return {
      $tipo: 'DCMotor', get throttle() { return th; },
      $set_throttle(x) {
        if (x !== null && x !== undefined) { x = num(x, 'throttle', x); if (x < -1 || x > 1) throw exc('ValueError', 'Throttle must be None or between -1.0 and +1.0'); }
        th = x === undefined ? null : x;
        hw.avanzar(25);
        hw.fijarMotorPy(i, th === null ? 0 : th);
      },
      decay_mode: 0,
    };
  }
  function IdeaBoard() {
    const m1 = Motor(0), m2 = Motor(1);
    let color = tupla([0, 0, 0]);
    const o = {
      $tipo: 'IdeaBoard', motor_1: m1, motor_2: m2,
      get pixel() { return color; },
      $set_pixel(c) { const k = colorDe(c); color = tupla(k); hw.avanzar(80); hw.ledNeo(k); },
      AnalogIn: pin => AnalogIn(pin),
      DigitalIn: (pin, pull) => { const d = DigitalInOut(pin); if (pull) d.$set_pull(pull); return d; },
      DigitalOut: pin => { const d = DigitalInOut(pin); d.$set_direction(Direction.OUTPUT); return d; },
      Servo: () => ({ $tipo: 'Servo', angle: null, $set_angle(a) { this.angle = a; } }),
    };
    return o;
  }
  // Sonar HC-SR04/SR05: dispara, espera el eco y mide cuanto dura (en cm).
  function Sonar(trig, eco, timeout, tipo) {
    tomarPin(trig, tipo); tomarPin(eco, tipo);
    const medir = function* () {
      hw.avanzar(250);
      if (eco.n === P.echo && hw.nivelEco(hw.t)) {        // el eco anterior no termino
        const hasta = hw.proximoCambioEco(hw.t);
        if (hasta - hw.t > timeout) { yield* esperar(timeout); throw exc('RuntimeError', 'Timed out'); }
        yield* esperar(hasta - hw.t + 5);
      }
      yield* hw.dispararSonar(trig.n);
      if (eco.n !== P.echo) { yield* esperar(timeout); throw exc('RuntimeError', 'Timed out'); }
      const t0 = hw.t;
      while (!hw.nivelEco(hw.t)) {
        if (hw.t - t0 > timeout) throw exc('RuntimeError', 'Timed out');
        hw.avanzar(Math.max(2, Math.min(hw.proximoCambioEco(hw.t) - hw.t, t0 + timeout + 1 - hw.t, 1000)));
        yield* ceder();
      }
      const ti = hw.t;
      while (hw.nivelEco(hw.t)) {
        if (hw.t - ti > timeout) throw exc('RuntimeError', 'Timed out');
        hw.avanzar(Math.max(2, Math.min(hw.proximoCambioEco(hw.t) - hw.t, ti + timeout + 1 - hw.t, 1000)));
        yield* ceder();
      }
      hw.avanzar(300);
      return (hw.t - ti) * 0.017;
    };
    return { $tipo: 'HCSR04', $get_distance: medir, dist_cm: medir, deinit() { soltarPin(trig); soltarPin(eco); return null; } };
  }
  const hcsr04 = modulo('hcsr04', { HCSR04: (trig, eco, ...a) => { const kw = a.pop() || {}; return Sonar(kw.trigger_pin || trig, kw.echo_pin || eco, (kw.timeout || 0.1) * 1e6, 'HCSR04'); } });
  hcsr04.HCSR04.$conKw = true;
  const adafruit_hcsr04 = modulo('adafruit_hcsr04', { HCSR04: (trig, eco, ...a) => { const kw = a.pop() || {}; return Sonar(kw.trigger_pin || trig, kw.echo_pin || eco, (kw.timeout || 0.1) * 1e6, 'HCSR04'); } });
  adafruit_hcsr04.HCSR04.$conKw = true;
  function I2C() {
    return {
      $tipo: 'I2C', try_lock: () => true, unlock: () => null, deinit: () => null,
      scan() { hw.avanzar(3000); return hw.op.imuAusente ? [] : [P.imuDir]; },
    };
  }
  const busio = modulo('busio', { I2C: (...a) => I2C() });
  board.I2C = () => I2C(); board.STEMMA_I2C = () => I2C();
  const Rate = { $esModulo: true, $nombre: 'Rate', RATE_SHUTDOWN: 0, RATE_12_5_HZ: 1, RATE_26_HZ: 2, RATE_52_HZ: 3, RATE_104_HZ: 4, RATE_208_HZ: 5,
    RATE_416_HZ: 6, RATE_833_HZ: 7, RATE_1_66K_HZ: 8, RATE_3_33K_HZ: 9, RATE_6_66K_HZ: 10 };
  const AccelRange = { $esModulo: true, $nombre: 'AccelRange', RANGE_2G: 0, RANGE_16G: 1, RANGE_4G: 2, RANGE_8G: 3 };
  const GyroRange = { $esModulo: true, $nombre: 'GyroRange', RANGE_125_DPS: 2, RANGE_250_DPS: 0, RANGE_500_DPS: 4, RANGE_1000_DPS: 8, RANGE_2000_DPS: 12, RANGE_4000_DPS: 1 };
  function IMUpy(nombre) {
    const f = function (i2c, ...a) {
      const kw = a.pop() || {};
      const dir = kw.address !== undefined ? kw.address : (a[0] !== undefined ? a[0] : 0x6A);
      hw.avanzar(COSTO.i2cBegin);
      if (!hw.imuPresente(dir)) throw exc('ValueError', `No I2C device at address: 0x${dir.toString(16)}`);
      const o = {
        $tipo: nombre, rangoA: 2, rangoG: 0, odrA: 4, odrG: 4,
        *leer(cual) {
          hw.avanzar(700);
          yield* ceder();
          hw.tUltActividad = hw.t;
          const M = hw.cuerpo.imu.muestra;
          if (cual === 'a') { const lg = IMU_RANGO_ACC_G[o.rangoA] * G, c = x => clamp(x, -lg, lg); return tupla([c(M.ax), c(M.ay), c(M.az)]); }
          const lw = IMU_RANGO_GIRO_DPS[o.rangoG] * GRAD, c = x => clamp(x, -lw, lw);
          return tupla([c(M.gx), c(M.gy), c(M.gz)]);
        },
        $get_acceleration() { return o.leer('a'); }, $get_gyro() { return o.leer('g'); },
        *$get_temperature() { hw.avanzar(400); yield* ceder(); return 27.5; },
        get accelerometer_range() { return o.rangoA; }, get gyro_range() { return o.rangoG; },
        get accelerometer_data_rate() { return o.odrA; }, get gyro_data_rate() { return o.odrG; },
        $set_accelerometer_range(r) { o.rangoA = r; }, $set_gyro_range(r) { o.rangoG = r; },
        $set_accelerometer_data_rate(r) { o.odrA = r; hw.fijarOdrImu(Math.max(IMU_ODR_HZ[o.odrA] || 0, IMU_ODR_HZ[o.odrG] || 0)); },
        $set_gyro_data_rate(r) { o.odrG = r; hw.fijarOdrImu(Math.max(IMU_ODR_HZ[o.odrA] || 0, IMU_ODR_HZ[o.odrG] || 0)); },
      };
      hw.fijarOdrImu(104);
      return o;
    };
    f.$conKw = true;
    return f;
  }
  const lsm = { lsm6ds3trc: 'LSM6DS3TRC', lsm6ds3: 'LSM6DS3', lsm6dsox: 'LSM6DSOX', lsm6ds33: 'LSM6DS33', ism330dhcx: 'ISM330DHCX' };
  const adafruit_lsm6ds = modulo('adafruit_lsm6ds', { Rate, AccelRange, GyroRange });
  for (const [sub, clase] of Object.entries(lsm)) adafruit_lsm6ds[sub] = modulo('adafruit_lsm6ds.' + sub, { [clase]: IMUpy(clase), Rate, AccelRange, GyroRange });
  const motorMod = modulo('adafruit_motor.motor', {
    FAST_DECAY: 0, SLOW_DECAY: 1,
    DCMotor: (a, b) => {
      let th = 0;
      return {
        $tipo: 'DCMotor', decay_mode: 0, get throttle() { return th; },
        $set_decay_mode(m) { this.decay_mode = m; },
        $set_throttle(x) {
          if (x !== null) { x = num(x, 'throttle', x); if (x < -1 || x > 1) throw exc('ValueError', 'Throttle must be None or between -1.0 and +1.0'); }
          th = x;
          const d = x === null ? 0 : Math.round(Math.abs(x) * 65535);
          if (x === null || x === 0) { a.$set_duty_cycle(0); b.$set_duty_cycle(0); }
          else if (x > 0) { a.$set_duty_cycle(d); b.$set_duty_cycle(0); }
          else { a.$set_duty_cycle(0); b.$set_duty_cycle(d); }
        },
      };
    },
  });
  const adafruit_motor = modulo('adafruit_motor', { motor: motorMod });
  const supervisor = modulo('supervisor', { ticks_ms: () => Math.floor(hw.t / 1000) % 536870912, runtime: { $tipo: 'Runtime', serial_connected: true, usb_connected: true, serial_bytes_available: 0 },
    reload: () => { hw.fallo('supervisor.reload(): el programa se reinicia'); } });
  const gc = modulo('gc', { collect: () => { hw.avanzar(2000); return null; }, mem_free: () => 118000, mem_alloc: () => 42000, enable: () => null, disable: () => null });
  const microcontroller = modulo('microcontroller', { cpu: { $tipo: 'Processor', temperature: 45.5, frequency: 240000000, voltage: 3.3 },
    reset: () => { hw.fallo('microcontroller.reset(): el robot se reinicia'); }, pin: modulo('microcontroller.pin', {}) });
  const sys = modulo('sys', { exit: () => { throw new SalidaPrograma('sys.exit()'); }, platform: 'Espressif ESP32', version: '3.4.0',
    implementation: { $tipo: 'implementation', name: 'circuitpython', version: tupla([9, 2, 1]) }, stdout: { $tipo: 'stdout' },
    print_exception: e => { hw.emitirTexto(`${e.$clase ? e.$clase.$nombre : 'Exception'}: ${str(e)}\n`); return null; } });
  const os = modulo('os', { getenv: () => null, listdir: () => ['code.py', 'lib', 'boot_out.txt'], uname: () => tupla(['esp32', 'esp32', '9.2.1', '9.2.1', 'IdeaBoard']) });
  const digitalio = modulo('digitalio', { DigitalInOut, Direction, Pull, DriveMode });
  const analogio = modulo('analogio', { AnalogIn, AnalogOut: () => { throw exc('ValueError', 'el ESP32 del kit no tiene AnalogOut en esos pines'); } });
  const pwmio = modulo('pwmio', { PWMOut });
  const ideaboard = modulo('ideaboard', { IdeaBoard });
  const MODULOS = { board, digitalio, analogio, pwmio, time, random, math, keypad, neopixel, ideaboard, hcsr04, adafruit_hcsr04, busio,
    adafruit_lsm6ds, adafruit_motor, 'adafruit_motor.motor': motorMod, supervisor, gc, microcontroller, sys, os };
  for (const sub of Object.keys(lsm)) MODULOS['adafruit_lsm6ds.' + sub] = adafruit_lsm6ds[sub];
  function importar(nombre, raiz) {
    hw.avanzar(3000);
    const m = MODULOS[nombre];
    if (!m) throw exc('ImportError', `no module named '${nombre}'`);
    return raiz ? MODULOS[nombre.split('.')[0]] : m;
  }
  function desde(nombre, n) {
    const m = importar(nombre, false);
    if (m[n] === undefined) {
      if (MODULOS[nombre + '.' + n]) return MODULOS[nombre + '.' + n];
      throw exc('ImportError', `cannot import name '${n}' from '${nombre}'`);
    }
    return m[n];
  }

  // ─────────────── excepciones y arranque ───────────────
  function aPython(x) {
    if (x instanceof FalloPrograma || x instanceof SalidaPrograma) throw x;
    if (x && x.$esInstancia) return x;
    const m = String(x && x.message || x);
    let tipo = 'RuntimeError';
    if (x instanceof RangeError && /call stack/i.test(m)) tipo = 'RecursionError';
    else if (x instanceof TypeError) tipo = 'TypeError';
    else if (x instanceof ReferenceError) tipo = 'NameError';
    const e = exc(tipo, m);
    e.$pila = x && x.stack;
    return e;
  }
  function coincide(e, T) {
    if (T instanceof Tupla || Array.isArray(T)) return T.some(t => coincide(e, t));
    if (!T || !T.$esClase) throw exc('TypeError', 'catching classes that do not inherit from BaseException is not allowed');
    return esInstancia(e, T);
  }
  function* lanzar(e) {
    if (e && e.$esClase) { if (!BaseException.prototype.isPrototypeOf(e.prototype)) throw exc('TypeError', 'exceptions must derive from BaseException'); e = yield* nuevo(e, [], null); }
    if (!esInstancia(e, BaseException)) throw exc('TypeError', 'exceptions must derive from BaseException');
    e.$pila = new Error().stack;
    return e;
  }
  function noDefinido(n) { throw exc('NameError', `name '${n}' is not defined`); }
  function* conducir(mod) {
    yield* esperar(1000000);           // arranque de CircuitPython hasta code.py (~1 s)
    try {
      yield* mod.principal();
      hw.emitirTexto('\nCode done running.\n');
    } catch (x) {
      if (x instanceof SalidaPrograma) { hw.emitirTexto('\nCode done running.\n'); }
      else {
        const e = x && x.$esInstancia ? x : aPython(x);
        const nombre = e.$clase ? e.$clase.$nombre : 'Error';
        hw.emitirTexto(`Traceback (most recent call last):\n${nombre}: ${str(e)}\n\nCode done running.\n`);
        const f = new FalloPrograma(`${nombre}: ${str(e)}`);
        f.$pila = e.$pila;
        f.stack = e.$pila || f.stack;
        throw f;
      }
    }
    // al terminar code.py, CircuitPython suelta los pines: los motores se paran
    hw.fijarMotoresPrograma(0, 0);
  }
  // Valores de las variables para la pantalla.
  function vista(o) {
    const r = {};
    for (const [k, x] of Object.entries(o)) {
      if (x === undefined || typeof x === 'function' || (x && (x.$esModulo || x.$esClase || x.$tipo))) continue;
      r[k] = aVista(x, 0);
    }
    return r;
  }
  function aVista(x, prof) {
    if (x === null || typeof x !== 'object') return x;
    if (prof > 3) return '…';
    if (Array.isArray(x)) return x.slice(0, 32).map(y => aVista(y, prof + 1));
    if (x instanceof Dict) { const r = {}; for (const [k, w] of itemsDict(x)) r[str(k)] = aVista(w, prof + 1); return r; }
    if (x.$esInstancia) { const r = { $clase: x.$clase.$nombre }; for (const k of Object.keys(x)) if (!k.startsWith('$')) r[k] = aVista(x[k], prof + 1); return r; }
    return repr(x);
  }
  const rt = {
    $t: us => { hw.t += us; hw.ticks = 0; return hw.t >= hw.limite; },
    $v: v, $B: B, $BR: BR, $noDefinido: noDefinido, $Ellipsis: Ellipsis,
    $tupla: tupla, $set: it => new PySet(it), $dict: pares => new Dict(pares),
    $dictMezcla: partes => { const d = new Dict(); for (const p of partes) { if (Array.isArray(p)) d.set(p[0], p[1]); else for (const [k, w] of itemsDict(p.d)) d.set(k, w); } return d; },
    $kwMezcla: partes => { const r = {}; for (const p of partes) { if (Array.isArray(p)) r[p[0]] = p[1]; else if (p.d instanceof Dict) for (const [k, w] of itemsDict(p.d)) r[k] = w; } return r; },
    $leer: leer, $leerG: leerG, $escribir: escribir, $borrarAttr: borrarAttr, $item: item, $ponerItem: ponerItem, $borrarItem: borrarItem,
    $cortar: cortar, $ponerCorte: ponerCorte, $slice: slice, $iter: iter, $desempaquetar: desempaquetar, $desempaquetarEstrella: desempaquetarEstrella,
    $eq: eq, $lt: lt, $le: le, $en: en, $es: es,
    $add: add, $sub: sub, $mul: mul, $div: div, $fdiv: fdiv, $mod: mod, $pow: pow, $lsh: lsh, $rsh: rsh, $band: band, $bor: bor, $bxor: bxor, $matmul: matmul,
    $iadd: iadd, $isub: sub, $imul: imul, $idiv: div, $ifdiv: fdiv, $imod: mod, $ipow: pow, $ilsh: lsh, $irsh: rsh, $iband: band, $ibor: bor, $ibxor: bxor, $imatmul: matmul,
    $neg: neg, $pos: pos, $inv: inv,
    $str: str, $formatoF: formatoF,
    $llamar: llamar, $metodo: metodo, $super: superMetodo, $funcion: funcion, $clase: clase, $estatico: estatico, $declase: declase, $propiedad: propiedad,
    $exc: exc, $lanzar: lanzar, $aPython: aPython, $coincide: coincide,
    $importar: importar, $desde: desde,
    conducir, vista,
  };
  return rt;
}
