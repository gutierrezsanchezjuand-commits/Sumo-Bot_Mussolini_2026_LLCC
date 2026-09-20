/*
  CONTROL POR GIROSCOPIO (LSM6DS3TRC) - modulo adicional para el Sumobot
  Escuela de Sistemas Inteligentes - Universidad Cenfotec

  SEGUNDA PESTAÑA del MISMO sketch: el IDE la compila junto con
  sumo_arduino.ino compartiendo funciones y variables globales. Las
  variables de estado del IMU (imuDps, rumboDeg, inclinacionDeg, ...)
  estan declaradas en sumo_arduino.ino porque esa pestaña se concatena
  primero.

  Logica de giro basada en el codigo base del repo oficial
  (codigos_de_ejemplo/Control_Movimientos.md + code_PDI.py): integra la
  velocidad angular del giroscopio para saber cuanto giro el robot, y
  desacelera cerca del objetivo para no pasarse.

  Este archivo aporta:
    - leerIMU(): UNA lectura validada por vuelta del loop. Todo lo demas
      (giro, levantamiento, golpe, rumbo) sale de esa lectura.
    - girarGradosGiro(): giro por angulo real.
    - detectarLevantado(): inclinacion 3D contra el vector de reposo.
    - rotacionForzada() / detectarEmpujeLateral(): nos estan moviendo
      sin que lo mandemos.
    - maniobraEscapePreciso(), reaccionLevantado(),
      reaccionPerdiendoEmpuje(), reaccionEmpujeLateral().

  EJE DE GIRO: confirmado con "giroscopio_diagnostico.ino" en el robot
  real -> es el eje Z (GYRO_EJE_GIRO = 2). El SIGNO (si girar a la
  izquierda da positivo o negativo) NO se asume: se aprende solo la
  primera vez que el robot pivotea (signoGiroIzq).

  Si iniciarGiroscopio() no encuentra el sensor, giroListo queda en
  false y todo cae al comportamiento por tiempo. El robot nunca se
  queda sin reaccion por falta de sensor.
*/

#include <Wire.h>
#include <Adafruit_LSM6DS3TRC.h>

#define GYRO_EJE_GIRO 2  // 0=X  1=Y  2=Z  -> confirmado con el diagnostico en el robot real

const uint32_t I2C_HZ = 400000;  // el LSM6DS3TR-C soporta 400 kHz; bajar a 100000 si suben los imuFallos

// ── Giro por angulo ──
const float MARGEN_ERROR_GRADOS = 4.0;              // tolerancia pedida: +/-4 grados
const unsigned long TIMEOUT_GIRO_MS = 3000;         // limite de seguridad (180 a fondo mide ~1450 ms en este kit)
// Medido 2026-09-20: a 0.45 el robot se quedo parado a 72 de 90 grados
// hasta el timeout. 0.75 es la velocidad de busqueda, que si pivotea.
// Sin desacelerar, un giro de 90 termina en 92-95 reales por inercia.
const float ZONA_DESACELERACION_GRADOS = 25.0;      // ultimos grados a velocidad reducida (solo con desacelerar=true)
const float VEL_DESACELERACION = 0.75;
const float FILTRO_DRIFT_RAD_S = 0.015;             // muestras mas rapidas que esto no entran al promedio del drift

// ── Levantamiento (inclinacion 3D) ──
// Una rampa que levanta el frente inclina el chasis unos 15-25 grados.
// Se mide el angulo entre el vector de aceleracion actual y el de
// reposo (calibrado al arrancar, asi no importa si el robot no esta
// nivelado ni como esta montado el IMU). Histeresis: entra por encima
// de INCLINACION_LEVANTADO_DEG y sale por debajo de INCLINACION_SALIDA_DEG.
// Medido 2026-09-20: levantamientos reales leen 22-27 grados; manejando
// normal hay picos momentaneos de 13-17 que los 150 ms sostenidos filtran.
const float INCLINACION_LEVANTADO_DEG = 15.0;
const float INCLINACION_SALIDA_DEG = 10.0;
// Medido 2026-09-20: los giros y golpes producen picos de 22-27 grados de
// un solo ciclo; 150 ms los filtraba por poco. Un levantamiento real dura
// segundos, asi que 250 ms discrimina sin retrasar demasiado la reaccion.
const unsigned long DURACION_LEVANTADO_MS = 250;
// Antes 30 grados/s, lo que apagaba la deteccion durante toda la
// busqueda (~90 grados/s). Ese valor respondia al metodo viejo (solo eje
// Z), donde la vibracion del giro parecia una caida de g. Con el angulo
// 3D sostenido 150 ms la vibracion no dispara; solo se apaga en giros
// realmente violentos. PRUEBA: buscar libremente 20 s sin LEVANTADO_DET.
const float UMBRAL_GIRO_ACTIVO = 120.0;
const float DPS_GIRO_EVIDENTE = 30.0;               // para aprender el signo del giro: pivote claramente en marcha

// ── Golpe y rotacion forzada ──
const float UMBRAL_GOLPE_G = 0.35;                  // aceleracion horizontal (respecto al reposo) que cuenta como golpe
const unsigned long COOLDOWN_GOLPE_MS = 300;
const unsigned long GRACIA_TRAS_CAMBIO_MS = 150;    // tras cambiar la orden de motores, nuestra propia aceleracion no es golpe
// Medido 2026-09-20: mandando recto a fondo el robot curva solo a 15-30
// grados/s (motores desparejos). Las rotaciones forzadas reales midieron
// 100+. 60 deja margen a ambos lados.
const float UMBRAL_ROTACION_FORZADA_DPS = 60.0;     // mandando recto y girando mas que esto: nos rotan
const unsigned long VIGENCIA_GOLPE_MS = 200;        // un golpe mas viejo que esto ya no justifica reaccionar
const unsigned long DURACION_ROTACION_FORZADA_MS = 100;

// ── Reaccion al levantamiento ──
const unsigned long RETROCESO_LEVANTADO_MS = 280;
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

const float RAD_A_GRADOS = 180.0 / PI;

// Devuelve el eje configurado (X/Y/Z) de una lectura de giroscopio.
// Recibe los 3 valores sueltos, no el sensors_event_t completo: el
// generador de prototipos del IDE inserta las declaraciones de funciones
// ANTES que el #include de esta pestaña, y como sensors_event_t se
// define recien en ese include, usarlo como parametro rompia la
// compilacion. Con float no hay ese problema.
float leerEjeGiro(float gx, float gy, float gz) {
  if (GYRO_EJE_GIRO == 0) return gx;
  if (GYRO_EJE_GIRO == 1) return gy;
  return gz;
}

// Si el ESP32 se reinicio a mitad de una transaccion I2C (reset por RTS,
// brownout, boton), el sensor puede quedar con SDA en bajo esperando
// clocks, y Wire.begin() no lo destraba. Nueve pulsos en SCL y un STOP
// lo sueltan. Visto el 2026-09-20: "No se encontro el LSM6DS3TRC" tras
// un reset en pleno combate.
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

  // 416 Hz: una muestra nueva cada ~2.4 ms, a la par del loop. Con el
  // default de 104 Hz se leia la misma muestra varias veces seguidas.
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
//  LECTURA UNICA DEL IMU POR VUELTA
//  Valida la lectura (I2C y magnitud plausible), actualiza velocidad
//  angular, rumbo integrado, inclinacion y deltas horizontales, y
//  aprende el signo del giro. Ante una lectura mala deja los valores
//  anteriores y suma un fallo. Devuelve true si hubo lectura valida.
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
  dAxG = axg - ax0;
  dAyG = ayg - ay0;

  // Signo del giro: cuando se manda un pivote puro y el giroscopio
  // responde, se anota si "izquierda" sale positivo o negativo.
  if (ultimaIzq != 0 && ultimaDer == -ultimaIzq && fabs(imuDps) > DPS_GIRO_EVIDENTE) {
    signoGiroIzq = (ultimaIzq > 0) ? (int)signo(imuDps) : -(int)signo(imuDps);
  }

  // Golpe: aceleracion horizontal brusca que no es nuestra (la orden
  // de motores no cambio hace poco) y no esta en cooldown.
  float horizontal = sqrt(dAxG * dAxG + dAyG * dAyG);
  unsigned long ms = millis();
  if (horizontal > UMBRAL_GOLPE_G &&
      ms - tUltimoCambioMotores > GRACIA_TRAS_CAMBIO_MS &&
      ms - tUltimoGolpe > COOLDOWN_GOLPE_MS) {
    tUltimoGolpe = ms;
    golpePendiente = true;
    evento("GOLPE", String(horizontal, 2) + ";" + String(dAxG, 2) + ";" + String(dAyG, 2) + ";" + estadoTel);
  }

  return true;
}

// ────────────────────────────────────────────
//  AVANCE RECTO CON CORRECCION
//  vel con la convencion de motores(): negativo = adelante. Rotar a la
//  izquierda (e > 0) se compensa acelerando la rueda izquierda y
//  frenando la derecha: izq = vel - corr, der = vel + corr. La misma
//  formula sirve marcha atras, porque siempre agrega una rotacion hacia
//  la derecha independiente de la velocidad base. Sin giroscopio o sin
//  el signo aprendido, corr = 0 y es motores(vel, vel).
// ────────────────────────────────────────────
void avanzarRecto(float vel) {
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
    float e = imuDps * signoGiroIzq;   // > 0: derivando a la izquierda
    dpsFiltrado += FILTRO_DPS_RECTO * (e - dpsFiltrado);
    integralRecta = constrain(integralRecta + e * imuDt, -INTEGRAL_MAX_RECTO, INTEGRAL_MAX_RECTO);
    corr = constrain(KP_RECTO * dpsFiltrado + KI_RECTO * integralRecta, -CORRECCION_MAX_RECTO, CORRECCION_MAX_RECTO);
  }
  correccionRecta = corr;
  aplicarMotores(vel - corr, vel + corr);
}

// ────────────────────────────────────────────
//  GIRO POR ANGULO
//  Gira 'grados' (positivo = izquierda, igual que motores(+V,-V)).
//  Se detiene dentro del margen de error en vez de exigir el grado
//  exacto (con un MEMS integrado, exigir el grado exacto solo produce
//  oscilacion). desacelerar=true baja la velocidad en los ultimos
//  ZONA_DESACELERACION_GRADOS para no pasarse (giro de ronda);
//  false mantiene la velocidad todo el giro (escapes).
// ────────────────────────────────────────────
void girarGradosGiro(float grados, float velocidad, bool desacelerar) {
  if (!giroListo) return;

  int sentido = (grados > 0) ? 1 : -1;
  float objetivo = fabs(grados);
  float acumulado = 0;
  float vel = velocidad;
  unsigned long tInicio = millis();

  leerIMU();  // fija la base de tiempo: lo que paso antes no cuenta

  while (acumulado < objetivo - MARGEN_ERROR_GRADOS) {
    if (millis() - tInicio > TIMEOUT_GIRO_MS) {
      evento("GIRO_TIMEOUT", String(acumulado, 1) + ";" + String(objetivo, 1));
      break;
    }
    if (desacelerar && (objetivo - acumulado) <= ZONA_DESACELERACION_GRADOS) vel = VEL_DESACELERACION;

    motores(vel * sentido, -vel * sentido);
    if (leerIMU()) acumulado += fabs(imuDps) * imuDt;
    telemetria();
  }

  detener();

  // objetivo;logrado;ms -> con esto se mide cuanto tarda un giro real.
  evento("GIRO", String(grados, 0) + ";" + String(acumulado, 1) + ";" + String(millis() - tInicio));
}

// ────────────────────────────────────────────
//  DETECCION DE LEVANTAMIENTO
//  Cuando el rival mete su rampa debajo del chasis, el frente sube y
//  el vector de gravedad que ve el acelerometro se inclina respecto al
//  de reposo. Se mide ese angulo directamente (usa X, Y y Z), asi que
//  no depende de que el robot este nivelado ni de como esta montado
//  el IMU. Se ignora mientras el robot gira rapido (la vibracion del
//  giro se confunde con inclinacion) y exige DURACION_LEVANTADO_MS
//  sostenidos para no disparar por una frenada o un golpe.
//  Solo detecta y avisa - la reaccion esta en reaccionLevantado().
// ────────────────────────────────────────────
bool detectarLevantado() {
  if (!giroListo) return false;
  if (fabs(imuDps) > UMBRAL_GIRO_ACTIVO) return levantado;  // girando fuerte: no evaluar este ciclo

  if (!levantado) {
    if (inclinacionDeg > INCLINACION_LEVANTADO_DEG) {
      if (tInicioLevante == 0) tInicioLevante = millis();
      if (millis() - tInicioLevante >= DURACION_LEVANTADO_MS) {
        levantado = true;
        evento("LEVANTADO_DET", String(inclinacionDeg, 1) + ";" + String(dAxG, 2) + ";" + String(dAyG, 2));
      }
    } else {
      tInicioLevante = 0;
    }
  } else if (inclinacionDeg < INCLINACION_SALIDA_DEG) {
    levantado = false;
    tInicioLevante = 0;
  }

  if (levantado) setPixelColor(255, 0, 128);  // magenta
  return levantado;
}

// ────────────────────────────────────────────
//  ROTACION FORZADA
//  Mandando recto (o parado) y el giroscopio dice que rotamos mas de
//  UMBRAL_ROTACION_FORZADA_DPS sostenidos: alguien nos esta girando.
//  En ataque significa que vamos perdiendo el empuje; fuera de ataque,
//  que nos empujan de costado.
// ────────────────────────────────────────────
bool rotacionForzada() {
  if (!giroListo) return false;
  bool graciaMotores = (millis() - tUltimoCambioMotores) < GRACIA_TRAS_CAMBIO_MS;
  // Con la correccion de rumbo activa, parte de la rotacion impuesta se
  // compensa y el giroscopio la ve menor. Por eso tambien cuenta que el
  // integral este al tope Y siga rotando: la correccion maxima no alcanza,
  // alguien nos esta girando. (La primera version miraba solo la
  // saturacion y disparaba con 7-25 grados/s de ruido.)
  bool rotando = fabs(imuDps) >= UMBRAL_ROTACION_FORZADA_DPS ||
                 (fabs(integralRecta) >= INTEGRAL_MAX_RECTO && fabs(imuDps) >= UMBRAL_ROTACION_FORZADA_DPS / 2.0);
  if (!mandandoRecto || graciaMotores || !rotando) {
    tInicioRotForzada = 0;
    return false;
  }
  if (tInicioRotForzada == 0) tInicioRotForzada = millis();
  return (millis() - tInicioRotForzada) >= DURACION_ROTACION_FORZADA_MS;
}

// Fuera de ataque, un golpe o una rotacion forzada significan que el
// rival nos alcanzo por donde no lo esperabamos.
bool detectarEmpujeLateral() {
  if (!giroListo) return false;
  if (estadoTel == "ATAQUE") return false;   // en ataque el contacto es esperado
  if (rotacionForzada()) return true;
  // Un golpe registrado durante una maniobra (flanqueo, escape) no debe
  // disparar al terminar la maniobra: solo cuenta si es reciente.
  bool golpeReciente = golpePendiente && (millis() - tUltimoGolpe) < VIGENCIA_GOLPE_MS;
  golpePendiente = false;
  return golpeReciente;
}

// ────────────────────────────────────────────
//  MANIOBRA DE ESCAPE DEL BORDE
//  Cada tramo recto va vigilando el lado hacia el que se mueve, y
//  los giros son por angulo real (o por tiempo si no hay sensor).
//  Los angulos vienen de los tiempos del codigo original
//  (400 ms = 90, 900 ms = 200) - no estan medidos en un escape real.
//  Si el anti-bucle detecta oscilacion, invierte el sentido y suma
//  EXTRA_GIRO_ANTIBUCLE grados.
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

  if (direccion == "FRENTE") {
    moverVigilando(1.0, 1.0, 180, VIGILAR_ATRAS);
    detener();
    bool izq = emergencia ? girarIzquierda : elegirSentidoGiro();
    girarConFallback(izq ? (200.0 + extra) : -(200.0 + extra));
  }
  else if (direccion == "ATRAS") {
    moverVigilando(-1.0, -1.0, 200, VIGILAR_ADELANTE);  // el dojo esta adelante; ya mira hacia adentro
  }
  else if (direccion == "EMPUJE_DERECHA" || direccion == "EMPUJE_IZQUIERDA") {
    // Los dos sensores de un lado en blanco: vamos paralelos al borde.
    // Curva hacia ADENTRO (la rueda de afuera mas rapida) y despues
    // pivote hacia adentro.
    bool haciaIzq = (direccion == "EMPUJE_DERECHA");
    moverVigilando(haciaIzq ? -0.25 : -VEL_ATAQUE,
                   haciaIzq ? -VEL_ATAQUE : -0.25, 300, VIGILAR_ADELANTE);
    girarConFallback(haciaIzq ? (68.0 + extra) : -(68.0 + extra));
    // Pivotear en el lugar no saca los sensores de la linea: despues del
    // giro hay que trasladarse hacia adentro (visto el 2026-09-20).
    moverVigilando(-VEL_ATAQUE, -VEL_ATAQUE, 150, VIGILAR_ADELANTE);
  }
  else if (direccion == "FRENTE_IZQ" || direccion == "FRENTE_DER") {
    bool haciaDer = (direccion == "FRENTE_IZQ");
    moverVigilando(1.0, 1.0, 120, VIGILAR_ATRAS);
    girarConFallback(haciaDer ? -(90.0 + extra) : (90.0 + extra));
  }
  else if (direccion == "ATRAS_IZQ" || direccion == "ATRAS_DER") {
    bool haciaDer = (direccion == "ATRAS_IZQ");
    moverVigilando(-1.0, -1.0, 150, VIGILAR_ADELANTE);
    girarConFallback(haciaDer ? -(45.0 + extra) : (45.0 + extra));
  }

  detener();
  golpePendiente = false;  // el tiron del propio escape no es un golpe del rival
}

// ────────────────────────────────────────────
//  REACCION AL LEVANTAMIENTO: retroceder y reposicionar
//  Retrocede (vigilando el borde trasero) para salir de la rampa,
//  despues gira hacia donde estaba el rival para no volver a encarar
//  el mismo angulo a ciegas.
// ────────────────────────────────────────────
void reaccionLevantado() {
  bool izq = elegirSentidoGiro();
  evento("LEVANTADO_REACCION", izq ? "giro_izq" : "giro_der");
  setPixelColor(255, 0, 128);
  estadoTel = "LEVANTADO";

  moverVigilando(1.0, 1.0, RETROCESO_LEVANTADO_MS, VIGILAR_ATRAS);
  detener();
  girarConFallback(izq ? GIRO_LEVANTADO_GRADOS : -GIRO_LEVANTADO_GRADOS);

  levantado = false;
  tInicioLevante = 0;
  golpePendiente = false;
}

// ────────────────────────────────────────────
//  EMPUJE FRONTAL PERDIDO: soltar y flanquear
//  Retrocede corto, gira ANGULO_FLANQUEO (contra la rotacion que nos
//  imponian, si la hubo, para re-centrar sobre el rival; si fue por
//  tiempo, alterna), avanza un tramo en diagonal y deja que el loop
//  lo vuelva a encontrar - ahora de costado.
// ────────────────────────────────────────────
void reaccionPerdiendoEmpuje(String motivo) {
  float dpsAlDetectar = imuDps;
  evento("EMPUJE_PERDIDO", motivo + ";" + String(dpsAlDetectar, 1));
  setPixelColor(255, 80, 0);
  estadoTel = "FLANQUEO";

  moverVigilando(1.0, 1.0, RETROCESO_FLANQUEO_MS, VIGILAR_ATRAS);
  detener();

  bool izq;
  if (motivo == "rotado" && signoGiroIzq != 0) {
    izq = (dpsAlDetectar * signoGiroIzq) < 0;   // nos rotaban a la derecha -> girar a la izquierda
    girarIzquierda = izq;
  } else {
    girarIzquierda = !girarIzquierda;
    izq = girarIzquierda;
  }
  girarConFallback(izq ? ANGULO_FLANQUEO : -ANGULO_FLANQUEO);
  moverVigilando(-VEL_ATAQUE, -VEL_ATAQUE, AVANCE_FLANQUEO_MS, VIGILAR_ADELANTE);

  tInicioEmpuje = 0;
  tInicioRotForzada = 0;
}

// ────────────────────────────────────────────
//  EMPUJE LATERAL / GOLPE fuera de ataque: escapar hacia adelante
//  Sale de la linea de empuje a fondo (vigilando el borde frontal).
//  Despues el loop busca al rival hacia donde se lo vio por ultima vez.
// ────────────────────────────────────────────
void reaccionEmpujeLateral() {
  evento("EMPUJE_LATERAL", String(imuDps, 1) + ";" + String(dAxG, 2) + ";" + String(dAyG, 2));
  setPixelColor(0, 255, 128);
  estadoTel = "EMPUJADO";

  moverVigilando(-VEL_ATAQUE, -VEL_ATAQUE, ESCAPE_ADELANTE_MS, VIGILAR_ADELANTE);

  tInicioRotForzada = 0;
  golpePendiente = false;
}
