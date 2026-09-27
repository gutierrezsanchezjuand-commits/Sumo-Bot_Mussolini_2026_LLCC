
/* ==========================================================================
   API DE ARDUINO para los programas traducidos (traductor_arduino.js).
   Todo lo que el programa ve del ESP32: millis(), pines, LEDC (core 2.x y
   3.x), analogWrite, pulseIn, Serial, Wire, el NeoPixel, el IMU (Adafruit
   LSM6DS y MPU6050), NewPing y HCSR04. Los pines salen de la configuracion
   del robot (por defecto, los del kit IdeaBoard).
   Las funciones que esperan tiempo son generadores: avanzan el reloj del
   programa y ceden el turno cuando llegan al instante del mundo.
   ========================================================================== */
const IMU_ODR_HZ = { 0: 0, 1: 12.5, 2: 26, 3: 52, 4: 104, 5: 208, 6: 416, 7: 833, 8: 1660, 9: 3330, 10: 6660 };
const IMU_RANGO_ACC_G = { 0: 2, 1: 16, 2: 4, 3: 8 };
const IMU_RANGO_GIRO_DPS = { 0: 250, 2: 125, 4: 500, 8: 1000, 12: 2000, 1: 4000 };
const MPU_RANGO_ACC_G = { 0: 2, 1: 4, 2: 8, 3: 16 };
const MPU_RANGO_GIRO_DPS = { 0: 250, 1: 500, 2: 1000, 3: 2000 };

// Print::printFloat del core de Arduino, paso a paso (suma 0.5 del ultimo digito y trunca).
function textoFlotante(numero, dig) {
  if (Number.isNaN(numero)) return 'nan';
  if (numero === Infinity || numero === -Infinity) return 'inf';
  if (numero > 4294967040 || numero < -4294967040) return 'ovf';
  dig = dig === undefined ? 2 : Math.max(0, Math.trunc(dig));
  let s = '';
  if (numero < 0) { s = '-'; numero = -numero; }
  let redondeo = 0.5;
  for (let i = 0; i < dig; i++) redondeo /= 10;
  numero += redondeo;
  const entero = Math.floor(numero);
  let resto = numero - entero;
  s += String(entero);
  if (dig > 0) s += '.';
  while (dig-- > 0) { resto *= 10; const d = Math.trunc(resto); s += d; resto -= d; }
  return s;
}
// dtostrf del core del ESP32 (lo usan String(float) y la concatenacion de String con float).
function dtostrfCore(numero, ancho, prec) {
  if (Number.isNaN(numero)) return 'nan';
  if (numero === Infinity || numero === -Infinity) return 'inf';
  prec = Math.max(0, Math.trunc(prec));
  let out = '', llenar = ancho, neg = false;
  if (prec > 0) llenar -= prec + 1;
  if (numero < 0) { neg = true; llenar--; numero = -numero; }
  let r = 2;
  for (let i = 0; i < prec; i++) r *= 10;
  numero += 1 / r;
  let pot = 1, digitos = 1;
  while (numero >= 10 * pot) { pot *= 10; digitos++; }
  numero /= pot;
  llenar -= digitos;
  while (llenar-- > 0) out += ' ';
  if (neg) out += '-';
  digitos += prec;
  while (digitos-- > 0) {
    let d = Math.trunc(numero);
    if (d > 9) d = 9;
    out += d;
    if (digitos === prec && prec > 0) out += '.';
    numero -= d; numero *= 10;
  }
  return out;
}
// Numero con n decimales, redondeado sobre el valor exacto con los empates al par
// (como printf de newlib en el ESP32 y como Python).
function fijoExacto(x, n) {
  n = Math.max(0, Math.min(40, Math.trunc(n)));
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
  const a = Math.abs(x);
  const exacto = a.toPrecision(100);
  if (/e/.test(exacto)) return x.toFixed(Math.min(n, 20));
  const partes = exacto.split('.');
  const ent = partes[0], frac = partes[1] || '';
  const resto = frac.slice(n);
  let k = BigInt(ent + frac.padEnd(n, '0').slice(0, n));
  const p = resto[0] || '0', despues = /[1-9]/.test(resto.slice(1));
  if (p > '5' || (p === '5' && (despues || k % 2n === 1n))) k += 1n;
  let s = k.toString().padStart(n + 1, '0');
  if (n) s = s.slice(0, s.length - n) + '.' + s.slice(s.length - n);
  return (x < 0 ? '-' : '') + s;
}
function textoEnteroMin(v, base) {
  if (base === undefined || base === 10) return String(Math.trunc(v));
  return (Math.trunc(v) >>> 0).toString(base < 2 || base > 36 ? 10 : base);
}
function textoEntero(v, base) {
  if (base === undefined || base === 10) return String(Math.trunc(v));
  if (base < 2 || base > 36) base = 10;
  if (base === 10) return String(Math.trunc(v));
  return (Math.trunc(v) >>> 0).toString(base).toUpperCase();
}
// printf de C: %d %i %u %f %e %g %x %X %o %c %s %p %%, con banderas, ancho y precision.
function formatoPrintf(fmt, args) {
  let k = 0;
  return String(fmt).replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|L|z|j|t)?([diuoxXfFeEgGcsp%])/g, (m, flags, ancho, prec, largo, conv) => {
    if (conv === '%') return '%';
    if (ancho === '*') ancho = args[k++];
    if (prec === '*') prec = args[k++];
    let v = args[k++];
    let s;
    const p = prec === undefined ? undefined : +prec;
    switch (conv) {
      case 'd': case 'i': s = String(Math.trunc(Number(v) || 0)); if (p !== undefined) s = s.replace(/\d+/, d => d.padStart(p, '0')); break;
      case 'u': s = String((Number(v) || 0) >>> 0); break;
      case 'x': s = ((Number(v) || 0) >>> 0).toString(16); if (flags.includes('#') && v) s = '0x' + s; break;
      case 'X': s = ((Number(v) || 0) >>> 0).toString(16).toUpperCase(); if (flags.includes('#') && v) s = '0X' + s; break;
      case 'o': s = ((Number(v) || 0) >>> 0).toString(8); break;
      case 'f': case 'F': s = fijoExacto(Number(v), p === undefined ? 6 : p); break;
      case 'e': case 'E': s = Number(v).toExponential(p === undefined ? 6 : p).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break;
      case 'g': case 'G': { const n = Number(v); s = n === 0 ? '0' : String(Number(n.toPrecision(p === undefined ? 6 : Math.max(1, p)))); if (conv === 'G') s = s.toUpperCase(); break; }
      case 'c': s = typeof v === 'string' ? v.charAt(0) : String.fromCharCode(Number(v) || 0); break;
      case 's': s = v === undefined || v === null ? '(null)' : String(v); if (p !== undefined) s = s.substring(0, p); break;
      case 'p': s = '0x3ffb' + ((Number(v) || 0) >>> 0).toString(16).padStart(4, '0'); break;
    }
    if (flags.includes('+') && /^[0-9]/.test(s) && 'dif'.includes(conv.toLowerCase())) s = '+' + s;
    else if (flags.includes(' ') && /^[0-9]/.test(s) && 'dif'.includes(conv.toLowerCase())) s = ' ' + s;
    const w = ancho === undefined ? 0 : +ancho;
    if (s.length < w) {
      if (flags.includes('-')) s = s.padEnd(w);
      else if (flags.includes('0') && !'cs'.includes(conv)) { const signo = /^[+-]/.test(s) ? s[0] : ''; s = signo + s.slice(signo.length).padStart(w - signo.length, '0'); }
      else s = s.padStart(w);
    }
    return s;
  });
}
function copiarProfundo(o) {
  if (o === null || typeof o !== 'object') return o;
  if (ArrayBuffer.isView(o)) return o.slice();
  if (Array.isArray(o)) return o.map(copiarProfundo);
  const r = {};
  for (const k of Object.keys(o)) r[k] = copiarProfundo(o[k]);
  return r;
}
function colorHSV(hue, sat, val) {
  hue = ((hue % 65536) + 65536) % 65536;
  sat = sat === undefined ? 255 : sat; val = val === undefined ? 255 : val;
  hue = Math.floor((hue * 1530 + 32768) / 65536);
  let r, g, b;
  if (hue < 510) { b = 0; if (hue < 255) { r = 255; g = hue; } else { r = 510 - hue; g = 255; } }
  else if (hue < 1020) { r = 0; if (hue < 765) { g = 255; b = hue - 510; } else { g = 1020 - hue; b = 255; } }
  else if (hue < 1530) { g = 0; if (hue < 1275) { r = hue - 1020; b = 255; } else { r = 255; b = 1530 - hue; } }
  else { r = 255; g = b = 0; }
  const v1 = 1 + val, s1 = 1 + sat, s2 = 255 - sat;
  const f = c => (((((c * s1) >> 8) + s2) * v1) & 0xff00) >> 8;
  return ((f(r) << 16) | (f(g) << 8) | f(b)) >>> 0;
}

function crearApiArduino(hw) {
  const P = hw.pines;
  function* ceder() { if (hw.ceder) { hw.ceder = false; yield; } }
  function* esperar(us) {
    const fin = hw.t + us;
    while (hw.t < fin) { hw.avanzar(Math.min(1000, fin - hw.t)); yield* ceder(); }
  }
  const azar = () => hw.azarProg.sig();

  // ── Serial ──
  function crearSerial(mudo) {
    return {
      begin(baud) { if (!mudo && baud > 0) hw.baudios = baud; hw.avanzar(20); },
      end() {},
      *print(txt) { if (mudo) { hw.avanzar(COSTO.serial); return 0; } yield* hw.escribirSerial(String(txt)); return String(txt).length; },
      *println(txt) { if (mudo) { hw.avanzar(COSTO.serial); return 0; } yield* hw.escribirSerial(String(txt === undefined ? '' : txt) + '\r\n'); return String(txt || '').length + 2; },
      *flush() { if (!mudo) while (hw.uartLibre > hw.t) { hw.avanzar(Math.min(1000, hw.uartLibre - hw.t)); yield* ceder(); } },
      available: () => 0, read: () => -1, peek: () => -1, setTimeout() {}, readString: () => '', readStringUntil: () => '',
      parseInt: () => 0, parseFloat: () => 0, availableForWrite: () => 128, setDebugOutput() {}, setTxBufferSize: () => 0,
      setRxBufferSize: () => 256, updateBaudRate(b) { if (!mudo && b > 0) hw.baudios = b; }, find: () => false, readBytes: () => 0,
    };
  }

  // ── Wire (I2C): responde el IMU en su direccion, con sus registros ──
  const Wire = {
    tx: null, rx: [], reg: 0,
    begin() { hw.avanzar(200); return true; }, end() { return true; }, setClock() { return true; }, getClock: () => 400000,
    setTimeOut() {}, setTimeout() {},
    beginTransmission(dir) { this.tx = { dir, datos: [] }; },
    write(b) { if (this.tx) this.tx.datos.push(typeof b === 'string' ? b.charCodeAt(0) : b & 255); return 1; },
    *endTransmission() {
      hw.avanzar(60 + (this.tx ? this.tx.datos.length * 25 : 0));
      yield* ceder();
      const t = this.tx; this.tx = null;
      if (!t || !hw.imuPresente(t.dir)) return 2;
      if (t.datos.length) { this.reg = t.datos[0]; for (let i = 1; i < t.datos.length; i++) hw.imuEscribirRegistro(this.reg + i - 1, t.datos[i]); }
      return 0;
    },
    *requestFrom(dir, n) {
      hw.avanzar(60 + n * 25);
      yield* ceder();
      this.rx = [];
      if (!hw.imuPresente(dir)) return 0;
      for (let i = 0; i < n; i++) this.rx.push(hw.imuLeerRegistro(this.reg + i));
      this.reg += n;
      return n;
    },
    read() { return this.rx.length ? this.rx.shift() : -1; },
    peek() { return this.rx.length ? this.rx[0] : -1; },
    available() { return this.rx.length; },
  };

  // ── objetos de librerias ──
  const clases = {
    Adafruit_NeoPixel(n, pin) {
      n = Math.max(1, n | 0);
      const o = {
        n, pin: pin === undefined ? -1 : pin, brillo: 0, px: new Uint32Array(n), finShow: -1e12,
        begin() { return true; },
        *show() {
          const espera = Math.max(0, COSTO.latchNeopixel - (hw.t - this.finShow));
          hw.avanzar(espera + 30 * this.n + 15);
          this.finShow = hw.t;
          if (this.pin === P.neopixel || hw.neoPrincipal === this || hw.neoPrincipal === null) {
            if (hw.neoPrincipal === null) hw.neoPrincipal = this;
            const c = this.px[0], k = this.brillo ? this.brillo / 256 : 1;
            hw.ledNeo([Math.floor(((c >> 16) & 255) * k), Math.floor(((c >> 8) & 255) * k), Math.floor((c & 255) * k)]);
          }
          yield* ceder();
        },
        setPixelColor(i, r, g, b) {
          if (i < 0 || i >= this.n) return;
          this.px[i] = g === undefined ? (r >>> 0) : ((((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0);
        },
        Color(r, g, b) { return ((((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0); },
        clear() { this.px.fill(0); },
        setBrightness(b) { this.brillo = ((b & 255) + 1) & 255; },
        getBrightness() { return (this.brillo - 1) & 255; },
        fill(c, primero, cuantos) { c = c >>> 0; primero = primero || 0; const fin = cuantos ? Math.min(this.n, primero + cuantos) : this.n; for (let i = primero; i < fin; i++) this.px[i] = c; },
        numPixels() { return this.n; },
        getPixelColor(i) { return i >= 0 && i < this.n ? this.px[i] : 0; },
        ColorHSV(h, s, v) { return colorHSV(h, s, v); },
        gamma32(c) { const g = x => Math.round(Math.pow(x / 255, 2.6) * 255); return ((g((c >> 16) & 255) << 16) | (g((c >> 8) & 255) << 8) | g(c & 255)) >>> 0; },
        gamma8(x) { return Math.round(Math.pow((x & 255) / 255, 2.6) * 255); },
        sine8(x) { return Math.round((Math.sin(((x & 255) / 256) * 2 * Math.PI - Math.PI / 2) + 1) * 127.5); },
        canShow() { return true; }, updateLength(k) { this.n = k; this.px = new Uint32Array(k); }, setPin(p) { this.pin = p; }, updateType() {},
      };
      return o;
    },
    LSM6DS(tipo) {
      const mpu = tipo === 'Adafruit_MPU6050';
      const o = {
        listo: false, rangoAcc: mpu ? 0 : 2, rangoGiro: mpu ? 0 : 12, odrAcc: 4, odrGiro: 4,
        *iniciar(dir) {
          hw.avanzar(COSTO.i2cBegin);
          yield* ceder();
          const d = dir === undefined || dir === null ? (mpu ? 0x68 : 0x6A) : dir;
          this.listo = !hw.op.imuAusente && (mpu || hw.imuPresente(d));
          if (!this.listo && !hw.op.imuAusente) hw.avisoPrograma(`el IMU no respondio en 0x${d.toString(16).toUpperCase()}: en el kit esta en 0x${P.imuDir.toString(16).toUpperCase()}`);
          if (this.listo) { this.rangoAcc = mpu ? 0 : 2; this.rangoGiro = mpu ? 0 : 12; this.odrAcc = this.odrGiro = 4; hw.fijarOdrImu(mpu ? 1000 : 104); }
          return this.listo;
        },
        *begin_I2C(dir) { return yield* this.iniciar(dir); },
        *begin(dir) { return yield* this.iniciar(dir); },
        *begin_SPI() { hw.avanzar(COSTO.i2cBegin); return false; },
        *getEvent(a, g, t) {
          hw.avanzar(COSTO.i2cEvento);
          const M = hw.cuerpo.imu.muestra;
          let ax = M.ax, ay = M.ay, az = M.az, gx = M.gx, gy = M.gy, gz = M.gz;
          if (M.fuerte && hw.op.azarI2C.prob(IMU.fallaI2C)) { ax = 0; ay = 0; az = 0; }
          const lg = (mpu ? MPU_RANGO_ACC_G[this.rangoAcc] : IMU_RANGO_ACC_G[this.rangoAcc]) * G;
          const lw = (mpu ? MPU_RANGO_GIRO_DPS[this.rangoGiro] : IMU_RANGO_GIRO_DPS[this.rangoGiro]) * GRAD;
          const ca = v => clamp(v, -lg, lg), cw = v => clamp(v, -lw, lw);
          if (!this.listo) { ax = ay = az = gx = gy = gz = 0; }
          if (a && a.acceleration) { a.acceleration.x = ca(ax); a.acceleration.y = ca(ay); a.acceleration.z = ca(az); a.timestamp = Math.floor(hw.t / 1000); }
          if (g && g.gyro) { g.gyro.x = cw(gx); g.gyro.y = cw(gy); g.gyro.z = cw(gz); g.timestamp = Math.floor(hw.t / 1000); }
          if (t) t.temperature = 27.5 + hw.azarVario.gauss() * 0.2;
          yield* ceder();
          return this.listo;
        },
        *setAccelRange(r) { hw.avanzar(COSTO.i2cConfig); this.rangoAcc = r; yield* ceder(); },
        *setGyroRange(r) { hw.avanzar(COSTO.i2cConfig); this.rangoGiro = r; yield* ceder(); },
        *setAccelerometerRange(r) { hw.avanzar(COSTO.i2cConfig); this.rangoAcc = r; yield* ceder(); },
        *setGyroscopeRange(r) { hw.avanzar(COSTO.i2cConfig); this.rangoGiro = r; yield* ceder(); },
        *setAccelDataRate(r) { hw.avanzar(COSTO.i2cConfig); this.odrAcc = r; hw.fijarOdrImu(Math.max(IMU_ODR_HZ[this.odrAcc] || 0, IMU_ODR_HZ[this.odrGiro] || 0)); yield* ceder(); },
        *setGyroDataRate(r) { hw.avanzar(COSTO.i2cConfig); this.odrGiro = r; hw.fijarOdrImu(Math.max(IMU_ODR_HZ[this.odrAcc] || 0, IMU_ODR_HZ[this.odrGiro] || 0)); yield* ceder(); },
        getAccelRange() { return this.rangoAcc; }, getGyroRange() { return this.rangoGiro; },
        getAccelerometerRange() { return this.rangoAcc; }, getGyroscopeRange() { return this.rangoGiro; },
        getAccelDataRate() { return this.odrAcc; }, getGyroDataRate() { return this.odrGiro; },
        *reset() { hw.avanzar(COSTO.i2cConfig); yield* ceder(); },
        configInt1() {}, configInt2() {}, setFilterBandwidth() {}, setHighPassFilter() {},
        *getTemperature() { hw.avanzar(COSTO.i2cConfig); yield* ceder(); return 27.5; },
      };
      return o;
    },
    NewPing(trig, eco, maxCm) {
      const max = Math.min(maxCm || 500, 500);
      const o = {
        *ping(maxc) {
          const m = maxc ? Math.min(maxc, max) : max;
          if (eco === P.echo && hw.nivelEco(hw.t)) { hw.avanzar(3); yield* ceder(); return 0; }   // el ping anterior no termino
          yield* hw.dispararSonar(trig);
          if (eco !== P.echo) { yield* esperar(5800); return 0; }
          const t0 = hw.t;
          while (!hw.nivelEco(hw.t)) {
            if (hw.t - t0 > 5800) return 0;
            hw.avanzar(Math.max(1, Math.min(hw.proximoCambioEco(hw.t) - hw.t, t0 + 5801 - hw.t, 500)));
            yield* ceder();
          }
          const ti = hw.t, tope = m * 57 + 57;
          while (hw.nivelEco(hw.t)) {
            if (hw.t - ti > tope) return 0;
            hw.avanzar(Math.max(1, Math.min(hw.proximoCambioEco(hw.t) - hw.t, ti + tope + 1 - hw.t, 500)));
            yield* ceder();
          }
          return Math.floor(hw.t - ti);
        },
        *ping_cm(maxc) { const us = yield* this.ping(maxc); return this.convert_cm(us); },
        *ping_in(maxc) { const us = yield* this.ping(maxc); return us ? Math.max(Math.floor((us + 73) / 146), 1) : 0; },
        *ping_median(n, maxc) {
          n = Math.max(1, n || 5);
          const v = [];
          for (let i = 0; i < n; i++) {
            const us = yield* this.ping(maxc);
            if (us) v.push(us);
            if (i < n - 1) yield* esperar(29000);
          }
          if (!v.length) return 0;
          v.sort((a, b) => a - b);
          return v[v.length >> 1];
        },
        convert_cm(us) { return us ? Math.max(Math.floor((us + 28) / 57), 1) : 0; },
        convert_in(us) { return us ? Math.max(Math.floor((us + 73) / 146), 1) : 0; },
      };
      return o;
    },
    UltraSonicDistanceSensor(trig, eco, maxCm) {
      const max = maxCm || 400;
      return {
        *measureDistanceCm() {
          yield* hw.dispararSonar(trig);
          const us = yield* api.pulseIn(eco, 1, max * 58 * 2 + 2000);
          const d = us / 2 * 0.0343;
          return (d === 0 || d > max) ? -1.0 : d;
        },
      };
    },
  };

  const api = {
    // ── tiempo ──
    millis() { hw.avanzar(0.3); return Math.floor(hw.t / 1000) >>> 0; },
    micros() { hw.avanzar(0.3); return Math.floor(hw.t) >>> 0; },
    esp_timer_get_time() { hw.avanzar(0.3); return Math.floor(hw.t); },
    xTaskGetTickCount() { return Math.floor(hw.t / 1000) >>> 0; },
    *delay(ms) {
      ms = Math.trunc(Number(ms)) >>> 0;
      const fin = (Math.floor(hw.t / 1000) + ms) * 1000;   // FreeRTOS: despierta en el tick
      while (hw.t < fin) { hw.avanzar(Math.min(1000, fin - hw.t)); yield* ceder(); }
    },
    *vTaskDelay(ticks) { yield* api.delay(ticks); },
    *delayMicroseconds(us) { yield* esperar(Math.max(0, Number(us) || 0)); },
    *__yield() { hw.avanzar(1); yield* ceder(); },
    // ── pines ──
    pinMode(pin, modo) { hw.avanzar(COSTO.pinMode); hw.pinModo[pin] = modo; },
    *digitalWrite(pin, v) { hw.avanzar(COSTO.digitalWrite); hw.escribirDigital(pin, v ? 1 : 0); yield* ceder(); },
    *digitalRead(pin) {
      let v;
      if (pin === P.boot) {
        const prox = hw.sim.mundo.proximoEvento();
        hw.avanzar(Math.max(COSTO.digitalRead, Math.min(1000, prox - hw.t, hw.limite - hw.t)));
        v = hw.leerBoot();
      } else {
        hw.avanzar(COSTO.digitalRead);
        v = hw.leerDigital(pin);
      }
      yield* ceder();
      return v;
    },
    *analogRead(pin) {
      hw.avanzar(COSTO.analogRead);
      const v = hw.leerAnalogico(pin);
      yield* ceder();
      const b = hw.bitsAdc;
      return b === 12 ? v : (b < 12 ? v >> (12 - b) : v << (b - 12));
    },
    *analogReadMilliVolts(pin) {
      hw.avanzar(COSTO.analogRead);
      const v = hw.leerAnalogico(pin);
      yield* ceder();
      return Math.round(142 + v * (3130 - 142) / 4095);
    },
    analogReadResolution(b) { hw.bitsAdc = clamp(b | 0, 9, 16); },
    analogSetAttenuation() {}, analogSetPinAttenuation() {}, analogSetWidth() {},
    *analogWrite(pin, v) {
      hw.avanzar(COSTO.ledcWrite + 1);
      const bits = hw.bitsAnalogWrite[pin] || hw.bitsAnalogWrite.todos || 8;
      const max = Math.pow(2, bits) - 1;
      hw.escribirFrac(pin, clamp(Number(v) || 0, 0, max) / max);
      yield* ceder();
    },
    analogWriteResolution(a, b) { if (b === undefined) hw.bitsAnalogWrite.todos = a; else hw.bitsAnalogWrite[a] = b; return true; },
    analogWriteFrequency() { return true; },
    // LEDC: core 2.x (ledcSetup + ledcAttachPin + ledcWrite(canal)) y 3.x (ledcAttach + ledcWrite(pin))
    ledcSetup(canal, frec, bits) { const c = hw.ledcCanal[canal] || (hw.ledcCanal[canal] = { bits: 8, pines: [] }); c.bits = bits; hw.ledcModo2 = true; hw.avanzar(20); return frec; },
    ledcAttachPin(pin, canal) { const c = hw.ledcCanal[canal] || (hw.ledcCanal[canal] = { bits: 8, pines: [] }); if (!c.pines.includes(pin)) c.pines.push(pin); hw.ledcModo2 = true; hw.escribirFrac(pin, 0); },
    ledcDetachPin(pin) { for (const c of Object.values(hw.ledcCanal)) c.pines = c.pines.filter(p => p !== pin); hw.escribirFrac(pin, 0); },
    ledcAttach(pin, frec, bits) { hw.ledcBitsPin[pin] = bits || 8; hw.escribirFrac(pin, 0); hw.avanzar(20); return true; },
    ledcAttachChannel(pin, frec, bits, canal) {
      hw.ledcBitsPin[pin] = bits || 8;
      const c = hw.ledcCanal3[canal] || (hw.ledcCanal3[canal] = []);
      if (!c.includes(pin)) c.push(pin);
      hw.escribirFrac(pin, 0); hw.avanzar(20); return true;
    },
    ledcDetach(pin) { delete hw.ledcBitsPin[pin]; hw.escribirFrac(pin, 0); return true; },
    *ledcWrite(x, duty) {
      hw.avanzar(COSTO.ledcWrite);
      duty = Number(duty) || 0;
      let ok = true;
      if (hw.ledcModo2 && hw.ledcCanal[x]) {
        const c = hw.ledcCanal[x], max = Math.pow(2, c.bits) - 1;
        for (const pin of c.pines) hw.escribirFrac(pin, clamp(duty, 0, max) / max);
      } else if (hw.ledcBitsPin[x] !== undefined) {
        const max = Math.pow(2, hw.ledcBitsPin[x]) - 1;
        hw.escribirFrac(x, clamp(duty, 0, max) / max);
      } else if (hw.ledcCanal3[x]) {
        for (const pin of hw.ledcCanal3[x]) { const max = Math.pow(2, hw.ledcBitsPin[pin] || 8) - 1; hw.escribirFrac(pin, clamp(duty, 0, max) / max); }
      } else {
        ok = false;
        hw.avisoPrograma(`ledcWrite(${x}, ...) sin ledcAttach(${x}, ...) antes: en el robot ese pin no se mueve`);
      }
      yield* ceder();
      return ok;
    },
    ledcRead(x) { return 0; }, ledcReadFreq() { return 0; }, ledcWriteTone() { return 0; }, ledcWriteNote() { return 0; },
    ledcChangeFrequency(p, f) { return f; }, ledcOutputInvert() { return true; }, ledcFade() { return true; },
    *neopixelWrite(pin, r, g, b) { hw.avanzar(COSTO.neopixel); if (pin === P.neopixel) hw.ledNeo([r & 255, g & 255, b & 255]); yield* ceder(); },
    *rgbLedWrite(pin, r, g, b) { yield* api.neopixelWrite(pin, r, g, b); },
    tone() {}, noTone() {},
    *pulseIn(pin, estado, timeout) {
      timeout = timeout === undefined ? 1000000 : (Number(timeout) >>> 0);
      if (pin !== P.echo) { yield* esperar(timeout); return 0; }
      const limite = hw.t + timeout;
      let fase = 1, inicio = 0;
      estado = estado ? 1 : 0;
      for (;;) {
        const nivel = hw.nivelEco(hw.t);
        if (fase === 1 && nivel !== estado) fase = 2;
        if (fase === 2 && nivel === estado) { fase = 3; inicio = hw.t; }
        else if (fase === 3 && nivel !== estado) { yield* ceder(); return Math.floor(hw.t - inicio); }
        if (hw.t >= limite) { yield* ceder(); return 0; }
        const prox = hw.proximoCambioEco(hw.t);
        hw.avanzar(Math.max(0.25, Math.min(prox - hw.t, limite + 0.5 - hw.t, 500)));
        yield* ceder();
      }
    },
    *pulseInLong(pin, estado, timeout) { return yield* api.pulseIn(pin, estado, timeout); },
    // ── otras del core ──
    random(a, b) {
      if (b === undefined) { b = a; a = 0; }
      a = Math.trunc(a); b = Math.trunc(b);
      if (a >= b) return b === 0 && a === 0 ? 0 : a;
      return a + Math.floor(azar() * (b - a));
    },
    randomSeed(s) { if (s) hw.azarProg = crearAzar((Number(s) >>> 0) ^ 0x5DEECE66); },
    esp_random() { return Math.floor(azar() * 4294967296) >>> 0; },
    temperatureRead() { return 48 + hw.azarVario.gauss(); },
    *hallRead() { hw.avanzar(100); yield* ceder(); return Math.round(hw.azarVario.gauss() * 10); },
    *touchRead() { hw.avanzar(500); yield* ceder(); return 70 + Math.round(hw.azarVario.gauss() * 2); },
    interrupts() {}, noInterrupts() {}, digitalPinToInterrupt(p) { return p; },
    isDigit: c => c >= 48 && c <= 57, isAlpha: c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isAlphaNumeric: c => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isSpace: c => c === 32 || (c >= 9 && c <= 13), isWhitespace: c => c === 32 || c === 9,
    isUpperCase: c => c >= 65 && c <= 90, isLowerCase: c => c >= 97 && c <= 122, isAscii: c => c >= 0 && c < 128,
    isPunct: c => /[!-\/:-@\[-`{-~]/.test(String.fromCharCode(c)), isHexadecimalDigit: c => /[0-9A-Fa-f]/.test(String.fromCharCode(c)),
    isPrintable: c => c >= 32 && c < 127, isControl: c => c < 32 || c === 127,
    esp_restart() { hw.fallo('el programa reinicio el ESP32 (esp_restart)'); },
    abort() { hw.fallo('el programa llamo a abort(): en el robot el ESP32 se reinicia'); },
    // ── objetos ──
    Serial: crearSerial(false), Serial1: crearSerial(true), Serial2: crearSerial(true), Wire,
    ESP: {
      restart() { hw.fallo('el programa reinicio el ESP32 (ESP.restart)'); },
      getFreeHeap: () => 243000, getHeapSize: () => 327680, getMinFreeHeap: () => 238000, getChipModel: () => 'ESP32-D0WD-V3',
      getChipRevision: () => 3, getCpuFreqMHz: () => 240, getSketchSize: () => 290000, getFlashChipSize: () => 4194304,
      getEfuseMac: () => 0x2462ABCDEF12, getChipCores: () => 2,
    },
    // ── ayudas del traductor ──
    __tick() { return hw.tick(); },
    *__detener() { for (;;) { hw.avanzar(Math.max(1, hw.limite - hw.t)); hw.ceder = false; yield; } },
    __div(a, b) { if (b === 0) hw.fallo('division entera por cero (en el robot el ESP32 se reinicia)'); return Math.trunc(a / b); },
    __mod(a, b) { if (b === 0) hw.fallo('resto (%) de una division por cero (en el robot el ESP32 se reinicia)'); return a % b; },
    __constrain(x, a, b) { return x < a ? a : (x > b ? b : x); },
    __map(x, a, b, c, d) {
      x = Math.trunc(x); a = Math.trunc(a); b = Math.trunc(b); c = Math.trunc(c); d = Math.trunc(d);
      const run = b - a;
      if (run === 0) return -1;
      return Math.trunc(((x - a) * (d - c)) / run) + c;
    },
    __round(x) { return x < 0 ? -Math.round(-x) : Math.round(x); },
    __ff: textoFlotante, __fi: textoEntero, __printf: formatoPrintf,
    __dtostrf(v, ancho, prec) { return dtostrfCore(Number(v), ancho, prec); },
    __fiMin: textoEnteroMin,
    __charAt(s, i) { return i >= 0 && i < s.length ? s.charCodeAt(i) : 0; },
    __toInt(s) { const m = /^\s*[+-]?\d+/.exec(String(s)); return m ? (parseInt(m[0], 10) | 0) : 0; },
    __toFloat(s) { const v = parseFloat(String(s)); return Number.isNaN(v) ? 0 : v; },
    __cmpTexto(a, b) { return a < b ? -1 : (a > b ? 1 : 0); },
    __copiar: copiarProfundo,
    __arr(Clase, n, vals) { const a = new Clase(n); a.set(vals.slice(0, n)); return a; },
    __lista(n, vals, fab) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i < vals.length ? vals[i] : fab(); return a; },
    __refIdx(o, k) { return { get 0() { return o[k]; }, set 0(v) { o[k] = v; } }; },
    __memset(a, v, n, tam) {
      const k = Math.min(a.length, Math.floor(n / tam));
      if (ArrayBuffer.isView(a)) new Uint8Array(a.buffer, a.byteOffset, k * a.BYTES_PER_ELEMENT).fill(v & 255);
      else for (let i = 0; i < k; i++) a[i] = v;
    },
    __memcpy(dst, src, n, tam) { const k = Math.min(dst.length, Math.floor(n / tam)); for (let i = 0; i < k; i++) dst[i] = src[i]; },
    __nuevo(clase, args) {
      if (clase === 'Adafruit_NeoPixel') return clases.Adafruit_NeoPixel(...args);
      if (clase === 'NewPing') return clases.NewPing(...args);
      if (clase === 'UltraSonicDistanceSensor') return clases.UltraSonicDistanceSensor(...args);
      if (TA_CLASES[clase] === 'LSM6DS') return clases.LSM6DS(clase);
      throw new Error('clase desconocida: ' + clase);
    },
  };
  return api;
}
