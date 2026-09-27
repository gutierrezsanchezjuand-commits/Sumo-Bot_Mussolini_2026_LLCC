(function () {
'use strict';
const S = window.SimSumo;
const $ = id => document.getElementById(id);
const GRAD = Math.PI / 180;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// ───────────── configuracion (se recuerda en este navegador) ─────────────
const CLAVE = 'simSumoCfg.v4';        // v4: programas y pines configurables
const CLAVE_PROG = 'simSumoProgramas.v1';
function leerLS(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? def : v; } catch (e) { return def; } }
function escribirLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function guardar() { escribirLS(CLAVE, Object.assign({}, cfg, { velocidad, arranqueRapido })); }
const prev = leerLS(CLAVE, {});
const cfg = Object.assign({}, S.CFG_DEF, { programa: S.PROGRAMA_DEF, programaRival: S.PROGRAMA_RIVAL_DEF, modoSimple: false });
for (const k of ['ronda', 'rival', 'dojo', 'perfilIR', 'destellos', 'imuAusente', 'operadorAuto', 'v0', 'desbalance', 'fuerzaRival', 'masaCaja',
  'perdidaEcoContacto', 'semilla', 'posiciones', 'programa', 'programaRival', 'modoSimple', 'modeloIMU', 'pines'])
  if (prev[k] !== undefined) cfg[k] = prev[k];
let velocidad = prev.velocidad || 1;
let arranqueRapido = prev.arranqueRapido !== false;

// Programas cargados por la persona: { id, nombre, archivos: [{ nombre, texto }] }
let propios = leerLS(CLAVE_PROG, []);
if (!Array.isArray(propios)) propios = [];
function registrarPropio(p) {
  const prog = S.programaDesdeArchivos(p.archivos, p.nombre);
  prog.id = p.id; prog.propio = true;
  S.registrarPrograma(prog);
  return prog;
}
for (const p of propios) { try { registrarPropio(p); } catch (e) { /* un programa roto no impide arrancar */ } }
function guardarPropios() {
  if (!escribirLS(CLAVE_PROG, propios)) mostrarAviso('', 'No se pudo guardar en este navegador (sin espacio o sin permiso). El programa queda hasta que cierres la página.', [['Entendido', ocultarAviso]]);
}
const VACIO = S.programaArduino('vacio', 'Sin programa', [{ nombre: 'vacio.ino', texto: 'void setup() {}\nvoid loop() { delay(100); }\n' }]);

// ───────────── estado de la app ─────────────
let sim = null;
let iniciado = false;
let corriendo = false;
let ultimoCuadro = performance.now();
let vistaInforme = { n: 0, sim: null };
let seleccion = null;
let arrastre = null;
let colores = {};
let proxColores = 0;
let proxPaneles = 0;
let proxLento = 0;
let serialN = -1;
let varsPrevias = {};
let errorPrograma = null;

function programaElegido(id) {
  return S.PROGRAMAS[id] || S.PROGRAMAS[S.PROGRAMA_DEF];
}
function lenguaje(p) { return p.tipo === 'python' ? 'CircuitPython' : p.tipo === 'arduino' ? 'Arduino' : 'firmware escrito a mano'; }

function nuevaSim() {
  if (!S.PROGRAMAS[cfg.programa]) cfg.programa = S.PROGRAMA_DEF;
  if (!S.PROGRAMAS[cfg.programaRival]) cfg.programaRival = S.PROGRAMA_RIVAL_DEF;
  const prog = programaElegido(cfg.programa);
  const progR = programaElegido(cfg.programaRival);
  errorPrograma = null;
  let tr = prog.traducir ? prog.traducir() : { ok: true, errores: [], avisos: [] };
  let trR = cfg.rival === 'espejo' && progR.traducir ? progR.traducir() : { ok: true };
  const base = Object.assign({}, cfg, { opc: { modoSimple: cfg.modoSimple }, opcRival: {} });
  try {
    sim = new S.Simulacion(Object.assign(base, {
      programa: tr.ok ? prog : VACIO,
      programaRival: trR.ok ? progR : VACIO,
    }));
  } catch (x) {
    errorPrograma = x.message;
    sim = new S.Simulacion(Object.assign(base, { programa: VACIO, programaRival: VACIO }));
  }
  sim.oyentes = {
    fin: () => { corriendo = false; mostrarAviso('fuera', `El robot salió del dojo a los ${sim.tiempoCombate().toFixed(2)} s`, [['Reiniciar', reiniciar]]); },
    victoria: () => { corriendo = false; mostrarAviso('victoria', `El rival salió del dojo a los ${sim.tiempoCombate().toFixed(2)} s`, [['Seguir', seguir], ['Reiniciar', reiniciar]]); },
    tiempo: () => { corriendo = false; mostrarAviso('', 'Se cumplió 1:30 de combate', [['Seguir', seguir], ['Reiniciar', reiniciar]]); },
    fallo: d => { mostrarAviso('fuera', `El programa se detuvo${d.linea ? ` en la línea ${d.linea}` : ''}: ${d.msg}`, [['Ver el código', () => abrirCodigo(d.linea)], ['Reiniciar', reiniciar]]); },
  };
  const fis = cfg.modeloIMU === 'limpio' ? 'IMU limpio' : S.VERSION_FISICA;
  $('fw').textContent = `${prog.nombre} · ${lenguaje(prog)} · ${fis}`;
  $('filaProgRival').hidden = cfg.rival !== 'espejo';
  $('filaModoSimple').hidden = cfg.programa !== 'plan' || prog.tipo !== 'nativo';
  $('bQuitar').hidden = !prog.propio;
  $('bVerCodigo').disabled = prog.tipo === 'nativo';
  for (const f of ['estado', 'maniobra', 'golpe']) document.querySelector(`.filtro[data-f="${f}"]`).hidden = prog.tipo !== 'nativo';
  pintarEstadoPrograma(prog, tr, progR, trR);
  iniciado = false;
  corriendo = false;
  ocultarAviso();
  vistaInforme = { n: 0, sim };
  serialN = -1;
  varsPrevias = {};
  $('informe').innerHTML = '';
  $('serial').textContent = '(vacío)';
  actualizarBotones();
  refrescarTodo();
}
function reiniciar() { nuevaSim(); }
function seguir() { ocultarAviso(); corriendo = true; actualizarBotones(); }

function pintarEstadoPrograma(prog, tr, progR, trR) {
  const caja = $('estadoProg');
  caja.innerHTML = '';
  caja.classList.remove('mal');
  const linea = (html) => { const d = document.createElement('div'); d.innerHTML = html; caja.appendChild(d); return d; };
  if (prog.tipo === 'nativo') linea(`<b class="ok">Firmware propio</b> escrito a mano en JavaScript (copia interna): no pasa por el traductor.`);
  else if (!tr.ok) {
    caja.classList.add('mal');
    linea(`<b class="mal">No se pudo traducir</b> · ${escapar(lenguaje(prog))} · ${tr.errores.length} error${tr.errores.length === 1 ? '' : 'es'}. El robot queda quieto hasta que lo corrijas.`);
    caja.appendChild(listaErrores(tr.errores, false));
  } else {
    const n = (tr.codigo || '').split('\n').length;
    linea(`<b class="ok">Traducido</b> · ${escapar(lenguaje(prog))} · ${n} líneas de JavaScript${tr.avisos && tr.avisos.length ? ` · ${tr.avisos.length} aviso${tr.avisos.length === 1 ? '' : 's'}` : ''}`);
    if (tr.avisos && tr.avisos.length) caja.appendChild(listaErrores(tr.avisos, true));
  }
  if (errorPrograma) { caja.classList.add('mal'); linea(`<b class="mal">No arranca:</b> ${escapar(errorPrograma)}`); }
  if (cfg.rival === 'espejo' && trR && !trR.ok) { caja.classList.add('mal'); linea(`<b class="mal">El programa del rival no se pudo traducir</b> (${escapar(progR.nombre)}): ${escapar(trR.errores[0].msg)} (línea ${trR.errores[0].linea})`); }
  // protocolo de arranque detectado
  const p = sim && sim.plan;
  const nombres = { negro: 'NEGRO', blanco: 'BLANCO', ronda: 'ronda', paso: 'BOOT', salida: 'salida' };
  if (p && p.acciones) {
    if (!p.acciones.length) $('protocolo').innerHTML = 'Arranque: el programa no espera el BOOT; el combate empieza al encender.';
    else {
      const pasos = p.acciones.slice(0, 12).map(a => `<b>${nombres[a.tipo] || a.tipo}</b>`).join(' → ') + (p.acciones.length > 12 ? ' → …' : '');
      $('protocolo').innerHTML = `Arranque detectado (el operador aprieta BOOT en cada paso): ${pasos}`;
    }
  } else $('protocolo').textContent = prog.tipo === 'nativo' ? 'Arranque: el operador sigue los mensajes del firmware.' : '';
}
function listaErrores(lista, avisos) {
  const ul = document.createElement('ul');
  ul.className = 'errores';
  for (const e of lista.slice(0, 12)) {
    const li = document.createElement('li');
    if (avisos) li.className = 'aviso-t';
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = e.linea ? `línea ${e.linea}` : '—';
    b.title = 'Ver en el código';
    b.addEventListener('click', () => abrirCodigo(e.linea, e.archivo));
    const s = document.createElement('span');
    s.textContent = (e.archivo && !/^code\.py$|\(interno\)/.test(e.archivo) ? e.archivo + ': ' : '') + e.msg;
    li.append(b, s);
    ul.appendChild(li);
  }
  return ul;
}

// ───────────── bucle principal ─────────────
function cuadro(ahora) {
  const dt = Math.min(50, ahora - ultimoCuadro);
  ultimoCuadro = ahora;
  if (corriendo && sim && !sim.fin && !evaluando) {
    let esc = velocidad;
    if (arranqueRapido && sim.tCombate === null) esc = Math.max(esc, 12);
    sim.avanzar(dt * 1000 * esc);
  }
  dibujar();
  if (ahora >= proxPaneles) { proxPaneles = ahora + 66; actualizarPaneles(ahora); }
  requestAnimationFrame(cuadro);
}

// ───────────── lienzo ─────────────
const cv = $('cv'), ctx = cv.getContext('2d');
const VISTA = 1.14;   // metros visibles de lado
let W = 0, H = 0, esc = 1, dpr = 1;
function ajustar() {
  const r = cv.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
  cv.width = W; cv.height = H;
  esc = Math.min(W, H) / VISTA;
  const c = $('cinta'), rc = c.getBoundingClientRect();
  c.width = Math.max(1, Math.round(rc.width * dpr)); c.height = Math.max(1, Math.round(rc.height * dpr));
}
new ResizeObserver(ajustar).observe($('lienzo'));
window.addEventListener('resize', ajustar);

function leerColores() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue(n).trim();
  colores = { floor: g('--floor'), grid: g('--floor-grid'), cone: g('--cone'), ink: g('--ink'), ink3: g('--ink-3'), panel: g('--panel') };
}
function aMundo(px, py) { return [(px - W / 2) / esc, -(py - H / 2) / esc]; }
function transformarMundo() { ctx.setTransform(esc, 0, 0, -esc, W / 2, H / 2); }
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
const rgb = (c, a) => a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const esApagado = c => c[0] === 0 && c[1] === 0 && c[2] === 0;

function dibujar() {
  if (!sim || !W) return;
  if (performance.now() > proxColores) { leerColores(); proxColores = performance.now() + 700; }
  const m = sim.mundo, R = m.robot, O = m.rival, hw = sim.hw;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colores.floor; ctx.fillRect(0, 0, W, H);
  transformarMundo();
  ctx.lineWidth = 1 / esc;
  ctx.strokeStyle = colores.grid;
  ctx.beginPath();
  for (let g = -0.6; g <= 0.6001; g += 0.1) { ctx.moveTo(g, -0.6); ctx.lineTo(g, 0.6); ctx.moveTo(-0.6, g); ctx.lineTo(0.6, g); }
  ctx.stroke();

  const d = m.dojo;
  if (sim.cfg.dojo === 'oficial') { ctx.fillStyle = '#101113'; ctx.fillRect(-0.5, -0.5, 1.0, 1.0); }
  ctx.fillStyle = '#F4F4F1'; ctx.beginPath(); ctx.arc(0, 0, d.rTotal, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = '#0D0E10'; ctx.beginPath(); ctx.arc(0, 0, d.rNegro, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1 / esc;
  for (const r of [0.1, 0.2, 0.3]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI); ctx.stroke(); }

  const ahoraT = m.t;
  if (m.rastroRival.length > 1) {
    ctx.strokeStyle = 'rgba(150,150,150,0.35)'; ctx.lineWidth = 2 / esc; ctx.beginPath();
    m.rastroRival.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
  }
  const ras = m.rastro;
  ctx.lineWidth = 3.2 / esc; ctx.lineCap = 'round';
  for (let i = 1; i < ras.length; i++) {
    const a = ras[i - 1], b = ras[i];
    const edad = (ahoraT - b[3]) / 1e6;
    if (edad > 30) continue;
    const alfa = 0.75 * Math.max(0.12, 1 - edad / 30);
    const c = esApagado(b[2]) ? [140, 146, 152] : b[2];
    ctx.strokeStyle = rgb(c, alfa);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }

  // cono del ultrasonico
  const [sx, sy] = R.puntoCuerpo(S.SONAR.xMontaje, 0);
  const a0 = R.th - S.SONAR.semiAngulo, a1 = R.th + S.SONAR.semiAngulo;
  const ping = hw.ultimoPing, reciente = ping && (hw.t - ping.t) < 90000;
  ctx.fillStyle = `rgba(${colores.cone},${reciente ? 0.16 : 0.09})`;
  ctx.strokeStyle = `rgba(${colores.cone},0.55)`; ctx.lineWidth = 1.2 / esc;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, 1.0, a0, a1); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (ping && ping.hay && (hw.t - ping.t) < 250000 && ping.d < 2) {
    const hx = sx + Math.cos(ping.angulo) * ping.d, hy = sy + Math.sin(ping.angulo) * ping.d;
    ctx.strokeStyle = `rgba(${colores.cone},0.95)`; ctx.lineWidth = 2 / esc;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 / esc;
    ctx.beginPath(); ctx.arc(hx, hy, 0.008, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }

  if (O && !O.caido) dibujarRival(O, sim.hwRival ? sim.hwRival.led : null);
  if (O && O.caido) { ctx.save(); ctx.globalAlpha = 0.35; dibujarRival(O, null); ctx.restore(); }
  dibujarRobot(R, hw.led, m);

  if (m.contacto) {
    ctx.fillStyle = '#FFD166';
    for (const p of m.contacto.puntos) { ctx.beginPath(); ctx.arc(p[0], p[1], 0.004, 0, 2 * Math.PI); ctx.fill(); }
  }

  if (editable()) {
    for (const [cuerpo, nombre] of [[R, 'robot'], [O, 'rival']]) {
      if (!cuerpo || cuerpo.caido) continue;
      const activo = seleccion === nombre;
      ctx.strokeStyle = activo ? colores.ink : 'rgba(128,128,128,0.8)';
      ctx.lineWidth = (activo ? 2 : 1.2) / esc;
      ctx.setLineDash([5 / esc, 4 / esc]);
      ctx.beginPath();
      const q = cuerpo.esquinas(); ctx.moveTo(q[0][0], q[0][1]); for (const p of q.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      const [hx, hy] = manija(cuerpo);
      const [cx, cy] = cuerpo.puntoCuerpo(cuerpo.hl, 0);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = colores.panel; ctx.beginPath(); ctx.arc(hx, hy, 0.011, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const x0 = 14 * dpr, y0 = H - 16 * dpr, largo = 0.1 * esc;
  ctx.strokeStyle = colores.ink; ctx.fillStyle = colores.ink; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + largo, y0); ctx.moveTo(x0, y0 - 4 * dpr); ctx.lineTo(x0, y0 + 4 * dpr);
  ctx.moveTo(x0 + largo, y0 - 4 * dpr); ctx.lineTo(x0 + largo, y0 + 4 * dpr); ctx.stroke();
  ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`; ctx.fillText('10 cm', x0, y0 - 8 * dpr);
}

function manija(c) { return c.puntoCuerpo(c.hl + 0.035, 0); }

function dibujarRobot(R, led, m) {
  ctx.save();
  ctx.translate(R.x, R.y); ctx.rotate(R.th);
  const e = 1 / esc;
  if (R.cabeceo > 0.02) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18 * dpr; ctx.shadowOffsetX = 6 * dpr; ctx.shadowOffsetY = 6 * dpr; }
  ctx.fillStyle = '#DDE2E7'; ctx.strokeStyle = '#27303A'; ctx.lineWidth = 1.5 * e;
  rr(-R.hl, -R.hw, 2 * R.hl, 2 * R.hw, 0.007); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.stroke();
  ctx.fillStyle = '#8E98A3'; ctx.fillRect(R.hl - 0.008, -R.hw, 0.008, 2 * R.hw);
  ctx.fillStyle = '#1B2026';
  rr(-0.017, R.hw - 0.012, 0.034, 0.012, 0.003); ctx.fill();
  rr(-0.017, -R.hw, 0.034, 0.012, 0.003); ctx.fill();
  ctx.fillStyle = '#2E4B41'; rr(-0.046, -0.026, 0.040, 0.052, 0.004); ctx.fill();
  const xm = S.SONAR.xMontaje;
  ctx.fillStyle = '#2F5E8E'; rr(xm - 0.006, -0.022, 0.009, 0.044, 0.002); ctx.fill();
  ctx.fillStyle = '#C9CED4'; ctx.strokeStyle = '#4A525B'; ctx.lineWidth = 1 * e;
  for (const s of [-0.011, 0.011]) { ctx.beginPath(); ctx.arc(xm + 0.004, s, 0.0072, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
  S.ROBOT.sensoresIR.forEach(p => {                   // IR: resaltado si el piso debajo es blanco
    const [wx, wy] = R.puntoCuerpo(p[0], p[1]);
    const b = m.blancura(wx, wy) > 0.5;
    ctx.fillStyle = b ? '#FFFFFF' : '#3A434D';
    ctx.strokeStyle = b ? '#E0A33A' : '#0F1318'; ctx.lineWidth = (b ? 2.2 : 1) * e;
    ctx.fillRect(p[0] - 0.0045, p[1] - 0.0045, 0.009, 0.009); ctx.strokeRect(p[0] - 0.0045, p[1] - 0.0045, 0.009, 0.009);
  });
  const lx = -0.034, ly = 0.0;
  if (!esApagado(led)) { ctx.shadowColor = rgb(led); ctx.shadowBlur = 22 * dpr; }
  ctx.fillStyle = esApagado(led) ? '#2A2F35' : rgb(led);
  ctx.beginPath(); ctx.arc(lx, ly, 0.0085, 0, 2 * Math.PI); ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#0F1318'; ctx.lineWidth = 1 * e; ctx.stroke();
  ctx.fillStyle = '#27303A';
  ctx.beginPath(); ctx.moveTo(R.hl - 0.011, 0); ctx.lineTo(R.hl - 0.019, 0.006); ctx.lineTo(R.hl - 0.019, -0.006); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function dibujarRival(O, ledRival) {
  ctx.save();
  ctx.translate(O.x, O.y); ctx.rotate(O.th);
  const e = 1 / esc;
  if (O.tipo === 'pared') {
    ctx.fillStyle = '#7C8690'; ctx.strokeStyle = '#3C444C'; ctx.lineWidth = 1.5 * e;
    ctx.fillRect(-O.hl, -O.hw, 2 * O.hl, 2 * O.hw); ctx.strokeRect(-O.hl, -O.hw, 2 * O.hl, 2 * O.hw);
  } else if (O.tipo === 'caja') {
    ctx.fillStyle = '#B8925A'; ctx.strokeStyle = '#6B522C'; ctx.lineWidth = 1.5 * e;
    ctx.fillRect(-O.hl, -O.hw, 2 * O.hl, 2 * O.hw); ctx.strokeRect(-O.hl, -O.hw, 2 * O.hl, 2 * O.hw);
    ctx.fillStyle = 'rgba(232,214,170,0.75)'; ctx.fillRect(-O.hl, -0.006, 2 * O.hl, 0.012);
  } else {
    ctx.fillStyle = '#3B4047'; ctx.strokeStyle = '#121518'; ctx.lineWidth = 1.5 * e;
    rr(-O.hl, -O.hw, 2 * O.hl, 2 * O.hw, 0.007); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9C2B2B'; ctx.fillRect(O.hl - 0.009, -O.hw, 0.009, 2 * O.hw);
    ctx.fillStyle = '#0B0D0F';
    rr(-0.017, O.hw - 0.012, 0.034, 0.012, 0.003); ctx.fill(); rr(-0.017, -O.hw, 0.034, 0.012, 0.003); ctx.fill();
    ctx.fillStyle = '#C9CED4'; ctx.beginPath(); ctx.moveTo(O.hl - 0.013, 0); ctx.lineTo(O.hl - 0.022, 0.007); ctx.lineTo(O.hl - 0.022, -0.007); ctx.closePath(); ctx.fill();
    if (ledRival) {
      if (!esApagado(ledRival)) { ctx.shadowColor = rgb(ledRival); ctx.shadowBlur = 18 * dpr; }
      ctx.fillStyle = esApagado(ledRival) ? '#2A2F35' : rgb(ledRival);
      ctx.beginPath(); ctx.arc(-0.034, 0, 0.0085, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    }
  }
  ctx.restore();
}

// ───────────── edicion con el puntero ─────────────
function editable() { return sim && !corriendo && !evaluando; }
function puntero(ev) {
  const r = cv.getBoundingClientRect();
  return aMundo((ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr);
}
function dentro(c, p) {
  const co = Math.cos(c.th), si = Math.sin(c.th), dx = p[0] - c.x, dy = p[1] - c.y;
  return Math.abs(dx * co + dy * si) <= c.hl && Math.abs(-dx * si + dy * co) <= c.hw;
}
function cuerpos() { const m = sim.mundo; return [['robot', m.robot], ['rival', m.rival && !m.rival.caido ? m.rival : null]]; }
cv.addEventListener('pointerdown', ev => {
  if (!editable()) return;
  const p = puntero(ev);
  for (const [n, c] of cuerpos()) {
    if (!c) continue;
    const [hx, hy] = manija(c);
    if (Math.hypot(p[0] - hx, p[1] - hy) < 0.018) { arrastre = { n, c, modo: 'rotar' }; seleccion = n; break; }
  }
  if (!arrastre) for (const [n, c] of cuerpos()) {
    if (c && dentro(c, p)) { arrastre = { n, c, modo: 'mover', dx: c.x - p[0], dy: c.y - p[1] }; seleccion = n; break; }
  }
  if (arrastre) { cv.setPointerCapture(ev.pointerId); ev.preventDefault(); }
});
cv.addEventListener('pointermove', ev => {
  if (!editable()) { cv.style.cursor = 'default'; return; }
  const p = puntero(ev);
  if (!arrastre) {
    let cursor = 'default';
    for (const [, c] of cuerpos()) {
      if (!c) continue;
      const [hx, hy] = manija(c);
      if (Math.hypot(p[0] - hx, p[1] - hy) < 0.018) cursor = 'grab';
      else if (dentro(c, p)) cursor = 'move';
    }
    cv.style.cursor = cursor;
    return;
  }
  const c = arrastre.c;
  if (arrastre.modo === 'mover') {
    const lim = 0.55;
    c.x = clampN(p[0] + arrastre.dx, -lim, lim);
    c.y = clampN(p[1] + arrastre.dy, -lim, lim);
  } else {
    let a = Math.atan2(p[1] - c.y, p[0] - c.x);
    if (!ev.shiftKey) a = Math.round(a / (5 * GRAD)) * 5 * GRAD;
    c.th = a;
  }
  c.vx = c.vy = c.w = 0;
  if (!iniciado) recordarPosiciones();
});
function soltar() { if (arrastre) { arrastre = null; if (!iniciado) recordarPosiciones(); } }
cv.addEventListener('pointerup', soltar);
cv.addEventListener('pointercancel', soltar);
function recordarPosiciones() {
  const m = sim.mundo, R = m.robot, O = m.rival;
  cfg.posiciones = {
    robot: { x: R.x, y: R.y, th: R.th },
    rival: O ? { x: O.x, y: O.y, th: O.th } : S.posicionesRonda(cfg.ronda, cfg.rival).rival,
  };
  guardar();
}
$('lienzo').tabIndex = 0;
$('lienzo').addEventListener('keydown', ev => {
  if (!editable() || !seleccion) return;
  const c = seleccion === 'robot' ? sim.mundo.robot : sim.mundo.rival;
  if (!c) return;
  const paso = ev.shiftKey ? 0.01 : 0.005;
  let hecho = true;
  if (ev.key === 'ArrowLeft') c.x -= paso; else if (ev.key === 'ArrowRight') c.x += paso;
  else if (ev.key === 'ArrowUp') c.y += paso; else if (ev.key === 'ArrowDown') c.y -= paso;
  else if (ev.key === 'q' || ev.key === 'Q') c.th += 5 * GRAD; else if (ev.key === 'e' || ev.key === 'E') c.th -= 5 * GRAD;
  else hecho = false;
  if (hecho) { ev.preventDefault(); if (!iniciado) recordarPosiciones(); }
});

// ───────────── paneles ─────────────
const irs = $('irs');
const NOMBRES_IR = ['FI', 'FD', 'TI', 'TD'];
const filasIR = NOMBRES_IR.map((n, i) => {
  const d = document.createElement('div');
  d.className = 'ir';
  d.innerHTML = `<span title="${['frontal izquierdo', 'frontal derecho', 'trasero izquierdo', 'trasero derecho'][i]}">${n}</span><div class="barra"><i></i><u></u></div><b>0</b>`;
  irs.appendChild(d);
  return { el: d, barra: d.querySelector('i'), umbral: d.querySelector('u'), num: d.querySelector('b') };
});

function fmtT(e) {
  if (sim.tCombate !== null && e.t >= sim.tCombate) return ((e.t - sim.tCombate) / 1e6).toFixed(3);
  return '(' + (e.t / 1e6).toFixed(2) + ')';
}
const ETIQUETA = { estado: 'estado', led: 'led', maniobra: '', giro: '', borde: 'borde', alerta: '', golpe: 'imu', evento: 'evento', prueba: 'prueba', mundo: '', fuera: '', victoria: '', arranque: 'arranque', serial: '' };
function filaInforme(e) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="t"></span><span class="punto"></span><span><span class="tit"></span><span class="det"></span></span>`;
  pintarFila(li, e);
  return li;
}
function pintarFila(li, e) {
  const tipo = (e.tipo === 'giro' || e.tipo === 'borde' || e.tipo === 'alerta') && sim.programa.tipo !== 'nativo' ? 'evento' : e.tipo;
  li.className = `k-${tipo}${e.nivel ? ' sub' : ''}${e.cortada ? ' cortada' : ''}`;
  const tag = ETIQUETA[e.tipo] ? `<span class="tag">${ETIQUETA[e.tipo]}</span>` : '';
  li.querySelector('.t').textContent = fmtT(e);
  const p = li.querySelector('.punto');
  p.style.background = esApagado(e.led) ? 'transparent' : rgb(e.led);
  p.title = 'LED: ' + S.nombreLed(e.led);
  li.querySelector('.tit').innerHTML = tag + escapar(e.titulo);
  li.querySelector('.det').textContent = e.detalle || '';
}
function escapar(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function actualizarInforme() {
  const lista = $('informe'), ent = sim.registro.entradas;
  const abajo = lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 40;
  if (vistaInforme.sim !== sim) { lista.innerHTML = ''; vistaInforme = { n: 0, sim }; }
  if (vistaInforme.n > 0 && lista.lastElementChild) pintarFila(lista.lastElementChild, ent[vistaInforme.n - 1]);
  if (ent.length > vistaInforme.n) {
    const frag = document.createDocumentFragment();
    for (let i = vistaInforme.n; i < ent.length; i++) frag.appendChild(filaInforme(ent[i]));
    lista.appendChild(frag);
    vistaInforme.n = ent.length;
    while (lista.children.length > 1800) lista.removeChild(lista.firstElementChild);
    if (abajo) lista.scrollTop = lista.scrollHeight;
  }
}

function actualizarResumen() {
  const r = sim.registro.resumen(), c = r.contadores;
  const items = [];
  if (sim.programa.tipo === 'nativo') {
    const porTipo = Object.entries(r.escapesPorTipo).map(([k, n]) => `${k} ×${n}`).join(', ');
    items.push(['Escapes', c.ESCAPE, porTipo], ['Giros', c.GIRO], ['Búsquedas', c.PERDIDO], ['Golpes', c.GOLPE],
      ['Levantado', c.LEVANTADO_DET], ['Empuje perdido', c.EMPUJE_PERDIDO], ['Empuje lateral', c.EMPUJE_LATERAL],
      ['Giros trabados', c.GIRO_TRABADO || 0], ['Giros cortados', c.GIRO_CORTADO + c.GIRO_TIMEOUT], ['Fantasmas', r.fantasmas || 0]);
  } else {
    for (const [k, n] of Object.entries(c)) if (n) items.push([k, n]);
    for (const [k, n] of Object.entries(r.otrosEventos).sort((a, b) => b[1] - a[1]).slice(0, 12)) items.push([k, n]);
  }
  const est = sim.estadisticas || {};
  items.push(['Contacto', `${((est.contactoUs || 0) / 1e6).toFixed(1)} s`], ['Reflejos IR', r.destellos]);
  $('resumen').innerHTML = items.map(([n, k, t]) => `<span class="cuenta"${t ? ` title="${escapar(t)}"` : ''}>${escapar(n)} <b>${escapar(k)}</b></span>`).join('');
}

function actualizarSerial() {
  const s = sim.registro.serial;
  if (s.length === serialN) return;
  serialN = s.length;
  const pre = $('serial');
  const abajo = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
  const ult = s.slice(-600);
  pre.textContent = ult.length ? ult.map(l => `[${String(Math.floor(l.t / 1000)).padStart(6)}] ${l.texto}`).join('\n') : '(vacío)';
  if (abajo) pre.scrollTop = pre.scrollHeight;
}

function fmtMotor(u) {
  if (Math.abs(u) < 0.005) return '0';
  return (u > 0 ? '▲ ' : '▼ ') + Math.abs(u).toFixed(2);
}
function fmtValor(v, prof) {
  prof = prof || 0;
  if (v === null || v === undefined) return prof ? 'None' : '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(+v.toFixed(4)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v.length > 80 ? v.slice(0, 80) + '…' : v);
  if (Array.isArray(v)) return '[' + v.slice(0, 16).map(x => fmtValor(x, prof + 1)).join(', ') + (v.length > 16 ? ', …' : '') + ']';
  if (typeof v === 'object') return '{' + Object.entries(v).slice(0, 8).map(([k, x]) => `${k}: ${fmtValor(x, prof + 1)}`).join(', ') + '}';
  return String(v);
}
function leerVars() { try { return sim.fw.vars() || {}; } catch (e) { return {}; } }
function actualizarVars() {
  if (!$('cajaVars').open) return;
  const v = leerVars();
  const cuerpo = $('vars');
  const claves = Object.keys(v).slice(0, 250);
  if (!claves.length) { cuerpo.innerHTML = '<tr><td>—</td><td>el programa no tiene variables globales</td></tr>'; return; }
  const filas = claves.map(k => {
    const txt = fmtValor(v[k]);
    const cambio = varsPrevias[k] !== undefined && varsPrevias[k] !== txt;
    varsPrevias[k] = txt;
    return `<tr${cambio ? ' class="cambio"' : ''}><td>${escapar(k)}</td><td>${escapar(txt)}</td></tr>`;
  });
  cuerpo.innerHTML = filas.join('');
}
// Umbrales IR del programa, si tiene una variable umbral... con 4 numeros.
function umbralesPrograma(v) {
  for (const [k, x] of Object.entries(v)) {
    if (!/umbral|threshold/i.test(k) || !Array.isArray(x) || x.length !== 4 || !x.every(n => typeof n === 'number')) continue;
    return sim.programa.tipo === 'python' ? x.map(n => n / 16) : x;
  }
  return null;
}

function estadoMostrado(v) {
  if (sim.programa.tipo === 'nativo' && v.estadoTel) return v.estadoTel;
  const ent = sim.registro.entradas;
  for (let i = ent.length - 1; i >= 0 && i > ent.length - 40; i--) {
    const e = ent[i];
    if (e.tipo === 'evento' || e.codigo) { if (sim.hw.t - e.t < 1500000) return e.codigo || e.titulo; break; }
  }
  return S.nombreLed(sim.hw.led);
}

function actualizarPaneles(ahora) {
  if (!sim) return;
  const hw = sim.hw, R = sim.mundo.robot;
  const lento = ahora >= proxLento;
  if (lento) proxLento = ahora + 250;
  const v = lento || sim.programa.tipo === 'nativo' ? leerVars() : null;
  if (sim.tCombate !== null) $('reloj').textContent = `t ${sim.tiempoCombate().toFixed(2)} s`;
  else $('reloj').textContent = iniciado ? 'arranque' : '—';
  $('millis').textContent = `millis() ${Math.floor(hw.t / 1000)}`;
  // LED
  const led = hw.led, info = S.NOMBRES_LED.find(n => n.rgb[0] === led[0] && n.rgb[1] === led[1] && n.rgb[2] === led[2]);
  const g = $('ledGrande');
  g.style.background = esApagado(led) ? '#1B1F24' : rgb(led);
  g.style.boxShadow = esApagado(led) ? 'none' : `0 0 22px 4px ${rgb(led, 0.75)}`;
  $('ledNombre').textContent = S.nombreLed(led);
  $('ledRgb').textContent = `(${led.join(', ')})`;
  $('ledUso').textContent = sim.programa.tipo === 'nativo' && info ? info.uso : '';
  pintarCinta();
  // lecturas del hardware
  $('dMi').textContent = fmtMotor(R.uIzq);
  $('dMd').textContent = fmtMotor(R.uDer);
  const ping = hw.ultimoPing;
  $('dDist').textContent = !ping ? '—' : (ping.hay ? `${(ping.d * 100).toFixed(1)} cm` : 'sin eco');
  const M = R.imu ? R.imu.muestra : null;
  const imuOk = M && !sim.cfg.imuAusente;
  $('dGiro').textContent = imuOk ? `${(M.gz / GRAD).toFixed(0)} °/s` : '—';
  $('dIncl').textContent = imuOk ? `${(Math.atan2(M.ay, M.az) / GRAD).toFixed(1)}°` : '—';
  let rumbo = ((R.th / GRAD) % 360 + 360) % 360;
  $('dRumbo').textContent = `${rumbo.toFixed(0)}°`;
  const um = v ? umbralesPrograma(v) : null;
  filasIR.forEach((f, i) => {
    const val = hw.ultIR[i];
    f.barra.style.width = `${(val / 4095 * 100).toFixed(1)}%`;
    if (um) { f.umbral.style.left = `${clampN(um[i] / 4095 * 100, 0, 100).toFixed(2)}%`; f.umbral.hidden = false; }
    else if (v) f.umbral.hidden = true;
    f.num.textContent = val;
    const [wx, wy] = R.puntoCuerpo(S.ROBOT.sensoresIR[i][0], S.ROBOT.sensoresIR[i][1]);
    f.el.classList.toggle('blanco', sim.mundo.blancura(wx, wy) > 0.5);
  });
  $('chipEstado').textContent = !iniciado ? 'apagado' : (sim.hw.detenido ? 'detenido' : (sim.tCombate === null ? 'arranque' : (v ? estadoMostrado(v) : $('chipEstado').textContent)));
  $('chipDist').textContent = ping && ping.hay && ping.d < 3 ? `sonar ${(ping.d * 100).toFixed(1)} cm` : 'sonar —';
  // pista
  const pista = $('pista');
  let txt = '';
  if (evaluando) txt = 'Evaluando: la vista se actualiza al terminar.';
  else if (!iniciado) txt = 'Arrastrá el robot o el rival para ubicarlos. La manija gira (Shift: sin pasos de 5°).';
  else if (sim.tCombate === null) txt = pistaArranque();
  else if (!corriendo && !sim.fin) txt = 'En pausa: podés mover el robot o el rival con el puntero.';
  pista.textContent = txt; pista.hidden = !txt;
  actualizarInforme();
  actualizarSerial();
  actualizarBotones();
  if (lento) { actualizarResumen(); actualizarVars(); actualizarLeyenda(); }
}

function pistaArranque() {
  const op = sim.hw.operador, auto = sim.cfg.operadorAuto;
  if (sim.hw.detenido) return 'El programa se detuvo.';
  if (op && op.acciones) {
    if (op.listo) return auto ? 'Listo para la salida: el operador da el BOOT.' : 'Listo: apretá BOOT para la salida.';
    const a = op.acciones[op.acciones.length - 1];
    if (a) {
      const que = { negro: 'sensores sobre NEGRO', blanco: 'sensores sobre BLANCO', ronda: `elige la ronda ${sim.cfg.ronda}`, paso: 'aprieta BOOT' }[a.tipo] || '';
      return `El programa pide: "${(a.texto || 'BOOT').slice(0, 60)}"${que ? ` · operador: ${que}` : ''}`;
    }
    return auto ? 'Arrancando: el operador espera a que el programa pida el BOOT.' : 'Arrancando: apretá BOOT cuando el programa lo pida.';
  }
  const s = sim.registro.serial;
  return s.length ? s[s.length - 1].texto.slice(0, 70) : 'Arrancando…';
}

function pintarCinta() {
  const c = $('cinta'), g = c.getContext('2d'), w = c.width, h = c.height;
  if (!w) return;
  const tFin = sim.hw.t, tIni = tFin - 20e6, seg = sim.registro.led;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#1B1F24'; g.fillRect(0, 0, w, h);
  let i = seg.length - 1;
  while (i > 0 && seg[i].t > tIni) i--;
  for (; i < seg.length; i++) {
    const a = Math.max(tIni, seg[i].t), b = i + 1 < seg.length ? seg[i + 1].t : tFin;
    if (b <= tIni || esApagado(seg[i].rgb)) continue;
    const x0 = (a - tIni) / 20e6 * w, x1 = (b - tIni) / 20e6 * w;
    g.fillStyle = rgb(seg[i].rgb); g.fillRect(x0, 0, Math.max(1, x1 - x0), h);
  }
  g.fillStyle = 'rgba(255,255,255,0.25)';
  for (let k = 1; k < 4; k++) g.fillRect(k * w / 4, 0, 1, h);
  if (sim.tCombate !== null && sim.tCombate > tIni) {
    const x = (sim.tCombate - tIni) / 20e6 * w;
    g.fillStyle = '#FFFFFF'; g.fillRect(x - 1, 0, 2, h);
  }
}
// Leyenda: con el firmware propio, que significa cada color; con otro programa,
// los colores que uso y cuanto tiempo.
function actualizarLeyenda() {
  const ul = $('leyenda');
  if (sim.programa.tipo === 'nativo' && S.USOS_LED) {
    $('tituloLeyenda').textContent = 'Colores del firmware';
    if (ul.dataset.modo !== 'fw') {
      ul.dataset.modo = 'fw';
      ul.innerHTML = S.NOMBRES_LED.map(n => `<li><i style="background:${rgb(n.rgb)}"></i><span><b>${n.nombre}</b><code>(${n.rgb.join(', ')})</code></span><span>${escapar(n.uso || '')}</span></li>`).join('');
    }
    return;
  }
  $('tituloLeyenda').textContent = 'Colores que usó el programa';
  ul.dataset.modo = 'uso';
  if (!ul.closest('details').open) return;
  const seg = sim.registro.led, tiempos = new Map();
  for (let i = 0; i < seg.length; i++) {
    const k = seg[i].rgb.join(','), dur = (i + 1 < seg.length ? seg[i + 1].t : sim.hw.t) - seg[i].t;
    tiempos.set(k, (tiempos.get(k) || 0) + dur);
  }
  const total = [...tiempos.values()].reduce((a, b) => a + b, 0) || 1;
  const filas = [...tiempos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  ul.innerHTML = filas.map(([k, t]) => { const c = k.split(',').map(Number); return `<li><i style="background:${esApagado(c) ? 'transparent' : rgb(c)}"></i><span><b>${S.nombreLed(c)}</b><code>(${k.replace(/,/g, ', ')})</code></span><span>${(100 * t / total).toFixed(0)} % del tiempo</span></li>`; }).join('') || '<li><span></span><span>—</span><span>todavía nada</span></li>';
}

// ───────────── avisos y botones ─────────────
function mostrarAviso(clase, texto, botones) {
  const a = $('aviso');
  a.className = 'aviso' + (clase ? ' ' + clase : '');
  a.innerHTML = '';
  const s = document.createElement('span'); s.textContent = texto; a.appendChild(s);
  for (const [t, f] of botones || []) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn chico'; b.textContent = t;
    b.addEventListener('click', f); a.appendChild(b);
  }
  a.hidden = false;
}
function ocultarAviso() { $('aviso').hidden = true; }

function actualizarBotones() {
  if (!sim) return;
  const txt = $('txtIniciar'), ico = $('icoIniciar');
  if (!iniciado || sim.fin) { txt.textContent = 'Encender'; ico.textContent = '▶'; }
  else if (corriendo) { txt.textContent = 'Pausa'; ico.textContent = '❚❚'; }
  else { txt.textContent = 'Seguir'; ico.textContent = '▶'; }
  const combate = sim.combateEnCurso && !sim.fin && !evaluando;
  for (const id of ['bLevantar', 'bGolpeIzq', 'bGolpeDer', 'bEmpIzq', 'bEmpDer']) $(id).disabled = !combate;
  $('bBoot').disabled = !(iniciado && !sim.cfg.operadorAuto && !evaluando);
  $('bPaso').disabled = corriendo || !!sim.fin || evaluando;
  $('bIniciar').disabled = evaluando;
}

$('bIniciar').addEventListener('click', () => {
  if (sim.fin) nuevaSim();
  if (!iniciado) { iniciado = true; corriendo = true; seleccion = null; }
  else corriendo = !corriendo;
  if (corriendo) ocultarAviso();
  actualizarBotones();
});
$('bReiniciar').addEventListener('click', reiniciar);
$('bPaso').addEventListener('click', () => {
  if (sim.fin) return;
  iniciado = true; corriendo = false;
  sim.avanzar(20000);
  actualizarBotones();
});
$('selVel').value = String(velocidad);
if (!$('selVel').value) $('selVel').value = '1';
$('selVel').addEventListener('change', e => { velocidad = parseFloat(e.target.value); guardar(); });

function marcarRonda() { for (const b of $('segRonda').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.r === cfg.ronda)); }
$('segRonda').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  cfg.ronda = +b.dataset.r; cfg.posiciones = null; marcarRonda(); guardar(); nuevaSim();
});
function enlazarSelect(id, clave, borrarPos) {
  const el = $(id); el.value = cfg[clave];
  el.addEventListener('change', () => { cfg[clave] = el.value; if (borrarPos) cfg.posiciones = null; guardar(); nuevaSim(); });
}
enlazarSelect('selRival', 'rival', true);
enlazarSelect('selDojo', 'dojo', false);
enlazarSelect('selIR', 'perfilIR', false);
enlazarSelect('selIMU', 'modeloIMU', false);
function enlazarCheck(id, clave, reinicia) {
  const el = $(id); el.checked = !!cfg[clave];
  el.addEventListener('change', () => { cfg[clave] = el.checked; if (sim) sim.cfg[clave] = el.checked; guardar(); if (reinicia) nuevaSim(); else actualizarBotones(); });
}
enlazarCheck('chkDestellos', 'destellos', true);
enlazarCheck('chkSinImu', 'imuAusente', true);
enlazarCheck('chkModoSimple', 'modoSimple', true);
enlazarCheck('chkAuto', 'operadorAuto', false);
$('chkRapido').checked = arranqueRapido;
$('chkRapido').addEventListener('change', e => { arranqueRapido = e.target.checked; guardar(); });
$('bPosicion').addEventListener('click', () => { cfg.posiciones = null; guardar(); nuevaSim(); });

function enlazarRango(id, salida, clave, aCfg, deCfg, fmt) {
  const el = $(id), o = $(salida);
  el.value = deCfg(cfg[clave]);
  const pinta = () => { o.textContent = fmt(+el.value); };
  pinta();
  el.addEventListener('input', pinta);
  el.addEventListener('change', () => { cfg[clave] = aCfg(+el.value); guardar(); nuevaSim(); });
}
enlazarRango('rV0', 'oV0', 'v0', x => x / 100, v => Math.round(v * 100), x => `${x} cm/s`);
enlazarRango('rDes', 'oDes', 'desbalance', x => x / 100, v => Math.round(v * 100), x => `${x > 0 ? '+' : ''}${x} %`);
enlazarRango('rEco', 'oEco', 'perdidaEcoContacto', x => x / 100, v => Math.round(v * 100), x => `${x} %`);
enlazarRango('rFza', 'oFza', 'fuerzaRival', x => x / 100, v => Math.round(v * 100), x => `${x} %`);
enlazarRango('rCaja', 'oCaja', 'masaCaja', x => x / 1000, v => Math.round(v * 1000), x => `${x} g`);
enlazarRango('rSem', 'oSem', 'semilla', x => x, v => clampN(v % 100 || 1, 1, 99), x => String(x));

// pruebas
$('bLevantar').addEventListener('click', () => sim.levantar(3000));
$('bGolpeIzq').addEventListener('click', () => sim.golpe('izq'));
$('bGolpeDer').addEventListener('click', () => sim.golpe('der'));
$('bEmpIzq').addEventListener('click', () => sim.empujar('izq'));
$('bEmpDer').addEventListener('click', () => sim.empujar('der'));
const boot = $('bBoot');
const apretar = v => { if (boot.disabled) return; sim.fijarBoton(v, 'usuario'); boot.classList.toggle('apretado', v); };
boot.addEventListener('pointerdown', e => { e.preventDefault(); apretar(true); });
for (const t of ['pointerup', 'pointerleave', 'pointercancel']) boot.addEventListener(t, () => apretar(false));
boot.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); apretar(true); } });
boot.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') apretar(false); });

// filtros del informe
$('filtros').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  $('informe').classList.toggle('ocultar-' + b.dataset.f, !on);
});

// copiar
function textoInforme() {
  return sim.registro.entradas.map(e => {
    const t = fmtT(e).padStart(9);
    return `${t}  [${S.nombreLed(e.led)}] ${'  '.repeat(e.nivel)}${e.titulo}${e.detalle ? ' — ' + e.detalle : ''}`;
  }).join('\n');
}
function copiar(texto) {
  const ok = () => { const c = $('copiado'); c.hidden = false; $('respaldo').hidden = true; setTimeout(() => { c.hidden = true; }, 1600); };
  const falla = () => { const r = $('respaldo'); r.hidden = false; r.value = texto; r.focus(); r.select(); };
  try { navigator.clipboard.writeText(texto).then(ok, falla); } catch (e) { falla(); }
}
$('bCopiar').addEventListener('click', () => copiar(textoInforme()));
$('bCopiarSerial').addEventListener('click', () => copiar(sim.registro.serial.map(l => `[${Math.floor(l.t / 1000)}] ${l.texto}`).join('\n') || '(vacío)'));

// ───────────── programas ─────────────
function llenarSelect(sel, valor) {
  sel.innerHTML = '';
  const grupos = [
    ['Ejemplos', Object.values(S.PROGRAMAS).filter(p => p.ejemplo)],
    ['Firmwares propios (copia interna)', Object.values(S.PROGRAMAS).filter(p => p.tipo === 'nativo')],
    ['Tus programas', Object.values(S.PROGRAMAS).filter(p => p.propio)],
  ];
  for (const [titulo, lista] of grupos) {
    if (!lista.length) continue;
    const og = document.createElement('optgroup');
    og.label = titulo;
    for (const p of lista) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.nombre; og.appendChild(o); }
    sel.appendChild(og);
  }
  sel.value = valor;
  if (sel.value !== valor && sel.options.length) sel.value = sel.options[0].value;
}
function refrescarSelects() { llenarSelect($('selPrograma'), cfg.programa); llenarSelect($('selProgRival'), cfg.programaRival); }
$('selPrograma').addEventListener('change', e => { cfg.programa = e.target.value; guardar(); nuevaSim(); });
$('selProgRival').addEventListener('change', e => { cfg.programaRival = e.target.value; guardar(); nuevaSim(); });

function nuevoId() { return 'usr:' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function agregarPropio(nombre, archivos) {
  const p = { id: nuevoId(), nombre, archivos };
  propios.push(p);
  guardarPropios();
  registrarPropio(p);
  cfg.programa = p.id;
  guardar();
  refrescarSelects();
  nuevaSim();
  return p;
}
$('bCargar').addEventListener('click', () => $('archivo').click());
$('archivo').addEventListener('change', async e => {
  const fs = [...e.target.files];
  e.target.value = '';
  if (!fs.length) return;
  const archivos = [];
  for (const f of fs) {
    if (f.size > 600000) { mostrarAviso('', `${f.name} es demasiado grande para un programa (${Math.round(f.size / 1024)} KB).`, [['Entendido', ocultarAviso]]); return; }
    archivos.push({ nombre: f.name, texto: await f.text() });
  }
  const principal = archivos.find(a => /\.(ino|py)$/i.test(a.nombre)) || archivos[0];
  agregarPropio(principal.nombre.replace(/\.(ino|py|pde)$/i, ''), archivos);
});
$('bQuitar').addEventListener('click', () => {
  const i = propios.findIndex(p => p.id === cfg.programa);
  if (i < 0) return;
  if (!confirm(`¿Quitar "${propios[i].nombre}" de este navegador?`)) return;
  delete S.PROGRAMAS[propios[i].id];
  propios.splice(i, 1);
  guardarPropios();
  cfg.programa = S.PROGRAMA_DEF;
  guardar();
  refrescarSelects();
  nuevaSim();
});

// ── editor de codigo ──
const dlg = $('dlgCodigo');
let dlgModo = null;       // { tipo: 'ver'|'nuevo', prog, archivos }
function archivosDe(p) {
  if (p.archivos) return p.archivos.map(a => ({ nombre: a.nombre, texto: a.texto }));
  if (p.texto !== undefined) return [{ nombre: p.archivo || 'code.py', texto: p.texto }];
  return [];
}
function pintarNumeros() {
  const ta = $('dlgTexto');
  const n = ta.value.split('\n').length;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  $('dlgNums').textContent = s;
  $('dlgNums').scrollTop = ta.scrollTop;
}
$('dlgTexto').addEventListener('input', () => { if (dlgModo && dlgModo.archivos) dlgModo.archivos[dlgModo.actual].texto = $('dlgTexto').value; pintarNumeros(); });
$('dlgTexto').addEventListener('scroll', () => { $('dlgNums').scrollTop = $('dlgTexto').scrollTop; });
$('dlgTexto').addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    const ta = e.target, a = ta.selectionStart, b = ta.selectionEnd;
    ta.setRangeText('  ', a, b, 'end');
    ta.dispatchEvent(new Event('input'));
  }
});
function mostrarArchivo(i) {
  dlgModo.actual = i;
  $('dlgTexto').value = dlgModo.archivos[i].texto;
  $('dlgTexto').scrollTop = 0;
  pintarNumeros();
}
$('dlgArchivo').addEventListener('change', e => mostrarArchivo(+e.target.value));
function irALinea(n) {
  const ta = $('dlgTexto');
  const lineas = ta.value.split('\n');
  n = clampN(n || 1, 1, lineas.length);
  let a = 0;
  for (let i = 0; i < n - 1; i++) a += lineas[i].length + 1;
  ta.focus();
  ta.setSelectionRange(a, a + lineas[n - 1].length);
  const alto = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  ta.scrollTop = Math.max(0, (n - 4) * alto);
  $('dlgNums').scrollTop = ta.scrollTop;
}
function pintarErroresDlg(lista) {
  const ul = $('dlgErrores');
  ul.innerHTML = '';
  for (const e of (lista || []).slice(0, 10)) {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button'; b.textContent = e.linea ? `línea ${e.linea}` : '—';
    b.addEventListener('click', () => {
      if (e.archivo && dlgModo.archivos) { const k = dlgModo.archivos.findIndex(a => a.nombre === e.archivo); if (k >= 0 && k !== dlgModo.actual) { $('dlgArchivo').value = String(k); mostrarArchivo(k); } }
      irALinea(e.linea);
    });
    const s = document.createElement('span'); s.textContent = e.msg;
    li.append(b, s); ul.appendChild(li);
  }
}
function abrirCodigo(linea, archivo) {
  const prog = programaElegido(cfg.programa);
  if (prog.tipo === 'nativo') return;
  const archivos = archivosDe(prog);
  dlgModo = { tipo: 'ver', prog, archivos, actual: 0 };
  $('dlgTitulo').textContent = prog.nombre;
  const selA = $('dlgArchivo');
  selA.hidden = archivos.length < 2;
  selA.innerHTML = archivos.map((a, i) => `<option value="${i}">${escapar(a.nombre)}</option>`).join('');
  let k = archivo ? archivos.findIndex(a => a.nombre === archivo) : 0;
  if (k < 0) k = 0;
  selA.value = String(k);
  $('dlgLenguaje').hidden = true; $('dlgNombre').hidden = true;
  $('dlgNota').textContent = prog.ejemplo ? 'Es un ejemplo: al aplicar se guarda una copia tuya.' : (prog.propio ? 'Tus cambios se guardan en este navegador.' : '');
  const tr = prog.traducir ? prog.traducir() : null;
  pintarErroresDlg(tr && !tr.ok ? tr.errores : (tr ? tr.avisos : []));
  mostrarArchivo(k);
  if (!dlg.open) dlg.showModal();
  if (linea) setTimeout(() => irALinea(linea), 30);
}
$('bVerCodigo').addEventListener('click', () => abrirCodigo());
$('bPegar').addEventListener('click', () => {
  dlgModo = { tipo: 'nuevo', archivos: [{ nombre: 'programa', texto: '' }], actual: 0 };
  $('dlgTitulo').textContent = 'Pegar un programa';
  $('dlgArchivo').hidden = true;
  $('dlgLenguaje').hidden = false; $('dlgLenguaje').value = 'auto';
  $('dlgNombre').hidden = false; $('dlgNombre').value = '';
  $('dlgNota').textContent = 'Pegá el código completo de tu .ino o tu code.py.';
  pintarErroresDlg([]);
  mostrarArchivo(0);
  dlg.showModal();
  $('dlgTexto').focus();
});
$('dlgCerrar').addEventListener('click', () => dlg.close());
$('dlgAplicar').addEventListener('click', () => {
  if (!dlgModo) return;
  if (dlgModo.tipo === 'nuevo') {
    const texto = $('dlgTexto').value;
    if (!texto.trim()) { pintarErroresDlg([{ linea: 0, msg: 'No hay código.' }]); return; }
    let leng = $('dlgLenguaje').value;
    if (leng === 'auto') leng = /void\s+(setup|loop)\s*\(/.test(texto) || /#include/.test(texto) ? 'ino' : (/^\s*(import |from \w+ import |def |while True:)/m.test(texto) ? 'py' : 'ino');
    const nombre = $('dlgNombre').value.trim() || (leng === 'py' ? 'code' : 'sketch');
    const archivos = [{ nombre: `${nombre.replace(/[^\w\-. ]/g, '_')}.${leng}`, texto }];
    const prueba = S.programaDesdeArchivos(archivos, nombre).traducir();
    agregarPropio(nombre, archivos);
    if (!prueba.ok) { dlgModo = { tipo: 'ver', prog: programaElegido(cfg.programa), archivos, actual: 0 }; abrirCodigo(prueba.errores[0].linea, prueba.errores[0].archivo); return; }
    dlg.close();
    return;
  }
  const prog = dlgModo.prog;
  const archivos = dlgModo.archivos.map(a => ({ nombre: a.nombre, texto: a.texto }));
  const prueba = S.programaDesdeArchivos(archivos, prog.nombre).traducir();
  if (prog.propio) {
    const p = propios.find(x => x.id === prog.id);
    if (p) { p.archivos = archivos; guardarPropios(); delete S.PROGRAMAS[p.id]; registrarPropio(p); }
    nuevaSim();
  } else {
    agregarPropio(prog.nombre.replace(/^Ejemplo:\s*/, '') + ' (mío)', archivos);
    dlgModo.prog = programaElegido(cfg.programa);
  }
  if (!prueba.ok) { pintarErroresDlg(prueba.errores); $('dlgNota').textContent = 'Guardado, pero todavía tiene errores:'; return; }
  pintarErroresDlg(prueba.avisos);
  dlg.close();
});

// ── pines ──
const txtLista = a => a.join(', ');
const leerLista = (s, n) => { const v = String(s).split(/[,\s]+/).filter(x => x).map(x => parseInt(x, x.trim().startsWith('0x') ? 16 : 10)); return v.length === n && v.every(x => Number.isInteger(x) && x >= 0 && x <= 48) ? v : null; };
function pintarPines() {
  const P = Object.assign({}, S.PINES_KIT, cfg.pines || {});
  $('pMotorIzq').value = txtLista(P.motorIzq); $('pMotorDer').value = txtLista(P.motorDer);
  $('pSonar').value = txtLista([P.trig, P.echo]); $('pIR').value = txtLista(P.ir);
  $('pBoot').value = String(P.boot); $('pNeo').value = String(P.neopixel);
  $('pImu').value = '0x' + P.imuDir.toString(16).toUpperCase();
  $('pInvIzq').checked = !!P.invertirIzq; $('pInvDer').checked = !!P.invertirDer;
  $('notaPines').textContent = cfg.pines ? 'Pines cambiados (no son los del kit).' : '';
}
function leerPines() {
  const mi = leerLista($('pMotorIzq').value, 2), md = leerLista($('pMotorDer').value, 2), so = leerLista($('pSonar').value, 2), ir = leerLista($('pIR').value, 4);
  const bt = leerLista($('pBoot').value, 1), neo = leerLista($('pNeo').value, 1);
  const imu = parseInt($('pImu').value, /^\s*0x/i.test($('pImu').value) ? 16 : 10);
  if (!mi || !md || !so || !ir || !bt || !neo || !(imu >= 0 && imu < 128)) { $('notaPines').textContent = 'Revisá los números: cada pin va de 0 a 39.'; return; }
  const P = { motorIzq: mi, motorDer: md, trig: so[0], echo: so[1], ir, boot: bt[0], neopixel: neo[0], imuDir: imu, invertirIzq: $('pInvIzq').checked, invertirDer: $('pInvDer').checked };
  cfg.pines = JSON.stringify(P) === JSON.stringify(Object.assign({}, S.PINES_KIT)) ? null : P;
  guardar(); pintarPines(); nuevaSim();
}
for (const id of ['pMotorIzq', 'pMotorDer', 'pSonar', 'pIR', 'pBoot', 'pNeo', 'pImu', 'pInvIzq', 'pInvDer']) $(id).addEventListener('change', leerPines);
$('bPinesKit').addEventListener('click', () => { cfg.pines = null; guardar(); pintarPines(); nuevaSim(); });

// ───────────── evaluacion: 3 rondas x rivales x semillas, sin dibujar ─────────────
let evaluando = false;
const NOMBRE_RIVAL = { caja: 'Caja', tipico: 'Típico', rival: 'Embiste', espejo: 'Programa del rival', pared: 'Pared' };
$('bEvaluar').addEventListener('click', async () => {
  if (evaluando) { evaluando = 'cancelar'; return; }
  const rivales = [...document.querySelectorAll('[data-riv]')].filter(c => c.checked).map(c => c.dataset.riv);
  if (!rivales.length) return;
  const semillas = clampN(+$('nSemillas').value || 1, 1, 10), tope = clampN(+$('nTope').value || 90, 10, 180);
  const prog = programaElegido(cfg.programa);
  const tr = prog.traducir ? prog.traducir() : { ok: true };
  if (!tr.ok) { $('resultadoEval').innerHTML = '<p class="nota">El programa tiene errores: corregilos antes de evaluar.</p>'; return; }
  const trabajos = [];
  for (const rival of rivales) for (const ronda of [1, 2, 3]) for (let s = 1; s <= semillas; s++) trabajos.push({ rival, ronda, semilla: s });
  evaluando = true; corriendo = false;
  $('bEvaluar').textContent = 'Cancelar';
  const barra = $('progreso'); barra.hidden = false; barra.firstElementChild.style.width = '0%';
  const res = [];
  const t0 = performance.now();
  for (let k = 0; k < trabajos.length && evaluando === true; k++) {
    const t = trabajos[k];
    let s;
    try {
      s = new S.Simulacion(Object.assign({}, cfg, { opc: { modoSimple: cfg.modoSimple }, opcRival: {}, rival: t.rival, ronda: t.ronda, semilla: t.semilla, posiciones: null, operadorAuto: true }));
    } catch (x) { res.push(Object.assign({ r: 'X', seg: 0, msg: x.message }, t)); continue; }
    for (;;) {
      const inicio = performance.now();
      let listo = false;
      while (performance.now() - inicio < 28) {
        if (s.fin || s.rivalFueraEn !== null || s.hw.detenido) { listo = true; break; }
        if (s.tCombate === null && s.mundo.t > 60e6) { listo = true; break; }
        if (s.tCombate !== null && s.tiempoCombate() >= tope) { listo = true; break; }
        s.avanzar(40000);
      }
      if (listo || evaluando !== true) break;
      barra.firstElementChild.style.width = `${(100 * (k + (s.tCombate !== null ? Math.min(1, s.tiempoCombate() / tope) : 0)) / trabajos.length).toFixed(1)}%`;
      await new Promise(r => setTimeout(r, 0));
    }
    let r = 'E', seg = tope;
    if (s.fin) { r = 'P'; seg = s.tiempoCombate(); }
    else if (s.rivalFueraEn !== null) { r = 'G'; seg = (s.rivalFueraEn - s.tCombate) / 1e6; }
    else if (s.tCombate === null) r = 'N';
    else if (s.hw.detenido && !s.hw.detenido.fin) r = 'X';
    res.push(Object.assign({ r, seg, msg: s.hw.detenido ? s.hw.detenido.msg : '' }, t));
    barra.firstElementChild.style.width = `${(100 * (k + 1) / trabajos.length).toFixed(1)}%`;
  }
  const cancelado = evaluando !== true;
  evaluando = false;
  $('bEvaluar').textContent = 'Evaluar';
  barra.hidden = true;
  pintarEvaluacion(res, rivales, semillas, tope, (performance.now() - t0) / 1000, cancelado);
  actualizarBotones();
});
function pintarEvaluacion(res, rivales, semillas, tope, cpu, cancelado) {
  const pts = x => x.r === 'G' ? 3 : (x.r === 'E' ? 1 : 0);
  const total = res.reduce((a, x) => a + pts(x), 0), maximo = res.length * 3;
  const gan = res.filter(x => x.r === 'G');
  let html = `<p class="eval-total"><b>${total}</b> de ${maximo} puntos · ${gan.length} ganados, ${res.filter(x => x.r === 'E').length} empatados, ${res.filter(x => x.r === 'P').length} perdidos`;
  if (gan.length) html += ` · gana en ${(gan.reduce((a, x) => a + x.seg, 0) / gan.length).toFixed(1)} s en promedio`;
  html += `${cancelado ? ' · <b>cancelado</b>' : ''}</p>`;
  html += `<table class="tabla-eval"><thead><tr><th>Rival</th><th>Ronda 1 · frente</th><th>Ronda 2 · lado</th><th>Ronda 3 · espalda</th><th>Puntos</th></tr></thead><tbody>`;
  for (const rv of rivales) {
    const fila = res.filter(x => x.rival === rv);
    if (!fila.length) continue;
    html += `<tr><td>${NOMBRE_RIVAL[rv] || rv}</td>`;
    for (const ronda of [1, 2, 3]) {
      const c = fila.filter(x => x.ronda === ronda);
      html += `<td class="res">${c.map(x => `<span class="${x.r}" title="semilla ${x.semilla}: ${{ G: 'gana', E: 'empata', P: 'pierde', N: 'nunca arrancó', X: 'el programa falló' }[x.r]} (${x.seg.toFixed(1)} s)${x.msg ? ' · ' + escapar(x.msg) : ''}">${x.r}</span>`).join('')}</td>`;
    }
    html += `<td>${fila.reduce((a, x) => a + pts(x), 0)} / ${fila.length * 3}</td></tr>`;
  }
  html += `</tbody></table><p class="nota">G gana · E empata (llega al tope de ${tope} s) · P pierde · N nunca arrancó · X el programa falló. ${res.length} combates en ${cpu.toFixed(0)} s. Pasá el puntero sobre una letra para ver el detalle.</p>`;
  $('resultadoEval').innerHTML = html;
}

function refrescarTodo() { marcarRonda(); actualizarPaneles(performance.now()); proxLento = 0; }

// arranque de la pagina: enciende solo para que se vea funcionando
refrescarSelects();
pintarPines();
ajustar();
leerColores();
nuevaSim();
iniciado = true; corriendo = true;
actualizarBotones();
requestAnimationFrame(t => { ultimoCuadro = t; cuadro(t); });
})();
