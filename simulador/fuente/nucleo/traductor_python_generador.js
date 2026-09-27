
// ─────────────────────────── generador de JavaScript (Python) ───────────────────────────
const TP_RESERVADAS_JS = new Set(['var', 'let', 'const', 'new', 'this', 'function', 'switch', 'case', 'default', 'delete', 'void', 'typeof',
  'instanceof', 'do', 'catch', 'throw', 'enum', 'export', 'extends', 'super', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity',
  'arguments', 'eval', 'await', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'yield', 'debugger',
  'finally', 'with', 'in', 'of', 'import', 'class', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'try']);
// Atributos que leen hardware: se leen con un generador (pueden esperar tiempo).
const TP_ATTR_LENTOS = new Set(['value', 'distance', 'acceleration', 'gyro', 'temperature', 'magnetic', 'events', 'raw_value', 'proximity']);
// Integradas rapidas (sin espera): se llaman directo si no estan redefinidas.
const TP_RAPIDAS = new Set(['len', 'abs', 'int', 'float', 'bool', 'range', 'round', 'chr', 'ord', 'hex', 'bin', 'oct', 'isinstance',
  'tuple', 'list', 'enumerate', 'zip', 'reversed', 'divmod', 'pow', 'sum', 'min', 'max', 'any', 'all', 'type', 'callable', 'str', 'repr', 'set']);
const TP_INTEGRADAS = new Set(['print', 'len', 'range', 'abs', 'min', 'max', 'sum', 'int', 'float', 'str', 'bool', 'round', 'sorted',
  'reversed', 'enumerate', 'zip', 'list', 'tuple', 'dict', 'set', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'type',
  'chr', 'ord', 'hex', 'bin', 'oct', 'divmod', 'pow', 'map', 'filter', 'any', 'all', 'iter', 'next', 'repr', 'format', 'id', 'hash',
  'callable', 'input', 'open', 'exit', 'quit', 'dir', 'vars', 'globals', 'locals', 'object', 'super', 'staticmethod', 'classmethod',
  'property', 'bytes', 'bytearray', 'frozenset', 'slice', 'NotImplemented', 'Ellipsis', '__name__', 'help',
  'BaseException', 'Exception', 'ArithmeticError', 'AssertionError', 'AttributeError', 'EOFError', 'ImportError', 'IndexError',
  'KeyError', 'KeyboardInterrupt', 'LookupError', 'MemoryError', 'NameError', 'NotImplementedError', 'OSError', 'OverflowError',
  'RuntimeError', 'StopIteration', 'SyntaxError', 'SystemExit', 'TypeError', 'ValueError', 'ZeroDivisionError', 'TimeoutError',
  'IndentationError', 'UnboundLocalError', 'RecursionError', 'ConnectionError', 'ModuleNotFoundError']);
const TP_BINOPS = { '+': '$add', '-': '$sub', '*': '$mul', '/': '$div', '//': '$fdiv', '%': '$mod', '**': '$pow', '<<': '$lsh', '>>': '$rsh',
  '&': '$band', '|': '$bor', '^': '$bxor', '@': '$matmul' };
const TP_COSTO_SENTENCIA = 4, TP_COSTO_VUELTA = 3;

function tpJs(n) { return TP_RESERVADAS_JS.has(n) ? n + '$' : n; }

// Nombres que una funcion (o el modulo) asigna: esos son sus variables.
function tpAsignados(cuerpo, res) {
  res = res || { asig: new Set(), glob: new Set(), noloc: new Set() };
  const obj = e => {
    if (!e) return;
    if (e.k === 'nombre') res.asig.add(e.n);
    else if (e.k === 'tupla' || e.k === 'lista') e.elems.forEach(x => obj(x.k === 'estrella' ? x.e : x));
    else if (e.k === 'estrella') obj(e.e);
  };
  const walrus = e => {
    if (!e || typeof e !== 'object') return;
    if (e.k === 'walrus') res.asig.add(e.n);
    if (e.k === 'lambda') return;
    for (const v of Object.values(e)) {
      if (Array.isArray(v)) v.forEach(walrus);
      else if (v && typeof v === 'object' && v.k) walrus(v);
      else if (v && typeof v === 'object' && !v.k) for (const w of Object.values(v)) if (w && typeof w === 'object') (Array.isArray(w) ? w.forEach(walrus) : walrus(w));
    }
  };
  const sent = s => {
    switch (s.k) {
      case 'asig': s.objetivos.forEach(obj); walrus(s.valor); break;
      case 'aum': obj(s.objetivo); walrus(s.valor); break;
      case 'expr': walrus(s.e); break;
      case 'for': obj(s.objetivo); s.cuerpo.forEach(sent); if (s.sino) s.sino.forEach(sent); break;
      case 'while': walrus(s.c); s.cuerpo.forEach(sent); if (s.sino) s.sino.forEach(sent); break;
      case 'if': s.ramas.forEach(r => { walrus(r.c); r.cuerpo.forEach(sent); }); if (s.sino) s.sino.forEach(sent); break;
      case 'try': s.cuerpo.forEach(sent); s.manejadores.forEach(m => { if (m.nombre) res.asig.add(m.nombre); m.cuerpo.forEach(sent); });
        if (s.sino) s.sino.forEach(sent); if (s.final) s.final.forEach(sent); break;
      case 'with': s.items.forEach(it => obj(it.como)); s.cuerpo.forEach(sent); break;
      case 'def': case 'class': res.asig.add(s.nombre); break;
      case 'import': s.items.forEach(it => res.asig.add(it.como || it.modulo.split('.')[0])); break;
      case 'desde': if (s.items !== '*') s.items.forEach(it => res.asig.add(it.como || it.nombre)); break;
      case 'del': s.objetivos.forEach(obj); break;
      case 'global': s.nombres.forEach(n => res.glob.add(n)); break;
      case 'nonlocal': s.nombres.forEach(n => res.noloc.add(n)); break;
    }
  };
  cuerpo.forEach(sent);
  return res;
}

class TPGenerador {
  constructor(modulos) {
    this.modulos = modulos || {};     // nombre de modulo -> lista de nombres que exporta
    this.salida = []; this.mapa = [];
    this.sang = 0;
    this.ayudas = new Set();
    this.ambitos = [];
    this.nClase = 0;
    this.nDef = 0;
  }
  err(msg, n) { throw new ErrorPython(msg, n && n.L); }
  h(nombre) { this.ayudas.add(nombre); return nombre; }
  emitir(txt, L) { this.salida.push('  '.repeat(this.sang) + txt); this.mapa.push(L || this.lineaActual || 0); }
  temp() { const f = this.funcionActual(); f.temps = (f.temps || 0) + 1; return '$' + f.temps; }
  funcionActual() { for (let i = this.ambitos.length - 1; i >= 0; i--) if (this.ambitos[i].tipo !== 'comp' && this.ambitos[i].tipo !== 'clase') return this.ambitos[i]; return this.ambitos[0]; }

  // ── nombres ──
  resolver(n, nodo) {
    let saltarClase = false;
    for (let i = this.ambitos.length - 1; i >= 0; i--) {
      const a = this.ambitos[i];
      if (a.tipo === 'comp') { if (a.vars.has(n)) return a.vars.get(n); continue; }
      if (a.tipo === 'clase') { if (!saltarClase && a.asig.has(n)) return `$ns[${JSON.stringify(n)}]`; continue; }
      if (a.tipo === 'funcion') {
        saltarClase = true;
        if (a.glob.has(n)) return this.global(n, nodo);
        if (a.locales.has(n) && !a.noloc.has(n)) return tpJs(n);
        continue;
      }
      if (a.tipo === 'modulo') return this.global(n, nodo);
    }
    return this.global(n, nodo);
  }
  global(n, nodo) {
    const m = this.ambitos[0];
    if (m.locales.has(n)) return tpJs(n);
    if (TP_INTEGRADAS.has(n)) return `${this.h('$B')}.${n}`;
    return `${this.h('$noDefinido')}(${JSON.stringify(n)})`;
  }
  esIntegrada(n) {
    // la integrada vale si nadie la redefine en el camino
    for (let i = this.ambitos.length - 1; i >= 0; i--) {
      const a = this.ambitos[i];
      if (a.tipo === 'comp' && a.vars.has(n)) return false;
      if (a.tipo === 'funcion' && a.locales.has(n)) return false;
      if (a.tipo === 'modulo' && a.locales.has(n)) return false;
    }
    return TP_INTEGRADAS.has(n);
  }
  funcionModulo(n) {
    // def del modulo que nunca se reasigna: se puede llamar directo
    if (this.ambitos.some((a, i) => i > 0 && ((a.tipo === 'funcion' && a.locales.has(n) && !a.glob.has(n)) || (a.tipo === 'comp' && a.vars.has(n))))) return null;
    return this.defsModulo.get(n) || null;
  }

  // ── expresiones ──
  cond(e) {
    switch (e.k) {
      case 'cmp': case 'not': return this.expr(e);
      case 'const': if (e.v === true || e.v === false || e.v === null) return String(!!e.v); break;
      case 'boolop': return '(' + e.vals.map(x => this.cond(x)).join(e.op === 'and' ? ' && ' : ' || ') + ')';
      case 'call': if (e.f.k === 'nombre' && ['isinstance', 'hasattr', 'callable', 'bool', 'any', 'all'].includes(e.f.n) && this.esIntegrada(e.f.n)) return this.expr(e); break;
    }
    return `${this.h('$v')}(${this.expr(e)})`;
  }
  expr(e) {
    switch (e.k) {
      case 'nombre': return this.resolver(e.n, e);
      case 'num': return Number.isFinite(e.v) ? (e.v < 0 ? `(${e.v})` : String(e.v)) : 'Infinity';
      case 'str': return JSON.stringify(e.v);
      case 'const': return e.v === '...' ? this.h('$Ellipsis') : String(e.v);
      case 'fstr': return this.fstr(e);
      case 'tupla': return `${this.h('$tupla')}([${this.elems(e.elems)}])`;
      case 'lista': return `[${this.elems(e.elems)}]`;
      case 'set': return `${this.h('$set')}([${this.elems(e.elems)}])`;
      case 'dict': {
        if (e.pares.some(p => p.doble)) return `${this.h('$dictMezcla')}([${e.pares.map(p => p.doble ? `{ d: ${this.expr(p.doble)} }` : `[${this.expr(p.k)}, ${this.expr(p.v)}]`).join(', ')}])`;
        return `${this.h('$dict')}([${e.pares.map(p => `[${this.expr(p.k)}, ${this.expr(p.v)}]`).join(', ')}])`;
      }
      case 'comp': return this.comp(e);
      case 'attr': return this.leerAttr(e);
      case 'sub': {
        const o = this.expr(e.o);
        if (e.i.k === 'slice') return `${this.h('$cortar')}(${o}, ${this.opc(e.i.inicio)}, ${this.opc(e.i.fin)}, ${this.opc(e.i.paso)})`;
        return `${this.h('$item')}(${o}, ${this.expr(e.i)})`;
      }
      case 'slice': return `${this.h('$slice')}(${this.opc(e.inicio)}, ${this.opc(e.fin)}, ${this.opc(e.paso)})`;
      case 'call': return this.llamada(e);
      case 'bin': return `${this.h(TP_BINOPS[e.op])}(${this.expr(e.a)}, ${this.expr(e.b)})`;
      case 'un': {
        if (e.op === '-' && e.a.k === 'num') return `(${-e.a.v})`;
        return `${this.h({ '-': '$neg', '+': '$pos', '~': '$inv' }[e.op])}(${this.expr(e.a)})`;
      }
      case 'not': return `(!${this.cond(e.a)})`;
      case 'boolop': {
        let res = this.expr(e.vals[e.vals.length - 1]);
        for (let i = e.vals.length - 2; i >= 0; i--) {
          const t = this.temp();
          const a = this.expr(e.vals[i]);
          res = e.op === 'and' ? `((${t} = ${a}), ${this.h('$v')}(${t}) ? ${res} : ${t})` : `((${t} = ${a}), ${this.h('$v')}(${t}) ? ${t} : ${res})`;
        }
        return res;
      }
      case 'cmp': {
        const partes = [];
        let izq = this.expr(e.a);
        for (let i = 0; i < e.ops.length; i++) {
          let der = this.expr(e.vals[i]);
          if (i < e.ops.length - 1) { const t = this.temp(); partes.push(this.comparar(e.ops[i], izq, `(${t} = ${der})`)); izq = t; continue; }
          partes.push(this.comparar(e.ops[i], izq, der));
        }
        return partes.length === 1 ? partes[0] : `(${partes.join(' && ')})`;
      }
      case 'ternario': return `(${this.cond(e.c)} ? ${this.expr(e.a)} : ${this.expr(e.b)})`;
      case 'lambda': return this.funcion('<lambda>', e.params, [{ k: 'return', e: e.cuerpo, L: e.L }], e, true);
      case 'walrus': { const d = this.resolver(e.n, e); return `(${d} = ${this.expr(e.e)})`; }
      case 'estrella': this.err('*x solo puede ir en una lista, una tupla o una llamada', e);
    }
    this.err('expresion no soportada: ' + e.k, e);
  }
  opc(e) { return e ? this.expr(e) : 'null'; }
  elems(lista) { return lista.map(x => x.k === 'estrella' ? `...${this.h('$iter')}(${this.expr(x.e)})` : this.expr(x)).join(', '); }
  comparar(op, a, b) {
    switch (op) {
      case '==': return `${this.h('$eq')}(${a}, ${b})`;
      case '!=': return `(!${this.h('$eq')}(${a}, ${b}))`;
      case '<': return `${this.h('$lt')}(${a}, ${b})`;
      case '>': return `${this.h('$lt')}(${b}, ${a})`;
      case '<=': return `${this.h('$le')}(${a}, ${b})`;
      case '>=': return `${this.h('$le')}(${b}, ${a})`;
      case 'in': return `${this.h('$en')}(${a}, ${b})`;
      case 'not in': return `(!${this.h('$en')}(${a}, ${b}))`;
      case 'is': return `${this.h('$es')}(${a}, ${b})`;
      case 'is not': return `(!${this.h('$es')}(${a}, ${b}))`;
    }
  }
  fstr(e) {
    const partes = e.partes.map(p => {
      if (typeof p === 'string') return JSON.stringify(p);
      let spec = '""';
      if (p.spec) spec = p.spec.map(q => typeof q === 'string' ? JSON.stringify(q) : `${this.h('$str')}(${this.expr(q.ast)})`).join(' + ') || '""';
      return `${this.h('$formatoF')}(${this.expr(p.ast)}, ${JSON.stringify(p.conv)}, ${spec})`;
    });
    return partes.length ? `(${partes.join(' + ')})` : '""';
  }
  leerAttr(e) {
    const o = this.expr(e.o);
    if (TP_ATTR_LENTOS.has(e.n)) return `(yield* ${this.h('$leerG')}(${o}, ${JSON.stringify(e.n)}))`;
    return `${this.h('$leer')}(${o}, ${JSON.stringify(e.n)})`;
  }
  argumentos(args, kw) {
    const pos = this.elems(args);
    let k = 'null';
    if (kw.length) {
      if (kw.some(x => x.n === null)) k = `${this.h('$kwMezcla')}([${kw.map(x => x.n === null ? `{ d: ${this.expr(x.e)} }` : `[${JSON.stringify(x.n)}, ${this.expr(x.e)}]`).join(', ')}])`;
      else k = `{ ${kw.map(x => `${JSON.stringify(x.n)}: ${this.expr(x.e)}`).join(', ')} }`;
    }
    return { pos, k, simple: !kw.length && !args.some(a => a.k === 'estrella') };
  }
  llamada(e) {
    const f = e.f;
    // super().metodo(...)
    if (f.k === 'attr' && f.o.k === 'call' && f.o.f.k === 'nombre' && f.o.f.n === 'super' && !f.o.args.length) {
      const m = this.metodoActual;
      if (!m) this.err('super() solo se puede usar dentro de un metodo de una clase', e);
      const a = this.argumentos(e.args, e.kw);
      return `(yield* ${this.h('$super')}(${m.clase}, ${m.self}, ${JSON.stringify(f.n)}, [${a.pos}], ${a.k}))`;
    }
    if (f.k === 'attr') {
      const o = this.expr(f.o);
      const a = this.argumentos(e.args, e.kw);
      return `(yield* ${this.h('$metodo')}(${o}, ${JSON.stringify(f.n)}, [${a.pos}], ${a.k}))`;
    }
    const a = this.argumentos(e.args, e.kw);
    if (f.k === 'nombre') {
      if (this.esIntegrada(f.n)) {
        if (a.simple && TP_RAPIDAS.has(f.n)) return `${this.h('$BR')}.${f.n}(${a.pos})`;
        return `(yield* ${this.h('$llamar')}(${this.h('$B')}.${f.n}, [${a.pos}], ${a.k}))`;
      }
      const d = this.funcionModulo(f.n);
      if (d && a.simple && d.params.every(p => p.tipo === 'normal') && e.args.length <= d.params.length && e.args.length >= d.params.filter(p => !p.def).length)
        return `(yield* ${tpJs(f.n)}(${a.pos}))`;
    }
    return `(yield* ${this.h('$llamar')}(${this.expr(f)}, [${a.pos}], ${a.k}))`;
  }
  comp(e) {
    const amb = { tipo: 'comp', vars: new Map() };
    this.ambitos.push(amb);
    const lineas = [];
    const r = '$r';
    let cierre = '';
    const iters = [];
    try {
      e.gens.forEach((g, i) => {
        // el primer iterable se evalua afuera (como en Python)
        const it = i === 0 ? null : this.expr(g.iter);
        const v = `$e${i}`;
        const nombres = [];
        const juntar = o => { if (o.k === 'nombre') nombres.push(o.n); else if (o.k === 'tupla' || o.k === 'lista') o.elems.forEach(x => juntar(x.k === 'estrella' ? x.e : x)); };
        juntar(g.objetivo);
        for (const n of nombres) amb.vars.set(n, `${tpJs(n)}$c${i}`);
        iters.push({ it, v, g, nombres });
      });
      this.ambitos.pop();
      const primero = this.expr(e.gens[0].iter);
      this.ambitos.push(amb);
      let cuerpo = '';
      let abiertas = 0;
      iters.forEach(({ it, v, g, nombres }, i) => {
        const fuente = i === 0 ? '$it0' : it;
        let asignar = '';
        if (g.objetivo.k === 'nombre') asignar = '';
        else asignar = `let ${nombres.map(n => amb.vars.get(n)).join(', ')}; ${this.asignarDesde(g.objetivo, v)} `;
        const var0 = g.objetivo.k === 'nombre' ? amb.vars.get(g.objetivo.n) : v;
        cuerpo += `for (const ${var0} of ${this.h('$iter')}(${fuente})) { if (${this.h('$t')}(${TP_COSTO_VUELTA})) yield; ${asignar}`;
        for (const c of g.conds) cuerpo += `if (!${this.cond(c)}) continue; `;
        abiertas++;
      });
      let agregar;
      if (e.tipo === 'dict') agregar = `${r}.set(${this.expr(e.elem)}, ${this.expr(e.valor)});`;
      else if (e.tipo === 'set') agregar = `${r}.add(${this.expr(e.elem)});`;
      else agregar = `${r}.push(${this.expr(e.elem)});`;
      cuerpo += agregar + ' }'.repeat(abiertas);
      const ini = e.tipo === 'dict' ? `${this.h('$dict')}([])` : e.tipo === 'set' ? `${this.h('$set')}([])` : '[]';
      const temps = amb.temps ? `let ${Array.from({ length: amb.temps }, (_, i) => '$' + (i + 1)).join(', ')}; ` : '';
      return `(yield* (function* ($it0) { ${temps}const ${r} = ${ini}; ${cuerpo} return ${r}; })(${primero}))`;
    } finally {
      if (this.ambitos[this.ambitos.length - 1] === amb) this.ambitos.pop();
    }
  }
  // Asignar el valor (codigo JS) a un objetivo de Python; devuelve codigo.
  asignarDesde(obj, valor) {
    switch (obj.k) {
      case 'nombre': return `${this.resolver(obj.n, obj)} = ${valor};`;
      case 'attr': return `${this.h('$escribir')}(${this.expr(obj.o)}, ${JSON.stringify(obj.n)}, ${valor});`;
      case 'sub':
        if (obj.i.k === 'slice') return `${this.h('$ponerCorte')}(${this.expr(obj.o)}, ${this.opc(obj.i.inicio)}, ${this.opc(obj.i.fin)}, ${this.opc(obj.i.paso)}, ${valor});`;
        return `${this.h('$ponerItem')}(${this.expr(obj.o)}, ${this.expr(obj.i)}, ${valor});`;
      case 'tupla': case 'lista': {
        const est = obj.elems.findIndex(x => x.k === 'estrella');
        const d = this.temp();
        let c = est >= 0 ? `${d} = ${this.h('$desempaquetarEstrella')}(${valor}, ${est}, ${obj.elems.length - est - 1}); `
          : `${d} = ${this.h('$desempaquetar')}(${valor}, ${obj.elems.length}); `;
        obj.elems.forEach((x, i) => { c += this.asignarDesde(x.k === 'estrella' ? x.e : x, `${d}[${i}]`) + ' '; });
        return c.trim();
      }
    }
    this.err('no se puede asignar a eso', obj);
  }

  // ── sentencias ──
  bloque(cuerpo) { this.sang++; for (const s of cuerpo) this.sentencia(s); this.sang--; }
  sentencia(s) {
    this.lineaActual = s.L || this.lineaActual;
    const L = s.L;
    const costo = () => this.emitir(`if (${this.h('$t')}(${TP_COSTO_SENTENCIA})) yield;`, L);
    switch (s.k) {
      case 'expr': costo(); this.emitir(this.expr(s.e) + ';', L); return;
      case 'pass': costo(); return;
      case 'asig': {
        costo();
        if (s.objetivos.length === 1) { this.emitir(this.asignarDesde(s.objetivos[0], this.expr(s.valor)), L); return; }
        const t = this.temp();
        this.emitir(`${t} = ${this.expr(s.valor)};`, L);
        for (const o of s.objetivos) this.emitir(this.asignarDesde(o, t), L);
        return;
      }
      case 'aum': {
        costo();
        const op = `${this.h('$i' + TP_BINOPS[s.op].slice(1))}`;
        const o = s.objetivo;
        if (o.k === 'nombre') { const d = this.resolver(o.n, o); this.emitir(`${d} = ${op}(${d}, ${this.expr(s.valor)});`, L); return; }
        if (o.k === 'attr') {
          const t = this.temp();
          this.emitir(`${t} = ${this.expr(o.o)}; ${this.h('$escribir')}(${t}, ${JSON.stringify(o.n)}, ${op}(${TP_ATTR_LENTOS.has(o.n) ? `(yield* ${this.h('$leerG')}(${t}, ${JSON.stringify(o.n)}))` : `${this.h('$leer')}(${t}, ${JSON.stringify(o.n)})`}, ${this.expr(s.valor)}));`, L);
          return;
        }
        if (o.k === 'sub') {
          const t = this.temp(), i = this.temp();
          this.emitir(`${t} = ${this.expr(o.o)}; ${i} = ${this.expr(o.i)}; ${this.h('$ponerItem')}(${t}, ${i}, ${op}(${this.h('$item')}(${t}, ${i}), ${this.expr(s.valor)}));`, L);
          return;
        }
        this.err('no se puede usar ' + s.op + '= con eso', s);
        return;
      }
      case 'break': this.emitir('break;', L); return;
      case 'continue': this.emitir('continue;', L); return;
      case 'return': costo(); this.emitir(`return ${s.e ? this.expr(s.e) : 'null'};`, L); return;
      case 'global': case 'nonlocal': return;
      case 'del': {
        costo();
        for (const o of s.objetivos) {
          if (o.k === 'nombre') this.emitir(`${this.resolver(o.n, o)} = undefined;`, L);
          else if (o.k === 'sub') this.emitir(`${this.h('$borrarItem')}(${this.expr(o.o)}, ${o.i.k === 'slice' ? this.expr(o.i) : this.expr(o.i)});`, L);
          else if (o.k === 'attr') this.emitir(`${this.h('$borrarAttr')}(${this.expr(o.o)}, ${JSON.stringify(o.n)});`, L);
        }
        return;
      }
      case 'assert': costo(); this.emitir(`if (!${this.cond(s.c)}) throw ${this.h('$exc')}("AssertionError", ${s.msg ? this.expr(s.msg) : 'null'});`, L); return;
      case 'raise': {
        costo();
        if (!s.e) { this.emitir(`throw ${this.excActual ? this.excActual : `${this.h('$exc')}("RuntimeError", "No active exception to reraise")`};`, L); return; }
        this.emitir(`throw (yield* ${this.h('$lanzar')}(${this.expr(s.e)}));`, L);
        return;
      }
      case 'import': {
        costo();
        for (const it of s.items) {
          this.revisarModulo(it.modulo, s);
          if (it.como) this.emitir(`${this.resolver(it.como, s)} = ${this.h('$importar')}(${JSON.stringify(it.modulo)}, false);`, L);
          else this.emitir(`${this.resolver(it.modulo.split('.')[0], s)} = ${this.h('$importar')}(${JSON.stringify(it.modulo)}, true);`, L);
        }
        return;
      }
      case 'desde': {
        costo();
        this.revisarModulo(s.modulo, s);
        if (s.items === '*') {
          const nombres = this.modulos[s.modulo] || [];
          for (const n of nombres) this.emitir(`${this.resolver(n, s)} = ${this.h('$desde')}(${JSON.stringify(s.modulo)}, ${JSON.stringify(n)});`, L);
          return;
        }
        for (const it of s.items) this.emitir(`${this.resolver(it.como || it.nombre, s)} = ${this.h('$desde')}(${JSON.stringify(s.modulo)}, ${JSON.stringify(it.nombre)});`, L);
        return;
      }
      case 'if': {
        costo();
        s.ramas.forEach((r, i) => {
          this.lineaActual = r.L;
          this.emitir(`${i ? '} else if' : 'if'} (${this.cond(r.c)}) {`, r.L);
          this.bloque(r.cuerpo);
        });
        if (s.sino) { this.emitir('} else {', L); this.bloque(s.sino); }
        this.emitir('}', L);
        return;
      }
      case 'while': {
        const flag = s.sino ? this.temp() : null;
        if (flag) this.emitir(`${flag} = false;`, L);
        this.emitir(`while (${this.cond(s.c)}) {`, L);
        this.sang++; this.emitir(`if (${this.h('$t')}(${TP_COSTO_VUELTA})) yield;`, L); this.sang--;
        this.bucle(s.cuerpo, flag);
        this.emitir('}', L);
        if (flag) { this.emitir(`if (!${flag}) {`, L); this.bloque(s.sino); this.emitir('}', L); }
        return;
      }
      case 'for': {
        costo();
        const flag = s.sino ? this.temp() : null;
        if (flag) this.emitir(`${flag} = false;`, L);
        const v = this.temp();
        this.emitir(`for (const ${v}$ of ${this.h('$iter')}(${this.expr(s.iter)})) {`, L);
        this.sang++;
        this.emitir(`if (${this.h('$t')}(${TP_COSTO_VUELTA})) yield;`, L);
        this.emitir(this.asignarDesde(s.objetivo, v + '$'), L);
        this.sang--;
        this.bucle(s.cuerpo, flag);
        this.emitir('}', L);
        if (flag) { this.emitir(`if (!${flag}) {`, L); this.bloque(s.sino); this.emitir('}', L); }
        return;
      }
      case 'try': return this.sTry(s);
      case 'with': this.err('with no esta soportado en el simulador', s); return;
      case 'def': {
        costo();
        const js = this.resolver(s.nombre, s);
        let f = this.funcion(s.nombre, s.params, s.cuerpo, s, false);
        for (const d of (s.decoradores || []).slice().reverse()) f = `(yield* ${this.h('$llamar')}(${this.expr(d)}, [${f}], null))`;
        this.emitir(`${js} = ${f};`, L);
        return;
      }
      case 'class': return this.sClase(s);
    }
    this.err('sentencia no soportada: ' + s.k, s);
  }
  bucle(cuerpo, flag) {
    // break dentro de un for/while con else: marca que no hay que correr el else
    const guardado = this.flagBreak;
    this.flagBreak = flag;
    this.sang++;
    for (const st of cuerpo) this.sentenciaBucle(st);
    this.sang--;
    this.flagBreak = guardado;
  }
  sentenciaBucle(s) {
    if (s.k === 'break' && this.flagBreak) { this.emitir(`${this.flagBreak} = true; break;`, s.L); return; }
    if (s.k === 'if' && this.flagBreak) {
      this.lineaActual = s.L;
      this.emitir(`if (${this.h('$t')}(${TP_COSTO_SENTENCIA})) yield;`, s.L);
      s.ramas.forEach((r, i) => { this.emitir(`${i ? '} else if' : 'if'} (${this.cond(r.c)}) {`, r.L); this.sang++; r.cuerpo.forEach(x => this.sentenciaBucle(x)); this.sang--; });
      if (s.sino) { this.emitir('} else {', s.L); this.sang++; s.sino.forEach(x => this.sentenciaBucle(x)); this.sang--; }
      this.emitir('}', s.L);
      return;
    }
    this.sentencia(s);
  }
  sTry(s) {
    const L = s.L;
    const ok = s.sino ? this.temp() : null;
    if (s.final) { this.emitir('try {', L); this.sang++; }
    if (ok) this.emitir(`${ok} = false;`, L);
    if (s.manejadores.length) {
      this.emitir('try {', L);
      this.bloque(s.cuerpo);
      if (ok) { this.sang++; this.emitir(`${ok} = true;`, L); this.sang--; }
      const ex = this.temp();
      this.emitir(`} catch (${ex}$) {`, L);
      this.sang++;
      this.emitir(`${ex} = ${this.h('$aPython')}(${ex}$);`, L);
      const guardado = this.excActual;
      this.excActual = ex;
      s.manejadores.forEach((m, i) => {
        this.lineaActual = m.L;
        const c = m.tipo ? `${this.h('$coincide')}(${ex}, ${this.expr(m.tipo)})` : 'true';
        this.emitir(`${i ? '} else if' : 'if'} (${c}) {`, m.L);
        this.sang++;
        if (m.nombre) this.emitir(`${this.resolver(m.nombre, m)} = ${ex};`, m.L);
        this.sang--;
        this.bloque(m.cuerpo);
      });
      this.emitir(`} else throw ${ex};`, L);
      this.excActual = guardado;
      this.sang--;
      this.emitir('}', L);
    } else {
      this.emitir('{', L); this.bloque(s.cuerpo); if (ok) { this.sang++; this.emitir(`${ok} = true;`, L); this.sang--; } this.emitir('}', L);
    }
    if (ok) { this.emitir(`if (${ok}) {`, L); this.bloque(s.sino); this.emitir('}', L); }
    if (s.final) {
      this.sang--;
      this.emitir('} finally {', L);
      this.bloque(s.final);
      this.emitir('}', L);
    }
  }
  revisarModulo(nombre, s) {
    const base = nombre.split('.')[0];
    if (!(nombre in this.modulos) && !(base in this.modulos)) this.err(`el simulador no tiene el modulo '${nombre}' (tiene: ${Object.keys(this.modulos).filter(m => !m.includes('.')).sort().join(', ')})`, s);
  }
  // Una funcion de Python -> function* de JS con sus metadatos.
  funcion(nombre, params, cuerpo, nodo, esLambda) {
    const info = tpAsignados(cuerpo);
    for (const p of params) info.asig.add(p.nombre);
    const locales = new Set([...info.asig].filter(n => !info.glob.has(n) && !info.noloc.has(n)));
    // Los valores por defecto se calculan al definir la funcion (como en Python).
    const defs = params.map(p => {
      if (!p.def) return null;
      const c = this.expr(p.def);
      if (/^(\(?-?[\d.e+]+\)?|"(?:[^"\\]|\\.)*"|true|false|null)$/.test(c)) return c;
      const t = this.temp();
      this.emitir(`${t} = ${c};`, nodo && nodo.L);
      return t;
    });
    const amb = { tipo: 'funcion', locales, glob: info.glob, noloc: info.noloc, temps: 0 };
    const guardado = { salida: this.salida, mapa: this.mapa, sang: this.sang };
    this.salida = []; this.mapa = []; this.sang = 1;
    this.ambitos.push(amb);
    const guardaMetodo = this.metodoActual;
    if (!(nodo && nodo.esMetodo)) this.metodoActual = null;
    else this.metodoActual = { clase: nodo.claseJs, self: params.length ? tpJs(params[0].nombre) : 'null' };
    try {
      const noParams = [...locales].filter(n => !params.some(p => p.nombre === n));
      const cuerpoFn = [];
      const salida = this.salida;
      for (const st of cuerpo) this.sentencia(st);
      const lineas = this.salida, mapa = this.mapa;
      this.salida = guardado.salida; this.mapa = guardado.mapa; this.sang = guardado.sang;
      // cabecera
      const ps = params.map((p, i) => {
        const js = tpJs(p.nombre);
        return defs[i] !== null ? `${js} = ${defs[i]}` : js;
      });
      const meta = JSON.stringify(params.map(p => ({ n: p.nombre, t: p.tipo, d: !!p.def })));
      const vars = noParams.map(tpJs);
      const temps = Array.from({ length: amb.temps }, (_, i) => '$' + (i + 1));
      const prologo = [];
      if (vars.length || temps.length) prologo.push(`let ${vars.concat(temps).join(', ')};`);
      params.forEach(p => { if (p.tipo === '*') prologo.push(`${tpJs(p.nombre)} = ${this.h('$tupla')}(${tpJs(p.nombre)} || []);`); });
      const id = ++this.nDef;
      // el cuerpo se arma como texto multilinea dentro de la expresion
      const indent = '  '.repeat(this.sang + 1);
      const cuerpoTxt = [...prologo.map(l => indent + l), ...lineas.map(l => indent + l), indent + 'return null;'];
      this.funcionesPendientes = this.funcionesPendientes || [];
      const marca = `/*@fn${id}@*/`;
      this.funcionesPendientes.push({ marca, cuerpo: cuerpoTxt, mapa: [...prologo.map(() => nodo.L), ...mapa.map(x => x), nodo.L] });
      return `${this.h('$funcion')}(${JSON.stringify(nombre)}, ${meta}, function* (${ps.join(', ')}) {${marca}\n${'  '.repeat(this.sang)}})`;
    } finally {
      this.ambitos.pop();
      this.metodoActual = guardaMetodo;
    }
  }
  sClase(s) {
    const L = s.L;
    this.emitir(`if (${this.h('$t')}(${TP_COSTO_SENTENCIA * 3})) yield;`, L);
    const claseJs = '$K' + (++this.nClase);
    const destino = this.resolver(s.nombre, s);
    const info = tpAsignados(s.cuerpo);
    const amb = { tipo: 'clase', asig: info.asig };
    const bases = s.bases.map(b => this.expr(b)).join(', ');
    this.claseDeclaradas = this.claseDeclaradas || [];
    this.claseDeclaradas.push(claseJs);
    this.emitir(`${destino} = ${claseJs} = (yield* ${this.h('$clase')}(${JSON.stringify(s.nombre)}, [${bases}], function* ($ns) {`, L);
    this.ambitos.push(amb);
    this.sang++;
    for (const st of s.cuerpo) {
      if (st.k === 'def') {
        this.lineaActual = st.L;
        st.esMetodo = true; st.claseJs = claseJs;
        let f = this.funcion(st.nombre, st.params, st.cuerpo, st, false);
        for (const d of (st.decoradores || []).slice().reverse()) {
          if (d.k === 'nombre' && d.n === 'staticmethod') f = `${this.h('$estatico')}(${f})`;
          else if (d.k === 'nombre' && d.n === 'classmethod') f = `${this.h('$declase')}(${f})`;
          else if (d.k === 'nombre' && d.n === 'property') f = `${this.h('$propiedad')}(${f})`;
          else f = `(yield* ${this.h('$llamar')}(${this.expr(d)}, [${f}], null))`;
        }
        this.emitir(`$ns[${JSON.stringify(st.nombre)}] = ${f};`, st.L);
      } else this.sentencia(st);
    }
    this.sang--;
    this.ambitos.pop();
    this.emitir('}));', L);
  }
  modulo(cuerpo) {
    const info = tpAsignados(cuerpo);
    const locales = new Set(info.asig);
    this.ambitos = [{ tipo: 'modulo', locales, temps: 0 }];
    this.defsModulo = new Map();
    const cuenta = new Map();
    for (const s of cuerpo) {
      if (s.k === 'def') { cuenta.set(s.nombre, (cuenta.get(s.nombre) || 0) + 1); this.defsModulo.set(s.nombre, s); }
    }
    // Solo se llaman directo las funciones que se definen una vez y nunca se reasignan.
    const reasignados = new Set();
    const mirar = st => {
      if (st.k === 'asig') st.objetivos.forEach(o => { if (o.k === 'nombre') reasignados.add(o.n); });
      if (st.k === 'aum' && st.objetivo.k === 'nombre') reasignados.add(st.objetivo.n);
      if (st.k === 'import' || st.k === 'desde' || st.k === 'class') tpAsignados([st]).asig.forEach(n => reasignados.add(n));
      for (const k of ['cuerpo', 'sino', 'final']) if (Array.isArray(st[k])) st[k].forEach(mirar);
      if (st.ramas) st.ramas.forEach(r => r.cuerpo.forEach(mirar));
      if (st.manejadores) st.manejadores.forEach(m => m.cuerpo.forEach(mirar));
    };
    cuerpo.forEach(mirar);
    for (const [n, c] of cuenta) if (c > 1 || reasignados.has(n) || (s => s.decoradores && s.decoradores.length)(this.defsModulo.get(n))) this.defsModulo.delete(n);
    this.sang = 1;
    for (const s of cuerpo) this.sentencia(s);
    const cuerpoPrincipal = this.salida, mapaPrincipal = this.mapa;
    // expandir las funciones anidadas (el texto de cada cuerpo va en su marca)
    const expandir = (lineas, mapa) => {
      const outL = [], outM = [];
      lineas.forEach((l, i) => {
        const m = /\/\*@fn(\d+)@\*\//.exec(l);
        if (!m) { outL.push(l); outM.push(mapa[i]); return; }
        const f = this.funcionesPendientes.find(x => x.marca === m[0]);
        const [antes, despues] = l.split(m[0]);
        outL.push(antes); outM.push(mapa[i]);
        const sub = expandir(f.cuerpo, f.mapa);
        outL.push(...sub.l); outM.push(...sub.m);
        outL.push(despues.replace(/^\n/, '')); outM.push(mapa[i]);
      });
      return { l: outL, m: outM };
    };
    const principal = expandir(cuerpoPrincipal, mapaPrincipal);
    const out = [], mapa = [];
    const push = (t, L) => { out.push(t); mapa.push(L || 0); };
    push("'use strict';");
    push(`const { ${[...this.ayudas].sort().join(', ')} } = __py;`);
    const globs = [...locales].map(tpJs);
    const temps = Array.from({ length: this.ambitos[0].temps }, (_, i) => '$' + (i + 1));
    if (globs.length || temps.length || this.claseDeclaradas) push(`let ${globs.concat(temps).concat(this.claseDeclaradas || []).join(', ')};`);
    push('function* $principal() {');
    principal.l.forEach((l, i) => push(l, principal.m[i]));
    push('}');
    push(`function $vars() { return { ${[...locales].map(n => `${JSON.stringify(n)}: ${tpJs(n)}`).join(', ')} }; }`);
    push('return { principal: $principal, vars: $vars };');
    return { codigo: out.join('\n'), mapa };
  }
}

function traducirPython(texto, modulos) {
  const res = { ok: false, codigo: null, mapa: [], errores: [], avisos: [] };
  try {
    const toks = tpTokenizar(String(texto));
    const cuerpo = new TPParser(toks).modulo();
    const gen = new TPGenerador(modulos || (typeof PY_MODULOS_NOMBRES !== 'undefined' ? PY_MODULOS_NOMBRES : {}));
    const r = gen.modulo(cuerpo);
    res.codigo = r.codigo; res.mapa = r.mapa; res.ok = true;
  } catch (x) {
    if (!(x instanceof ErrorPython)) throw x;
    res.errores.push({ linea: x.linea, archivo: 'code.py', msg: x.message });
  }
  return res;
}
