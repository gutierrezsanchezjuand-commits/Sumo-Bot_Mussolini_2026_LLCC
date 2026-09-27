
/* ==========================================================================
   TRADUCTOR DE ARDUINO: el .ino (C++ del IDE) a JavaScript con generadores.
   Trabaja como un compilador chico, en tres pasos:
     1. Preprocesador: comentarios, #define (con argumentos, # y ##), #if,
        #ifdef, #elif, #include "archivo.h" entre los archivos cargados.
     2. Parser: declaraciones, funciones, struct, enum y sentencias de C++
        (lo que usa un programa de Arduino; sin clases propias ni plantillas).
     3. Generador: respeta los tipos de C (division entera, truncado al
        asignar a un int, desborde de byte, String de Arduino, char) y
        convierte en function* toda funcion que espera tiempo (delay,
        lecturas, bucles): asi el simulador puede pausar el programa en
        cualquier punto sin cambiar su logica.
   El resultado es el texto de una funcion (api) -> { setup, loop, ... }.
   ========================================================================== */

class ErrorTraduccion extends Error {
  constructor(msg, linea, archivo) { super(msg); this.linea = linea; this.archivo = archivo; }
}

// ─────────────────────────── léxico ───────────────────────────
const TA_PUNT3 = new Set(['>>=', '<<=', '...', '->*']);
const TA_PUNT2 = new Set(['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=',
  '%=', '&=', '|=', '^=', '::', '##']);

function taQuitarComentarios(txt) {
  let out = '', i = 0;
  const n = txt.length;
  while (i < n) {
    const c = txt[i], d = txt[i + 1];
    if (c === '/' && d === '/') { while (i < n && txt[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2; out += ' ';
      while (i < n && !(txt[i] === '*' && txt[i + 1] === '/')) { if (txt[i] === '\n') out += '\n'; i++; }
      i += 2; continue;
    }
    if (c === '"' || (c === "'" && !/[0-9A-Fa-f]/.test(txt[i - 1] || '') )) {
      const q = c; out += c; i++;
      while (i < n && txt[i] !== q && txt[i] !== '\n') {
        if (txt[i] === '\\' && i + 1 < n) { out += txt[i] + txt[i + 1]; i += 2; continue; }
        out += txt[i]; i++;
      }
      if (i < n && txt[i] === q) { out += q; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// Lineas logicas: une las que terminan en '\' y guarda el numero de la primera.
function taLineas(txt) {
  const fis = txt.split('\n');
  const res = [];
  for (let i = 0; i < fis.length; i++) {
    let s = fis[i].replace(/\r$/, ''), n0 = i + 1;
    while (/\\\s*$/.test(s) && i + 1 < fis.length) { s = s.replace(/\\\s*$/, ' ') + fis[++i].replace(/\r$/, ''); }
    res.push({ s, n: n0 });
  }
  return res;
}

function taEscape(s, i) {
  const c = s[i];
  const simples = { n: 10, t: 9, r: 13, '0': 0, a: 7, b: 8, f: 12, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63, e: 27 };
  if (c === 'x') {
    let j = i + 1, h = '';
    while (j < s.length && /[0-9A-Fa-f]/.test(s[j])) h += s[j++];
    return { cod: parseInt(h || '0', 16), fin: j };
  }
  if (/[0-7]/.test(c)) {
    let j = i, o = '';
    while (j < s.length && o.length < 3 && /[0-7]/.test(s[j])) o += s[j++];
    return { cod: parseInt(o, 8), fin: j };
  }
  if (c in simples) return { cod: simples[c], fin: i + 1 };
  return { cod: c.charCodeAt(0), fin: i + 1 };
}

function taNumero(txt, linea, archivo) {
  let s = txt.replace(/'/g, '');
  let m;
  if ((m = /^0[xX]([0-9A-Fa-f]+)([uUlL]*)$/.exec(s))) {
    const v = parseInt(m[1], 16), suf = m[2].toLowerCase();
    const u = suf.includes('u') || v > 0x7FFFFFFF;
    return { v, tipo: suf.includes('ll') ? (u ? 'u64' : 'i64') : (u ? 'u32' : 'i32') };
  }
  if ((m = /^0[bB]([01]+)([uUlL]*)$/.exec(s))) {
    const v = parseInt(m[1], 2), suf = m[2].toLowerCase();
    return { v, tipo: (suf.includes('u') || v > 0x7FFFFFFF) ? 'u32' : 'i32' };
  }
  if ((m = /^([0-9]*\.[0-9]*(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+)([fFlL]?)$/.exec(s))) {
    return { v: parseFloat(m[1]), tipo: /[fF]/.test(m[2]) ? 'f32' : 'f64' };
  }
  if ((m = /^([0-9]+)([uUlL]*)$/.exec(s))) {
    const oct = m[1].length > 1 && m[1][0] === '0';
    const v = oct ? parseInt(m[1], 8) : parseInt(m[1], 10), suf = m[2].toLowerCase();
    const u = suf.includes('u');
    return { v, tipo: suf.includes('ll') ? (u ? 'u64' : 'i64') : (u || v > 0x7FFFFFFF ? 'u32' : 'i32') };
  }
  throw new ErrorTraduccion(`numero invalido: ${txt}`, linea, archivo);
}

function taTokenizar(s, linea, archivo) {
  const toks = [];
  let i = 0, ws = true;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; ws = true; continue; }
    const base = { linea, archivo, ws };
    ws = false;
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(s[j])) j++;
      const v = s.slice(i, j);
      if ((v === 'L' || v === 'u8' || v === 'u' || v === 'U') && (s[j] === '"' || s[j] === "'")) { i = j; continue; }
      if (v === 'R' && s[j] === '"') throw new ErrorTraduccion('los textos crudos R"(...)" no estan soportados', linea, archivo);
      toks.push(Object.assign({ t: 'id', v, raw: v }, base));
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i + 1;
      const hex = /^0[xX]/.test(s.slice(i, i + 2));
      while (j < n) {
        const d = s[j];
        if (/[0-9A-Za-z_.]/.test(d)) { j++; continue; }
        if (d === "'" && /[0-9A-Fa-f]/.test(s[j + 1] || '')) { j++; continue; }
        if ((d === '+' || d === '-') && !hex && /[eE]/.test(s[j - 1])) { j++; continue; }
        break;
      }
      const raw = s.slice(i, j);
      toks.push(Object.assign({ t: 'num', raw }, base, taNumero(raw, linea, archivo)));
      i = j; continue;
    }
    if (c === '"') {
      let j = i + 1, v = '';
      while (j < n && s[j] !== '"') {
        if (s[j] === '\\') { const e = taEscape(s, j + 1); v += String.fromCharCode(e.cod); j = e.fin; continue; }
        v += s[j]; j++;
      }
      if (j >= n) throw new ErrorTraduccion('texto sin cerrar (falta ")', linea, archivo);
      toks.push(Object.assign({ t: 'str', v, raw: s.slice(i, j + 1) }, base));
      i = j + 1; continue;
    }
    if (c === "'") {
      let j = i + 1, cod = 0, cuenta = 0;
      while (j < n && s[j] !== "'") {
        if (s[j] === '\\') { const e = taEscape(s, j + 1); cod = (cod << 8) | e.cod; j = e.fin; }
        else { cod = (cod << 8) | s.charCodeAt(j); j++; }
        cuenta++;
      }
      if (j >= n) throw new ErrorTraduccion("caracter sin cerrar (falta ')", linea, archivo);
      toks.push(Object.assign({ t: 'chr', v: cod, raw: s.slice(i, j + 1), multi: cuenta > 1 }, base));
      i = j + 1; continue;
    }
    const t3 = s.slice(i, i + 3), t2 = s.slice(i, i + 2);
    let op = TA_PUNT3.has(t3) ? t3 : (TA_PUNT2.has(t2) ? t2 : c);
    toks.push(Object.assign({ t: 'op', v: op, raw: op }, base));
    i += op.length;
  }
  return toks;
}

// ─────────────────────────── preprocesador ───────────────────────────
// Macros que el IDE define para un ESP32 (core 3.x).
const TA_PREDEF = {
  ARDUINO: '10607', ESP32: '1', ARDUINO_ARCH_ESP32: '1', ARDUINO_ESP32_DEV: '1', CONFIG_IDF_TARGET_ESP32: '1',
  ESP_ARDUINO_VERSION_MAJOR: '3', ESP_ARDUINO_VERSION_MINOR: '3', ESP_ARDUINO_VERSION_PATCH: '0',
  ESP_ARDUINO_VERSION: '((3 << 16) | (3 << 8) | 0)', __cplusplus: '201703L', __GNUC__: '12',
  'ESP_ARDUINO_VERSION_VAL(major, minor, patch)': '((major << 16) | (minor << 8) | (patch))',
};

class TAPreprocesador {
  constructor(archivos, defines) {
    this.archivos = archivos;       // [{ nombre, texto }]
    this.macros = new Map();
    this.avisos = [];
    this.incluidos = new Set();
    this.librerias = [];
    for (const [k, v] of Object.entries(TA_PREDEF)) this.definirTexto(k, v);
    for (const [k, v] of Object.entries(defines || {})) this.definirTexto(k, String(v));
  }
  definirTexto(cabeza, cuerpo) {
    const toks = taTokenizar('#define ' + cabeza + ' ' + cuerpo, 0, '(interno)');
    this.definir(toks.slice(2), 0, '(interno)');
  }
  // toks: lo que sigue a "#define"
  definir(toks, linea, archivo) {
    if (!toks.length || toks[0].t !== 'id') throw new ErrorTraduccion('#define sin nombre', linea, archivo);
    const nombre = toks[0].v;
    let i = 1, params = null, variadic = false;
    if (toks[1] && toks[1].t === 'op' && toks[1].v === '(' && !toks[1].ws) {
      params = []; i = 2;
      while (i < toks.length && !(toks[i].t === 'op' && toks[i].v === ')')) {
        const t = toks[i];
        if (t.t === 'id') params.push(t.v);
        else if (t.t === 'op' && t.v === '...') { params.push('__VA_ARGS__'); variadic = true; }
        else if (!(t.t === 'op' && t.v === ',')) throw new ErrorTraduccion(`parametro raro en la macro ${nombre}`, linea, archivo);
        i++;
      }
      i++;
    }
    this.macros.set(nombre, { nombre, params, variadic, cuerpo: toks.slice(i).map(t => Object.assign({}, t)) });
  }
  procesar() {
    if (!this.archivos.length) throw new ErrorTraduccion('no hay ningun archivo para traducir', 0, '');
    const salida = [];
    const principales = this.archivos.filter(a => /\.(ino|pde)$/i.test(a.nombre));
    let lista = principales.length ? principales : this.archivos.filter(a => /\.(cpp|c)$/i.test(a.nombre));
    if (!lista.length) lista = this.archivos.filter(a => !/\.(h|hpp)$/i.test(a.nombre));   // archivos sin extension
    if (!lista.length) throw new ErrorTraduccion('falta el archivo .ino principal', 0, '');
    for (const a of lista) this.procesarArchivo(a, salida, 0);
    for (const a of this.archivos) if (/\.(cpp|c)$/i.test(a.nombre) && principales.length) this.procesarArchivo(a, salida, 0);
    return salida;
  }
  buscarArchivo(nombre) {
    const base = nombre.split(/[\\/]/).pop().toLowerCase();
    return this.archivos.find(a => a.nombre.split(/[\\/]/).pop().toLowerCase() === base);
  }
  procesarArchivo(arch, salida, prof) {
    if (prof > 20) throw new ErrorTraduccion('#include demasiado anidado', 0, arch.nombre);
    this.incluidos.add(arch.nombre);
    const lineas = taLineas(taQuitarComentarios(arch.texto));
    const pila = [];            // { activo, tomado, padre }
    let activo = true, buf = [];
    const volcar = () => { if (buf.length) { for (const t of this.expandir(buf)) salida.push(t); buf = []; } };
    for (const L of lineas) {
      const m = /^\s*#\s*(\w*)(.*)$/.exec(L.s);
      if (!m) {
        if (activo) for (const t of taTokenizar(L.s, L.n, arch.nombre)) buf.push(t);
        continue;
      }
      volcar();
      const dir = m[1], resto = m[2];
      const toks = () => taTokenizar(resto, L.n, arch.nombre);
      switch (dir) {
        case 'if': case 'ifdef': case 'ifndef': {
          const padre = activo;
          let c = false;
          if (padre) {
            if (dir === 'if') c = this.evaluarCondicion(toks(), L.n, arch.nombre);
            else { const t = toks()[0]; c = !!t && this.macros.has(t.v); if (dir === 'ifndef') c = !c; }
          }
          pila.push({ activo, tomado: c, padre });
          activo = padre && c;
          break;
        }
        case 'elif': {
          const p = pila[pila.length - 1];
          if (!p) throw new ErrorTraduccion('#elif sin #if', L.n, arch.nombre);
          if (!p.padre || p.tomado) activo = false;
          else { const c = this.evaluarCondicion(toks(), L.n, arch.nombre); activo = c; if (c) p.tomado = true; }
          break;
        }
        case 'else': {
          const p = pila[pila.length - 1];
          if (!p) throw new ErrorTraduccion('#else sin #if', L.n, arch.nombre);
          activo = p.padre && !p.tomado; p.tomado = true;
          break;
        }
        case 'endif': {
          const p = pila.pop();
          if (!p) throw new ErrorTraduccion('#endif sin #if', L.n, arch.nombre);
          activo = p.activo;
          break;
        }
        default:
          if (!activo) break;
          if (dir === 'define') this.definir(toks(), L.n, arch.nombre);
          else if (dir === 'undef') { const t = toks()[0]; if (t) this.macros.delete(t.v); }
          else if (dir === 'include') {
            const mi = /^\s*[<"]([^>"]+)[>"]/.exec(resto);
            if (!mi) break;
            const inc = this.buscarArchivo(mi[1]);
            if (inc && inc !== arch) { if (!this.incluidos.has(inc.nombre) || !/\.h(pp)?$/i.test(inc.nombre)) this.procesarArchivo(inc, salida, prof + 1); }
            else if (/^\s*"/.test(resto) && !inc) this.avisos.push({ linea: L.n, archivo: arch.nombre, msg: `no se cargo "${mi[1]}": si es un archivo tuyo, agregalo junto al .ino` });
            else this.librerias.push(mi[1]);
          } else if (dir === 'error') throw new ErrorTraduccion('#error' + resto, L.n, arch.nombre);
          else if (dir === 'warning') this.avisos.push({ linea: L.n, archivo: arch.nombre, msg: '#warning' + resto });
          // pragma, line y otras: se ignoran
      }
    }
    volcar();
    if (pila.length) throw new ErrorTraduccion('falta un #endif', lineas.length, arch.nombre);
  }
  evaluarCondicion(toks, linea, archivo) {
    const r = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'id' && t.v === 'defined') {
        let nombre;
        if (toks[i + 1] && toks[i + 1].v === '(') { nombre = toks[i + 2] && toks[i + 2].v; i += 3; }
        else { nombre = toks[i + 1] && toks[i + 1].v; i += 1; }
        r.push({ t: 'num', v: this.macros.has(nombre) ? 1 : 0, raw: '0', linea, archivo });
        continue;
      }
      if (t.t === 'id' && t.v === '__has_include') {   // __has_include(<x>) -> 0
        let p = 0; do { if (toks[i].v === '(') p++; if (toks[i].v === ')') p--; i++; } while (i < toks.length && p > 0); i--;
        r.push({ t: 'num', v: 0, raw: '0', linea, archivo }); continue;
      }
      r.push(t);
    }
    const exp = this.expandir(r).map(t => (t.t === 'id') ? { t: 'num', v: t.v === 'true' ? 1 : 0, raw: '0', linea, archivo } : t);
    return taEvaluarConstante(exp, linea, archivo) !== 0;
  }
  expandir(entrada) {
    const out = [];
    const pila = [];
    for (let i = entrada.length - 1; i >= 0; i--) pila.push(entrada[i]);
    let pasos = 0;
    while (pila.length) {
      if (++pasos > 200000) throw new ErrorTraduccion('macros que se expanden sin fin', entrada[0].linea, entrada[0].archivo);
      const tk = pila.pop();
      if (tk.t !== 'id') { out.push(tk); continue; }
      if (tk.v === '__LINE__') { out.push(Object.assign({}, tk, { t: 'num', v: tk.linea, tipo: 'i32', raw: String(tk.linea) })); continue; }
      if (tk.v === '__FILE__') { out.push(Object.assign({}, tk, { t: 'str', v: tk.archivo, raw: JSON.stringify(tk.archivo) })); continue; }
      const m = this.macros.get(tk.v);
      if (!m || (tk.hs && tk.hs.has(tk.v))) { out.push(tk); continue; }
      const hs = new Set(tk.hs || []); hs.add(tk.v);
      if (!m.params) {
        const cuerpo = this.pegar(m.cuerpo.map(b => Object.assign({}, b, { linea: tk.linea, archivo: tk.archivo, ws: b.ws })), tk);
        for (let i = cuerpo.length - 1; i >= 0; i--) { const b = cuerpo[i]; b.hs = new Set([...(b.hs || []), ...hs]); pila.push(b); }
        continue;
      }
      const sig = pila[pila.length - 1];
      if (!sig || sig.t !== 'op' || sig.v !== '(') { out.push(tk); continue; }
      pila.pop();
      const args = [[]];
      let prof = 0, cerrado = false;
      while (pila.length) {
        const a = pila.pop();
        if (a.t === 'op' && a.v === '(') prof++;
        else if (a.t === 'op' && a.v === ')') { if (prof === 0) { cerrado = true; break; } prof--; }
        else if (a.t === 'op' && a.v === ',' && prof === 0) { args.push([]); continue; }
        args[args.length - 1].push(a);
      }
      if (!cerrado) throw new ErrorTraduccion(`la macro ${tk.v}( no se cierra`, tk.linea, tk.archivo);
      const cuerpo = this.sustituir(m, args, tk);
      for (let i = cuerpo.length - 1; i >= 0; i--) { const b = cuerpo[i]; b.hs = new Set([...(b.hs || []), ...hs]); pila.push(b); }
    }
    return out;
  }
  sustituir(m, args, tk) {
    const P = m.params;
    let act = args;
    if (m.variadic) {
      const fijos = P.length - 1, va = [];
      for (let i = fijos; i < args.length; i++) {
        if (i > fijos) va.push({ t: 'op', v: ',', raw: ',', linea: tk.linea, archivo: tk.archivo, ws: false });
        va.push(...args[i]);
      }
      act = args.slice(0, fijos).concat([va]);
    }
    if (P.length === 0 && act.length === 1 && act[0].length === 0) act = [];
    if (act.length !== P.length) throw new ErrorTraduccion(`la macro ${m.nombre} espera ${P.length} argumentos y recibio ${act.length}`, tk.linea, tk.archivo);
    const cache = new Map();
    const expandido = i => { if (!cache.has(i)) cache.set(i, this.expandir(act[i].map(x => Object.assign({}, x)))); return cache.get(i); };
    const res = [];
    const C = m.cuerpo;
    const donde = x => Object.assign({}, x, { linea: tk.linea, archivo: tk.archivo });
    for (let i = 0; i < C.length; i++) {
      const b = C[i];
      if (b.t === 'op' && b.v === '#' && C[i + 1] && C[i + 1].t === 'id' && P.includes(C[i + 1].v)) {
        const a = act[P.indexOf(C[i + 1].v)];
        const txt = a.map((x, k) => (k > 0 && x.ws ? ' ' : '') + x.raw).join('');
        res.push(donde({ t: 'str', v: txt, raw: JSON.stringify(txt), ws: b.ws }));
        i++; continue;
      }
      if (b.t === 'id' && P.includes(b.v)) {
        const k = P.indexOf(b.v);
        const junto = (C[i - 1] && C[i - 1].v === '##') || (C[i + 1] && C[i + 1].v === '##');
        const toks = junto ? act[k] : expandido(k);
        if (!toks.length && junto) res.push(donde({ t: 'vacio', v: '', raw: '' }));
        toks.forEach((x, j) => res.push(donde(Object.assign({}, x, j === 0 ? { ws: b.ws } : {}))));
        continue;
      }
      res.push(donde(b));
    }
    return this.pegar(res, tk);
  }
  pegar(toks, tk) {
    if (!toks.some(t => t.t === 'op' && t.v === '##')) return toks.filter(t => t.t !== 'vacio');
    const r = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'op' && t.v === '##' && r.length && toks[i + 1]) {
        const izq = r.pop(), der = toks[++i];
        const txt = (izq.raw || '') + (der.raw || '');
        const nuevos = txt ? taTokenizar(txt, tk.linea, tk.archivo) : [];
        nuevos.forEach((x, j) => { if (j === 0) x.ws = izq.ws; r.push(x); });
        continue;
      }
      r.push(t);
    }
    return r.filter(t => t.t !== 'vacio');
  }
}

// Evaluador de constantes para #if (y para tamaños de arreglos).
function taEvaluarConstante(toks, linea, archivo) {
  let i = 0;
  const ver = () => toks[i], sig = () => toks[i++];
  const esOp = v => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
  function primario() {
    const t = sig();
    if (!t) throw new ErrorTraduccion('expresion incompleta en #if', linea, archivo);
    if (t.t === 'num' || t.t === 'chr') return Number(t.v);
    if (t.t === 'op' && t.v === '(') { const v = ternario(); if (!esOp(')')) throw new ErrorTraduccion('falta ) en #if', linea, archivo); sig(); return v; }
    if (t.t === 'op' && t.v === '!') return primario() ? 0 : 1;
    if (t.t === 'op' && t.v === '-') return -primario();
    if (t.t === 'op' && t.v === '+') return +primario();
    if (t.t === 'op' && t.v === '~') return ~primario();
    throw new ErrorTraduccion(`no entiendo '${t.raw}' en la condicion del #if`, linea, archivo);
  }
  function binario(min) {
    let a = primario();
    for (;;) {
      const t = ver();
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < min) return a;
      sig();
      const b = binario(PREC[t.v] + 1);
      switch (t.v) {
        case '||': a = (a || b) ? 1 : 0; break; case '&&': a = (a && b) ? 1 : 0; break;
        case '|': a = a | b; break; case '^': a = a ^ b; break; case '&': a = a & b; break;
        case '==': a = a === b ? 1 : 0; break; case '!=': a = a !== b ? 1 : 0; break;
        case '<': a = a < b ? 1 : 0; break; case '>': a = a > b ? 1 : 0; break;
        case '<=': a = a <= b ? 1 : 0; break; case '>=': a = a >= b ? 1 : 0; break;
        case '<<': a = a << b; break; case '>>': a = a >> b; break;
        case '+': a = a + b; break; case '-': a = a - b; break; case '*': a = a * b; break;
        case '/': a = b ? Math.trunc(a / b) : 0; break; case '%': a = b ? a % b : 0; break;
      }
    }
  }
  function ternario() {
    const c = binario(1);
    if (esOp('?')) { sig(); const a = ternario(); if (!esOp(':')) throw new ErrorTraduccion('falta : en #if', linea, archivo); sig(); const b = ternario(); return c ? a : b; }
    return c;
  }
  const v = ternario();
  if (i < toks.length) throw new ErrorTraduccion(`sobra '${toks[i].raw}' en la condicion del #if`, linea, archivo);
  return v;
}

// ─────────────────────────── tipos ───────────────────────────
// Tipos escalares: 'bool','char','i8','u8','i16','u16','i32','u32','i64','u64','f32','f64',
// 'String' (de Arduino), 'cstr' (const char*), 'void', 'null'. Compuestos:
// { n:'arr', e, len }, { n:'struct', s }, { n:'obj', c }, { n:'ptr', e }, { n:'fn' }.
const TA_T = s => ({ n: s });
const TA_ENTEROS = new Set(['bool', 'char', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64']);
const TA_TAMANO = { bool: 1, char: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4, f64: 8, String: 12, cstr: 4, ptr: 4, obj: 4, null: 4 };
const taEsEntero = t => !!t && TA_ENTEROS.has(t.n);
const taEsFlot = t => !!t && (t.n === 'f32' || t.n === 'f64');
const taEsNum = t => taEsEntero(t) || taEsFlot(t);
const taEsTexto = t => !!t && (t.n === 'String' || t.n === 'cstr');
const taEsArr = t => !!t && t.n === 'arr';
const TA_ARREGLO_JS = { bool: 'Uint8Array', char: 'Int8Array', i8: 'Int8Array', u8: 'Uint8Array', i16: 'Int16Array', u16: 'Uint16Array',
  i32: 'Int32Array', u32: 'Uint32Array', i64: 'Float64Array', u64: 'Float64Array', f32: 'Float32Array', f64: 'Float64Array' };
function taNombreTipo(t) {
  if (!t) return '?';
  const N = { bool: 'bool', char: 'char', i8: 'int8_t', u8: 'byte', i16: 'int16_t', u16: 'uint16_t', i32: 'int', u32: 'unsigned long',
    i64: 'long long', u64: 'unsigned long long', f32: 'float', f64: 'double', String: 'String', cstr: 'const char*', void: 'void' };
  if (N[t.n]) return N[t.n];
  if (t.n === 'arr') return taNombreTipo(t.e) + '[]';
  if (t.n === 'struct') return t.s;
  if (t.n === 'obj') return t.c;
  if (t.n === 'ptr') return taNombreTipo(t.e) + '*';
  return t.n;
}
// Conversiones aritmeticas usuales (en el ESP32 int y long son de 32 bits).
function taAritmetico(a, b) {
  if (!taEsNum(a)) return b && taEsNum(b) ? b : TA_T('i32');
  if (!taEsNum(b)) return a;
  if (a.n === 'f64' || b.n === 'f64') return TA_T('f64');
  if (a.n === 'f32' || b.n === 'f32') return TA_T('f32');
  if (a.n === 'u64' || b.n === 'u64') return TA_T('u64');
  if (a.n === 'i64' || b.n === 'i64') return TA_T('i64');
  if (a.n === 'u32' || b.n === 'u32') return TA_T('u32');
  return TA_T('i32');
}
function taPromovido(a) { return taEsFlot(a) || a.n === 'u32' || a.n === 'i64' || a.n === 'u64' ? a : TA_T('i32'); }

// ─────────────────────────── API conocida ───────────────────────────
// [tipo que devuelve, bloquea (espera tiempo -> generador)]. 'arit' = el de
// los argumentos. La implementacion esta en api_arduino.js.
const TA_FUNCIONES = {
  millis: ['u32'], micros: ['u32'], delay: ['void', 1], delayMicroseconds: ['void', 1], yield: ['void', 1],
  pinMode: ['void'], digitalWrite: ['void', 1], digitalRead: ['i32', 1], analogRead: ['u16', 1], analogReadMilliVolts: ['u32', 1],
  analogReadResolution: ['void'], analogSetAttenuation: ['void'], analogSetPinAttenuation: ['void'], analogSetWidth: ['void'],
  analogWrite: ['void', 1], analogWriteResolution: ['void'], analogWriteFrequency: ['void'],
  pulseIn: ['u32', 1], pulseInLong: ['u32', 1],
  ledcSetup: ['u32'], ledcAttachPin: ['void'], ledcDetachPin: ['void'], ledcAttach: ['bool'], ledcAttachChannel: ['bool'],
  ledcDetach: ['bool'], ledcWrite: ['bool', 1], ledcRead: ['u32'], ledcReadFreq: ['u32'], ledcWriteTone: ['u32'], ledcWriteNote: ['u32'],
  ledcChangeFrequency: ['u32'], ledcOutputInvert: ['bool'], ledcFade: ['bool'],
  neopixelWrite: ['void', 1], rgbLedWrite: ['void', 1], tone: ['void'], noTone: ['void'],
  min: ['arit'], max: ['arit'], abs: ['arit'], constrain: ['arit'], sq: ['arit'], map: ['i32'],
  round: ['f64'], floor: ['f64'], ceil: ['f64'], trunc: ['f64'], fabs: ['f64'], sqrt: ['f64'], pow: ['f64'], exp: ['f64'], log: ['f64'],
  log10: ['f64'], log2: ['f64'], sin: ['f64'], cos: ['f64'], tan: ['f64'], asin: ['f64'], acos: ['f64'], atan: ['f64'], atan2: ['f64'],
  sinh: ['f64'], cosh: ['f64'], tanh: ['f64'], fmod: ['f64'], fmin: ['f64'], fmax: ['f64'], hypot: ['f64'], cbrt: ['f64'],
  roundf: ['f32'], floorf: ['f32'], ceilf: ['f32'], fabsf: ['f32'], sqrtf: ['f32'], powf: ['f32'], sinf: ['f32'], cosf: ['f32'],
  atan2f: ['f32'], fmodf: ['f32'], fminf: ['f32'], fmaxf: ['f32'], lround: ['i32'], lroundf: ['i32'],
  isnan: ['bool'], isinf: ['bool'], radians: ['f64'], degrees: ['f64'],
  random: ['i32'], randomSeed: ['void'], esp_random: ['u32'],
  bitRead: ['i32'], bit: ['u32'], lowByte: ['u8'], highByte: ['u8'],
  isDigit: ['bool'], isAlpha: ['bool'], isAlphaNumeric: ['bool'], isSpace: ['bool'], isUpperCase: ['bool'], isLowerCase: ['bool'],
  isPunct: ['bool'], isHexadecimalDigit: ['bool'], isPrintable: ['bool'], isWhitespace: ['bool'], isAscii: ['bool'], isControl: ['bool'],
  toupper: ['char'], tolower: ['char'], toUpperCase: ['char'], toLowerCase: ['char'],
  esp_timer_get_time: ['i64'], vTaskDelay: ['void', 1], temperatureRead: ['f32'], hallRead: ['i32', 1], touchRead: ['u16', 1],
  interrupts: ['void'], noInterrupts: ['void'], digitalPinToInterrupt: ['i32'], attachInterrupt: ['void'], detachInterrupt: ['void'],
  atoi: ['i32'], atol: ['i32'], atof: ['f64'], strlen: ['u32'], strcmp: ['i32'], strncmp: ['i32'], strcasecmp: ['i32'],
  xTaskGetTickCount: ['u32'], esp_restart: ['void'], abort: ['void'],
  F: ['cstr'], PSTR: ['cstr'], sprintf: ['i32'], snprintf: ['i32'], dtostrf: ['cstr'], strcpy: ['cstr'], strncpy: ['cstr'],
  strcat: ['cstr'], itoa: ['cstr'], ltoa: ['cstr'], utoa: ['cstr'], bitSet: ['i32'], bitClear: ['i32'], bitWrite: ['i32'],
  memset: ['void'], memcpy: ['void'],
};
// Metodos por clase (Serial, Wire y las librerias de sensores del kit).
const TA_METODOS = {
  Serial: { begin: ['void'], end: ['void'], print: ['u32', 1], println: ['u32', 1], printf: ['u32', 1], write: ['u32', 1],
    available: ['i32'], read: ['i32'], peek: ['i32'], flush: ['void', 1], setTimeout: ['void'], readString: ['String'],
    readStringUntil: ['String'], parseInt: ['i32'], parseFloat: ['f32'], availableForWrite: ['i32'], setDebugOutput: ['void'],
    setTxBufferSize: ['u32'], setRxBufferSize: ['u32'], updateBaudRate: ['void'], find: ['bool'], readBytes: ['u32'] },
  Wire: { begin: ['bool'], end: ['bool'], setClock: ['bool'], setTimeOut: ['void'], setTimeout: ['void'], getClock: ['u32'],
    beginTransmission: ['void'], write: ['u32'], endTransmission: ['u8', 1], requestFrom: ['u8', 1], read: ['i32'], available: ['i32'], peek: ['i32'] },
  ESP: { restart: ['void'], getFreeHeap: ['u32'], getHeapSize: ['u32'], getChipModel: ['cstr'], getChipRevision: ['u8'],
    getCpuFreqMHz: ['u32'], getSketchSize: ['u32'], getFlashChipSize: ['u32'], getEfuseMac: ['u64'], getMinFreeHeap: ['u32'], getChipCores: ['u8'] },
  Adafruit_NeoPixel: { begin: ['bool'], show: ['void', 1], setPixelColor: ['void'], Color: ['u32'], clear: ['void'], setBrightness: ['void'],
    getBrightness: ['u8'], fill: ['void'], numPixels: ['u16'], getPixelColor: ['u32'], ColorHSV: ['u32'], gamma32: ['u32'], gamma8: ['u8'],
    canShow: ['bool'], updateLength: ['void'], setPin: ['void'], updateType: ['void'], sine8: ['u8'] },
  LSM6DS: { begin_I2C: ['bool', 1], begin_SPI: ['bool', 1], begin: ['bool', 1], getEvent: ['bool', 1], setAccelRange: ['void', 1],
    setGyroRange: ['void', 1], setAccelDataRate: ['void', 1], setGyroDataRate: ['void', 1], getAccelRange: ['i32'], getGyroRange: ['i32'],
    getAccelDataRate: ['i32'], getGyroDataRate: ['i32'], reset: ['void', 1], configInt1: ['void'], configInt2: ['void'],
    setFilterBandwidth: ['void'], setAccelerometerRange: ['void', 1], setGyroscopeRange: ['void', 1],
    getAccelerometerRange: ['i32'], getGyroscopeRange: ['i32'], setHighPassFilter: ['void'], getTemperature: ['f32', 1] },
  NewPing: { ping: ['u32', 1], ping_cm: ['u32', 1], ping_in: ['u32', 1], ping_median: ['u32', 1], convert_cm: ['u32'], convert_in: ['u32'] },
  UltraSonicDistanceSensor: { measureDistanceCm: ['f32', 1] },
};
const TA_CLASES = {
  Adafruit_NeoPixel: 'Adafruit_NeoPixel', NewPing: 'NewPing', UltraSonicDistanceSensor: 'UltraSonicDistanceSensor',
  Adafruit_LSM6DS3TRC: 'LSM6DS', Adafruit_LSM6DS33: 'LSM6DS', Adafruit_LSM6DS3: 'LSM6DS', Adafruit_LSM6DSOX: 'LSM6DS',
  Adafruit_LSM6DSO32: 'LSM6DS', Adafruit_LSM6DSL: 'LSM6DS', Adafruit_ISM330DHCX: 'LSM6DS', Adafruit_MPU6050: 'LSM6DS',
};
// Objetos globales de la API (se usan sin declararlos).
const TA_OBJETOS = { Serial: 'Serial', Serial0: 'Serial', Serial1: 'SerialMudo', Serial2: 'SerialMudo', Wire: 'Wire', Wire1: 'Wire', ESP: 'ESP' };
// Constantes: se reemplazan por su valor.
const TA_CONSTANTES = {
  HIGH: [1, 'i32'], LOW: [0, 'i32'], INPUT: [1, 'i32'], OUTPUT: [3, 'i32'], INPUT_PULLUP: [5, 'i32'], INPUT_PULLDOWN: [9, 'i32'],
  OUTPUT_OPEN_DRAIN: [0x13, 'i32'], PULLUP: [4, 'i32'], PULLDOWN: [8, 'i32'], OPEN_DRAIN: [0x10, 'i32'], ANALOG: [0xC0, 'i32'],
  LED_BUILTIN: [2, 'i32'], RGB_BUILTIN: [2, 'i32'], SDA: [21, 'i32'], SCL: [22, 'i32'], MOSI: [23, 'i32'], MISO: [19, 'i32'], SCK: [18, 'i32'], SS: [5, 'i32'],
  A0: [36, 'i32'], A3: [39, 'i32'], A4: [32, 'i32'], A5: [33, 'i32'], A6: [34, 'i32'], A7: [35, 'i32'], A10: [4, 'i32'], A11: [0, 'i32'],
  A12: [2, 'i32'], A13: [15, 'i32'], A14: [13, 'i32'], A15: [12, 'i32'], A16: [14, 'i32'], A17: [27, 'i32'], A18: [25, 'i32'], A19: [26, 'i32'],
  RISING: [1, 'i32'], FALLING: [2, 'i32'], CHANGE: [3, 'i32'], ONLOW: [4, 'i32'], ONHIGH: [5, 'i32'],
  DEC: [10, 'i32'], HEX: [16, 'i32'], OCT: [8, 'i32'], BIN: [2, 'i32'],
  PI: [Math.PI, 'f64'], HALF_PI: [Math.PI / 2, 'f64'], TWO_PI: [Math.PI * 2, 'f64'], DEG_TO_RAD: [Math.PI / 180, 'f64'],
  RAD_TO_DEG: [180 / Math.PI, 'f64'], EULER: [Math.E, 'f64'], M_PI: [Math.PI, 'f64'], M_PI_2: [Math.PI / 2, 'f64'], M_PI_4: [Math.PI / 4, 'f64'],
  M_E: [Math.E, 'f64'], M_SQRT2: [Math.SQRT2, 'f64'], M_2PI: [Math.PI * 2, 'f64'],
  NEO_GRB: [0x52, 'u32'], NEO_RGB: [0x06, 'u32'], NEO_BRG: [0x58, 'u32'], NEO_RBG: [0x09, 'u32'], NEO_GBR: [0xA1, 'u32'], NEO_BGR: [0xA4, 'u32'],
  NEO_GRBW: [0xD8, 'u32'], NEO_RGBW: [0x1B, 'u32'], NEO_KHZ800: [0x0000, 'u32'], NEO_KHZ400: [0x0100, 'u32'],
  LSM6DS_ACCEL_RANGE_2_G: [0, 'i32'], LSM6DS_ACCEL_RANGE_16_G: [1, 'i32'], LSM6DS_ACCEL_RANGE_4_G: [2, 'i32'], LSM6DS_ACCEL_RANGE_8_G: [3, 'i32'],
  LSM6DS_GYRO_RANGE_125_DPS: [0b0010, 'i32'], LSM6DS_GYRO_RANGE_250_DPS: [0, 'i32'], LSM6DS_GYRO_RANGE_500_DPS: [0b0100, 'i32'],
  LSM6DS_GYRO_RANGE_1000_DPS: [0b1000, 'i32'], LSM6DS_GYRO_RANGE_2000_DPS: [0b1100, 'i32'], ISM330DHCX_GYRO_RANGE_4000_DPS: [0b0001, 'i32'],
  LSM6DS_RATE_SHUTDOWN: [0, 'i32'], LSM6DS_RATE_12_5_HZ: [1, 'i32'], LSM6DS_RATE_26_HZ: [2, 'i32'], LSM6DS_RATE_52_HZ: [3, 'i32'],
  LSM6DS_RATE_104_HZ: [4, 'i32'], LSM6DS_RATE_208_HZ: [5, 'i32'], LSM6DS_RATE_416_HZ: [6, 'i32'], LSM6DS_RATE_833_HZ: [7, 'i32'],
  LSM6DS_RATE_1_66K_HZ: [8, 'i32'], LSM6DS_RATE_3_33K_HZ: [9, 'i32'], LSM6DS_RATE_6_66K_HZ: [10, 'i32'],
  MPU6050_RANGE_2_G: [0, 'i32'], MPU6050_RANGE_4_G: [1, 'i32'], MPU6050_RANGE_8_G: [2, 'i32'], MPU6050_RANGE_16_G: [3, 'i32'],
  MPU6050_RANGE_250_DEG: [0, 'i32'], MPU6050_RANGE_500_DEG: [1, 'i32'], MPU6050_RANGE_1000_DEG: [2, 'i32'], MPU6050_RANGE_2000_DEG: [3, 'i32'],
  MPU6050_BAND_260_HZ: [0, 'i32'], MPU6050_BAND_184_HZ: [1, 'i32'], MPU6050_BAND_94_HZ: [2, 'i32'], MPU6050_BAND_44_HZ: [3, 'i32'],
  MPU6050_BAND_21_HZ: [4, 'i32'], MPU6050_BAND_10_HZ: [5, 'i32'], MPU6050_BAND_5_HZ: [6, 'i32'],
  LSM6DS3TRC_CHIP_ID: [0x6A, 'i32'], LSM6DS_I2CADDR_DEFAULT: [0x6A, 'i32'], MPU6050_I2CADDR_DEFAULT: [0x68, 'i32'],
  NO_ECHO: [0, 'u32'], US_ROUNDTRIP_CM: [57, 'u32'], US_ROUNDTRIP_IN: [146, 'u32'], MAX_SENSOR_DISTANCE: [500, 'u32'],
  portTICK_PERIOD_MS: [1, 'u32'], portTICK_RATE_MS: [1, 'u32'], portMAX_DELAY: [0xFFFFFFFF, 'u32'],
  ADC_0db: [0, 'i32'], ADC_2_5db: [1, 'i32'], ADC_6db: [2, 'i32'], ADC_11db: [3, 'i32'], ADC_ATTENDB_MAX: [3, 'i32'],
  INT8_MAX: [127, 'i32'], INT8_MIN: [-128, 'i32'], UINT8_MAX: [255, 'i32'], INT16_MAX: [32767, 'i32'], INT16_MIN: [-32768, 'i32'],
  UINT16_MAX: [65535, 'i32'], INT32_MAX: [2147483647, 'i32'], INT32_MIN: [-2147483648, 'i32'], UINT32_MAX: [4294967295, 'u32'],
  INT_MAX: [2147483647, 'i32'], INT_MIN: [-2147483648, 'i32'], LONG_MAX: [2147483647, 'i32'], LONG_MIN: [-2147483648, 'i32'],
  ULONG_MAX: [4294967295, 'u32'], FLT_MAX: [3.4028234663852886e38, 'f32'], FLT_MIN: [1.1754943508222875e-38, 'f32'], DBL_MAX: [Number.MAX_VALUE, 'f64'],
  FLT_EPSILON: [1.1920928955078125e-7, 'f32'], NAN: [NaN, 'f32'], INFINITY: [Infinity, 'f32'], RAND_MAX: [2147483647, 'i32'],
  SERIAL_8N1: [0x800001c, 'u32'], SENSOR_TYPE_ACCELEROMETER: [1, 'i32'], SENSOR_TYPE_GYROSCOPE: [4, 'i32'],
};
// struct que trae la libreria de sensores (Adafruit Unified Sensor).
const TA_STRUCTS_API = {
  sensors_vec_t: [['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['roll', 'f32'], ['pitch', 'f32'], ['heading', 'f32'], ['status', 'i8']],
  sensors_event_t: [['version', 'i32'], ['sensor_id', 'i32'], ['type', 'i32'], ['timestamp', 'i32'],
    ['acceleration', 'sensors_vec_t'], ['gyro', 'sensors_vec_t'], ['magnetic', 'sensors_vec_t'], ['orientation', 'sensors_vec_t'],
    ['temperature', 'f32'], ['distance', 'f32'], ['light', 'f32'], ['pressure', 'f32'], ['relative_humidity', 'f32'],
    ['current', 'f32'], ['voltage', 'f32']],
};
const TA_RESERVADAS_JS = new Set(['arguments', 'await', 'debugger', 'eval', 'export', 'extends', 'function', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'package', 'var', 'with', 'yield', 'typeof', 'undefined', 'NaN', 'Infinity', 'Object',
  'Array', 'Math', 'Number', 'Symbol', 'JSON', 'Error', 'Boolean', 'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'globalThis', 'console']);
