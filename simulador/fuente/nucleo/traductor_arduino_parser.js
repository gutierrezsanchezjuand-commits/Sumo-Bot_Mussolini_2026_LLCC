
// ─────────────────────────── parser de C++ (lo que usa Arduino) ───────────────────────────
const TA_BASICOS = new Set(['void', 'bool', 'boolean', 'char', 'int', 'float', 'double', 'byte', 'word', 'size_t', 'String', 'auto',
  'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t']);
const TA_MODIF = new Set(['unsigned', 'signed', 'short', 'long']);
const TA_IGNORAR = new Set(['volatile', 'extern', 'inline', 'register', 'mutable', 'IRAM_ATTR', 'DRAM_ATTR', 'RTC_DATA_ATTR',
  'ICACHE_RAM_ATTR', 'typename', 'PROGMEM', '__inline', 'ARDUINO_ISR_ATTR']);
const TA_INICIO_DECL = new Set(['const', 'constexpr', 'static', 'struct', 'enum', 'union', ...TA_MODIF, ...TA_IGNORAR]);
const TA_ASIG = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const TA_PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const TA_BASICO_A_TIPO = { void: 'void', bool: 'bool', boolean: 'bool', byte: 'u8', word: 'u16', size_t: 'u32', String: 'String',
  int8_t: 'i8', uint8_t: 'u8', int16_t: 'i16', uint16_t: 'u16', int32_t: 'i32', uint32_t: 'u32', int64_t: 'i64', uint64_t: 'u64',
  float: 'f32', double: 'f64', auto: 'auto' };

function taTipoBasico(q) {
  const b = q.base;
  if (b === 'char') return TA_T(q.unsigned ? 'u8' : q.signed ? 'i8' : 'char');
  if (b === 'double' || (b === 'float' && q.long)) return TA_T('f64');
  if (b && b !== 'int') return TA_T(TA_BASICO_A_TIPO[b]);
  if (q.short) return TA_T(q.unsigned ? 'u16' : 'i16');
  if (q.long >= 2) return TA_T(q.unsigned ? 'u64' : 'i64');
  return TA_T(q.unsigned ? 'u32' : 'i32');
}

class TAParser {
  constructor(toks) {
    this.toks = toks; this.i = 0;
    const ult = toks[toks.length - 1];
    this.FIN = { t: 'fin', v: '', raw: 'el final del archivo', linea: ult ? ult.linea : 0, archivo: ult ? ult.archivo : '' };
    this.tipos = new Map();
    for (const c of Object.keys(TA_CLASES)) this.tipos.set(c, { n: 'obj', c: TA_CLASES[c], clase: c });
    for (const s of Object.keys(TA_STRUCTS_API)) this.tipos.set(s, { n: 'struct', s });
    this.enumValores = new Map();
    this.pendientes = [];
    this.todosStructs = [];
    this.nAnon = 0;
  }
  ver(k = 0) { return this.toks[this.i + k] || this.FIN; }
  sig() { return this.toks[this.i++] || this.FIN; }
  fin() { return this.i >= this.toks.length; }
  esOp(v, k = 0) { const t = this.ver(k); return t.t === 'op' && t.v === v; }
  esId(v, k = 0) { const t = this.ver(k); return t.t === 'id' && t.v === v; }
  error(msg, t) { t = t || this.ver(); throw new ErrorTraduccion(msg, t.linea, t.archivo); }
  esperar(v) {
    const t = this.ver();
    if (t.v !== v || (t.t !== 'op' && t.t !== 'id')) {
      const previo = this.toks[this.i - 1];
      if (v === ';' && previo && t.linea !== previo.linea) this.error(`falta un ';' al final de esta linea`, previo);
      this.error(`se esperaba '${v}' y aparece '${t.raw}'`);
    }
    return this.sig();
  }
  nodo(o, t) { o.L = t.linea; o.A = t.archivo; return o; }
  tomarPendientes() { const p = this.pendientes; this.pendientes = []; return p; }

  programa() {
    const decls = [];
    while (!this.fin()) {
      if (this.esOp(';')) { this.sig(); continue; }
      if (this.esId('typedef')) { this.typedef(decls); continue; }
      if (this.esId('using')) { while (!this.fin() && !this.esOp(';')) this.sig(); this.sig(); continue; }
      if (this.esId('namespace')) this.error('los namespace no estan soportados en el simulador');
      if (this.esId('template')) this.error('las plantillas (template) no estan soportadas en el simulador');
      if (this.esId('extern') && this.ver(1).t === 'str') {
        this.sig(); this.sig();
        if (this.esOp('{')) {
          this.sig();
          while (!this.fin() && !this.esOp('}')) { if (this.esOp(';')) { this.sig(); continue; } decls.push(...this.declaracionExterna()); }
          this.esperar('}');
        }
        continue;
      }
      decls.push(...this.declaracionExterna());
    }
    return decls;
  }
  declaracionExterna() {
    const t0 = this.ver();
    const esp = this.especificador();
    if (!esp) {
      if (t0.t === 'id' && this.esOp('(', 1)) this.error(`'${t0.v}(...)' fuera de una funcion: si es una funcion, falta el tipo que devuelve (por ejemplo void ${t0.v}(...))`, t0);
      if (t0.t === 'id' && this.ver(1).t === 'id') this.error(`'${t0.v}' no es un tipo conocido: si es de una libreria, el simulador no la tiene`, t0);
      this.error(`no entiendo '${t0.raw}' aca: se esperaba una variable o una funcion`, t0);
    }
    const res = this.tomarPendientes();
    if (this.esOp(';')) { this.sig(); return res; }
    for (;;) {
      const d = this.declarador();
      if (this.esOp('(') && d.nombre && !d.dims.length) {
        if (this.pareceParametros()) {
          const f = this.funcion(esp, d);
          res.push(f);
          if (f.cuerpo) return res;
        } else {
          this.sig();
          res.push(this.nodoVar(esp, d, null, this.argumentos()));
        }
      } else {
        let init = null;
        if (this.esOp('=')) { this.sig(); init = this.inicializador(); }
        else if (this.esOp('{')) init = this.inicializador();
        res.push(this.nodoVar(esp, d, init, null));
      }
      if (this.esOp(',')) { this.sig(); continue; }
      this.esperar(';');
      return res;
    }
  }
  pareceParametros() {
    const t1 = this.ver(1);
    if (t1.t === 'op' && (t1.v === ')' || t1.v === '...')) return true;
    return t1.t === 'id' && (TA_BASICOS.has(t1.v) || TA_INICIO_DECL.has(t1.v) || this.tipos.has(t1.v));
  }
  saltarAtributo() {
    this.sig();
    let p = 0;
    do { const t = this.sig(); if (t.v === '(') p++; else if (t.v === ')') p--; if (t.t === 'fin') break; } while (p > 0);
  }
  especificador() {
    const q = { const: false, static: false, unsigned: false, signed: false, short: 0, long: 0, base: null, tipo: null };
    let algo = false;
    for (;;) {
      const t = this.ver();
      if (t.t !== 'id') break;
      const v = t.v;
      if (v === 'const' || v === 'constexpr') { q.const = true; this.sig(); algo = true; continue; }
      if (v === 'static') { q.static = true; this.sig(); algo = true; continue; }
      if (TA_IGNORAR.has(v)) { this.sig(); algo = true; continue; }
      if (v === '__attribute__') { this.saltarAtributo(); continue; }
      if (v === 'unsigned') { q.unsigned = true; this.sig(); algo = true; continue; }
      if (v === 'signed') { q.signed = true; this.sig(); algo = true; continue; }
      if (v === 'short') { q.short++; this.sig(); algo = true; continue; }
      if (v === 'long') { q.long++; this.sig(); algo = true; continue; }
      if (q.base || q.tipo) break;
      if (v === 'struct' || v === 'union' || v === 'class') { q.tipo = this.structDef(v); algo = true; continue; }
      if (v === 'enum') { q.tipo = this.enumDef(); algo = true; continue; }
      if (TA_BASICOS.has(v)) { q.base = v; this.sig(); algo = true; continue; }
      if (this.tipos.has(v) && !this.esOp('::', 1)) {
        q.tipo = this.tipos.get(v); this.sig(); algo = true;
        if (this.esOp('<')) this.error(`plantillas como ${v}<...> no estan soportadas`);
        continue;
      }
      if (v === 'std' && this.esOp('::', 1)) this.error('la libreria estandar de C++ (std::) no esta soportada en el simulador');
      break;
    }
    if (!algo) return null;
    if (!q.base && !q.tipo && !q.unsigned && !q.signed && !q.short && !q.long) {
      if (q.const || q.static) this.error('falta el tipo despues de const/static');
      return null;
    }
    return { tipo: q.tipo || taTipoBasico(q), const: q.const, static: q.static };
  }
  declarador() {
    let ptr = 0, ref = false;
    for (;;) {
      if (this.esOp('*')) { ptr++; this.sig(); while (this.esId('const') || this.esId('volatile')) this.sig(); continue; }
      if (this.esOp('&') || this.esOp('&&')) { ref = true; this.sig(); continue; }
      break;
    }
    const tok = this.ver();
    let nombre = null;
    if (tok.t === 'id' && !TA_BASICOS.has(tok.v)) nombre = this.sig().v;
    if (this.esOp('::')) this.error('definir metodos de una clase (Clase::metodo) no esta soportado');
    if (this.esOp('(') && this.esOp('*', 1)) this.error('los punteros a funcion no estan soportados');
    const dims = [];
    while (this.esOp('[')) {
      this.sig();
      if (this.esOp(']')) dims.push(null); else dims.push(this.expresion());
      this.esperar(']');
    }
    while (this.ver().t === 'id' && TA_IGNORAR.has(this.ver().v)) this.sig();
    if (this.esId('__attribute__')) this.saltarAtributo();
    return { nombre, ptr, ref, dims, tok };
  }
  // Tipo final de lo declarado: los char[] y char* son textos.
  tipoDeclarado(base, d) {
    let t = base;
    const dims = (d.dims || []).slice();
    if (d.ptr > 0) {
      if (t.n === 'char') { t = TA_T('cstr'); for (let k = 1; k < d.ptr; k++) t = { n: 'ptr', e: t }; }
      else for (let k = 0; k < d.ptr; k++) t = { n: 'ptr', e: t };
    } else if (t.n === 'char' && dims.length) { const cap = dims.pop(); t = { n: 'cstr', cap }; }
    for (let k = dims.length - 1; k >= 0; k--) t = { n: 'arr', e: t, lenExpr: dims[k] };
    return t;
  }
  nodoVar(esp, d, init, ctor) {
    if (!d.nombre) this.error('falta el nombre de la variable', d.tok);
    return this.nodo({ k: 'var', nombre: d.nombre, tipo: this.tipoDeclarado(esp.tipo, d), ref: d.ref, const: esp.const,
      static: esp.static, init, ctor }, d.tok);
  }
  funcion(esp, d) {
    this.esperar('(');
    const params = [];
    if (this.esId('void') && this.esOp(')', 1)) this.sig();
    while (!this.esOp(')')) {
      if (this.esOp('...')) this.error('las funciones con argumentos variables (...) no estan soportadas');
      const pt = this.ver();
      const pe = this.especificador();
      if (!pe) this.error(`se esperaba el tipo de un parametro y aparece '${pt.raw}'`, pt);
      const pd = this.declarador();
      let def = null;
      if (this.esOp('=')) { this.sig(); def = this.asignacion(); }
      params.push({ nombre: pd.nombre, tipo: this.tipoDeclarado(pe.tipo, pd), ref: pd.ref, const: pe.const, def, L: pt.linea, A: pt.archivo });
      if (this.esOp(',')) { this.sig(); continue; }
      break;
    }
    this.esperar(')');
    while (this.ver().t === 'id' && ['const', 'noexcept', 'override', 'IRAM_ATTR', 'ARDUINO_ISR_ATTR'].includes(this.ver().v)) this.sig();
    let cuerpo = null;
    if (this.esOp('{')) cuerpo = this.bloque();
    const tipoRet = this.tipoDeclarado(esp.tipo, { ptr: d.ptr, dims: [] });
    return this.nodo({ k: 'func', nombre: d.nombre, tipoRet, params, cuerpo }, d.tok);
  }
  structDef(kw) {
    const t0 = this.sig();
    let nombre = null;
    if (this.ver().t === 'id' && !this.esOp('{')) nombre = this.sig().v;
    if (this.esOp(':')) this.error('la herencia de clases no esta soportada');
    if (!this.esOp('{')) {
      if (!nombre) this.error(`${kw} sin nombre`);
      if (!this.tipos.has(nombre)) this.error(`${kw} ${nombre} no esta definido`);
      return this.tipos.get(nombre);
    }
    this.sig();
    if (!nombre) nombre = '__anon' + (this.nAnon++);
    const tipo = { n: 'struct', s: nombre };
    this.tipos.set(nombre, tipo);
    const campos = [];
    while (!this.esOp('}')) {
      if (this.fin()) this.error(`falta cerrar el ${kw} ${nombre} con }`, t0);
      if (['public', 'private', 'protected'].includes(this.ver().v) && this.esOp(':', 1)) { this.sig(); this.sig(); continue; }
      const ct = this.ver();
      const esp = this.especificador();
      if (!esp) this.error(`se esperaba un campo del ${kw} y aparece '${ct.raw}'`, ct);
      for (;;) {
        const d = this.declarador();
        if (this.esOp('(')) this.error(`las funciones dentro de un ${kw} no estan soportadas: usa funciones sueltas`, ct);
        let init = null;
        if (this.esOp('=')) { this.sig(); init = this.inicializador(); }
        campos.push({ nombre: d.nombre, tipo: this.tipoDeclarado(esp.tipo, d), init });
        if (this.esOp(',')) { this.sig(); continue; }
        break;
      }
      this.esperar(';');
    }
    this.sig();
    const nodo = this.nodo({ k: 'struct', nombre, campos, tipo }, t0);
    this.pendientes.push(nodo);
    this.todosStructs.push(nodo);
    return tipo;
  }
  enumDef() {
    const t0 = this.sig();
    let esClase = false;
    if (this.esId('class') || this.esId('struct')) { this.sig(); esClase = true; }
    let nombre = null;
    if (this.ver().t === 'id' && !this.esOp('{')) nombre = this.sig().v;
    if (this.esOp(':')) { this.sig(); this.especificador(); }
    const tipo = { n: 'i32', enumNombre: nombre };
    if (nombre) this.tipos.set(nombre, tipo);
    if (!this.esOp('{')) return tipo;
    this.sig();
    let valor = 0;
    while (!this.esOp('}')) {
      const t = this.sig();
      if (t.t !== 'id') this.error(`se esperaba el nombre de un valor del enum y aparece '${t.raw}'`, t);
      if (this.esOp('=')) { this.sig(); valor = this.constante(this.asignacion()); }
      if (!esClase) this.enumValores.set(t.v, valor);
      if (nombre) this.enumValores.set(nombre + '::' + t.v, valor);
      valor++;
      if (this.esOp(',')) this.sig(); else if (!this.esOp('}')) this.error("se esperaba ',' o '}' en el enum");
    }
    this.sig();
    this.pendientes.push(this.nodo({ k: 'enum', nombre }, t0));
    return tipo;
  }
  constante(e) {
    const ev = x => {
      switch (x.k) {
        case 'num': case 'chr': return Number(x.v);
        case 'bool': return x.v ? 1 : 0;
        case 'id': if (this.enumValores.has(x.n)) return this.enumValores.get(x.n); break;
        case 'scope': if (this.enumValores.has(x.a + '::' + x.n)) return this.enumValores.get(x.a + '::' + x.n); break;
        case 'un': { const a = ev(x.a); if (x.op === '-') return -a; if (x.op === '+') return a; if (x.op === '~') return ~a; if (x.op === '!') return a ? 0 : 1; break; }
        case 'bin': {
          const a = ev(x.a), b = ev(x.b);
          switch (x.op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b ? Math.trunc(a / b) : 0;
            case '%': return b ? a % b : 0; case '<<': return a << b; case '>>': return a >> b; case '|': return a | b;
            case '&': return a & b; case '^': return a ^ b;
          }
          break;
        }
        case 'cast': return ev(x.a);
      }
      throw new ErrorTraduccion('el valor de un enum tiene que ser una constante', x.L, x.A);
    };
    return ev(e);
  }
  typedef(decls) {
    this.sig();
    const t0 = this.ver();
    const esp = this.especificador();
    if (!esp) this.error('typedef sin tipo conocido', t0);
    const pend = this.tomarPendientes();
    for (;;) {
      const d = this.declarador();
      if (this.esOp('(')) this.error('typedef de funciones no esta soportado');
      if (!d.nombre) this.error('typedef sin nombre');
      const t = this.tipoDeclarado(esp.tipo, d);
      if (t.n === 'struct' && t.s.startsWith('__anon')) {
        const p = pend.find(x => x.k === 'struct' && x.tipo === t);
        this.tipos.delete(t.s);
        t.s = d.nombre;
        if (p) p.nombre = d.nombre;
      }
      this.tipos.set(d.nombre, t);
      if (this.esOp(',')) { this.sig(); continue; }
      break;
    }
    this.esperar(';');
    decls.push(...pend);
  }
  bloque() {
    const t0 = this.esperar('{');
    const stmts = [];
    while (!this.esOp('}')) {
      if (this.fin()) this.error('falta una } para cerrar el bloque que abre aca', t0);
      stmts.push(this.sentencia());
    }
    this.sig();
    return this.nodo({ k: 'bloque', stmts }, t0);
  }
  esDeclaracion() {
    const t = this.ver();
    if (t.t !== 'id') return false;
    if (TA_INICIO_DECL.has(t.v)) return true;
    if (TA_BASICOS.has(t.v) || this.tipos.has(t.v)) {
      const s = this.ver(1);
      if (s.t === 'op' && ['(', '::', '.', '{', '->', '[', '=', ';', ')', ','].includes(s.v)) return false;
      return true;
    }
    return false;
  }
  declaracionLocal() {
    const t0 = this.ver();
    const esp = this.especificador();
    const pend = this.tomarPendientes();
    const vars = [];
    if (!this.esOp(';')) for (;;) {
      const d = this.declarador();
      if (this.esOp('(')) {
        if (this.pareceParametros()) this.error('no se puede declarar una funcion dentro de otra');
        this.sig();
        vars.push(this.nodoVar(esp, d, null, this.argumentos()));
      } else {
        let init = null;
        if (this.esOp('=')) { this.sig(); init = this.inicializador(); }
        else if (this.esOp('{')) init = this.inicializador();
        vars.push(this.nodoVar(esp, d, init, null));
      }
      if (this.esOp(',')) { this.sig(); continue; }
      break;
    }
    this.esperar(';');
    return this.nodo({ k: 'decl', vars, tipos: pend }, t0);
  }
  sentencia() {
    const t = this.ver();
    if (this.esOp('{')) return this.bloque();
    if (this.esOp(';')) { this.sig(); return this.nodo({ k: 'vacio' }, t); }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.sig(); this.esperar('(');
          const c = this.expresion(); this.esperar(')');
          const a = this.sentencia();
          let b = null;
          if (this.esId('else')) { this.sig(); b = this.sentencia(); }
          return this.nodo({ k: 'if', c, a, b }, t);
        }
        case 'while': {
          this.sig(); this.esperar('(');
          const c = this.expresion(); this.esperar(')');
          return this.nodo({ k: 'while', c, cuerpo: this.sentencia() }, t);
        }
        case 'do': {
          this.sig();
          const cuerpo = this.sentencia();
          if (!this.esId('while')) this.error("falta el 'while' del do { } while (...)");
          this.sig(); this.esperar('(');
          const c = this.expresion(); this.esperar(')'); this.esperar(';');
          return this.nodo({ k: 'dowhile', c, cuerpo }, t);
        }
        case 'for': {
          this.sig(); this.esperar('(');
          if (this.esDeclaracion()) {
            const guardado = this.i;
            const esp = this.especificador();
            const d = this.declarador();
            if (this.esOp(':')) {
              this.sig();
              const expr = this.expresion(); this.esperar(')');
              return this.nodo({ k: 'forrango', v: this.nodoVar(esp, d, null, null), expr, cuerpo: this.sentencia() }, t);
            }
            this.i = guardado;
            this.pendientes = [];
          }
          let init = null;
          if (this.esOp(';')) this.sig();
          else if (this.esDeclaracion()) init = this.declaracionLocal();
          else { init = this.nodo({ k: 'expr', e: this.expresion() }, t); this.esperar(';'); }
          const c = this.esOp(';') ? null : this.expresion(); this.esperar(';');
          const inc = this.esOp(')') ? null : this.expresion(); this.esperar(')');
          return this.nodo({ k: 'for', init, c, inc, cuerpo: this.sentencia() }, t);
        }
        case 'switch': {
          this.sig(); this.esperar('(');
          const e = this.expresion(); this.esperar(')');
          this.esperar('{');
          const casos = [];
          while (!this.esOp('}')) {
            if (this.fin()) this.error('falta cerrar el switch', t);
            const ct = this.ver();
            if (this.esId('case')) {
              this.sig();
              const v = this.ternario();
              if (this.esOp('...')) this.error('los rangos en case (a ... b) no estan soportados');
              this.esperar(':');
              casos.push(this.nodo({ valor: v, stmts: [] }, ct));
            } else if (this.esId('default')) {
              this.sig(); this.esperar(':');
              casos.push(this.nodo({ valor: null, stmts: [] }, ct));
            } else {
              if (!casos.length) this.error('hay codigo antes del primer case', ct);
              casos[casos.length - 1].stmts.push(this.sentencia());
            }
          }
          this.sig();
          return this.nodo({ k: 'switch', e, casos }, t);
        }
        case 'break': this.sig(); this.esperar(';'); return this.nodo({ k: 'break' }, t);
        case 'continue': this.sig(); this.esperar(';'); return this.nodo({ k: 'continue' }, t);
        case 'return': {
          this.sig();
          const e = this.esOp(';') ? null : this.expresion();
          this.esperar(';');
          return this.nodo({ k: 'return', e }, t);
        }
        case 'goto': this.error('goto no esta soportado');
        case 'try': case 'throw': this.error('las excepciones de C++ (try/throw) no estan soportadas');
        case 'typedef': this.error('typedef dentro de una funcion no esta soportado: ponelo afuera');
        case 'case': case 'default': this.error(`'${t.v}' fuera de un switch`);
        case 'else': this.error("'else' sin un 'if' antes (revisa las llaves y los ;)");
      }
      if (this.esOp(':', 1)) this.error('las etiquetas (para goto) no estan soportadas');
      if (this.esDeclaracion()) return this.declaracionLocal();
    }
    const e = this.expresion();
    this.esperar(';');
    return this.nodo({ k: 'expr', e }, t);
  }
  inicializador() {
    if (this.esOp('{')) {
      const t0 = this.sig();
      const elems = [];
      while (!this.esOp('}')) {
        if (this.esOp('.') && this.ver(1).t === 'id' && this.esOp('=', 2)) {
          this.sig(); const campo = this.sig().v; this.sig();
          elems.push({ campo, e: this.inicializador() });
        } else elems.push({ e: this.inicializador() });
        if (this.esOp(',')) this.sig(); else break;
      }
      this.esperar('}');
      return this.nodo({ k: 'llaves', elems }, t0);
    }
    return this.asignacion();
  }
  expresion() {
    let e = this.asignacion();
    while (this.esOp(',')) { const t = this.sig(); e = this.nodo({ k: 'coma', a: e, b: this.asignacion() }, t); }
    return e;
  }
  asignacion() {
    const a = this.ternario();
    const t = this.ver();
    if (t.t === 'op' && TA_ASIG.has(t.v)) {
      this.sig();
      const b = this.esOp('{') ? this.inicializador() : this.asignacion();
      return this.nodo({ k: 'asig', op: t.v, a, b }, t);
    }
    return a;
  }
  ternario() {
    const c = this.binario(1);
    if (this.esOp('?')) {
      const t = this.sig();
      const a = this.expresion(); this.esperar(':');
      const b = this.asignacion();
      return this.nodo({ k: 'tern', c, a, b }, t);
    }
    return c;
  }
  binario(min) {
    let a = this.unario();
    for (;;) {
      const t = this.ver();
      if (t.t !== 'op') return a;
      const p = TA_PREC[t.v];
      if (!p || p < min) return a;
      this.sig();
      const b = this.binario(p + 1);
      a = this.nodo({ k: 'bin', op: t.v, a, b }, t);
    }
  }
  intentarCast() {
    const guardado = this.i;
    this.sig();
    const t = this.ver();
    const pareceTipo = t.t === 'id' && (TA_BASICOS.has(t.v) || this.tipos.has(t.v) || TA_MODIF.has(t.v) || t.v === 'const' || t.v === 'struct');
    if (!pareceTipo || (this.tipos.has(t.v) && this.esOp('::', 1))) { this.i = guardado; return null; }
    const esp = this.especificador();
    this.pendientes = [];
    if (!esp) { this.i = guardado; return null; }
    let ptr = 0;
    while (this.esOp('*') || this.esOp('&')) { if (this.ver().v === '*') ptr++; this.sig(); }
    if (!this.esOp(')')) { this.i = guardado; return null; }
    this.sig();
    return this.tipoDeclarado(esp.tipo, { ptr, dims: [] });
  }
  unario() {
    const t = this.ver();
    if (t.t === 'op') {
      if (['!', '~', '-', '+', '*', '&', '++', '--'].includes(t.v)) { this.sig(); return this.nodo({ k: 'un', op: t.v, a: this.unario() }, t); }
      if (t.v === '(') {
        const tipo = this.intentarCast();
        if (tipo) return this.nodo({ k: 'cast', tipo, a: this.unario() }, t);
      }
    } else if (t.t === 'id') {
      if (t.v === 'sizeof') {
        this.sig();
        if (this.esOp('(')) {
          const guardado = this.i;
          const tipo = this.intentarCast();
          if (tipo) return this.nodo({ k: 'sizeof', tipo }, t);
          this.i = guardado;
        }
        return this.nodo({ k: 'sizeof', e: this.unario() }, t);
      }
      if (['static_cast', 'reinterpret_cast', 'const_cast', 'dynamic_cast'].includes(t.v)) {
        this.sig(); this.esperar('<');
        const esp = this.especificador();
        if (!esp) this.error('tipo invalido en ' + t.v);
        let ptr = 0;
        while (this.esOp('*') || this.esOp('&')) { if (this.ver().v === '*') ptr++; this.sig(); }
        this.esperar('>'); this.esperar('(');
        const a = this.expresion(); this.esperar(')');
        return this.postfijo(this.nodo({ k: 'cast', tipo: this.tipoDeclarado(esp.tipo, { ptr, dims: [] }), a }, t));
      }
      if (t.v === 'new' || t.v === 'delete') this.error('new/delete (memoria dinamica) no estan soportados en el simulador');
    }
    return this.postfijo(this.primario());
  }
  postfijo(e) {
    for (;;) {
      const t = this.ver();
      if (t.t !== 'op') return e;
      if (t.v === '(') { this.sig(); e = this.nodo({ k: 'llamada', f: e, args: this.argumentos() }, t); continue; }
      if (t.v === '[') { this.sig(); const i = this.expresion(); this.esperar(']'); e = this.nodo({ k: 'idx', a: e, i }, t); continue; }
      if (t.v === '.' || t.v === '->') {
        this.sig();
        const n = this.sig();
        if (n.t !== 'id') this.error(`se esperaba un nombre despues de '${t.v}'`, n);
        e = this.nodo({ k: 'miembro', a: e, n: n.v, flecha: t.v === '->' }, t);
        continue;
      }
      if (t.v === '++' || t.v === '--') { this.sig(); e = this.nodo({ k: 'post', op: t.v, a: e }, t); continue; }
      return e;
    }
  }
  argumentos() {
    const args = [];
    if (this.esOp(')')) { this.sig(); return args; }
    for (;;) {
      args.push(this.esOp('{') ? this.inicializador() : this.asignacion());
      if (this.esOp(',')) { this.sig(); continue; }
      this.esperar(')');
      return args;
    }
  }
  primario() {
    const t = this.sig();
    switch (t.t) {
      case 'num': return this.nodo({ k: 'num', v: t.v, tipo: TA_T(t.tipo) }, t);
      case 'str': { let v = t.v; while (this.ver().t === 'str') v += this.sig().v; return this.nodo({ k: 'str', v }, t); }
      case 'chr': return this.nodo({ k: 'chr', v: t.v }, t);
      case 'op':
        if (t.v === '(') { const e = this.expresion(); this.esperar(')'); return e; }
        if (t.v === '{') { this.i--; return this.inicializador(); }
        if (t.v === '::') return this.primario();
        if (t.v === '[') this.error('las funciones lambda no estan soportadas', t);
        this.error(`no entiendo '${t.raw}' aca`, t);
        break;
      case 'id': {
        if (t.v === 'true' || t.v === 'false') return this.nodo({ k: 'bool', v: t.v === 'true' }, t);
        if (t.v === 'nullptr' || t.v === 'NULL') return this.nodo({ k: 'null' }, t);
        if (t.v === 'this') this.error("'this' no esta soportado (no hay clases propias)", t);
        const basico = TA_BASICOS.has(t.v) || TA_MODIF.has(t.v);
        if ((basico || this.tipos.has(t.v)) && (this.esOp('(') || this.esOp('{'))) {
          let tipo;
          if (basico) tipo = taTipoBasico({ base: TA_BASICOS.has(t.v) ? t.v : null, unsigned: t.v === 'unsigned', signed: false,
            short: t.v === 'short' ? 1 : 0, long: t.v === 'long' ? 1 : 0 });
          else tipo = this.tipos.get(t.v);
          if (this.esOp('{')) return this.nodo({ k: 'fcast', tipo, args: [this.inicializador()], llaves: true }, t);
          this.sig();
          return this.nodo({ k: 'fcast', tipo, args: this.argumentos() }, t);
        }
        if (this.esOp('::')) {
          this.sig();
          const n = this.sig();
          if (n.t !== 'id') this.error("se esperaba un nombre despues de '::'", n);
          return this.nodo({ k: 'scope', a: t.v, n: n.v }, t);
        }
        return this.nodo({ k: 'id', n: t.v }, t);
      }
    }
    this.error(`no entiendo '${t.raw}' aca`, t);
  }
}
