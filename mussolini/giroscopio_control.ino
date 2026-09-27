// Control por giroscopio (LSM6DS3TRC). Segunda pestaña del mismo sketch.

#include <Wire.h>
#include <Adafruit_LSM6DS3TRC.h>

#define GYRO_EJE_GIRO 2  // 0=X  1=Y  2=Z; Z confirmado en el robot

const uint32_t I2C_HZ = 400000;  // 400 kHz; bajar a 100000 si suben los imuFallos

// ── Giro por angulo ──
const float MARGEN_ERROR_GRADOS = 4.0;              // tolerancia pedida: +/-4 grados
const unsigned long TIMEOUT_GIRO_MS = 3000;         // limite de seguridad (180 a fondo ~1450 ms)
// A 0.45 no pivotea; sin desacelerar, se pasa 2-5 grados.
const float ZONA_DESACELERACION_GRADOS = 25.0;      // ultimos grados a velocidad reducida (solo con desacelerar=true)
const float VEL_DESACELERACION = 0.75;
const float FILTRO_DRIFT_RAD_S = 0.015;             // muestras mas rapidas no entran al promedio del drift
// Giro trabado (rival lo sujeta, o en el aire).
const unsigned long VENTANA_GIRO_TRABADO_MS = 300;
const float GIRO_MINIMO_VENTANA = 8.0;

// ── Levantamiento: inclinacion 3D contra el reposo, con histeresis ──
const float INCLINACION_LEVANTADO_DEG = 15.0;
const float INCLINACION_SALIDA_DEG = 10.0;
// Sostenido 250 ms: filtra picos de giros y golpes.
const unsigned long DURACION_LEVANTADO_MS = 250;
// Hueco sin evaluar reinicia la cuenta; inclinacion filtrada 100 ms.
const unsigned long HUECO_EVAL_LEVANTADO_MS = 50;
const float TAU_INCLINACION_S = 0.10;

// ── Escape del borde: retroceso largo y media vuelta ──
const unsigned long RETROCESO_ESCAPE_FRENTE_MS = 450;    // antes 180
const unsigned long RETROCESO_ESCAPE_LATERAL_MS = 350;   // antes 120
const float ANGULO_ESCAPE_FRENTE = 200.0;                // ya eran 200 (sin cambio)
const float ANGULO_ESCAPE_LATERAL = 180.0;               // antes 90
// Un eco nuevo sostenido corta el escape y ataca.
const unsigned long DURACION_DETECCION_GIRO_MS = 60;
bool escapeInterrumpidoPorSonar = false;

// ── Levantamiento: retroceder hasta volver a apoyar (min/max) ──
const unsigned long RETROCESO_MIN_LEVANTADO_MS = 250;
const unsigned long RETROCESO_MAX_LEVANTADO_MS = 1500;
const unsigned long PLANO_SOSTENIDO_MS = 150;
// Solo giros violentos apagan la deteccion de levantamiento.
const float UMBRAL_GIRO_ACTIVO = 120.0;
const float DPS_GIRO_EVIDENTE = 30.0;               // para aprender el signo del giro: pivote claramente en marcha

// ── Golpe y rotacion forzada ──
const float UMBRAL_GOLPE_G = 0.35;                  // aceleracion horizontal (respecto al reposo) que cuenta como golpe
const unsigned long COOLDOWN_GOLPE_MS = 300;
const unsigned long GRACIA_TRAS_CAMBIO_MS = 150;    // tras cambiar la orden, la aceleracion propia no es golpe
// Curva propia: 15-30 grados/s; rotaciones forzadas reales: 100+.
const float UMBRAL_ROTACION_FORZADA_DPS = 60.0;     // mandando recto y girando mas que esto: nos rotan
const unsigned long VIGENCIA_GOLPE_MS = 200;        // un golpe mas viejo que esto ya no justifica reaccionar
const unsigned long DURACION_ROTACION_FORZADA_MS = 100;
// Chasis inclinado: Z baja; un golpe real no cambia Z.
const float Z_GOLPE_INCLINADO_G = 0.05;

// ── Reaccion al levantamiento ──
const float GIRO_LEVANTADO_GRADOS = 90.0;

Adafruit_LSM6DS3TRC lsmGiro;
float driftGiro = 0;
float ax0 = 0, ay0 = 0, az0 = 1.0;   // vector de aceleracion en reposo, en g
float normReposo = 1.0;
unsigned long tUltimaLecturaImu = 0;

bool levantado = false;
unsigned long tInicioLevante = 0;
unsigned long tInicioRotForzada = 0;
unsigned long tUltimoGolpe = 0;
float golpeAz = 0;                    // Z del ultimo golpe (g): si cae, es inclinacion
float inclinacionFiltrada = 0;        // inclinacionDeg con un pasa-bajos de TAU_INCLINACION_S
unsigned long tUltimaEvalLevante = 0; // ultima vez que detectarLevantado() evaluo de verdad

const float RAD_A_GRADOS = 180.0 / PI;

// Recibe floats sueltos: sensors_event_t no existe al generar prototipos.
float leerEjeGiro(float gx, float gy, float gz) {
  if (GYRO_EJE_GIRO == 0) return gx;
  if (GYRO_EJE_GIRO == 1) return gy;
  return gz;
}

// Destraba el I2C (9 pulsos + STOP) tras un reset.
void recuperarBusI2C() {
  pinMode(SDA, INPUT_PULLUP);
  pinMode(SCL, OUTPUT);
  for (int i = 0; i < 9; i++) {
    digitalWrite(SCL, LOW);  delayMicroseconds(5);
    digitalWrite(SCL, HIGH); delayMicroseconds(5);
  }
  pinMode(SDA, OUTPUT);
  digitalWrite(SDA, LOW);  delayMicroseconds(5);
  digitalWrite(SCL, HIGH); delayMicroseconds(5);
  digitalWrite(SDA, HIGH); delayMicroseconds(5);   // STOP: SDA sube con SCL alto
  pinMode(SDA, INPUT_PULLUP);
  pinMode(SCL, INPUT_PULLUP);
}

// Llamar UNA vez desde setup(), con el robot quieto.
bool iniciarGiroscopio() {
  bool encontrado = false;
  for (int intento = 1; intento <= 3 && !encontrado; intento++) {
    if (intento > 1) {
      Wire.end();
      delay(50);
    }
    recuperarBusI2C();
    Wire.begin();
    Wire.setClock(I2C_HZ);
    Wire.setTimeOut(50);
    encontrado = lsmGiro.begin_I2C(0x6B);
    if (!encontrado) {
      Serial.print("[Giro] Intento "); Serial.print(intento); Serial.println(": no responde.");
      delay(100);
    }
  }

  if (!encontrado) {
    Serial.println("[Giro] No se encontro el LSM6DS3TRC. Sigo sin giroscopio.");
    giroListo = false;
    for (int i = 0; i < 3; i++) {   // aviso: tres rojos antes del BOOT final
      setPixelColor(255, 0, 0); delay(150);
      setPixelColor(0, 0, 0);   delay(150);
    }
    return false;
  }

  // 416 Hz: una muestra nueva por vuelta del loop.
  lsmGiro.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
  lsmGiro.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  lsmGiro.setAccelDataRate(LSM6DS_RATE_416_HZ);
  lsmGiro.setGyroDataRate(LSM6DS_RATE_416_HZ);
  delay(50);

  Serial.println("[Giro] Calibrando drift y nivel (dejar quieto)...");
  float suma = 0, sx = 0, sy = 0, sz = 0;
  int muestras = 0, total = 0;
  unsigned long t0 = millis();
  while (millis() - t0 < 2000) {
    sensors_event_t accel, gyro, temp;
    if (!lsmGiro.getEvent(&accel, &gyro, &temp)) { imuFallos++; delay(5); continue; }
    float v = leerEjeGiro(gyro.gyro.x, gyro.gyro.y, gyro.gyro.z);
    if (fabs(v) < FILTRO_DRIFT_RAD_S) {
      suma += v;
      muestras++;
    }
    sx += accel.acceleration.x / 9.81;
    sy += accel.acceleration.y / 9.81;
    sz += accel.acceleration.z / 9.81;
    total++;
    delay(5);
  }
  driftGiro = (muestras > 0) ? (suma / muestras) : 0;
  if (total > 0) {
    ax0 = sx / total;
    ay0 = sy / total;
    az0 = sz / total;
  }
  normReposo = sqrt(ax0 * ax0 + ay0 * ay0 + az0 * az0);
  if (normReposo < 0.5) normReposo = 1.0;  // por si la calibracion salio absurda

  Serial.print("[Giro] Drift: "); Serial.print(driftGiro, 5);
  Serial.print(" rad/s ("); Serial.print(muestras); Serial.print("/"); Serial.print(total); Serial.println(" muestras)");
  Serial.print("[Giro] Reposo (g): x="); Serial.print(ax0, 3);
  Serial.print(" y="); Serial.print(ay0, 3);
  Serial.print(" z="); Serial.print(az0, 3);
  Serial.print(" |a|="); Serial.println(normReposo, 3);

  giroListo = true;
  tUltimaLecturaImu = 0;
  return true;
}

// ────────────────────────────────────────────
//  LECTURA UNICA DEL IMU POR VUELTA: true si fue valida
// ────────────────────────────────────────────
bool leerIMU() {
  if (!giroListo) return false;

  sensors_event_t accel, gyro, temp;
  unsigned long ahora = micros();
  if (!lsmGiro.getEvent(&accel, &gyro, &temp)) { imuFallos++; return false; }

  float ax = accel.acceleration.x, ay = accel.acceleration.y, az = accel.acceleration.z;
  float mag = sqrt(ax * ax + ay * ay + az * az);
  if (mag < 2.0 || mag > 40.0) { imuFallos++; return false; }  // lectura absurda: se descarta

  float dt = (tUltimaLecturaImu == 0) ? 0 : (ahora - tUltimaLecturaImu) / 1000000.0;
  tUltimaLecturaImu = ahora;
  if (dt > 0.1) dt = 0;  // hueco largo sin lecturas: no integrar basura
  imuDt = dt;

  imuDps = (leerEjeGiro(gyro.gyro.x, gyro.gyro.y, gyro.gyro.z) - driftGiro) * RAD_A_GRADOS;
  rumboDeg += imuDps * dt;

  float axg = ax / 9.81, ayg = ay / 9.81, azg = az / 9.81;
  float dot = axg * ax0 + ayg * ay0 + azg * az0;
  float norma = sqrt(axg * axg + ayg * ayg + azg * azg) * normReposo;
  float c = (norma > 0) ? (dot / norma) : 1.0;
  inclinacionDeg = acos(constrain(c, -1.0, 1.0)) * RAD_A_GRADOS;
  if (dt > 0) inclinacionFiltrada += (dt / (TAU_INCLINACION_S + dt)) * (inclinacionDeg - inclinacionFiltrada);
  dAxG = axg - ax0;
  dAyG = ayg - ay0;

  // Aprende el signo del giro en cada pivote puro.
  if (ultimaIzq != 0 && ultimaDer == -ultimaIzq && fabs(imuDps) > DPS_GIRO_EVIDENTE) {
    signoGiroIzq = (ultimaIzq > 0) ? (int)signo(imuDps) : -(int)signo(imuDps);
  }

  // Golpe: aceleracion brusca ajena, fuera de gracia y cooldown.
  float horizontal = sqrt(dAxG * dAxG + dAyG * dAyG);
  unsigned long ms = millis();
  if (horizontal > UMBRAL_GOLPE_G &&
      ms - tUltimoCambioMotores > GRACIA_TRAS_CAMBIO_MS &&
      ms - tUltimoGolpe > COOLDOWN_GOLPE_MS) {
    tUltimoGolpe = ms;
    golpePendiente = true;
    golpeAz = azg - az0;
    evento("GOLPE", String(horizontal, 2) + ";" + String(dAxG, 2) + ";" + String(dAyG, 2) + ";" + estadoTel);
  }

  return true;
}

// ────────────────────────────────────────────
//  AVANCE RECTO CON CORRECCION hacia objetivoDps (0 = recto)
// ────────────────────────────────────────────
void avanzarRecto(float vel, float objetivoDps) {
  if (vel != ordenIzq || vel != ordenDer) {
    tUltimoCambioMotores = millis();
    integralRecta = 0;
    dpsFiltrado = 0;
  }
  ordenIzq = vel;
  ordenDer = vel;
  mandandoRecto = true;

  float corr = 0;
  if (giroListo && signoGiroIzq != 0 && vel != 0) {
    float e = imuDps * signoGiroIzq - objetivoDps;   // > 0: derivando a la izquierda de lo pedido
    dpsFiltrado += FILTRO_DPS_RECTO * (e - dpsFiltrado);
    integralRecta = constrain(integralRecta + e * imuDt, -INTEGRAL_MAX_RECTO, INTEGRAL_MAX_RECTO);
    corr = constrain(KP_RECTO * dpsFiltrado + KI_RECTO * integralRecta, -CORRECCION_MAX_RECTO, CORRECCION_MAX_RECTO);
  }
  correccionRecta = corr;
  aplicarMotores(vel - corr, vel + corr);
}

// ────────────────────────────────────────────
//  GIRO POR ANGULO (+ = izquierda); opcional: desacelerar, vigilar sonar
// ────────────────────────────────────────────
void girarGradosGiro(float grados, float velocidad, bool desacelerar, bool vigilarSonar) {
  if (!giroListo) return;

  int sentido = (grados > 0) ? 1 : -1;
  float objetivo = fabs(grados);
  float acumulado = 0;
  float vel = velocidad;
  unsigned long tInicio = millis();
  unsigned long tInicioDeteccion = 0;
  escapeInterrumpidoPorSonar = false;

  leerIMU();  // fija la base de tiempo del giro

  // Vigila los IR: aborta si un sensor cruza a blanco.
  actualizarBorde();
  bool yaBlanco[4];
  for (int i = 0; i < 4; i++) yaBlanco[i] = bordeDet[i];
  bool bordeNuevo = false;
  unsigned long tVentana = tInicio;
  float acumuladoVentana = 0;

  while (acumulado < objetivo - MARGEN_ERROR_GRADOS && !bordeNuevo && !escapeInterrumpidoPorSonar) {
    if (millis() - tInicio > TIMEOUT_GIRO_MS) {
      evento("GIRO_TIMEOUT", String(acumulado, 1) + ";" + String(objetivo, 1));
      break;
    }
    if (desacelerar && (objetivo - acumulado) <= ZONA_DESACELERACION_GRADOS) vel = VEL_DESACELERACION;

    motores(vel * sentido, -vel * sentido);
    if (leerIMU()) acumulado += fabs(imuDps) * imuDt;

    if (vigilarSonar) {
      if (medirDistanciaCm() < DIST_ATAQUE && tUltimoEco >= tInicio) {
        if (tInicioDeteccion == 0) tInicioDeteccion = millis();
        if (millis() - tInicioDeteccion >= DURACION_DETECCION_GIRO_MS) escapeInterrumpidoPorSonar = true;
      } else {
        tInicioDeteccion = 0;
      }
    }

    // Trabado: no giro GIRO_MINIMO_VENTANA en la ventana; se corta.
    if (millis() - tVentana >= VENTANA_GIRO_TRABADO_MS) {
      if (acumulado - acumuladoVentana < GIRO_MINIMO_VENTANA) {
        evento("GIRO_TRABADO", String(acumulado, 1) + ";" + String(objetivo, 1) + ";" + String(millis() - tInicio));
        break;
      }
      tVentana = millis();
      acumuladoVentana = acumulado;
    }

    // actualizarBorde(), no leerBorde(): solo hacen falta los booleanos.
#if TELEMETRIA
    leerBorde();
#else
    actualizarBorde();
#endif
    for (int i = 0; i < 4; i++) {
      if (bordeDet[i] && !yaBlanco[i]) bordeNuevo = true;
    }
    telemetria();
  }

  detener();

  // objetivo;logrado;ms -> con esto se mide cuanto tarda un giro real.
  evento("GIRO", String(grados, 0) + ";" + String(acumulado, 1) + ";" + String(millis() - tInicio));
  // El loop() atiende borde o ataque en la vuelta siguiente.
  if (bordeNuevo) evento("GIRO_CORTADO", String(acumulado, 1) + ";" + String(objetivo, 1));
  if (escapeInterrumpidoPorSonar) evento("GIRO_INTERRUMPIDO_SONAR", String(acumulado, 1) + ";" + String(objetivo, 1));
}

// ────────────────────────────────────────────
//  MOVIMIENTO VIGILADO, CON SONAR: se corta si ve al rival
// ────────────────────────────────────────────
bool moverVigilandoSonar(float izq, float der, unsigned long ms, int vigilar) {
  escapeInterrumpidoPorSonar = false;
  unsigned long tInicioDeteccion = 0;
  actualizarBorde();
  bool yaBlanco[4];
  for (int i = 0; i < 4; i++) yaBlanco[i] = bordeDet[i];

  unsigned long t0 = millis();
  while (millis() - t0 < ms) {
    if (izq == der) avanzarRecto(izq, 0.0); else motores(izq, der);
    leerIMU();
#if TELEMETRIA
    leerBorde();
#else
    actualizarBorde();
#endif
    if (vigilar == VIGILAR_ADELANTE) {
      if ((bordeDet[0] && !yaBlanco[0]) || (bordeDet[1] && !yaBlanco[1])) return true;
    } else if (vigilar == VIGILAR_ATRAS) {
      if ((bordeDet[2] && !yaBlanco[2]) || (bordeDet[3] && !yaBlanco[3])) return true;
    } else if (vigilar == VIGILAR_CUALQUIERA) {
      for (int i = 0; i < 4; i++) if (bordeDet[i] && !yaBlanco[i]) return true;
    }
    if (medirDistanciaCm() < DIST_ATAQUE && tUltimoEco >= t0) {
      if (tInicioDeteccion == 0) tInicioDeteccion = millis();
      if (millis() - tInicioDeteccion >= DURACION_DETECCION_GIRO_MS) {
        evento("ESCAPE_INTERRUMPIDO_SONAR", String(millis() - t0) + ";" + String(ultimaDistValida, 1));
        escapeInterrumpidoPorSonar = true;
        return false;
      }
    } else {
      tInicioDeteccion = 0;
    }
    telemetria();
  }
  return false;
}

// ────────────────────────────────────────────
//  DETECCION DE LEVANTAMIENTO: inclinacion filtrada sostenida, sin girar fuerte
// ────────────────────────────────────────────
bool detectarLevantado() {
  if (MODO_SIMPLE || !giroListo) return false;
  unsigned long ahora = millis();
  // Sostenido = sin cortes; tras un hueco, la cuenta reinicia.
  if (ahora - tUltimaEvalLevante > HUECO_EVAL_LEVANTADO_MS) tInicioLevante = 0;
  if (fabs(imuDps) > UMBRAL_GIRO_ACTIVO) return levantado;  // girando fuerte: no evaluar este ciclo
  tUltimaEvalLevante = ahora;

  if (!levantado) {
    if (inclinacionFiltrada > INCLINACION_LEVANTADO_DEG) {
      if (tInicioLevante == 0) tInicioLevante = ahora;
      if (ahora - tInicioLevante >= DURACION_LEVANTADO_MS) {
        levantado = true;
        evento("LEVANTADO_DET", String(inclinacionFiltrada, 1) + ";" + String(dAxG, 2) + ";" + String(dAyG, 2));
      }
    } else {
      tInicioLevante = 0;
    }
  } else if (inclinacionFiltrada < INCLINACION_SALIDA_DEG) {
    levantado = false;
    tInicioLevante = 0;
  }

  if (levantado) setPixelColor(255, 0, 128);  // magenta
  return levantado;
}

// ────────────────────────────────────────────
//  ROTACION FORZADA: mandando recto, algo nos esta girando
// ────────────────────────────────────────────
bool rotacionForzada() {
  if (MODO_SIMPLE || !giroListo) return false;
  bool graciaMotores = (millis() - tUltimoCambioMotores) < GRACIA_TRAS_CAMBIO_MS;
  // Tambien cuenta el integral al tope si sigue rotando.
  bool rotando = fabs(imuDps) >= UMBRAL_ROTACION_FORZADA_DPS ||
                 (fabs(integralRecta) >= INTEGRAL_MAX_RECTO && fabs(imuDps) >= UMBRAL_ROTACION_FORZADA_DPS / 2.0);
  if (!mandandoRecto || graciaMotores || !rotando) {
    tInicioRotForzada = 0;
    return false;
  }
  if (tInicioRotForzada == 0) tInicioRotForzada = millis();
  return (millis() - tInicioRotForzada) >= DURACION_ROTACION_FORZADA_MS;
}

// Fuera de ataque: golpe o rotacion forzada = nos alcanzaron.
bool detectarEmpujeLateral() {
  if (MODO_SIMPLE || !giroListo) return false;
  if (estadoTel == "ATAQUE") return false;   // en ataque el contacto es esperado
  if (rotacionForzada()) return true;
  // Solo golpes recientes; con Z caida es levantamiento, no golpe.
  bool golpeReciente = golpePendiente && (millis() - tUltimoGolpe) < VIGENCIA_GOLPE_MS &&
                       golpeAz >= -Z_GOLPE_INCLINADO_G;
  golpePendiente = false;
  return golpeReciente;
}

// ────────────────────────────────────────────
//  MANIOBRA DE ESCAPE DEL BORDE (tramos vigilados, giros por angulo)
// ────────────────────────────────────────────
void maniobraEscapePreciso(String direccion) {
  registrarEscape();
  bool emergencia = enBucle();
  if (emergencia) {
    girarIzquierda = !girarIzquierda;
    limpiarEscapes();
  }
  float extra = emergencia ? EXTRA_GIRO_ANTIBUCLE : 0.0;

  evento("ESCAPE", direccion + (emergencia ? ";ANTIBUCLE" : ""));
  setPixelColor(255, 0, 255);
  estadoTel = "BORDE";

  // Frente y costado: el sonar corta el giro. Atras no.
  escapeInterrumpidoPorSonar = false;
  if (direccion == "FRENTE") {
    moverVigilando(1.0, 1.0, RETROCESO_ESCAPE_FRENTE_MS, VIGILAR_ATRAS);
    detener();
    bool izq = emergencia ? girarIzquierda : elegirSentidoGiro();
    girarConFallbackVigilando(izq ? (ANGULO_ESCAPE_FRENTE + extra) : -(ANGULO_ESCAPE_FRENTE + extra));
  }
  else if (direccion == "ATRAS") {
    // Acorralado de espaldas: pivotear 45 grados antes de avanzar.
    if (emergencia) girarConFallback(girarIzquierda ? 45.0 : -45.0);
    moverVigilando(-1.0, -1.0, 200, VIGILAR_ADELANTE);  // el dojo esta adelante; ya mira hacia adentro
  }
  else if (direccion == "EMPUJE_DERECHA" || direccion == "EMPUJE_IZQUIERDA") {
    // Paralelo al borde: curva y pivote hacia adentro.
    bool haciaIzq = (direccion == "EMPUJE_DERECHA");
    moverVigilando(haciaIzq ? -0.25 : -VEL_ATAQUE,
                   haciaIzq ? -VEL_ATAQUE : -0.25, 300, VIGILAR_ADELANTE);
    girarConFallbackVigilando(haciaIzq ? (68.0 + extra) : -(68.0 + extra));
    // Tras pivotear hay que trasladarse adentro, salvo corte por sonar.
    if (!escapeInterrumpidoPorSonar) moverVigilando(-VEL_ATAQUE, -VEL_ATAQUE, 150, VIGILAR_ADELANTE);
  }
  else if (direccion == "FRENTE_IZQ" || direccion == "FRENTE_DER") {
    // Un solo sensor frontal: retroceder y dar media vuelta.
    bool haciaDer = (direccion == "FRENTE_IZQ");
    moverVigilando(1.0, 1.0, RETROCESO_ESCAPE_LATERAL_MS, VIGILAR_ATRAS);
    detener();
    girarConFallbackVigilando(haciaDer ? -(ANGULO_ESCAPE_LATERAL + extra) : (ANGULO_ESCAPE_LATERAL + extra));
  }
  else if (direccion == "ATRAS_IZQ" || direccion == "ATRAS_DER") {
    bool haciaDer = (direccion == "ATRAS_IZQ");
    moverVigilando(-1.0, -1.0, 150, VIGILAR_ADELANTE);
    girarConFallback(haciaDer ? -(45.0 + extra) : (45.0 + extra));
  }

  detener();
  golpePendiente = false;  // el tiron del escape no es golpe del rival
}

// ────────────────────────────────────────────
//  REACCION AL LEVANTAMIENTO: retroceder y girar (sin corte por sonar)
// ────────────────────────────────────────────

// Retrocede hasta apoyar plano (min/max), vigilando el borde trasero.
void retrocederHastaApoyar() {
  actualizarBorde();
  bool yaBlanco[4];
  for (int i = 0; i < 4; i++) yaBlanco[i] = bordeDet[i];

  unsigned long t0 = millis();
  unsigned long tPlano = 0;
  while (millis() - t0 < RETROCESO_MAX_LEVANTADO_MS) {
    avanzarRecto(1.0, 0.0);
    leerIMU();
#if TELEMETRIA
    leerBorde();
#else
    actualizarBorde();
#endif
    if ((bordeDet[2] && !yaBlanco[2]) || (bordeDet[3] && !yaBlanco[3])) {
      evento("LEVANTADO_APOYO", String(millis() - t0) + ";borde;" + String(inclinacionFiltrada, 1));
      return;
    }
    if (inclinacionFiltrada < INCLINACION_SALIDA_DEG) {
      if (tPlano == 0) tPlano = millis();
    } else {
      tPlano = 0;
    }
    if (millis() - t0 >= RETROCESO_MIN_LEVANTADO_MS && tPlano != 0 && millis() - tPlano >= PLANO_SOSTENIDO_MS) {
      evento("LEVANTADO_APOYO", String(millis() - t0) + ";plano;" + String(inclinacionFiltrada, 1));
      return;
    }
    telemetria();
  }
  evento("LEVANTADO_APOYO", String(millis() - t0) + ";tope;" + String(inclinacionFiltrada, 1));
}

void reaccionLevantado() {
  bool izq = elegirSentidoGiro();
  evento("LEVANTADO_REACCION", izq ? "giro_izq" : "giro_der");
  setPixelColor(255, 0, 128);
  estadoTel = "LEVANTADO";

  retrocederHastaApoyar();
  detener();
  girarConFallback(izq ? GIRO_LEVANTADO_GRADOS : -GIRO_LEVANTADO_GRADOS);

  levantado = false;
  tInicioLevante = 0;
  golpePendiente = false;
}

// ────────────────────────────────────────────
//  EMPUJE FRONTAL PERDIDO (nos rotan): retroceder, girar, flanquear
// ────────────────────────────────────────────
void reaccionPerdiendoEmpuje() {
  float dpsAlDetectar = imuDps;
  evento("EMPUJE_PERDIDO", "rotado;" + String(dpsAlDetectar, 1));
  setPixelColor(255, 80, 0);
  estadoTel = "FLANQUEO";

  moverVigilando(1.0, 1.0, RETROCESO_FLANQUEO_MS, VIGILAR_ATRAS);
  detener();

  bool izq = (dpsAlDetectar * signoGiroIzq) < 0;   // nos rotaban a la derecha -> girar a la izquierda
  girarIzquierda = izq;
  girarConFallback(izq ? ANGULO_FLANQUEO : -ANGULO_FLANQUEO);
  moverVigilando(-VEL_ATAQUE, -VEL_ATAQUE, AVANCE_FLANQUEO_MS, VIGILAR_ADELANTE);

  tInicioRotForzada = 0;
}

// ────────────────────────────────────────────
//  EMPUJE LATERAL / GOLPE fuera de ataque: escapar hacia adelante
// ────────────────────────────────────────────
void reaccionEmpujeLateral() {
  evento("EMPUJE_LATERAL", String(imuDps, 1) + ";" + String(dAxG, 2) + ";" + String(dAyG, 2));
  setPixelColor(0, 255, 128);
  estadoTel = "EMPUJADO";

  // Si el rival aparece adelante, deja de escapar y ataca.
  moverVigilandoSonar(-VEL_ATAQUE, -VEL_ATAQUE, ESCAPE_ADELANTE_MS, VIGILAR_ADELANTE);

  tInicioRotForzada = 0;
  golpePendiente = false;
}
