
// ─────────────────────────── parser de Python ───────────────────────────
const TP_ASIG_AUM = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '>>=', '<<=', '&=', '|=', '^=', '@=']);
const TP_CMP = new Set(['<', '>', '==', '>=', '<=', '!=']);

class TPParser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  ver(k = 0) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  sig() { return this.toks[this.i++]; }
  es(t, v, k = 0) { const x = this.ver(k); return x.t === t && (v === undefined || x.v === v); }
  op(v, k = 0) { return this.es('op', v, k); }
  kw(v, k = 0) { return this.es('kw', v, k); }
  err(msg, t) { t = t || this.ver(); throw new ErrorPython(msg, t.linea); }
  esperarOp(v) {
    if (!this.op(v)) {
      const t = this.ver();
      const que = t.t === 'nl' ? 'el final de la linea' : t.t === 'indent' ? 'una sangria de mas' : t.t === 'dedent' ? 'el final del bloque' : `'${t.v}'`;
      this.err(`se esperaba '${v}' y aparece ${que}`);
    }
    return this.sig();
  }
  esperarKw(v) { if (!this.kw(v)) this.err(`se esperaba '${v}'`); return this.sig(); }
  nombre() { const t = this.ver(); if (t.t !== 'nombre') this.err(`se esperaba un nombre y aparece '${t.v === undefined ? t.t : t.v}'`); return this.sig().v; }
  fin() { return this.ver().t === 'fin'; }

  modulo() {
    const cuerpo = [];
    while (!this.fin()) {
      if (this.es('nl')) { this.sig(); continue; }
      if (this.es('indent')) this.err('sangria inesperada (IndentationError)');
      cuerpo.push(...this.sentencia());
    }
    return cuerpo;
  }
  bloque() {
    // despues de ':'
    if (!this.es('nl')) { const s = this.simples(); return s; }
    this.sig();
    if (!this.es('indent')) this.err('se esperaba un bloque con sangria despues de ":" (IndentationError)');
    this.sig();
    const cuerpo = [];
    while (!this.es('dedent') && !this.fin()) {
      if (this.es('nl')) { this.sig(); continue; }
      cuerpo.push(...this.sentencia());
    }
    if (this.es('dedent')) this.sig();
    return cuerpo;
  }
  sentencia() {
    const t = this.ver();
    if (t.t === 'op' && t.v === '@') {
      const decs = [];
      while (this.op('@')) { this.sig(); decs.push(this.expr()); if (this.es('nl')) this.sig(); }
      const d = this.sentencia();
      if (!d.length || (d[0].k !== 'def' && d[0].k !== 'class')) this.err('un decorador tiene que ir antes de def o class', t);
      d[0].decoradores = decs;
      return d;
    }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': return [this.sIf()];
        case 'while': {
          this.sig(); const c = this.exprTest(); this.esperarOp(':');
          const cuerpo = this.bloque();
          let sino = null;
          if (this.kw('else')) { this.sig(); this.esperarOp(':'); sino = this.bloque(); }
          return [{ k: 'while', c, cuerpo, sino, L: t.linea }];
        }
        case 'for': {
          this.sig();
          const objetivo = this.listaObjetivos();
          this.esperarKw('in');
          const iter = this.listaExpr();
          this.esperarOp(':');
          const cuerpo = this.bloque();
          let sino = null;
          if (this.kw('else')) { this.sig(); this.esperarOp(':'); sino = this.bloque(); }
          return [{ k: 'for', objetivo, iter, cuerpo, sino, L: t.linea }];
        }
        case 'try': return [this.sTry()];
        case 'def': return [this.sDef()];
        case 'class': return [this.sClass()];
        case 'with': {
          this.sig();
          const items = [];
          for (;;) {
            const e = this.exprTest();
            let como = null;
            if (this.kw('as')) { this.sig(); como = this.objetivo(); }
            items.push({ e, como });
            if (this.op(',')) { this.sig(); continue; }
            break;
          }
          this.esperarOp(':');
          return [{ k: 'with', items, cuerpo: this.bloque(), L: t.linea }];
        }
        case 'async': this.err('async/await no esta soportado en el simulador');
      }
    }
    return this.simples();
  }
  sIf() {
    const t = this.sig();
    const ramas = [];
    let c = this.exprTest(); this.esperarOp(':');
    ramas.push({ c, cuerpo: this.bloque(), L: t.linea });
    let sino = null;
    for (;;) {
      if (this.kw('elif')) { const t2 = this.sig(); c = this.exprTest(); this.esperarOp(':'); ramas.push({ c, cuerpo: this.bloque(), L: t2.linea }); continue; }
      if (this.kw('else')) { this.sig(); this.esperarOp(':'); sino = this.bloque(); }
      break;
    }
    return { k: 'if', ramas, sino, L: t.linea };
  }
  sTry() {
    const t = this.sig(); this.esperarOp(':');
    const cuerpo = this.bloque();
    const manejadores = [];
    let sino = null, final = null;
    while (this.kw('except')) {
      const te = this.sig();
      let tipo = null, nombre = null;
      if (!this.op(':')) {
        tipo = this.exprTest();
        if (this.kw('as')) { this.sig(); nombre = this.nombre(); }
        else if (this.op(',')) { this.sig(); nombre = this.nombre(); }
      }
      this.esperarOp(':');
      manejadores.push({ tipo, nombre, cuerpo: this.bloque(), L: te.linea });
    }
    if (this.kw('else')) { this.sig(); this.esperarOp(':'); sino = this.bloque(); }
    if (this.kw('finally')) { this.sig(); this.esperarOp(':'); final = this.bloque(); }
    if (!manejadores.length && !final) this.err('try sin except ni finally', t);
    return { k: 'try', cuerpo, manejadores, sino, final, L: t.linea };
  }
  params(cierre) {
    const ps = [];
    let kwSolo = false;
    while (!this.op(cierre)) {
      if (this.op('/')) { this.sig(); if (this.op(',')) this.sig(); continue; }
      if (this.op('*')) {
        this.sig();
        if (this.es('nombre')) { const n = this.nombre(); if (this.op(':') && cierre === ')') { this.sig(); this.exprTest(); } ps.push({ nombre: n, tipo: '*' }); }
        kwSolo = true;
      } else if (this.op('**')) {
        this.sig(); const n = this.nombre(); if (this.op(':') && cierre === ')') { this.sig(); this.exprTest(); }
        ps.push({ nombre: n, tipo: '**' });
      } else {
        const n = this.nombre();
        if (this.op(':') && cierre === ')') { this.sig(); this.exprTest(); }
        let def = null;
        if (this.op('=')) { this.sig(); def = this.exprTest(); }
        ps.push({ nombre: n, def, tipo: kwSolo ? 'kw' : 'normal' });
      }
      if (this.op(',')) { this.sig(); continue; }
      break;
    }
    return ps;
  }
  sDef() {
    const t = this.sig();
    const nombre = this.nombre();
    this.esperarOp('(');
    const params = this.params(')');
    this.esperarOp(')');
    if (this.op('->')) { this.sig(); this.exprTest(); }
    this.esperarOp(':');
    const cuerpo = this.bloque();
    return { k: 'def', nombre, params, cuerpo, decoradores: [], L: t.linea };
  }
  sClass() {
    const t = this.sig();
    const nombre = this.nombre();
    let bases = [];
    if (this.op('(')) {
      this.sig();
      while (!this.op(')')) {
        if (this.es('nombre') && this.op('=', 1)) { this.sig(); this.sig(); this.exprTest(); }
        else bases.push(this.exprTest());
        if (this.op(',')) { this.sig(); continue; }
        break;
      }
      this.esperarOp(')');
    }
    this.esperarOp(':');
    return { k: 'class', nombre, bases, cuerpo: this.bloque(), decoradores: [], L: t.linea };
  }
  simples() {
    const res = [];
    for (;;) {
      res.push(this.simple());
      if (this.op(';')) { this.sig(); if (this.es('nl')) break; continue; }
      break;
    }
    if (this.es('nl')) this.sig();
    else if (!this.es('fin') && !this.es('dedent')) {
      const t = this.ver();
      this.err(`sobra '${t.v === undefined ? t.t : t.v}' al final de la sentencia`);
    }
    return res;
  }
  simple() {
    const t = this.ver();
    if (t.t === 'kw') {
      switch (t.v) {
        case 'pass': this.sig(); return { k: 'pass', L: t.linea };
        case 'break': this.sig(); return { k: 'break', L: t.linea };
        case 'continue': this.sig(); return { k: 'continue', L: t.linea };
        case 'return': { this.sig(); const e = (this.es('nl') || this.op(';') || this.es('fin')) ? null : this.listaExpr(); return { k: 'return', e, L: t.linea }; }
        case 'global': case 'nonlocal': {
          this.sig(); const nombres = [this.nombre()];
          while (this.op(',')) { this.sig(); nombres.push(this.nombre()); }
          return { k: t.v, nombres, L: t.linea };
        }
        case 'del': { this.sig(); const obj = [this.objetivo()]; while (this.op(',')) { this.sig(); obj.push(this.objetivo()); } return { k: 'del', objetivos: obj, L: t.linea }; }
        case 'assert': { this.sig(); const c = this.exprTest(); let msg = null; if (this.op(',')) { this.sig(); msg = this.exprTest(); } return { k: 'assert', c, msg, L: t.linea }; }
        case 'raise': {
          this.sig();
          let e = null, causa = null;
          if (!this.es('nl') && !this.op(';') && !this.es('fin')) { e = this.exprTest(); if (this.kw('from')) { this.sig(); causa = this.exprTest(); } }
          return { k: 'raise', e, causa, L: t.linea };
        }
        case 'import': {
          this.sig();
          const items = [];
          for (;;) {
            let mod = this.nombre();
            while (this.op('.')) { this.sig(); mod += '.' + this.nombre(); }
            let como = null;
            if (this.kw('as')) { this.sig(); como = this.nombre(); }
            items.push({ modulo: mod, como });
            if (this.op(',')) { this.sig(); continue; }
            break;
          }
          return { k: 'import', items, L: t.linea };
        }
        case 'from': {
          this.sig();
          let mod = '';
          while (this.op('.') || this.op('...')) mod += this.sig().v;
          if (this.es('nombre')) { mod += this.nombre(); while (this.op('.')) { this.sig(); mod += '.' + this.nombre(); } }
          this.esperarKw('import');
          const items = [];
          if (this.op('*')) { this.sig(); return { k: 'desde', modulo: mod, items: '*', L: t.linea }; }
          const par = this.op('(');
          if (par) this.sig();
          for (;;) {
            if (par && this.es('nl')) { this.sig(); continue; }
            const nombre = this.nombre();
            let como = null;
            if (this.kw('as')) { this.sig(); como = this.nombre(); }
            items.push({ nombre, como });
            if (this.op(',')) { this.sig(); if (par && this.op(')')) break; continue; }
            break;
          }
          if (par) this.esperarOp(')');
          return { k: 'desde', modulo: mod, items, L: t.linea };
        }
        case 'yield': this.err('yield (generadores de Python) no esta soportado en el simulador');
      }
    }
    // expresion o asignacion
    const e = this.listaExpr(true);
    if (this.op('=')) {
      const objetivos = [e];
      let valor;
      for (;;) {
        this.sig();
        valor = this.listaExpr(true);
        if (this.op('=')) { objetivos.push(valor); continue; }
        break;
      }
      for (const o of objetivos) this.validarObjetivo(o);
      return { k: 'asig', objetivos, valor, L: t.linea };
    }
    if (this.es('op') && TP_ASIG_AUM.has(this.ver().v)) {
      const op = this.sig().v;
      this.validarObjetivo(e, true);
      return { k: 'aum', op: op.slice(0, -1), objetivo: e, valor: this.listaExpr(), L: t.linea };
    }
    if (this.op(':')) {   // anotacion: x: int = 5
      this.sig(); this.exprTest();
      if (this.op('=')) { this.sig(); const valor = this.listaExpr(); this.validarObjetivo(e); return { k: 'asig', objetivos: [e], valor, L: t.linea }; }
      return { k: 'pass', L: t.linea };
    }
    return { k: 'expr', e, L: t.linea };
  }
  validarObjetivo(e, simple) {
    if (e.k === 'nombre' || e.k === 'attr' || e.k === 'sub') return;
    if (!simple && (e.k === 'tupla' || e.k === 'lista')) { for (const x of e.elems) this.validarObjetivo(x.k === 'estrella' ? x.e : x); return; }
    throw new ErrorPython('no se le puede asignar un valor a eso', e.L);
  }
  objetivo() { return this.expr(); }
  // Objetivo de un for: sin comparaciones (el 'in' que sigue es del for).
  listaObjetivos() {
    const t = this.ver();
    const uno = () => this.op('*') ? (this.sig(), { k: 'estrella', e: this.exprBin(1), L: t.linea }) : this.exprBin(1);
    const e = uno();
    if (!this.op(',')) return e;
    const elems = [e];
    while (this.op(',')) { this.sig(); if (this.kw('in')) break; elems.push(uno()); }
    return { k: 'tupla', elems, L: t.linea };
  }
  // expr, expr, ... (una tupla sin parentesis)
  listaExpr(conEstrella) {
    const t = this.ver();
    const uno = () => (conEstrella && this.op('*')) ? (this.sig(), { k: 'estrella', e: this.exprOr(), L: t.linea }) : this.exprTest();
    const e = uno();
    if (!this.op(',')) return e;
    const elems = [e];
    while (this.op(',')) {
      this.sig();
      if (this.es('nl') || this.op('=') || this.op(')') || this.op(';') || this.es('fin') || this.op(':') || (this.es('op') && TP_ASIG_AUM.has(this.ver().v))) break;
      elems.push(uno());
    }
    return { k: 'tupla', elems, L: t.linea };
  }
  exprTest() {
    const t = this.ver();
    if (this.kw('lambda')) {
      this.sig();
      const params = this.params(':');
      this.esperarOp(':');
      return { k: 'lambda', params, cuerpo: this.exprTest(), L: t.linea };
    }
    if (this.es('nombre') && this.op(':=', 1)) { const n = this.sig().v; this.sig(); return { k: 'walrus', n, e: this.exprTest(), L: t.linea }; }
    const a = this.exprOr();
    if (this.kw('if')) {
      this.sig();
      const c = this.exprOr();
      this.esperarKw('else');
      const b = this.exprTest();
      return { k: 'ternario', c, a, b, L: t.linea };
    }
    return a;
  }
  expr() { return this.exprTest(); }
  exprOr() {
    const t = this.ver();
    let a = this.exprAnd();
    if (!this.kw('or')) return a;
    const vals = [a];
    while (this.kw('or')) { this.sig(); vals.push(this.exprAnd()); }
    return { k: 'boolop', op: 'or', vals, L: t.linea };
  }
  exprAnd() {
    const t = this.ver();
    let a = this.exprNot();
    if (!this.kw('and')) return a;
    const vals = [a];
    while (this.kw('and')) { this.sig(); vals.push(this.exprNot()); }
    return { k: 'boolop', op: 'and', vals, L: t.linea };
  }
  exprNot() {
    const t = this.ver();
    if (this.kw('not')) { this.sig(); return { k: 'not', a: this.exprNot(), L: t.linea }; }
    return this.exprCmp();
  }
  exprCmp() {
    const t = this.ver();
    const a = this.exprBin(1);
    const ops = [], vals = [];
    for (;;) {
      const x = this.ver();
      let op = null;
      if (x.t === 'op' && TP_CMP.has(x.v)) { op = x.v; this.sig(); }
      else if (this.kw('in')) { op = 'in'; this.sig(); }
      else if (this.kw('not') && this.kw('in', 1)) { op = 'not in'; this.sig(); this.sig(); }
      else if (this.kw('is')) { this.sig(); if (this.kw('not')) { this.sig(); op = 'is not'; } else op = 'is'; }
      else if (x.t === 'op' && x.v === '<>') this.err('<> no existe en Python 3: usa !=');
      if (!op) break;
      ops.push(op); vals.push(this.exprBin(1));
    }
    if (!ops.length) return a;
    return { k: 'cmp', a, ops, vals, L: t.linea };
  }
  exprBin(nivel) {
    // 1: |  2: ^  3: &  4: << >>  5: + -  6: * / // % @
    const OPS = [null, ['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '//', '%', '@']];
    if (nivel > 6) return this.exprUnario();
    const t = this.ver();
    let a = this.exprBin(nivel + 1);
    while (this.es('op') && OPS[nivel].includes(this.ver().v)) {
      const op = this.sig().v;
      a = { k: 'bin', op, a, b: this.exprBin(nivel + 1), L: t.linea };
    }
    return a;
  }
  exprUnario() {
    const t = this.ver();
    if (this.op('-') || this.op('+') || this.op('~')) { const op = this.sig().v; return { k: 'un', op, a: this.exprUnario(), L: t.linea }; }
    return this.exprPot();
  }
  exprPot() {
    const t = this.ver();
    if (this.kw('await')) this.err('await no esta soportado');
    const a = this.postfijo(this.atomo());
    if (this.op('**')) { this.sig(); return { k: 'bin', op: '**', a, b: this.exprUnario(), L: t.linea }; }
    return a;
  }
  postfijo(e) {
    for (;;) {
      const t = this.ver();
      if (this.op('.')) { this.sig(); e = { k: 'attr', o: e, n: this.nombre(), L: t.linea }; continue; }
      if (this.op('(')) { this.sig(); const a = this.argumentos(); e = { k: 'call', f: e, args: a.args, kw: a.kw, L: t.linea }; continue; }
      if (this.op('[')) { this.sig(); const i = this.subindice(); this.esperarOp(']'); e = { k: 'sub', o: e, i, L: t.linea }; continue; }
      return e;
    }
  }
  subindice() {
    const t = this.ver();
    const parte = () => {
      if (this.op(':') || this.op(']') || this.op(',')) {
        // slice que empieza vacio
      } else {
        const x = this.exprTest();
        if (!this.op(':')) return x;
        return this.restoSlice(x, t);
      }
      return this.restoSlice(null, t);
    };
    const a = parte();
    if (!this.op(',')) return a;
    const elems = [a];
    while (this.op(',')) { this.sig(); if (this.op(']')) break; elems.push(parte()); }
    return { k: 'tupla', elems, L: t.linea };
  }
  restoSlice(inicio, t) {
    this.esperarOp(':');
    let fin = null, paso = null;
    if (!this.op(']') && !this.op(':') && !this.op(',')) fin = this.exprTest();
    if (this.op(':')) { this.sig(); if (!this.op(']') && !this.op(',')) paso = this.exprTest(); }
    return { k: 'slice', inicio, fin, paso, L: t.linea };
  }
  argumentos() {
    const args = [], kw = [];
    while (!this.op(')')) {
      const t = this.ver();
      if (this.op('*')) { this.sig(); args.push({ k: 'estrella', e: this.exprTest(), L: t.linea }); }
      else if (this.op('**')) { this.sig(); kw.push({ n: null, e: this.exprTest() }); }
      else if (this.es('nombre') && this.op('=', 1)) { const n = this.sig().v; this.sig(); kw.push({ n, e: this.exprTest() }); }
      else {
        const e = this.exprTest();
        if (this.kw('for')) { args.push(this.comprension('gen', e, t)); }
        else args.push(e);
      }
      if (this.op(',')) { this.sig(); continue; }
      break;
    }
    this.esperarOp(')');
    return { args, kw };
  }
  comprension(tipo, elem, t, valor) {
    const gens = [];
    while (this.kw('for')) {
      this.sig();
      const objetivo = this.listaObjetivos();
      this.esperarKw('in');
      const iter = this.exprOr();
      const conds = [];
      while (this.kw('if')) { this.sig(); conds.push(this.exprOrSinTernario()); }
      gens.push({ objetivo, iter, conds });
    }
    return { k: 'comp', tipo, elem, valor: valor || null, gens, L: t.linea };
  }
  exprOrSinTernario() { return this.exprOr(); }
  atomo() {
    const t = this.sig();
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v, flot: t.flot, L: t.linea };
      case 'str': case 'fstr': {
        const partes = [];
        let x = t;
        for (;;) {
          if (x.t === 'str') partes.push(x.v);
          else for (const p of tpPartesF(x.v, x.crudo, x.linea)) partes.push(p);
          if (this.es('str') || this.es('fstr')) { x = this.sig(); continue; }
          break;
        }
        if (partes.every(p => typeof p === 'string')) return { k: 'str', v: partes.join(''), L: t.linea };
        for (const p of partes) if (typeof p !== 'string') {
          p.ast = new TPParser(tpTokenizar('(' + p.expr + ')', t.linea)).exprSolo();
          if (p.spec) for (const q of p.spec) if (typeof q !== 'string') q.ast = new TPParser(tpTokenizar('(' + q.expr + ')', t.linea)).exprSolo();
        }
        return { k: 'fstr', partes, L: t.linea };
      }
      case 'nombre': return { k: 'nombre', n: t.v, L: t.linea };
      case 'kw':
        if (t.v === 'True') return { k: 'const', v: true, L: t.linea };
        if (t.v === 'False') return { k: 'const', v: false, L: t.linea };
        if (t.v === 'None') return { k: 'const', v: null, L: t.linea };
        if (t.v === 'lambda') { this.i--; return this.exprTest(); }
        if (t.v === 'yield') this.err('yield no esta soportado', t);
        this.err(`no se esperaba '${t.v}' aca`, t);
        break;
      case 'op':
        if (t.v === '...') return { k: 'const', v: '...', L: t.linea };
        if (t.v === '(') {
          if (this.op(')')) { this.sig(); return { k: 'tupla', elems: [], L: t.linea }; }
          const e = this.op('*') ? (this.sig(), { k: 'estrella', e: this.exprOr(), L: t.linea }) : this.exprTest();
          if (this.kw('for')) { const c = this.comprension('gen', e, t); this.esperarOp(')'); return c; }
          if (this.op(')')) { this.sig(); if (e.k === 'estrella') this.err('*x suelto entre parentesis'); return Object.assign({}, e, { paren: true }); }
          const elems = [e];
          while (this.op(',')) {
            this.sig();
            if (this.op(')')) break;
            elems.push(this.op('*') ? (this.sig(), { k: 'estrella', e: this.exprOr(), L: t.linea }) : this.exprTest());
          }
          this.esperarOp(')');
          return { k: 'tupla', elems, L: t.linea };
        }
        if (t.v === '[') {
          if (this.op(']')) { this.sig(); return { k: 'lista', elems: [], L: t.linea }; }
          const e = this.op('*') ? (this.sig(), { k: 'estrella', e: this.exprOr(), L: t.linea }) : this.exprTest();
          if (this.kw('for')) { const c = this.comprension('lista', e, t); this.esperarOp(']'); return c; }
          const elems = [e];
          while (this.op(',')) {
            this.sig();
            if (this.op(']')) break;
            elems.push(this.op('*') ? (this.sig(), { k: 'estrella', e: this.exprOr(), L: t.linea }) : this.exprTest());
          }
          this.esperarOp(']');
          return { k: 'lista', elems, L: t.linea };
        }
        if (t.v === '{') {
          if (this.op('}')) { this.sig(); return { k: 'dict', pares: [], L: t.linea }; }
          if (this.op('**')) {
            const pares = [];
            for (;;) {
              if (this.op('**')) { this.sig(); pares.push({ doble: this.exprOr() }); }
              else { const kk = this.exprTest(); this.esperarOp(':'); pares.push({ k: kk, v: this.exprTest() }); }
              if (this.op(',')) { this.sig(); if (this.op('}')) break; continue; }
              break;
            }
            this.esperarOp('}');
            return { k: 'dict', pares, L: t.linea };
          }
          const a = this.exprTest();
          if (this.op(':')) {
            this.sig();
            const b = this.exprTest();
            if (this.kw('for')) { const c = this.comprension('dict', a, t, b); this.esperarOp('}'); return c; }
            const pares = [{ k: a, v: b }];
            while (this.op(',')) {
              this.sig();
              if (this.op('}')) break;
              if (this.op('**')) { this.sig(); pares.push({ doble: this.exprOr() }); continue; }
              const kk = this.exprTest(); this.esperarOp(':'); pares.push({ k: kk, v: this.exprTest() });
            }
            this.esperarOp('}');
            return { k: 'dict', pares, L: t.linea };
          }
          if (this.kw('for')) { const c = this.comprension('set', a, t); this.esperarOp('}'); return c; }
          const elems = [a];
          while (this.op(',')) { this.sig(); if (this.op('}')) break; elems.push(this.exprTest()); }
          this.esperarOp('}');
          return { k: 'set', elems, L: t.linea };
        }
        break;
      case 'nl': this.err('la linea termina antes de tiempo (falta algo despues)', t); break;
      case 'indent': this.err('sangria inesperada (IndentationError)', t); break;
      case 'dedent': case 'fin': this.err('el codigo termina antes de tiempo', t); break;
    }
    this.err(`no se esperaba '${t.v}' aca`, t);
  }
  exprSolo() { const e = this.exprTest(); return e; }
}
