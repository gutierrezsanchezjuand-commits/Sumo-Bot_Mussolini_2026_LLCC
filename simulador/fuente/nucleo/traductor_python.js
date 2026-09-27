
/* ==========================================================================
   TRADUCTOR DE CIRCUITPYTHON: el code.py a JavaScript con generadores.
   Lexico con sangria (INDENT/DEDENT), parser de Python 3 (lo que usa un
   programa de robot: funciones, clases simples, listas, dict, try/except,
   comprensiones, f-strings) y un generador que respeta la semantica de
   Python con ayuda del runtime (api_python.js): // y % de Python, verdad
   de listas vacias, errores con el nombre de Python (ZeroDivisionError,
   IndexError, ...). Cada sentencia cuesta un poco de tiempo del ESP32 y
   todo es un generador: el simulador puede pausar el programa en cualquier
   punto. Los ayudantes del runtime empiezan con $ (Python no los puede
   nombrar), asi nunca chocan con los nombres del programa.
   ========================================================================== */
class ErrorPython extends Error {
  constructor(msg, linea) { super(msg); this.linea = linea; }
}

// ─────────────────────────── léxico ───────────────────────────
const TP_OPS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '<<', '>>', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=',
  '%=', '&=', '|=', '^=', '@=', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':',
  '.', ';', '=', '!'];
const TP_CLAVES = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield']);

function tpEscape(s, i) {
  const c = s[i];
  const simples = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '\n': '' };
  if (c === 'x') return { v: String.fromCharCode(parseInt(s.substr(i + 1, 2), 16)), fin: i + 3 };
  if (c === 'u') return { v: String.fromCharCode(parseInt(s.substr(i + 1, 4), 16)), fin: i + 5 };
  if (/[0-7]/.test(c)) { let j = i, o = ''; while (j < s.length && o.length < 3 && /[0-7]/.test(s[j])) o += s[j++]; return { v: String.fromCharCode(parseInt(o, 8)), fin: j }; }
  if (c in simples) return { v: simples[c], fin: i + 1 };
  return { v: '\\' + c, fin: i + 1 };
}

function tpTokenizar(texto, lineaBase) {
  const s = texto.replace(/\r\n?/g, '\n');
  const toks = [];
  const pila = [0];
  let i = 0, linea = lineaBase || 1, prof = 0, inicioLinea = true;
  const n = s.length;
  const err = (msg) => { throw new ErrorPython(msg, linea); };
  while (i < n) {
    if (inicioLinea && prof === 0) {
      // sangria de la linea logica
      let col = 0, j = i;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\f')) { col = s[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1; j++; }
      if (j >= n) { i = j; break; }
      if (s[j] === '\n') { i = j + 1; linea++; continue; }
      if (s[j] === '#') { while (j < n && s[j] !== '\n') j++; i = j; continue; }
      if (s[j] === '\\' && s[j + 1] === '\n') { i = j + 2; linea++; continue; }
      i = j;
      inicioLinea = false;
      const tope = pila[pila.length - 1];
      if (col > tope) { pila.push(col); toks.push({ t: 'indent', linea }); }
      else if (col < tope) {
        while (pila.length > 1 && col < pila[pila.length - 1]) { pila.pop(); toks.push({ t: 'dedent', linea }); }
        if (col !== pila[pila.length - 1]) err('la sangria no coincide con ningun nivel anterior (IndentationError)');
      }
      continue;
    }
    const c = s[i];
    if (c === '\n') { if (prof === 0) { toks.push({ t: 'nl', linea }); inicioLinea = true; } i++; linea++; continue; }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\r') { i++; continue; }
    if (c === '#') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '\\' && s[i + 1] === '\n') { i += 2; linea++; continue; }
    // textos (con prefijo)
    const mPref = /^([rRbBuUfF]{0,2})(['"])/.exec(s.slice(i, i + 3));
    if (mPref && (mPref[1] === '' || /^[A-Za-z]+$/.test(mPref[1])) && (mPref[1].length === 0 || !/[A-Za-z0-9_]/.test(s[i - 1] || ''))) {
      const pref = mPref[1].toLowerCase();
      if (/[^rbuf]/.test(pref)) { /* no es prefijo */ }
      else {
        const crudo = pref.includes('r'), fstr = pref.includes('f');
        let j = i + mPref[1].length;
        const q = s[j];
        const triple = s.substr(j, 3) === q + q + q;
        const cierre = triple ? q + q + q : q;
        j += cierre.length;
        const l0 = linea;
        let v = '', raw = '';
        while (j < n && s.substr(j, cierre.length) !== cierre) {
          if (s[j] === '\n') { if (!triple) err('texto sin cerrar (falta la comilla del final)'); linea++; }
          if (s[j] === '\\' && j + 1 < n) {
            raw += s[j] + s[j + 1];
            if (crudo) { v += s[j] + s[j + 1]; if (s[j + 1] === '\n') linea++; j += 2; continue; }
            if (s[j + 1] === '\n') linea++;
            const e = tpEscape(s, j + 1); v += e.v; j = e.fin; continue;
          }
          raw += s[j]; v += s[j]; j++;
        }
        if (j >= n) err('texto sin cerrar (falta la comilla del final)');
        j += cierre.length;
        if (fstr) toks.push({ t: 'fstr', v: raw, crudo, linea: l0 });
        else toks.push({ t: 'str', v, linea: l0 });
        i = j;
        continue;
      }
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_À-￿]/.test(s[j])) j++;
      const v = s.slice(i, j);
      toks.push({ t: TP_CLAVES.has(v) ? 'kw' : 'nombre', v, linea });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let m = /^(0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?))([jJ]?)/.exec(s.slice(i));
      if (!m) err('numero invalido');
      if (m[2]) err('los numeros complejos no estan soportados');
      const txt = m[1].replace(/_/g, '');
      let v, flot = false;
      if (/^0[xX]/.test(txt)) v = parseInt(txt.slice(2), 16);
      else if (/^0[oO]/.test(txt)) v = parseInt(txt.slice(2), 8);
      else if (/^0[bB]/.test(txt)) v = parseInt(txt.slice(2), 2);
      else { v = Number(txt); flot = /[.eE]/.test(txt); }
      toks.push({ t: 'num', v, flot, linea });
      i += m[0].length; continue;
    }
    let op = null;
    for (const o of TP_OPS) if (s.startsWith(o, i)) { op = o; break; }
    if (!op) err(`caracter inesperado '${c}'`);
    if (op === '(' || op === '[' || op === '{') prof++;
    if (op === ')' || op === ']' || op === '}') prof = Math.max(0, prof - 1);
    toks.push({ t: 'op', v: op, linea });
    i += op.length;
  }
  if (toks.length && toks[toks.length - 1].t !== 'nl') toks.push({ t: 'nl', linea });
  while (pila.length > 1) { pila.pop(); toks.push({ t: 'dedent', linea }); }
  toks.push({ t: 'fin', linea });
  return toks;
}

// Partes de un f-string: texto y campos { expr (fuente), conv, spec (partes) }.
function tpPartesF(raw, crudo, linea) {
  const partes = [];
  let i = 0, lit = '';
  const n = raw.length;
  const litFin = () => { if (lit) { partes.push(crudo ? lit : tpDesescapar(lit)); lit = ''; } };
  while (i < n) {
    const c = raw[i];
    if (c === '{' && raw[i + 1] === '{') { lit += '{'; i += 2; continue; }
    if (c === '}' && raw[i + 1] === '}') { lit += '}'; i += 2; continue; }
    if (c === '{') {
      litFin();
      let j = i + 1, prof = 0, q = null;
      let expr = '', conv = null, spec = null;
      for (; j < n; j++) {
        const d = raw[j];
        if (q) { expr += d; if (d === q) q = null; continue; }
        if (d === "'" || d === '"') { q = d; expr += d; continue; }
        if (d === '(' || d === '[' || d === '{') prof++;
        if (d === ')' || d === ']' || d === '}') { if (prof === 0) break; prof--; }
        if (prof === 0 && d === '!' && raw[j + 1] !== '=') { conv = raw[j + 1]; j += 2; break; }
        if (prof === 0 && d === ':') break;
        expr += d;
      }
      if (raw[j] === ':') {
        let k = j + 1, p2 = 0, sp = '';
        for (; k < n; k++) { if (raw[k] === '{') p2++; if (raw[k] === '}') { if (p2 === 0) break; p2--; } sp += raw[k]; }
        spec = tpPartesF(sp, true, linea);
        j = k;
      }
      if (raw[j] !== '}') throw new ErrorPython('f-string con una llave { sin cerrar', linea);
      const eq = /=\s*$/.test(expr) && !/[=!<>]=\s*$/.test(expr);
      if (eq) { partes.push(expr); expr = expr.replace(/=\s*$/, ''); if (!conv && !spec) conv = 'r'; }
      partes.push({ expr: expr.trim(), conv, spec });
      i = j + 1;
      continue;
    }
    if (c === '}') throw new ErrorPython("f-string con una llave } suelta (usa '}}')", linea);
    lit += c; i++;
  }
  litFin();
  return partes;
}
function tpDesescapar(s) {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { const e = tpEscape(s, i + 1); r += e.v; i = e.fin - 1; }
    else r += s[i];
  }
  return r;
}
