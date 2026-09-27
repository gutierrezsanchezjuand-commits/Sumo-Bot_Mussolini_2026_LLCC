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

  ANTES DE USAR ESTO EN COMBATE:
  Sube primero, aparte, "giroscopio_diagnostico.ino" y confirma con el
  robot real que el eje Z es el que se mueve al girar sobre la mesa.
  Si en tu sensor es otro eje, cambia GYRO_EJE_GIRO abajo (0=X 1=Y 2=Z).

  Mientras nadie llame a iniciarGiroscopio()/girarGradosGiro() desde
  sumo_arduino.ino, este archivo se compila pero no cambia nada del
  comportamiento actual del robot. Y si iniciarGiroscopio() no encuentra
  el sensor, girarGradosGiro() tampoco hace nada: el robot sigue
  funcionando con el giro por tiempo que ya tenias.
*/

#include <Wire.h>
#include <Adafruit_LSM6DS3TRC.h>

#define GYRO_EJE_GIRO 2  // 0=X  1=Y  2=Z  -> confirmar con el diagnostico
const float MARGEN_ERROR_GRADOS = 4.0;  // tolerancia pedida: +/-4 grados

Adafruit_LSM6DS3TRC lsmGiro;
bool  giroListo = false;
float driftGiro = 0;

const float RAD_A_GRADOS = 180.0 / PI;

// Devuelve el eje configurado (X/Y/Z) de una lectura de giroscopio.
float leerEjeGiro(sensors_event_t &gyro) {
  if (GYRO_EJE_GIRO == 0) return gyro.gyro.x;
  if (GYRO_EJE_GIRO == 1) return gyro.gyro.y;
  return gyro.gyro.z;
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

  Serial.println("[Giro] Calibrando drift (dejar quieto)...");
  float suma = 0;
  int muestras = 0;
  unsigned long t0 = millis();
  while (millis() - t0 < 2000) {
    sensors_event_t accel, gyro, temp;
    lsmGiro.getEvent(&accel, &gyro, &temp);
    float v = leerEjeGiro(gyro);
    if (fabs(v) < 0.05) {  // descarta saltos raros, igual que code_PDI.py
      suma += v;
      muestras++;
    }
    delay(5);
  }
  driftGiro = (muestras > 0) ? (suma / muestras) : 0;
  Serial.print("[Giro] Drift: "); Serial.println(driftGiro, 5);

  giroListo = true;
  return true;
}

// Gira 'grados' (signo = sentido; misma convencion que motores(izq,der)).
// Se detiene sola dentro del margen de error de arriba en vez de exigir
// el grado exacto (con un MEMS integrado en el tiempo, exigir el grado
// exacto solo produce oscilacion). Reutiliza motores()/detener() de
// sumo_arduino.ino: no las modifica, solo las llama.
void girarGradosGiro(float grados, float velocidad) {
  if (!giroListo) return;  // sin sensor: no hace nada

  int sentido = (grados > 0) ? 1 : -1;
  float objetivo = fabs(grados);
  float acumulado = 0;
  unsigned long tAnterior = micros();

  motores(velocidad * sentido, -velocidad * sentido);

  while (acumulado < objetivo - MARGEN_ERROR_GRADOS) {
    unsigned long tActual = micros();
    float dt = (tActual - tAnterior) / 1000000.0;
    tAnterior = tActual;

    sensors_event_t accel, gyro, temp;
    lsmGiro.getEvent(&accel, &gyro, &temp);
    float velAngular = leerEjeGiro(gyro) - driftGiro;
    acumulado += fabs(velAngular) * dt * RAD_A_GRADOS;

    if (objetivo - acumulado <= objetivo / 2.0) {  // ultimo tramo: desacelera
      motores(0.18 * sentido, -0.18 * sentido);
    }
  }

  detener();
}
