
// ─────────────────────────── generador de JavaScript ───────────────────────────
const TA_RANGO = { bool: [0, 1], char: [-128, 127], i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535],
  i32: [-2147483648, 2147483647], u32: [0, 4294967295], i64: [-9.2e18, 9.2e18], u64: [0, 1.8e19] };
const TA_MATE = { sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan2', sinh: 'sinh',
  cosh: 'cosh', tanh: 'tanh', sqrt: 'sqrt', pow: 'pow', exp: 'exp', log: 'log', log10: 'log10', log2: 'log2', floor: 'floor',
  ceil: 'ceil', trunc: 'trunc', fabs: 'abs', hypot: 'hypot', cbrt: 'cbrt', fmin: 'min', fmax: 'max', sqrtf: 'sqrt', powf: 'pow',
  sinf: 'sin', cosf: 'cos', atan2f: 'atan2', fabsf: 'abs', floorf: 'floor', ceilf: 'ceil', fminf: 'min', fmaxf: 'max' };
const taSimple = c => /^[A-Za-z_$][\w$]*$/.test(c) || /^-?[0-9.]+(e[+-]?\d+)?$/i.test(c);

class TAGenerador {
  constructor(parser, decls, opciones) {
    this.P = parser;
    this.decls = decls;
    this.op = opciones || {};
    this.errores = [];
    this.avisos = [];
    this.structs = new Map();
    for (const [s, campos] of Object.entries(TA_STRUCTS_API))
      this.structs.set(s, { campos: campos.map(([nombre, t]) => ({ nombre, tipo: TA_STRUCTS_API[t] ? { n: 'struct', s: t } : TA_T(t), init: null })), api: true });
    this.globales = new Map();
    this.funciones = new Map();
    this.apiUsada = new Set();
    this.estaticos = [];
    this.fn = null;
    this.ambitos = [];
    this.usados = new Set();          // nombres de JS ya tomados (para renombrar sin chocar)
    this.structsUsados = new Set();
  }
  // ── utilidades ──
  err(n, msg) { throw new ErrorTraduccion(msg, n && n.L, n && n.A); }
  aviso(n, msg) { if (!this.avisos.some(a => a.linea === (n && n.L) && a.msg === msg)) this.avisos.push({ linea: n && n.L, archivo: n && n.A, msg }); }
  api(nombre) { this.apiUsada.add(nombre); return nombre; }
  jsNombre(nombre, nuevo) {
    if (!nuevo && this.usadosPor.has(nombre)) return this.usadosPor.get(nombre);
    let js = nombre;
    if (nuevo || TA_RESERVADAS_JS.has(js) || js.startsWith('__')) { js = js + '_'; while (this.usados.has(js)) js = js + '_'; }
    this.usados.add(js);
    if (!nuevo) this.usadosPor.set(nombre, js);
    return js;
  }
  temp() {
    const f = this.fn || this.modulo;
    f.temps = (f.temps || 0) + 1;
    return (this.fn ? '__t' : '__g') + f.temps;
  }
  emitir(txt, L) { if (!this.salida) return; this.salida.push('  '.repeat(this.sang) + txt); this.mapa.push(L || this.lineaActual || 0); }

  // ── símbolos ──
  buscar(nombre, n) {
    for (let i = this.ambitos.length - 1; i >= 0; i--) { const s = this.ambitos[i].get(nombre); if (s) return s; }
    const g = this.globales.get(nombre);
    if (g) return g;
    if (this.P.enumValores.has(nombre)) return { clase: 'enum', valor: this.P.enumValores.get(nombre) };
    if (this.funciones.has(nombre)) return { clase: 'funcion', lista: this.funciones.get(nombre), nombre };
    if (TA_CONSTANTES[nombre]) return { clase: 'constante', valor: TA_CONSTANTES[nombre][0], tipo: TA_T(TA_CONSTANTES[nombre][1]) };
    if (TA_OBJETOS[nombre]) return { clase: 'objeto', clase2: TA_OBJETOS[nombre], nombre };
    if (TA_FUNCIONES[nombre]) return { clase: 'apiFuncion', nombre };
    if (this.P.tipos.has(nombre)) this.err(n, `'${nombre}' es un tipo, no un valor`);
    this.err(n, `'${nombre}' no esta declarado (no existe en tu codigo ni en lo que conoce el simulador)`);
  }
  declararLocal(nombre, tipo, extra, n) {
    const amb = this.ambitos[this.ambitos.length - 1];
    const js = this.jsLocal(nombre);
    const s = Object.assign({ clase: 'local', nombre, js, tipo }, extra || {});
    amb.set(nombre, s);
    return s;
  }
  jsLocal(nombre) {
    let js = nombre;
    if (TA_RESERVADAS_JS.has(js) || js.startsWith('__')) js = js + '_';
    return js;
  }
  numJS(v) {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '(-Infinity)';
    return v < 0 ? `(${v})` : String(v);
  }
  valorCero(T) {
    switch (T.n) {
      case 'bool': return 'false';
      case 'String': case 'cstr': return '""';
      case 'ptr': case 'null': return 'null';
      case 'struct': return this.nuevoStruct(T.s);
      default: return '0';
    }
  }
  nuevoStruct(s) { this.structsUsados.add(s); return `__nuevo_${this.jsStruct(s)}()`; }
  jsStruct(s) { return s.replace(/[^\w$]/g, '_'); }
  tamano(T) {
    if (TA_TAMANO[T.n]) return TA_TAMANO[T.n];
    if (T.n === 'struct') { const d = this.structs.get(T.s); return d ? d.campos.reduce((a, c) => a + this.tamano(c.tipo), 0) : 4; }
    if (T.n === 'arr') { const n = T.lenExpr && T.lenExpr.k === 'num' ? T.lenExpr.v : 1; return n * this.tamano(T.e); }
    return 4;
  }
  // ── tipos y conversiones ──
  cabe(S, T) {
    const a = TA_RANGO[S.n], b = TA_RANGO[T.n];
    return a && b && a[0] >= b[0] && a[1] <= b[1];
  }
  envolver(c, T) {
    switch (T.n) {
      case 'i32': return `(${c} | 0)`;
      case 'u32': return `(${c} >>> 0)`;
      case 'i16': return `(${c} << 16 >> 16)`;
      case 'u16': return `(${c} & 65535)`;
      case 'i8': case 'char': return `(${c} << 24 >> 24)`;
      case 'u8': return `(${c} & 255)`;
      case 'i64': case 'u64': return `Math.trunc(${c})`;
    }
    return c;
  }
  convertir(X, T, n) {
    const S = X.t;
    if (!T || T.n === 'void' || T.n === 'auto') return X;
    if (!S) return { c: X.c, t: T };
    if (T.n === 'String') {
      if (S.n === 'String' || S.n === 'cstr') return { c: X.c, t: T };
      if (S.n === 'null') return { c: '""', t: T };
      return { c: this.aTexto(X), t: T };
    }
    if (T.n === 'cstr') return { c: X.c, t: T };
    if (T.n === 'bool') {
      if (S.n === 'bool') return { c: X.c, t: T };
      if (taEsNum(S)) return { c: X.lit ? String(Number(X.c.replace(/[()]/g, '')) !== 0) : `(${X.c} !== 0)`, t: T };
      if (S.n === 'ptr' || S.n === 'null' || S.n === 'cstr') return { c: `(${X.c} != null)`, t: T };
      return { c: `(!!${X.c})`, t: T };
    }
    if (taEsFlot(T)) {
      if (S.n === 'bool') return { c: `(+${X.c})`, t: T };
      if (taEsTexto(S)) this.err(n, `no se puede convertir un texto (${taNombreTipo(S)}) a ${taNombreTipo(T)}: usa .toFloat()`);
      return { c: X.c, t: T };
    }
    if (taEsEntero(T)) {
      if (S.n === 'bool') return { c: X.lit ? (X.c === 'true' ? '1' : '0') : `(+${X.c})`, t: T };
      if (taEsTexto(S)) this.err(n, `no se puede convertir un texto (${taNombreTipo(S)}) a ${taNombreTipo(T)}: usa .toInt()`);
      if (S.n === 'null') return { c: '0', t: T };
      if (taEsFlot(S) || !this.cabe(S, T)) {
        if (X.lit && !taEsFlot(S)) { const v = Number(X.c.replace(/[()]/g, '')); return { c: this.numJS(this.envolverNum(v, T)), t: T, lit: true }; }
        return { c: this.envolver(X.c, T), t: T };
      }
      return { c: X.c, t: T, lit: X.lit };
    }
    return { c: X.c, t: T };
  }
  envolverNum(v, T) {
    switch (T.n) {
      case 'i32': return v | 0; case 'u32': return v >>> 0; case 'i16': return v << 16 >> 16; case 'u16': return v & 65535;
      case 'i8': case 'char': return v << 24 >> 24; case 'u8': return v & 255;
    }
    return Math.trunc(v);
  }
  aTexto(X) {
    const t = X.t;
    if (!t || t.n === 'String' || t.n === 'cstr') return X.c;
    if (t.n === 'char') return `String.fromCharCode(${X.c})`;
    if (t.n === 'bool') return `(${X.c} ? "1" : "0")`;
    if (taEsFlot(t)) return `${this.api('__dtostrf')}(${t.n === 'f32' ? `Math.fround(${X.c})` : X.c}, 4, 2)`;
    if (taEsEntero(t)) return `String(${X.c})`;
    if (t.n === 'null') return '""';
    return `String(${X.c})`;
  }
  // Texto para Serial.print(valor[, formato]) segun el tipo, como Print.cpp.
  formatoPrint(X, fmt) {
    const t = X.t;
    if (!t || t.n === 'String' || t.n === 'cstr') return X.c;
    if (t.n === 'char' && !fmt) return `String.fromCharCode(${X.c})`;
    if (t.n === 'bool') return fmt ? `${this.api('__fi')}(+${X.c}, ${fmt.c})` : `(${X.c} ? "1" : "0")`;
    if (taEsFlot(t)) return `${this.api('__ff')}(${t.n === 'f32' ? `Math.fround(${X.c})` : X.c}, ${fmt ? fmt.c : 2})`;
    if (taEsEntero(t)) return fmt ? `${this.api('__fi')}(${X.c}, ${fmt.c})` : `String(${X.c})`;
    if (t.n === 'null') return '""';
    this.err(null, `Serial.print no sabe imprimir ${taNombreTipo(t)}`);
  }
  unificar(A, B) {
    if (taEsTexto(A.t) || taEsTexto(B.t)) return (A.t.n === 'String' || B.t.n === 'String') ? TA_T('String') : TA_T('cstr');
    if (A.t.n === 'bool' && B.t.n === 'bool') return TA_T('bool');
    if (taEsNum(A.t) && taEsNum(B.t)) return taAritmetico(taPromovido(A.t), taPromovido(B.t));
    if (A.t.n === 'null') return B.t;
    return A.t;
  }
  tipoElem(T) { return T.n === 'arr' || T.n === 'ptr' ? T.e : null; }

  // ── expresiones ──
  expr(e) {
    switch (e.k) {
      case 'num': return { c: this.numJS(e.v), t: e.tipo, lit: true };
      case 'str': return { c: JSON.stringify(e.v), t: TA_T('cstr'), lit: true };
      case 'chr': return { c: String(e.v), t: TA_T('char'), lit: true };
      case 'bool': return { c: e.v ? 'true' : 'false', t: TA_T('bool'), lit: true };
      case 'null': return { c: 'null', t: TA_T('null'), lit: true };
      case 'id': return this.exprId(e);
      case 'scope': {
        const clave = e.a + '::' + e.n;
        if (this.P.enumValores.has(clave)) return { c: this.numJS(this.P.enumValores.get(clave)), t: TA_T('i32'), lit: true };
        this.err(e, `no conozco '${clave}'`);
        break;
      }
      case 'bin': return this.exprBin(e);
      case 'asig': return this.exprAsig(e);
      case 'un': return this.exprUn(e);
      case 'post': return this.incDec(e.a, e.op, true, e);
      case 'tern': {
        const c = this.cond(e.c), A = this.expr(e.a), B = this.expr(e.b);
        const T = this.unificar(A, B);
        const a = this.convertir(A, T, e), b = this.convertir(B, T, e);
        return { c: `(${c} ? ${a.c} : ${b.c})`, t: T };
      }
      case 'llamada': return this.exprLlamada(e);
      case 'idx': return this.exprIdx(e);
      case 'miembro': return this.exprMiembro(e);
      case 'cast': return this.convertir(this.expr(e.a), e.tipo, e);
      case 'fcast': return this.exprFcast(e);
      case 'sizeof': {
        if (e.tipo) return { c: String(this.tamano(e.tipo)), t: TA_T('u32'), lit: true };
        const X = this.expr(e.e);
        if (X.t.n === 'arr') return { c: `(${X.c}.length * ${this.tamano(X.t.e)})`, t: TA_T('u32') };
        if (X.t.n === 'cstr' && X.t.cap) return { c: this.expr(X.t.cap).c, t: TA_T('u32') };
        return { c: String(this.tamano(X.t)), t: TA_T('u32'), lit: true };
      }
      case 'coma': { const a = this.expr(e.a), b = this.expr(e.b); return { c: `(${a.c}, ${b.c})`, t: b.t }; }
      case 'llaves': this.err(e, 'una lista entre llaves { } solo puede ir al declarar una variable');
    }
    this.err(e, 'expresion no soportada');
  }
  exprId(e) {
    const s = this.buscar(e.n, e);
    switch (s.clase) {
      case 'local': case 'global': case 'param': case 'estatico':
        return { c: s.ref ? `${s.js}[0]` : s.js, t: s.tipo, sim: s };
      case 'enum': return { c: this.numJS(s.valor), t: TA_T('i32'), lit: true };
      case 'constante': return { c: this.numJS(s.valor), t: s.tipo, lit: true };
      case 'objeto': return { c: this.api(s.nombre), t: { n: 'obj', c: s.clase2 } };
      case 'funcion': this.err(e, `usar la funcion '${e.n}' como valor (sin llamarla) no esta soportado`); break;
      case 'apiFuncion': this.err(e, `usar '${e.n}' como valor (sin llamarla) no esta soportado`); break;
    }
    this.err(e, `no se puede usar '${e.n}' aca`);
  }
  cond(e) {
    const X = this.expr(e);
    if (X.t.n === 'bool' || taEsNum(X.t)) return X.c;
    if (X.t.n === 'ptr' || X.t.n === 'null') return `(${X.c} != null)`;
    if (X.t.n === 'String') return `true`;
    return `(!!${X.c})`;
  }
  aBool(X) { return X.t.n === 'bool' ? X.c : (taEsNum(X.t) ? `(${X.c} !== 0)` : `(!!${X.c})`); }
  exprBin(e) {
    const op = e.op;
    if (op === '&&' || op === '||') {
      const A = this.expr(e.a), B = this.expr(e.b);
      return { c: `(${this.aBool(A)} ${op} ${this.aBool(B)})`, t: TA_T('bool') };
    }
    return this.operar(op, this.expr(e.a), this.expr(e.b), e);
  }
  operar(op, A, B, e) {
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      if (taEsTexto(A.t) || taEsTexto(B.t)) {
        const ta = A.t.n === 'char' ? `String.fromCharCode(${A.c})` : A.c, tb = B.t.n === 'char' ? `String.fromCharCode(${B.c})` : B.c;
        const js = op === '==' ? '===' : op === '!=' ? '!==' : op;
        return { c: `(${ta} ${js} ${tb})`, t: TA_T('bool') };
      }
      const mezcla = (A.t.n === 'bool') !== (B.t.n === 'bool') || A.t.n === 'null' || B.t.n === 'null' || A.t.n === 'ptr' || B.t.n === 'ptr';
      const js = op === '==' ? (mezcla ? '==' : '===') : op === '!=' ? (mezcla ? '!=' : '!==') : op;
      return { c: `(${A.c} ${js} ${B.c})`, t: TA_T('bool') };
    }
    if (op === '+' && (taEsTexto(A.t) || taEsTexto(B.t))) return this.concatenar(A, B, e);
    if (taEsTexto(A.t) || taEsTexto(B.t)) this.err(e, `no se puede usar '${op}' con un texto`);
    if (!taEsNum(A.t) || !taEsNum(B.t)) this.err(e, `no se puede usar '${op}' con ${taNombreTipo(taEsNum(A.t) ? B.t : A.t)}`);
    const T = taAritmetico(taPromovido(A.t), taPromovido(B.t));
    const u = T.n === 'u32';
    switch (op) {
      case '/':
        if (taEsEntero(T)) return { c: `${this.api('__div')}(${A.c}, ${B.c})`, t: T };
        return { c: `(${A.c} / ${B.c})`, t: T };
      case '%':
        if (taEsEntero(T)) return { c: `${this.api('__mod')}(${A.c}, ${B.c})`, t: T };
        return { c: `(${A.c} % ${B.c})`, t: T };
      case '+': case '-': case '*':
        return { c: u ? `((${A.c} ${op} ${B.c}) >>> 0)` : `(${A.c} ${op} ${B.c})`, t: T };
      case '<<': { const TL = taPromovido(A.t); return { c: TL.n === 'u32' ? `((${A.c} << ${B.c}) >>> 0)` : `(${A.c} << ${B.c})`, t: TL }; }
      case '>>': { const TL = taPromovido(A.t); return { c: TL.n === 'u32' ? `(${A.c} >>> ${B.c})` : `(${A.c} >> ${B.c})`, t: TL }; }
      case '&': case '|': case '^':
        return { c: u ? `((${A.c} ${op} ${B.c}) >>> 0)` : `(${A.c} ${op} ${B.c})`, t: T };
    }
    this.err(e, `operador '${op}' no soportado`);
  }
  concatenar(A, B, e) {
    const cad = x => x.t.n === 'cstr';
    const hayString = A.t.n === 'String' || B.t.n === 'String';
    if (!hayString) {
      if (cad(A) && cad(B)) this.err(e, 'en C++ no se pueden sumar dos textos entre comillas: usa String("...") + ...');
      const [txt, num] = cad(A) ? [A, B] : [B, A];
      if (taEsFlot(num.t)) this.err(e, 'en C++ no se puede sumar un float a un texto entre comillas: usa String("...") + valor');
      this.aviso(e, 'sumar un numero a un texto entre comillas no los une en C++: avanza el puntero del texto (en el robot imprime basura o un pedazo). Usa String("...") + valor');
      return { c: `${txt.c}.substring(${num.c})`, t: TA_T('cstr') };
    }
    return { c: `(${this.aTexto(A)} + ${this.aTexto(B)})`, t: TA_T('String') };
  }
  exprUn(e) {
    switch (e.op) {
      case '!': return { c: `(!${this.cond(e.a)})`, t: TA_T('bool') };
      case '-': case '+': case '~': {
        const A = this.expr(e.a);
        if (!taEsNum(A.t)) this.err(e, `no se puede usar '${e.op}' con ${taNombreTipo(A.t)}`);
        const T = taPromovido(A.t);
        if (e.op === '+') return { c: A.c, t: T, lit: A.lit };
        if (A.lit && e.op === '-') return { c: this.numJS(-Number(A.c.replace(/[()]/g, ''))), t: T, lit: true };
        const c = `(${e.op}${A.c})`;
        return { c: T.n === 'u32' ? `(${c} >>> 0)` : c, t: T };
      }
      case '++': case '--': return this.incDec(e.a, e.op, false, e);
      case '*': {
        const A = this.expr(e.a);
        if (A.t.n === 'ptr') { if (A.t.e.n === 'struct' || A.t.e.n === 'obj') return { c: A.c, t: A.t.e }; return { c: `${A.c}[0]`, t: A.t.e }; }
        if (A.t.n === 'arr') return { c: `${A.c}[0]`, t: A.t.e };
        if (A.t.n === 'cstr') return { c: `${this.api('__charAt')}(${A.c}, 0)`, t: TA_T('char') };
        this.err(e, `'*' sobre algo que no es un puntero (${taNombreTipo(A.t)})`);
        break;
      }
      case '&': {
        const r = this.direccion(e.a);
        return r;
      }
    }
    this.err(e, `operador '${e.op}' no soportado`);
  }
  // &x: los struct, arreglos y objetos ya son referencias; un escalar se envuelve en una "caja" con [0].
  direccion(a) {
    const X = this.expr(a);
    if (['struct', 'arr', 'obj', 'String'].includes(X.t.n)) return { c: X.c, t: { n: 'ptr', e: X.t } };
    if (X.sim && X.sim.ref) return { c: X.sim.js, t: { n: 'ptr', e: X.t } };
    return { c: this.caja(a), t: { n: 'ptr', e: X.t } };
  }
  caja(a) {
    if (a.k === 'id') {
      const s = this.buscar(a.n, a);
      if (!['local', 'global', 'param', 'estatico'].includes(s.clase)) this.err(a, `no se puede tomar la direccion de '${a.n}'`);
      if (s.ref) return s.js;
      return `{ get 0() { return ${s.js}; }, set 0(__v) { ${s.js} = __v; } }`;
    }
    if (a.k === 'idx') {
      const A = this.expr(a.a), I = this.expr(a.i);
      if (A.t.n !== 'arr' && A.t.n !== 'ptr') this.err(a, 'solo se puede pasar por referencia un elemento de un arreglo');
      return `${this.api('__refIdx')}(${A.c}, ${I.c})`;
    }
    if (a.k === 'miembro') {
      const O = this.expr(a.a);
      return `${this.api('__refIdx')}(${O.c}, ${JSON.stringify(a.n)})`;
    }
    if (a.k === 'un' && a.op === '*') return this.expr(a.a).c;
    this.err(a, 'eso no se puede pasar por referencia (tiene que ser una variable)');
  }
  // Destino de una asignacion.
  lvalor(e) {
    switch (e.k) {
      case 'id': {
        const s = this.buscar(e.n, e);
        if (!['local', 'global', 'param', 'estatico'].includes(s.clase)) this.err(e, `no se puede asignar a '${e.n}'`);
        if (s.const && !s.ref) this.err(e, `'${e.n}' es const: no se puede cambiar`);
        const c = s.ref ? `${s.js}[0]` : s.js;
        return { leer: c, t: s.tipo, pre: [], simple: true, sim: s };
      }
      case 'idx': {
        const A = this.expr(e.a), I = this.expr(e.i);
        if (taEsTexto(A.t)) this.err(e, 'cambiar letras sueltas de un texto no esta soportado en el simulador');
        const T = this.tipoElem(A.t);
        if (!T) this.err(e, `no se puede usar [] con ${taNombreTipo(A.t)}`);
        const pre = [];
        let a = A.c, i = I.t.n === 'bool' ? `(+${I.c})` : I.c;
        if (!taSimple(a)) { const t = this.temp(); pre.push(`${t} = ${a}`); a = t; }
        if (!taSimple(i)) { const t = this.temp(); pre.push(`${t} = ${i}`); i = t; }
        const tipado = !!TA_ARREGLO_JS[T.n] && T.n !== 'i64' && T.n !== 'u64' && A.t.n === 'arr';
        return { leer: `${a}[${i}]`, t: T, pre, auto: tipado };
      }
      case 'miembro': {
        const O = this.expr(e.a);
        let t = O.t.n === 'ptr' ? O.t.e : O.t;
        if (t.n !== 'struct') this.err(e, `'${e.n}' no es un campo de ${taNombreTipo(t)}`);
        const campo = this.campo(t, e.n, e);
        const pre = [];
        let o = O.c;
        if (!taSimple(o)) { const tt = this.temp(); pre.push(`${tt} = ${o}`); o = tt; }
        return { leer: `${o}.${e.n}`, t: campo.tipo, pre };
      }
      case 'un':
        if (e.op === '*') {
          const A = this.expr(e.a);
          if (A.t.n === 'ptr' || A.t.n === 'arr') return { leer: `${A.c}[0]`, t: A.t.e, pre: [] };
        }
        break;
    }
    this.err(e, 'a eso no se le puede asignar un valor');
  }
  conPre(pre, c) { return pre.length ? `(${pre.join(', ')}, ${c})` : c; }
  exprAsig(e) {
    const L = this.lvalor(e.a);
    if (e.op === '=') {
      if (e.b.k === 'llaves') {
        if (L.t.n === 'struct') return { c: this.conPre(L.pre, `(${L.leer} = ${this.initStruct(L.t, e.b)})`), t: L.t };
        this.err(e, 'asignar una lista { } solo se puede a un struct');
      }
      let R = this.expr(e.b);
      if (L.t.n === 'arr') this.err(e, 'en C++ no se puede asignar un arreglo entero: copialo elemento por elemento');
      if (L.t.n === 'struct') return { c: this.conPre(L.pre, `(${L.leer} = ${this.api('__copiar')}(${R.c}))`), t: L.t };
      if (L.t.n === 'cstr' && L.t.cap && R.t.n !== 'cstr' && R.t.n !== 'String') this.err(e, 'no se puede asignar eso a un arreglo de char');
      const v = L.auto && R.t.n !== 'bool' ? R.c : this.convertir(R, L.t, e).c;
      return { c: this.conPre(L.pre, `(${L.leer} = ${v})`), t: L.t };
    }
    const bop = e.op.slice(0, -1);
    const R = this.expr(e.b);
    if (L.t.n === 'String' || L.t.n === 'cstr') {
      if (bop !== '+') this.err(e, `no se puede usar '${e.op}' con un texto`);
      return { c: this.conPre(L.pre, `(${L.leer} += ${this.aTexto(R)})`), t: L.t };
    }
    const res = this.operar(bop, { c: L.leer, t: L.t }, R, e);
    const intR = taEsEntero(R.t);
    const directo = L.auto || taEsFlot(L.t) || ((L.t.n === 'i32' || L.t.n === 'i64') && intR && bop !== '/' && bop !== '%');
    if (directo) return { c: this.conPre(L.pre, `(${L.leer} ${e.op} ${R.c === 'true' ? 1 : R.c === 'false' ? 0 : R.c})`), t: L.t };
    const v = L.auto ? res.c : this.convertir(res, L.t, e).c;
    return { c: this.conPre(L.pre, `(${L.leer} = ${v})`), t: L.t };
  }
  incDec(a, op, post, e) {
    const L = this.lvalor(a);
    if (!taEsNum(L.t)) this.err(e, `no se puede usar '${op}' con ${taNombreTipo(L.t)}`);
    const angosto = !L.auto && ['i8', 'u8', 'i16', 'u16', 'char', 'bool'].includes(L.t.n);
    if (!angosto) return { c: this.conPre(L.pre, post ? `${L.leer}${op}` : `${op}${L.leer}`), t: L.t };
    const nuevo = this.envolver(`(${L.leer} ${op[0]} 1)`, L.t);
    if (!post) return { c: this.conPre(L.pre, `(${L.leer} = ${nuevo})`), t: L.t };
    const t = this.temp();
    return { c: this.conPre(L.pre, `(${t} = ${L.leer}, ${L.leer} = ${nuevo}, ${t})`), t: L.t };
  }
  campo(T, nombre, n) {
    const d = this.structs.get(T.s);
    if (!d) this.err(n, `struct ${T.s} desconocido`);
    const c = d.campos.find(x => x.nombre === nombre);
    if (!c) this.err(n, `${T.s} no tiene un campo '${nombre}'`);
    if (d.api) this.structsUsados.add(T.s);
    return c;
  }
  exprMiembro(e) {
    const O = this.expr(e.a);
    let t = O.t;
    if (t.n === 'ptr') t = t.e;
    if (t.n === 'struct') {
      const c = this.campo(t, e.n, e);
      return { c: `${O.c}.${e.n}`, t: c.tipo };
    }
    if (t.n === 'obj') this.err(e, `${t.c}.${e.n}: el simulador no conoce ese campo`);
    if (taEsTexto(t)) this.err(e, `los textos no tienen un campo '${e.n}' (¿faltan los parentesis de un metodo?)`);
    this.err(e, `'${e.n}' no es un campo de ${taNombreTipo(t)}`);
  }
  exprIdx(e) {
    const A = this.expr(e.a), I = this.expr(e.i);
    const i = I.t.n === 'bool' ? `(+${I.c})` : I.c;
    if (A.t.n === 'arr' || A.t.n === 'ptr') return { c: `${A.c}[${i}]`, t: A.t.e };
    if (taEsTexto(A.t)) return { c: `${this.api('__charAt')}(${A.c}, ${i})`, t: TA_T('char') };
    this.err(e, `no se puede usar [] con ${taNombreTipo(A.t)}`);
  }
  exprFcast(e) {
    const T = e.tipo;
    if (T.n === 'String') {
      if (!e.args.length) return { c: '""', t: T };
      const X = this.expr(e.args[0]);
      if (e.args[1]) {
        const f = this.expr(e.args[1]);
        if (taEsFlot(X.t)) return { c: `${this.api('__dtostrf')}(${X.t.n === 'f32' ? `Math.fround(${X.c})` : X.c}, (${f.c}) + 2, ${f.c})`, t: T };
        if (taEsEntero(X.t)) return { c: `${this.api('__fiMin')}(${X.c}, ${f.c})`, t: T };
      }
      return { c: this.aTexto(X), t: T };
    }
    if (T.n === 'struct') {
      if (e.llaves) return { c: this.initStruct(T, e.args[0]), t: T };
      if (!e.args.length) return { c: this.nuevoStruct(T.s), t: T };
      this.err(e, 'los constructores de struct con argumentos no estan soportados: usa llaves { }');
    }
    if (T.n === 'obj') return { c: this.nuevoObjeto(T, e.args, e), t: T };
    if (e.args.length !== 1) this.err(e, `${taNombreTipo(T)}(...) lleva un solo valor`);
    return this.convertir(this.expr(e.llaves ? e.args[0].elems[0].e : e.args[0]), T, e);
  }
  nuevoObjeto(T, args, n) {
    const partes = (args || []).map(a => this.expr(a).c);
    return `${this.api('__nuevo')}(${JSON.stringify(T.clase || T.c)}, [${partes.join(', ')}])`;
  }
  // ── llamadas ──
  exprLlamada(e) {
    const f = e.f;
    if (f.k === 'id') {
      const s = this.buscar(f.n, f);
      if (s.clase === 'funcion') return this.llamarUsuario(s, e.args, e);
      if (s.clase === 'apiFuncion') return this.llamarApi(f.n, e.args, e);
      if (s.clase === 'local' || s.clase === 'global' || s.clase === 'param') this.err(e, `'${f.n}' es una variable, no una funcion`);
      this.err(e, `'${f.n}' no es una funcion`);
    }
    if (f.k === 'miembro') {
      const O = this.expr(f.a);
      let t = O.t.n === 'ptr' ? O.t.e : O.t;
      if (taEsTexto(t)) return this.metodoTexto(O, f.n, e.args, e, f.a);
      if (t.n === 'obj') return this.llamarMetodo({ c: O.c, t }, f.n, e.args, e);
      if (t.n === 'struct') this.err(e, `los struct no tienen metodos (${t.s}.${f.n})`);
      this.err(e, `${taNombreTipo(t)} no tiene metodos`);
    }
    if (f.k === 'scope') this.err(e, `no conozco '${f.a}::${f.n}()'`);
    this.err(e, 'esa llamada no esta soportada');
  }
  llamarUsuario(s, args, e) {
    const cands = s.lista.filter(g => args.length <= g.params.length && args.length >= g.params.filter(p => !p.def).length);
    if (!cands.length) {
      const g = s.lista[0];
      this.err(e, `${s.nombre}() recibe ${g.params.length} argumento${g.params.length === 1 ? '' : 's'} y se le pasaron ${args.length}`);
    }
    let g = cands[0];
    if (cands.length === 1 && !g.nodo) this.err(e, `la funcion ${s.nombre}() se declara pero nunca se escribe su cuerpo`);
    if (cands.length > 1) {
      const tipos = args.map(a => { try { return this.expr(a).t; } catch (x) { return null; } });
      let mejor = -1;
      for (const c of cands) {
        let p = 0;
        c.params.forEach((pp, i) => { const t = tipos[i]; if (!t) return; if (t.n === pp.tipo.n) p += 3; else if (taEsNum(t) && taEsNum(pp.tipo) && taEsFlot(t) === taEsFlot(pp.tipo)) p += 2; else if (taEsTexto(t) && taEsTexto(pp.tipo)) p += 2; });
        if (p > mejor) { mejor = p; g = c; }
      }
    }
    if (this.fn) this.fn.llama.add(g);
    else if (this.modulo) this.modulo.llama.add(g);
    const partes = args.map((a, i) => this.argumento(a, g.params[i], e));
    const call = `${g.js}(${partes.join(', ')})`;
    return { c: g.bloquea ? `(yield* ${call})` : call, t: g.tipoRet };
  }
  argumento(a, p, e) {
    const T = p.tipo;
    if (p.ref && !['arr', 'struct', 'obj'].includes(T.n) && !p.const) return this.caja(a);
    if (a.k === 'llaves') {
      if (T.n === 'struct') return this.initStruct(T, a);
      this.err(a, 'una lista { } solo se puede pasar a un parametro de tipo struct');
    }
    const X = this.expr(a);
    if (T.n === 'ptr') {
      if (X.t.n === 'ptr' || X.t.n === 'arr' || X.t.n === 'null' || X.t.n === 'struct' || X.t.n === 'obj') return X.c;
      this.err(a, `se esperaba un puntero (${taNombreTipo(T)}) y se paso ${taNombreTipo(X.t)}`);
    }
    if (T.n === 'arr') {
      if (X.t.n !== 'arr' && X.t.n !== 'ptr') this.err(a, `se esperaba un arreglo y se paso ${taNombreTipo(X.t)}`);
      return X.c;
    }
    if (T.n === 'struct') return p.ref ? X.c : `${this.api('__copiar')}(${X.c})`;
    if (T.n === 'obj') return X.c;
    return this.convertir(X, T, a).c;
  }
  bloqueaApi(nombre, bloquea) { if (bloquea) { if (this.fn) this.fn.directo = true; else if (this.modulo) this.modulo.directo = true; } }
  llamarApi(nombre, args, e) {
    const X = i => this.expr(args[i]);
    const n = args.length;
    const pide = (k) => { if (n < k) this.err(e, `${nombre}() necesita ${k} argumento${k === 1 ? '' : 's'}`); };
    switch (nombre) {
      case 'min': case 'max': { pide(2); const A = X(0), B = X(1); return { c: `Math.${nombre}(${A.c}, ${B.c})`, t: taAritmetico(taPromovido(A.t), taPromovido(B.t)) }; }
      case 'abs': { pide(1); const A = X(0); return { c: `Math.abs(${A.c})`, t: taPromovido(A.t) }; }
      case 'constrain': { pide(3); const A = X(0), B = X(1), C = X(2); return { c: `${this.api('__constrain')}(${A.c}, ${B.c}, ${C.c})`, t: taAritmetico(taPromovido(A.t), taAritmetico(taPromovido(B.t), taPromovido(C.t))) }; }
      case 'sq': { pide(1); const A = X(0); const t = this.temp(); return { c: `(${t} = ${A.c}, ${t} * ${t})`, t: taPromovido(A.t) }; }
      case 'map': { pide(5); const p = args.map(a => this.expr(a).c); return { c: `${this.api('__map')}(${p.join(', ')})`, t: TA_T('i32') }; }
      case 'round': case 'roundf': { pide(1); return { c: `${this.api('__round')}(${X(0).c})`, t: TA_T(nombre === 'roundf' ? 'f32' : 'f64') }; }
      case 'lround': case 'lroundf': { pide(1); return { c: `${this.api('__round')}(${X(0).c})`, t: TA_T('i32') }; }
      case 'fmod': case 'fmodf': { pide(2); return { c: `(${X(0).c} % ${X(1).c})`, t: TA_T('f64') }; }
      case 'radians': { pide(1); return { c: `(${X(0).c} * ${Math.PI / 180})`, t: TA_T('f64') }; }
      case 'degrees': { pide(1); return { c: `(${X(0).c} * ${180 / Math.PI})`, t: TA_T('f64') }; }
      case 'isnan': return { c: `Number.isNaN(${X(0).c})`, t: TA_T('bool') };
      case 'isinf': { const t = this.temp(); return { c: `(${t} = ${X(0).c}, ${t} === Infinity || ${t} === -Infinity)`, t: TA_T('bool') }; }
      case 'bitRead': { pide(2); return { c: `((${X(0).c} >> ${X(1).c}) & 1)`, t: TA_T('i32') }; }
      case 'bit': { pide(1); return { c: `((1 << ${X(0).c}) >>> 0)`, t: TA_T('u32') }; }
      case 'lowByte': return { c: `(${X(0).c} & 255)`, t: TA_T('u8') };
      case 'highByte': return { c: `((${X(0).c} >> 8) & 255)`, t: TA_T('u8') };
      case 'toupper': case 'toUpperCase': return { c: `String.fromCharCode(${X(0).c}).toUpperCase().charCodeAt(0)`, t: TA_T('char') };
      case 'tolower': case 'toLowerCase': return { c: `String.fromCharCode(${X(0).c}).toLowerCase().charCodeAt(0)`, t: TA_T('char') };
      case 'strlen': return { c: `${X(0).c}.length`, t: TA_T('u32') };
      case 'atoi': case 'atol': return { c: `${this.api('__toInt')}(${X(0).c})`, t: TA_T('i32') };
      case 'atof': return { c: `${this.api('__toFloat')}(${X(0).c})`, t: TA_T('f64') };
      case 'strcmp': case 'strcasecmp': { const a = X(0).c, b = X(1).c; return { c: nombre === 'strcmp' ? `${this.api('__cmpTexto')}(${a}, ${b})` : `${this.api('__cmpTexto')}(${a}.toLowerCase(), ${b}.toLowerCase())`, t: TA_T('i32') }; }
      case 'attachInterrupt': case 'detachInterrupt':
        this.aviso(e, `${nombre}() no esta soportado en el simulador: la interrupcion nunca se va a llamar`);
        return { c: 'undefined', t: TA_T('void') };
    }
    if (TA_MATE[nombre]) {
      const p = args.map(a => this.expr(a).c);
      return { c: `Math.${TA_MATE[nombre]}(${p.join(', ')})`, t: TA_T(TA_FUNCIONES[nombre][0]) };
    }
    // Funciones que escriben en su primer argumento (un texto o un numero).
    if (['sprintf', 'snprintf', 'dtostrf', 'strcpy', 'strncpy', 'strcat', 'itoa', 'ltoa', 'utoa', 'bitSet', 'bitClear', 'bitWrite', 'memset', 'memcpy'].includes(nombre))
      return this.llamarEscritora(nombre, args, e);
    if (nombre === 'F' || nombre === 'PSTR') { pide(1); return X(0); }
    const d = TA_FUNCIONES[nombre];
    if (!d) this.err(e, `el simulador no conoce la funcion ${nombre}()`);
    this.bloqueaApi(nombre, d[1]);
    const js = nombre === 'yield' ? this.api('__yield') : this.api(nombre);
    const p = args.map(a => {
      if (a.k === 'un' && a.op === '&') return this.direccion(a.a).c;
      const Y = this.expr(a);
      return Y.t.n === 'bool' ? `(+${Y.c})` : Y.c;
    });
    const call = `${js}(${p.join(', ')})`;
    return { c: d[1] ? `(yield* ${call})` : call, t: TA_T(d[0] === 'arit' ? 'i32' : d[0]) };
  }
  llamarEscritora(nombre, args, e) {
    if (nombre === 'dtostrf') {
      if (args.length < 4) this.err(e, 'dtostrf() necesita 4 argumentos');
      const B = this.lvalor(args[3]);
      const [v, w, p] = args.slice(0, 3).map(a => this.expr(a).c);
      return { c: this.conPre(B.pre, `(${B.leer} = ${this.api('__dtostrf')}(${v}, ${w}, ${p}))`), t: TA_T('cstr') };
    }
    if (nombre === 'itoa' || nombre === 'ltoa' || nombre === 'utoa') {
      if (args.length < 2) this.err(e, `${nombre}() necesita al menos 2 argumentos`);
      const B = this.lvalor(args[1]);
      return { c: this.conPre(B.pre, `(${B.leer} = ${this.api('__fiMin')}(${this.expr(args[0]).c}, ${args[2] ? this.expr(args[2]).c : 10}))`), t: TA_T('cstr') };
    }
    if (nombre === 'memset' || nombre === 'memcpy') {
      if (args.length < 3) this.err(e, `${nombre}() necesita 3 argumentos`);
      const A = this.expr(args[0]), b = this.expr(args[1]).c, n = this.expr(args[2]).c;
      return { c: `${this.api('__' + nombre)}(${A.c}, ${b}, ${n}, ${A.t.n === 'arr' ? this.tamano(A.t.e) : 1})`, t: TA_T('void') };
    }
    if (!args.length) this.err(e, `${nombre}() necesita argumentos`);
    const L = this.lvalor(args[0]);
    const resto = args.slice(1).map(a => this.expr(a));
    const asignar = v => this.conPre(L.pre, `(${L.leer} = ${v})`);
    const pide = k => { if (resto.length < k) this.err(e, `${nombre}() necesita ${k + 1} argumentos`); };
    switch (nombre) {
      case 'sprintf': pide(1); return { c: `${asignar(`${this.api('__printf')}(${resto[0].c}, [${resto.slice(1).map(x => this.valorPrintf(x)).join(', ')}])`)}.length`, t: TA_T('i32') };
      case 'snprintf': pide(2); return { c: `${asignar(`${this.api('__printf')}(${resto[1].c}, [${resto.slice(2).map(x => this.valorPrintf(x)).join(', ')}]).substring(0, Math.max(0, ${resto[0].c} - 1))`)}.length`, t: TA_T('i32') };
      case 'strcpy': pide(1); return { c: asignar(resto[0].c), t: TA_T('cstr') };
      case 'strncpy': pide(2); return { c: asignar(`${resto[0].c}.substring(0, ${resto[1].c})`), t: TA_T('cstr') };
      case 'strcat': pide(1); return { c: this.conPre(L.pre, `(${L.leer} += ${resto[0].c})`), t: TA_T('cstr') };
      case 'bitSet': pide(1); return { c: asignar(this.envolver(`(${L.leer} | (1 << ${resto[0].c}))`, L.t)), t: L.t };
      case 'bitClear': pide(1); return { c: asignar(this.envolver(`(${L.leer} & ~(1 << ${resto[0].c}))`, L.t)), t: L.t };
      case 'bitWrite': pide(2); return { c: asignar(this.envolver(`(${resto[1].c} ? (${L.leer} | (1 << ${resto[0].c})) : (${L.leer} & ~(1 << ${resto[0].c})))`, L.t)), t: L.t };
    }
    this.err(e, `${nombre}() no esta soportado`);
  }
  valorPrintf(X) { return X.t.n === 'bool' ? `(+${X.c})` : X.c; }
  llamarMetodo(O, metodo, args, e) {
    const clase = O.t.c;
    const tabla = TA_METODOS[clase === 'SerialMudo' ? 'Serial' : clase];
    const m = tabla && tabla[metodo];
    if (!m) this.err(e, `el simulador no conoce ${O.c}.${metodo}()`);
    if ((clase === 'Serial' || clase === 'SerialMudo') && (metodo === 'print' || metodo === 'println')) {
      const txt = args.length ? this.formatoPrint(this.expr(args[0]), args[1] ? this.expr(args[1]) : null) : '""';
      this.bloqueaApi(metodo, 1);
      return { c: `(yield* ${O.c}.${metodo}(${txt}))`, t: TA_T('u32') };
    }
    if ((clase === 'Serial' || clase === 'SerialMudo') && metodo === 'printf') {
      if (!args.length) this.err(e, 'Serial.printf() necesita un formato');
      const p = args.map(a => this.expr(a));
      this.bloqueaApi(metodo, 1);
      return { c: `(yield* ${O.c}.print(${this.api('__printf')}(${p[0].c}, [${p.slice(1).map(x => this.valorPrintf(x)).join(', ')}])))`, t: TA_T('u32') };
    }
    if ((clase === 'Serial' || clase === 'SerialMudo') && metodo === 'write') {
      const X = this.expr(args[0]);
      const txt = taEsTexto(X.t) ? X.c : `String.fromCharCode(${X.c})`;
      this.bloqueaApi(metodo, 1);
      return { c: `(yield* ${O.c}.print(${txt}))`, t: TA_T('u32') };
    }
    const p = args.map(a => {
      if (a.k === 'un' && a.op === '&') return this.direccion(a.a).c;
      const Y = this.expr(a);
      return Y.t.n === 'bool' ? `(+${Y.c})` : Y.c;
    });
    this.bloqueaApi(metodo, m[1]);
    const call = `${O.c}.${metodo}(${p.join(', ')})`;
    return { c: m[1] ? `(yield* ${call})` : call, t: TA_T(m[0]) };
  }
  metodoTexto(O, metodo, args, e, objNodo) {
    const X = i => this.expr(args[i]);
    const txt = i => { const Y = X(i); return Y.t.n === 'char' ? `String.fromCharCode(${Y.c})` : taEsTexto(Y.t) ? Y.c : this.aTexto(Y); };
    const mutar = v => { const L = this.lvalor(objNodo); return { c: this.conPre(L.pre, `(${L.leer} = ${v.split('$$').join(L.leer)})`), t: TA_T('void') }; };
    const s = O.c;
    switch (metodo) {
      case 'length': return { c: `${s}.length`, t: TA_T('u32') };
      case 'c_str': case 'begin': return { c: s, t: TA_T('cstr') };
      case 'charAt': return { c: `${this.api('__charAt')}(${s}, ${X(0).c})`, t: TA_T('char') };
      case 'equals': return { c: `(${s} === ${txt(0)})`, t: TA_T('bool') };
      case 'equalsIgnoreCase': return { c: `(${s}.toLowerCase() === ${txt(0)}.toLowerCase())`, t: TA_T('bool') };
      case 'compareTo': return { c: `${this.api('__cmpTexto')}(${s}, ${txt(0)})`, t: TA_T('i32') };
      case 'indexOf': case 'lastIndexOf': return { c: `${s}.${metodo}(${txt(0)}${args[1] ? ', ' + X(1).c : ''})`, t: TA_T('i32') };
      case 'substring': return { c: `${s}.substring(${X(0).c}${args[1] ? ', ' + X(1).c : ''})`, t: TA_T('String') };
      case 'startsWith': case 'endsWith': return { c: `${s}.${metodo}(${txt(0)})`, t: TA_T('bool') };
      case 'isEmpty': return { c: `(${s}.length === 0)`, t: TA_T('bool') };
      case 'toInt': return { c: `${this.api('__toInt')}(${s})`, t: TA_T('i32') };
      case 'toFloat': case 'toDouble': return { c: `${this.api('__toFloat')}(${s})`, t: TA_T(metodo === 'toFloat' ? 'f32' : 'f64') };
      case 'trim': return mutar('$$.trim()');
      case 'toUpperCase': return mutar('$$.toUpperCase()');
      case 'toLowerCase': return mutar('$$.toLowerCase()');
      case 'replace': return mutar(`$$.split(${txt(0)}).join(${txt(1)})`);
      case 'remove': return mutar(args[1] ? `($$.substring(0, ${X(0).c}) + $$.substring(${X(0).c} + ${X(1).c}))` : `$$.substring(0, ${X(0).c})`);
      case 'concat': { const L = this.lvalor(objNodo); return { c: this.conPre(L.pre, `(${L.leer} += ${txt(0)}, true)`), t: TA_T('bool') }; }
      case 'setCharAt': return mutar(`($$.substring(0, ${X(0).c}) + String.fromCharCode(${X(1).c}) + $$.substring(${X(0).c} + 1))`);
      case 'reserve': return { c: 'true', t: TA_T('bool') };
      case 'toCharArray': { const B = this.lvalor(args[0]); return { c: this.conPre(B.pre, `(${B.leer} = ${s}.substring(0, Math.max(0, ${X(1).c} - 1)))`), t: TA_T('void') }; }
    }
    this.err(e, `los textos no tienen el metodo ${metodo}() en el simulador`);
  }

  // ── declaraciones ──
  tipoFinal(T, init, n) {
    if (T.n === 'auto') {
      if (!init || init.k === 'llaves') this.err(n, 'auto necesita un valor inicial');
      const X = this.expr(init);
      return X.t.n === 'cstr' ? TA_T('cstr') : X.t;
    }
    return T;
  }
  largoArreglo(T, init, n) {
    if (T.lenExpr) return this.expr(T.lenExpr).c;
    if (init && init.k === 'llaves') return String(init.elems.length);
    if (init && init.k === 'str') return String(init.v.length + 1);
    this.err(n, 'un arreglo necesita un tamaño o una lista de valores');
  }
  initArreglo(T, init, n) {
    if (init && init.k !== 'llaves') this.err(n, 'un arreglo se inicializa con una lista entre llaves { }');
    const len = this.largoArreglo(T, init, n);
    const E = T.e;
    const elems = init ? init.elems.map(x => x.e) : [];
    if (TA_ARREGLO_JS[E.n]) {
      const clase = TA_ARREGLO_JS[E.n];
      if (!elems.length) return `new ${clase}(${len})`;
      const vals = elems.map(x => this.convertir(this.expr(x), E, x).c);
      if (String(elems.length) === len) return `${clase}.of(${vals.join(', ')})`;
      return `${this.api('__arr')}(${clase}, ${len}, [${vals.join(', ')}])`;
    }
    const gen = x => {
      if (E.n === 'arr') return this.initArreglo(E, x, n);
      if (E.n === 'struct') return x ? (x.k === 'llaves' ? this.initStruct(E, x) : `${this.api('__copiar')}(${this.expr(x).c})`) : this.nuevoStruct(E.s);
      if (E.n === 'obj') { if (!x) this.err(n, `un arreglo de ${E.clase || E.c} necesita sus valores`); return x.k === 'fcast' ? this.nuevoObjeto(E, x.args, x) : this.expr(x).c; }
      if (!x) return this.valorCero(E);
      return this.convertir(this.expr(x), E, x).c;
    };
    if (elems.length && String(elems.length) === len) return `[${elems.map(gen).join(', ')}]`;
    const lista = `[${elems.map(gen).join(', ')}]`;
    return `${this.api('__lista')}(${len}, ${lista}, () => ${gen(null)})`;
  }
  initStruct(T, init) {
    const d = this.structs.get(T.s);
    if (!d) this.err(init, `struct ${T.s} desconocido`);
    const partes = [];
    let k = 0;
    for (const el of init.elems) {
      const c = el.campo ? d.campos.find(x => x.nombre === el.campo) : d.campos[k++];
      if (!c) this.err(init, `demasiados valores para ${T.s}`);
      const v = c.tipo.n === 'struct' && el.e.k === 'llaves' ? this.initStruct(c.tipo, el.e)
        : c.tipo.n === 'arr' ? this.initArreglo(c.tipo, el.e, init) : this.convertir(this.expr(el.e), c.tipo, el.e).c;
      partes.push(`${c.nombre}: ${v}`);
    }
    return `Object.assign(${this.nuevoStruct(T.s)}, { ${partes.join(', ')} })`;
  }
  initVar(v, T) {
    if (T.n === 'arr') return this.initArreglo(T, v.init, v);
    if (T.n === 'struct') {
      if (!v.init) return this.nuevoStruct(T.s);
      if (v.init.k === 'llaves') return this.initStruct(T, v.init);
      return `${this.api('__copiar')}(${this.expr(v.init).c})`;
    }
    if (T.n === 'obj') return this.nuevoObjeto(T, v.ctor || (v.init && v.init.k === 'fcast' ? v.init.args : []), v);
    if (T.n === 'cstr' && T.cap && v.init && v.init.k === 'llaves') this.err(v, 'arreglo de char con lista de letras: usa un texto entre comillas');
    if (v.ctor) {
      if (T.n === 'String') return v.ctor.length ? this.exprFcast({ k: 'fcast', tipo: T, args: v.ctor, L: v.L, A: v.A }).c : '""';
      if (v.ctor.length === 1) return this.convertir(this.expr(v.ctor[0]), T, v).c;
    }
    if (!v.init) return this.valorCero(T);
    const init = v.init.k === 'llaves' ? (v.init.elems[0] ? v.init.elems[0].e : null) : v.init;
    if (!init) return this.valorCero(T);
    return this.convertir(this.expr(init), T, v).c;
  }

  // ── sentencias ──
  sentencias(lista) { for (const s of lista) this.sentencia(s); }
  cuerpo(s, tick) {
    this.emitirAbre();
    if (tick) this.emitir(`if (${this.api('__tick')}()) yield;`);
    this.ambitos.push(new Map());
    if (s.k === 'bloque') this.sentencias(s.stmts); else this.sentencia(s);
    this.ambitos.pop();
  }
  emitirAbre() { this.sang++; }
  cierra(txt) { this.sang--; this.emitir(txt); }
  constanteVerdadera(c) { return !c || (c.k === 'num' && c.v !== 0) || (c.k === 'bool' && c.v); }
  vacio(s) { return s.k === 'vacio' || (s.k === 'bloque' && s.stmts.length === 0); }
  sentencia(s) {
    this.lineaActual = s.L || this.lineaActual;
    try {
      this.sentenciaInterna(s);
    } catch (x) {
      if (!(x instanceof ErrorTraduccion)) throw x;
      if (this.errores.length < 30 && !this.errores.some(y => y.linea === x.linea && y.msg === x.message)) this.errores.push({ linea: x.linea || s.L, archivo: x.archivo || s.A, msg: x.message });
    }
  }
  sentenciaInterna(s) {
    const L = s.L;
    switch (s.k) {
      case 'vacio': return;
      case 'bloque':
        this.emitir('{', L); this.emitirAbre(); this.ambitos.push(new Map());
        this.sentencias(s.stmts);
        this.ambitos.pop(); this.cierra('}');
        return;
      case 'expr': this.emitir(this.expr(s.e).c + ';', L); return;
      case 'decl': for (const v of s.vars) this.declLocal(v); return;
      case 'if': {
        this.emitir(`if (${this.cond(s.c)}) {`, L);
        this.cuerpo(s.a, false); this.cierra('}');
        let b = s.b;
        while (b) {
          if (b.k === 'if') {
            this.lineaActual = b.L;
            this.emitir(`else if (${this.cond(b.c)}) {`, b.L);
            this.cuerpo(b.a, false); this.cierra('}');
            b = b.b;
          } else { this.emitir('else {', b.L); this.cuerpo(b, false); this.cierra('}'); b = null; }
        }
        return;
      }
      case 'while':
        if (this.constanteVerdadera(s.c) && this.vacio(s.cuerpo)) { this.marcarBloqueo(); this.emitir(`yield* ${this.api('__detener')}();`, L); return; }
        this.marcarBloqueo();
        this.emitir(`while (${this.cond(s.c)}) {`, L); this.cuerpo(s.cuerpo, true); this.cierra('}');
        return;
      case 'dowhile':
        this.marcarBloqueo();
        this.emitir('do {', L); this.cuerpo(s.cuerpo, true); this.cierra(`} while (${this.cond(s.c)});`);
        return;
      case 'for': {
        this.marcarBloqueo();
        if (!s.c && this.vacio(s.cuerpo) && !s.inc) { this.emitir(`yield* ${this.api('__detener')}();`, L); return; }
        this.ambitos.push(new Map());
        let ini = '';
        if (s.init && s.init.k === 'decl') {
          const partes = s.init.vars.map(v => {
            const T = this.tipoFinal(v.tipo, v.init, v);
            const c = this.initVar(v, T);
            const sim = this.declararLocal(v.nombre, T, { const: v.const }, v);
            return `${sim.js} = ${c}`;
          });
          ini = 'let ' + partes.join(', ');
        } else if (s.init) ini = this.expr(s.init.e).c;
        const c = s.c ? this.cond(s.c) : '';
        const inc = s.inc ? this.expr(s.inc).c : '';
        this.emitir(`for (${ini}; ${c}; ${inc}) {`, L); this.cuerpo(s.cuerpo, true); this.cierra('}');
        this.ambitos.pop();
        return;
      }
      case 'forrango': {
        this.marcarBloqueo();
        const X = this.expr(s.expr);
        if (X.t.n !== 'arr') this.err(s, 'el for (x : ...) solo recorre arreglos');
        this.ambitos.push(new Map());
        const T = s.v.tipo.n === 'auto' ? X.t.e : s.v.tipo;
        if (s.v.ref) this.aviso(s, 'for (tipo &x : arreglo): en el simulador x es una copia; cambiarla no cambia el arreglo');
        const sim = this.declararLocal(s.v.nombre, T, {}, s.v);
        this.emitir(`for (let ${sim.js} of ${X.c}) {`, L); this.cuerpo(s.cuerpo, true); this.cierra('}');
        this.ambitos.pop();
        return;
      }
      case 'switch': {
        const X = this.expr(s.e);
        this.emitir(`switch (${X.t.n === 'bool' ? `(+${X.c})` : X.c}) {`, L);
        this.emitirAbre();
        this.ambitos.push(new Map());
        for (const c of s.casos) {
          this.lineaActual = c.L;
          if (c.valor) {
            const V = this.expr(c.valor);
            this.emitir(`case ${V.t.n === 'bool' ? (V.c === 'true' ? '1' : '0') : V.c}:`, c.L);
          } else this.emitir('default:', c.L);
          this.emitirAbre();
          this.sentencias(c.stmts);
          this.sang--;
        }
        this.ambitos.pop();
        this.cierra('}');
        return;
      }
      case 'break': this.emitir('break;', L); return;
      case 'continue': this.emitir('continue;', L); return;
      case 'return': {
        if (!s.e) { this.emitir('return;', L); return; }
        const T = this.fn ? this.fn.sim.tipoRet : null;
        const X = this.expr(s.e);
        const v = T && T.n === 'struct' ? `${this.api('__copiar')}(${X.c})` : this.convertir(X, T, s).c;
        this.emitir(`return ${v};`, L);
        return;
      }
    }
    this.err(s, 'sentencia no soportada');
  }
  marcarBloqueo() { if (this.fn) this.fn.directo = true; }
  declLocal(v) {
    const T = this.tipoFinal(v.tipo, v.init, v);
    if (v.ref && !v.const) {
      const X = this.expr(v.init);
      if (['arr', 'struct', 'obj'].includes(T.n)) { const sim = this.declararLocal(v.nombre, T, {}, v); this.emitir(`let ${sim.js} = ${X.c};`, v.L); return; }
      const sim = this.declararLocal(v.nombre, T, { ref: true }, v);
      this.emitir(`let ${sim.js} = ${this.caja(v.init)};`, v.L);
      return;
    }
    if (v.static) {
      const fn = this.fn ? this.fn.sim.nombre : 'global';
      const js = this.jsNombre(`__e_${fn}_${v.nombre}`.replace(/^__/, 'e_'));
      const init = this.initVar(v, T);
      const literal = /^(-?[\d.e+]+|true|false|""|null|\(-?[\d.e+]+\))$/i.test(init) || /^new \w+Array\(\d+\)$/.test(init);
      const sim = { clase: 'estatico', nombre: v.nombre, js, tipo: T, const: v.const };
      this.ambitos[this.ambitos.length - 1].set(v.nombre, sim);
      if (this.recolectar) this.estaticos.push({ js, init: literal ? init : this.valorCero(T.n === 'arr' || T.n === 'obj' ? TA_T('null') : T), nombre: `${fn}::${v.nombre}`, tipo: T, perezoso: !literal });
      if (!literal) this.emitir(`if (!${js}__i) { ${js}__i = true; ${js} = ${init}; }`, v.L);
      return;
    }
    const init = this.initVar(v, T);
    const sim = this.declararLocal(v.nombre, T, { const: !!v.const && !['arr', 'struct', 'obj'].includes(T.n) }, v);
    this.emitir(`${v.const && !['arr', 'struct'].includes(T.n) ? 'const' : 'let'} ${sim.js} = ${init};`, v.L);
  }

  // ── programa ──
  generar() {
    this.usadosPor = new Map();
    // 1. tipos y firmas
    for (const d of this.P.todosStructs) this.structs.set(d.nombre, { campos: d.campos });
    for (const d of this.decls) {
      if (d.k === 'func') this.registrarFuncion(d);
    }
    for (const d of this.decls) {
      if (d.k === 'var') {
        if (this.globales.has(d.nombre) && !d.init && !d.ctor) continue;   // declaracion repetida (extern)
        const T = d.tipo;
        this.globales.set(d.nombre, { clase: 'global', nombre: d.nombre, js: this.jsNombre(d.nombre), tipo: T, const: !!d.const && !['arr', 'struct', 'obj'].includes(T.n), nodo: d });
      }
    }
    if (!this.funciones.has('setup')) this.errores.push({ linea: 0, archivo: '', msg: 'falta la funcion setup()' });
    if (!this.funciones.has('loop')) this.errores.push({ linea: 0, archivo: '', msg: 'falta la funcion loop()' });
    if (this.errores.length) return null;
    // 2. primera pasada: quien llama a quien y quien espera tiempo
    this.recolectar = true;
    this.pasada();
    this.recolectar = false;
    if (this.errores.length) return null;
    const todas = [].concat(...[...this.funciones.values()]).filter(g => g.nodo);
    for (const g of todas) g.bloquea = g.directo;
    for (let cambio = true; cambio;) {
      cambio = false;
      for (const g of todas) if (!g.bloquea && [...g.llama].some(h => h.bloquea)) { g.bloquea = true; cambio = true; }
    }
    // 3. segunda pasada: el codigo final
    return this.pasada(true);
  }
  registrarFuncion(d) {
    const lista = this.funciones.get(d.nombre) || [];
    this.funciones.set(d.nombre, lista);
    const firma = d.params.map(p => p.tipo.n).join(',');
    let g = lista.find(x => x.firma === firma || (x.params.length === d.params.length && (!x.nodo || !d.cuerpo)));
    if (!g) {
      const js = lista.length ? this.jsNombre(`${d.nombre}_${lista.length}`, true) : this.jsNombre(d.nombre);
      g = { nombre: d.nombre, js, firma, tipoRet: d.tipoRet, params: d.params.map(p => Object.assign({}, p)), nodo: null, protos: [], llama: new Set(), directo: false, bloquea: false };
      lista.push(g);
    }
    if (d.cuerpo) {
      if (g.nodo) this.errores.push({ linea: d.L, archivo: d.A, msg: `la funcion ${d.nombre}() esta escrita dos veces` });
      g.nodo = d;
      d.params.forEach((p, i) => { if (!p.def && g.params[i] && g.params[i].def) p.def = g.params[i].def; });
      g.params = d.params;
      g.tipoRet = d.tipoRet;
    } else {
      g.protos.push(d);
      d.params.forEach((p, i) => { if (p.def && g.params[i] && !g.params[i].def) g.params[i].def = p.def; });
    }
  }
  pasada(final) {
    this.salida = final ? [] : null;
    this.mapa = [];
    this.sang = 1;
    this.modulo = { temps: 0, llama: new Set(), directo: false };
    this.fn = null;
    this.ambitos = [];
    const inicios = [];     // globales que necesitan __init (llaman algo que espera tiempo)
    const lineasGlob = [];
    const guardarSalida = this.salida, guardarMapa = this.mapa;
    // globales en el orden del archivo
    for (const d of this.decls) {
      if (d.k !== 'var') continue;
      const s = this.globales.get(d.nombre);
      if (!s || s.nodo !== d) continue;
      try {
        this.lineaActual = d.L;
        const T = this.tipoFinal(d.tipo, d.init, d);
        s.tipo = T;
        const init = this.initVar(d, T);
        const decl = (s.const ? 'const ' : 'let ') + s.js;
        if (/\byield\b/.test(init)) { lineasGlob.push([`let ${s.js} = ${this.valorCero(T.n === 'arr' || T.n === 'obj' ? TA_T('null') : T)};`, d.L]); inicios.push([`${s.js} = ${init};`, d.L]); }
        else lineasGlob.push([`${decl} = ${init};`, d.L]);
      } catch (x) {
        if (!(x instanceof ErrorTraduccion)) throw x;
        this.errores.push({ linea: x.linea || d.L, archivo: x.archivo || d.A, msg: x.message });
      }
    }
    const tempsModulo = this.modulo.temps;
    // funciones
    const cuerpos = [];
    for (const d of this.decls) {
      if (d.k !== 'func' || !d.cuerpo) continue;
      const g = this.funciones.get(d.nombre).find(x => x.nodo === d);
      this.salida = final ? [] : null; this.mapa = []; this.sang = 1;
      this.fn = { sim: g, temps: 0, llama: g.llama, directo: false };
      if (this.recolectar) g.llama = this.fn.llama = new Set();
      this.ambitos = [new Map()];
      const ps = d.params.map((p, i) => {
        const ref = p.ref && !['arr', 'struct', 'obj'].includes(p.tipo.n) && !p.const;
        const sim = this.declararLocal(p.nombre || ('sinNombre' + i), p.tipo, { clase: 'param', ref }, d);
        let def = '';
        if (p.def) {
          const fnG = this.fn; this.fn = null; const amb = this.ambitos; this.ambitos = [];
          try { def = ' = ' + this.convertir(this.expr(p.def), p.tipo, p.def).c; } finally { this.fn = fnG; this.ambitos = amb; }
        }
        return sim.js + def;
      });
      this.lineaActual = d.L;
      this.sentencias(d.cuerpo.stmts);
      if (this.recolectar) g.directo = this.fn.directo;
      const temps = this.fn.temps;
      if (final) {
        const cab = `function${g.bloquea ? '*' : ''} ${g.js}(${ps.join(', ')}) {`;
        const cuerpo = this.salida;
        const mapa = this.mapa;
        cuerpos.push({ cab, cuerpo, mapa, temps, L: d.L });
      }
      this.fn = null;
    }
    if (!final) return null;
    // armar el modulo
    const out = [], mapa = [];
    const push = (txt, L) => { out.push(txt); mapa.push(L || 0); };
    push("'use strict';");
    const apiNombres = [...this.apiUsada].sort();
    if (apiNombres.length) push(`const { ${apiNombres.join(', ')} } = __api;`);
    if (tempsModulo) push(`let ${Array.from({ length: tempsModulo }, (_, i) => '__g' + (i + 1)).join(', ')};`);
    // fabricas de struct (las que se usan, con sus dependencias)
    const hechos = new Set();
    const fabrica = s => {
      if (hechos.has(s)) return;
      hechos.add(s);
      const d = this.structs.get(s);
      const campos = d.campos.map(c => {
        let v;
        if (c.tipo.n === 'struct') { fabrica(c.tipo.s); v = `__nuevo_${this.jsStruct(c.tipo.s)}()`; }
        else if (c.tipo.n === 'arr') { this.fn = null; v = this.initArreglo(c.tipo, c.init, { L: 0 }); }
        else if (c.init) { this.fn = null; v = this.convertir(this.expr(c.init), c.tipo, c.init).c; }
        else v = this.valorCero(c.tipo);
        return `${c.nombre}: ${v}`;
      });
      push(`function __nuevo_${this.jsStruct(s)}() { return { ${campos.join(', ')} }; }`);
    };
    for (const s of [...this.structsUsados]) fabrica(s);
    for (const [txt, L] of lineasGlob) push(txt, L);
    for (const e of this.estaticos) push(`let ${e.js} = ${e.init}${e.perezoso ? `, ${e.js}__i = false` : ''};`);
    for (const c of cuerpos) {
      push(c.cab, c.L);
      if (c.temps) push(`  let ${Array.from({ length: c.temps }, (_, i) => '__t' + (i + 1)).join(', ')};`, c.L);
      c.cuerpo.forEach((l, i) => push(l, c.mapa[i]));
      push('}');
    }
    if (inicios.length) {
      push('function* __init() {');
      for (const [txt, L] of inicios) push('  ' + txt, L);
      push('}');
    }
    // variables para la pantalla
    const vis = [];
    for (const s of this.globales.values()) {
      if (s.const || s.tipo.n === 'obj' || s.tipo.n === 'ptr') continue;
      if (s.tipo.n === 'arr') vis.push(`${JSON.stringify(s.nombre)}: Array.from(${s.js}, x => (typeof x === 'object' && x !== null) ? JSON.parse(JSON.stringify(x)) : x)`);
      else if (s.tipo.n === 'struct') vis.push(`${JSON.stringify(s.nombre)}: JSON.parse(JSON.stringify(${s.js}))`);
      else vis.push(`${JSON.stringify(s.nombre)}: ${s.js}`);
    }
    for (const e of this.estaticos) if (e.tipo.n !== 'obj' && e.tipo.n !== 'arr') vis.push(`${JSON.stringify(e.nombre)}: ${e.js}`);
    push(`function __vars() { return { ${vis.join(', ')} }; }`);
    const tipos = {};
    for (const s of this.globales.values()) tipos[s.nombre] = taNombreTipo(s.tipo);
    const setup = this.funciones.get('setup').find(g => g.nodo), loop = this.funciones.get('loop').find(g => g.nodo);
    push(`return { setup, loop, setupGen: ${setup.bloquea}, loopGen: ${loop.bloquea}, init: ${inicios.length ? '__init' : 'null'}, vars: __vars, tipos: ${JSON.stringify(tipos)} };`);
    return { codigo: out.join('\n'), mapa };
  }
}

// Punto de entrada: archivos [{ nombre, texto }] -> { ok, codigo, mapa, errores, avisos, librerias }
function traducirArduino(archivos, opciones) {
  opciones = opciones || {};
  const res = { ok: false, codigo: null, mapa: [], errores: [], avisos: [], librerias: [] };
  let toks, pre;
  try {
    pre = new TAPreprocesador(archivos, opciones.defines);
    toks = pre.procesar();
    res.avisos.push(...pre.avisos);
    res.librerias = pre.librerias;
  } catch (x) {
    if (!(x instanceof ErrorTraduccion)) throw x;
    res.errores.push({ linea: x.linea, archivo: x.archivo, msg: x.message });
    return res;
  }
  let parser, decls;
  try {
    parser = new TAParser(toks);
    decls = parser.programa();
  } catch (x) {
    if (!(x instanceof ErrorTraduccion)) throw x;
    res.errores.push({ linea: x.linea, archivo: x.archivo, msg: x.message });
    return res;
  }
  const gen = new TAGenerador(parser, decls, opciones);
  for (const t of toks) if (t.t === 'id') gen.usados.add(t.v);
  let r;
  try { r = gen.generar(); }
  catch (x) {
    if (!(x instanceof ErrorTraduccion)) throw x;
    gen.errores.push({ linea: x.linea, archivo: x.archivo, msg: x.message });
  }
  res.errores.push(...gen.errores);
  res.avisos.push(...gen.avisos);
  if (res.errores.length || !r) return res;
  res.ok = true;
  res.codigo = r.codigo;
  res.mapa = r.mapa;
  return res;
}
