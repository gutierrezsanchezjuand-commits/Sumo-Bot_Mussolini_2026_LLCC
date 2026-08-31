/*
  CONTROL POR GIROSCOPIO (LSM6DS3TRC) - modulo adicional para el Sumobot
  Escuela de Sistemas Inteligentes - Universidad Cenfotec

  ESTE ARCHIVO NO MODIFICA sumo_arduino.ino.
  Es una SEGUNDA PESTAÑA del MISMO sketch: coloca este .ino en la misma
  carpeta que sumo_arduino.ino y el IDE de Arduino los compila juntos,
  compartiendo funciones y variables globales. Por eso puede llamar a
  motores() y detener() (definidas alla) sin repetirlas ni tocarlas.

  Logica basada en el codigo base del repo
  (codigos_de_ejemplo/Control_Movimientos.md + code_PDI.py): integra la
  velocidad angular del giroscopio para saber cuanto giro el robot, y
  desacelera cerca del objetivo para no pasarse.

  ADEMAS del giro de ronda, este archivo agrega:
    - maniobraEscapePreciso(): copia de maniobraEscape() con los giros
      por angulo real en vez de por tiempo.
    - detectarLevantado(): usa el acelerometro para avisar cuando el
      chasis se inclina como si el rival lo estuviera levantando con
      su rampa.

  EJE DE GIRO: confirmado con "giroscopio_diagnostico.ino" en el robot
  real -> es el eje Z (GYRO_EJE_GIRO = 2, mas abajo). Si en algun momento
  cambias de sensor o de montaje fisico, repetir esa prueba antes de
  confiar en este archivo de nuevo.

  Mientras nadie llame a iniciarGiroscopio()/girarGradosGiro() desde
  sumo_arduino.ino, este archivo se compila pero no cambia nada del
  comportamiento actual del robot. Y si iniciarGiroscopio() no encuentra
  el sensor, girarGradosGiro() tampoco hace nada: el robot sigue
  funcionando con el giro por tiempo que ya tenias.
*/

#include <Wire.h>
#include <Adafruit_LSM6DS3TRC.h>

#define GYRO_EJE_GIRO 2  // 0=X  1=Y  2=Z  -> confirmado con el diagnostico en el robot real
const float MARGEN_ERROR_GRADOS = 4.0;  // tolerancia pedida: +/-4 grados
const unsigned long TIMEOUT_GIRO_MS = 2000;  // limite de seguridad: nunca girar mas de esto aunque el sensor falle o el drift este mal calibrado

Adafruit_LSM6DS3TRC lsmGiro;
bool  giroListo = false;
float driftGiro = 0;

// Deteccion de levantamiento (acelerometro) - ver detectarLevantado() mas abajo
const float UMBRAL_LEVANTADO = 0.12;              // caida de "g" para disparar (estimado, ajustar)
const unsigned long DURACION_LEVANTADO_MS = 150;  // sostenido, no un salto de ruido
const float UMBRAL_GIRO_ACTIVO = 30.0;            // grados/s - girando mas rapido que esto, no confiar en el acelerometro
float accelZReposo = 1.0;
bool  levantado = false;
unsigned long tInicioLevante = 0;

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

// Llamar UNA vez desde setup(), con el robot quieto (por ejemplo, justo
// antes de calibracionPorPasos()).
bool iniciarGiroscopio() {
  Wire.begin();

  if (!lsmGiro.begin_I2C(0x6B)) {
    Serial.println("[Giro] No se encontro el LSM6DS3TRC. Sigo sin giroscopio.");
    giroListo = false;
    return false;
  }

  Serial.println("[Giro] Calibrando drift y nivel (dejar quieto)...");
  float suma = 0;
  float sumaAccelZ = 0;
  int muestras = 0;
  int totalMuestras = 0;
  unsigned long t0 = millis();
  while (millis() - t0 < 2000) {
    sensors_event_t accel, gyro, temp;
    lsmGiro.getEvent(&accel, &gyro, &temp);
    float v = leerEjeGiro(gyro.gyro.x, gyro.gyro.y, gyro.gyro.z);
    if (fabs(v) < 0.05) {  // descarta saltos raros, igual que code_PDI.py
      suma += v;
      muestras++;
    }
    sumaAccelZ += accel.acceleration.z / 9.81;  // m/s^2 -> g
    totalMuestras++;
    delay(5);
  }
  driftGiro = (muestras > 0) ? (suma / muestras) : 0;
  accelZReposo = (totalMuestras > 0) ? (sumaAccelZ / totalMuestras) : 1.0;
  Serial.print("[Giro] Drift: "); Serial.println(driftGiro, 5);
  Serial.print("[Giro] Nivel (accel Z en reposo): "); Serial.println(accelZReposo, 3);

  giroListo = true;
  return true;
}

// Gira 'grados' (signo = sentido; misma convencion que motores(izq,der)).
// Se detiene sola dentro del margen de error de arriba en vez de exigir
// el grado exacto (con un MEMS integrado en el tiempo, exigir el grado
// exacto solo produce oscilacion). Reutiliza motores()/detener() de
// sumo_arduino.ino: no las modifica, solo las llama.
// desacelerar=true: baja la velocidad en el ultimo tramo para no
//   pasarse (bueno para el giro de ronda, no es critico en tiempo).
// desacelerar=false: mantiene 'velocidad' todo el giro (bueno para
//   escapes, donde llegar rapido importa mas que no pasarse un poco).
void girarGradosGiro(float grados, float velocidad, bool desacelerar) {
  if (!giroListo) return;  // sin sensor: no hace nada

  int sentido = (grados > 0) ? 1 : -1;
  float objetivo = fabs(grados);
  float acumulado = 0;
  unsigned long tAnterior = micros();
  unsigned long tInicio = millis();

  motores(velocidad * sentido, -velocidad * sentido);

  while (acumulado < objetivo - MARGEN_ERROR_GRADOS) {
    if (millis() - tInicio > TIMEOUT_GIRO_MS) {
      Serial.println("[Giro] Timeout en girarGradosGiro: salgo por seguridad.");
      break;
    }

    unsigned long tActual = micros();
    float dt = (tActual - tAnterior) / 1000000.0;
    tAnterior = tActual;

    sensors_event_t accel, gyro, temp;
    lsmGiro.getEvent(&accel, &gyro, &temp);
    float velAngular = leerEjeGiro(gyro.gyro.x, gyro.gyro.y, gyro.gyro.z) - driftGiro;
    acumulado += fabs(velAngular) * dt * RAD_A_GRADOS;

    if (desacelerar && objetivo - acumulado <= objetivo / 2.0) {  // ultimo tramo
      motores(0.18 * sentido, -0.18 * sentido);
    }
  }

  detener();
}

// ────────────────────────────────────────────
//  DETECCION DE LEVANTAMIENTO (acelerometro)
//  Cuando el rival mete su rampa debajo del chasis, el chasis se
//  inclina aunque las ruedas sigan tocando el dojo - y eso lo capta
//  el acelerometro: el eje que en reposo marca ~1g de gravedad cae
//  por debajo de su valor normal. Se confirmo con datos reales del
//  diagnostico: en reposo el eje Z midio ~1.04g, y en los tramos
//  donde se inclino el robot a mano bajo hasta ~0.93-0.95g.
//
//  Mientras el robot gira rapido (busqueda, giro de ronda), la
//  vibracion normal tambien mueve el acelerometro y se puede confundir
//  con un levantamiento - por eso esta funcion ignora el acelerometro
//  cuando el giroscopio marca que se esta girando fuerte
//  (UMBRAL_GIRO_ACTIVO), y solo confia en el cuando el robot va
//  derecho o esta quieto - que ademas es el momento real donde importa
//  detectar la rampa del rival.
//
//  UMBRAL_LEVANTADO, DURACION_LEVANTADO_MS y UMBRAL_GIRO_ACTIVO son un
//  punto de partida: probar dejando que el robot busque/gire libremente
//  (no deberia disparar) y despues, con el robot quieto, levantando el
//  frente del chasis a mano (si deberia disparar), mirando el Serial.
//
//  Llamar en cada vuelta del loop() para que corra siempre. Sin
//  sensor, no hace nada. Solo detecta y avisa (Serial + LED) - no
//  ejecuta ninguna maniobra por su cuenta.
// ────────────────────────────────────────────
bool detectarLevantado() {
  if (!giroListo) return false;

  sensors_event_t accel, gyro, temp;
  lsmGiro.getEvent(&accel, &gyro, &temp);
  float az = accel.acceleration.z / 9.81;
  float velZ = fabs((leerEjeGiro(gyro.gyro.x, gyro.gyro.y, gyro.gyro.z) - driftGiro) * RAD_A_GRADOS);

  if (velZ <= UMBRAL_GIRO_ACTIVO) {  // solo confiar en el acelerometro si no esta girando fuerte
    if (accelZReposo - az > UMBRAL_LEVANTADO) {
      if (tInicioLevante == 0) tInicioLevante = millis();
      if (!levantado && millis() - tInicioLevante > DURACION_LEVANTADO_MS) {
        levantado = true;
        Serial.println("[Giro] LEVANTADO detectado.");
      }
    } else {
      tInicioLevante = 0;
      levantado = false;
    }
  }
  // si esta girando fuerte, no se evalua nada este ciclo: se deja el
  // estado como estaba hasta el proximo ciclo sin giro fuerte.

  if (levantado) {
    setPixelColor(255, 0, 128);  // magenta - distinto a los colores que ya usa el combate
  }

  return levantado;
}

// ────────────────────────────────────────────
//  MANIOBRA DE ESCAPE CON GIRO PRECISO
//  Copia de maniobraEscape() de sumo_arduino.ino, con los tramos de
//  giro (motores+delay) reemplazados por girarGradosGiro(). Los
//  angulos son estimados por proporcion con los tiempos ya usados en
//  el codigo original (400ms=90, 800ms=180) - no estan medidos en un
//  escape real, probar y ajustar.
//
//  Si el giroscopio no esta listo, usa el mismo delay() del original:
//  nunca deja al robot sin reaccion de escape por falta de sensor.
//
//  Al ser una copia y no un llamado a maniobraEscape(), si mas
//  adelante cambias algo del original (velocidades, logica), hay que
//  replicarlo aca a mano - no se actualiza solo.
// ────────────────────────────────────────────
void maniobraEscapePreciso(String direccion) {
  setPixelColor(255, 0, 255);

  if (direccion == "EMPUJE_DERECHA" || direccion == "EMPUJE_IZQUIERDA") {
    bool haciaIzq = (direccion == "EMPUJE_DERECHA");
    unsigned long t0 = millis();
    while (millis() - t0 < 300) {
      motores(haciaIzq ? -VEL_ATAQUE : -0.25,
              haciaIzq ? -0.25 : -VEL_ATAQUE);
      if (leerBorde() == "FRENTE") break;
    }
    if (giroListo) {
      girarGradosGiro(haciaIzq ? -68 : 68, VEL_ATAQUE, false);  // ~300ms del original
    } else {
      motores(haciaIzq ? -VEL_ATAQUE : VEL_ATAQUE,
              haciaIzq ? VEL_ATAQUE : -VEL_ATAQUE);
      delay(300);
    }
  }
  else if (direccion == "FRENTE") {
    motores(1.0, 1.0);
    delay(180);
    detener();
    if (giroListo) {
      girarGradosGiro(girarIzquierda ? 200 : -200, VEL_ATAQUE, false);  // ~900ms del original
    } else {
      motores(girarIzquierda ? VEL_ATAQUE : -VEL_ATAQUE,
              girarIzquierda ? -VEL_ATAQUE : VEL_ATAQUE);
      delay(900);
    }
    girarIzquierda = !girarIzquierda;
  }
  else if (direccion == "IZQUIERDA" || direccion == "DERECHA") {
    bool haciaDer = (direccion == "IZQUIERDA");
    motores(1.0, 1.0);
    delay(120);
    if (giroListo) {
      girarGradosGiro(haciaDer ? -90 : 90, VEL_ATAQUE, false);  // 400ms del original
    } else {
      motores(haciaDer ? -VEL_ATAQUE : VEL_ATAQUE,
              haciaDer ? VEL_ATAQUE : -VEL_ATAQUE);
      delay(400);
    }
  }

  detener();
}

// ────────────────────────────────────────────
//  REACCION AL LEVANTAMIENTO: retroceder y reposicionar
//  Se ejecuta una sola vez por evento (ver loop(): se llama cuando
//  detectarLevantado() da true). Primero retrocede para intentar
//  salir de la rampa del rival, despues gira 90 grados para no volver
//  a encarar exactamente el mismo angulo. Reutiliza girarIzquierda
//  (la misma bandera que ya alterna sentido en busqueda y escape) asi
//  el proximo giro no siempre cae para el mismo lado.
//
//  Duracion del retroceso (280ms) y angulo del giro (90) son
//  estimados, no medidos en un levantamiento real - probar y ajustar.
// ────────────────────────────────────────────
void reaccionLevantado() {
  setPixelColor(255, 0, 128);

  motores(1.0, 1.0);  // retroceder (misma convencion que maniobraEscape)
  delay(280);
  detener();

  if (giroListo) {
    girarGradosGiro(girarIzquierda ? 90 : -90, VEL_ATAQUE, true);
  } else {
    motores(girarIzquierda ? VEL_ATAQUE : -VEL_ATAQUE,
            girarIzquierda ? -VEL_ATAQUE : VEL_ATAQUE);
    delay(TIEMPO_GIRO_90_MS);
    detener();
  }
  girarIzquierda = !girarIzquierda;

  // Se considera resuelto este evento: reinicia el estado de deteccion
  // para que el proximo levantamiento necesite sus propios 150ms
  // sostenidos antes de disparar de nuevo.
  levantado = false;
  tInicioLevante = 0;
}
