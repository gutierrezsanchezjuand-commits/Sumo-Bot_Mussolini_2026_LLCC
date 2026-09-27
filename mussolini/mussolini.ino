// Base: Tomas de Camino Beck (Cenfotec). Historia: HISTORIAL_DEL_CODIGO.md

#include <Adafruit_NeoPixel.h>  // requiere core ESP32 3.x (con 2.x no compila)

// ────────────────────────────────────────────
//  AJUSTE RAPIDO: si avanza al reves, cambiar 0/1
// ────────────────────────────────────────────
#define INVERTIR_MOTORES 1

// ────────────────────────────────────────────
//  PINES (verificados contra el repo oficial)
// ────────────────────────────────────────────
#define PIN_TRIG 25
#define PIN_ECHO 26

#define PIN_SEN1 36  // Frontal Izquierdo
#define PIN_SEN2 39  // Frontal Derecho
#define PIN_SEN3 34  // Trasero Izquierdo
#define PIN_SEN4 35  // Trasero Derecho

#define PIN_BOOT 0   // Boton BOOT (activo en LOW)

// ⚠ MOTOR1 = rueda izquierda. Si pivotea al reves, intercambiar MOTOR1/MOTOR2.
#define MOTOR1_IN1 12
#define MOTOR1_IN2 14
#define MOTOR2_IN1 13
#define MOTOR2_IN2 15

#define PIN_NEOPIXEL 2

const int pinesIr[4] = {PIN_SEN1, PIN_SEN2, PIN_SEN3, PIN_SEN4};
int  umbrales[4] = {0, 0, 0, 0};
bool blancoEsMenor[4] = {true, true, true, true};  // se recalcula en la calibracion
bool bordeDet[4] = {false, false, false, false};   // ultima deteccion confirmada por sensor

Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);

// ────────────────────────────────────────────
//  PWM (LEDC) - 20kHz para que no chille el motor
// ────────────────────────────────────────────
const int PWM_FREQ = 20000;  // 20kHz, fuera del oido humano
const int PWM_RES  = 8;      // 0-255

// ────────────────────────────────────────────
//  TELEMETRIA: lineas CSV "T" (estado) y "E" (eventos)
// ────────────────────────────────────────────
#ifndef TELEMETRIA
#define TELEMETRIA 0   // 1 para probar en banco; 0 para competir
#endif
const unsigned long INTERVALO_TELEMETRIA_MS = 100;  // 0 = una linea por vuelta (~2 ms), para diagnosticar IR

// ────────────────────────────────────────────
//  FIRMA: la pone FLASHEAR.bat; se imprime al arrancar
// ────────────────────────────────────────────
#ifndef FIRMA_ID
#define FIRMA_ID sin_firma_IDE
#endif
#define TEXTO_(x) #x
#define TEXTO(x) TEXTO_(x)

// ────────────────────────────────────────────
//  MODO SIMPLE (seguro de torneo): 1 = sin reacciones del IMU
// ────────────────────────────────────────────
#ifndef MODO_SIMPLE
#define MODO_SIMPLE 0
#endif

unsigned long ultimaTelemetria = 0;
int    irCrudo[4]  = {0, 0, 0, 0};
float  distanciaTel = 0;
String bordeTel  = "";
String estadoTel = "INIT";

// ────────────────────────────────────────────
//  ESTADO DEL IMU: aca porque esta pestaña va primero
// ────────────────────────────────────────────
bool  giroListo = false;
float imuDps = 0;            // velocidad angular en Z, grados/s, ya sin drift
float imuDt = 0;             // segundos entre las dos ultimas lecturas validas
float rumboDeg = 0;          // integral de imuDps desde el arranque (dead reckoning)
float inclinacionDeg = 0;    // angulo entre la aceleracion actual y la de reposo
float dAxG = 0, dAyG = 0;    // deltas horizontales respecto al reposo, en g
unsigned long imuFallos = 0; // lecturas descartadas por I2C o por magnitud absurda
// +1 si izquierda da imuDps positivo; se re-aprende al pivotear.
int   signoGiroIzq = 1;
bool  golpePendiente = false;

// ────────────────────────────────────────────
//  CONSTANTES DE COMPORTAMIENTO
// ────────────────────────────────────────────
const float DIST_MAX_SONAR = 100.0;  // Ignora objetos mas alla de 100cm
const float DIST_ATAQUE    = 40.0;   // Carga a fondo

// Sin eco: retiene la ultima distancia; tras PERDIDO_TRAS_MS, rival perdido.
const unsigned long RETENCION_DIST_MS = 80;
const unsigned long PERDIDO_TRAS_MS   = 150;
// Pegado al rival el sonar pierde ecos: esperar mas.
const float DIST_CONTACTO = 12.0;
const unsigned long PERDIDO_CONTACTO_MS = 500;

// Throttle del sonar: persiguiendo, el loop corre ~3x mas rapido.
const unsigned long INTERVALO_SONAR_MS = 20;

const float VEL_ATAQUE   = 1.0;   // Maxima potencia en contacto
const float VEL_TRACKING = 0.80;  // Avance directo hacia el rival (40-100cm)
const float VEL_BUSQUEDA = 0.75;  // Giro de busqueda

// Impulso a fondo al arrancar: vence la friccion estatica.
const float VEL_IMPULSO = 1.0;
const unsigned long TIEMPO_IMPULSO_MS = 70;

// ────────────────────────────────────────────
//  CALIBRACION IR: factor 0.10 filtra destellos del negro brillante
// ────────────────────────────────────────────
const int   MUESTRAS_CALIBRACION = 12;
const float FACTOR_UMBRAL[4] = {0.10, 0.10, 0.10, 0.10};  // [FrontIzq, FrontDer, TrasIzq, TrasDer]
const int   SEPARACION_MINIMA_IR = 150;
// Sensor degradado: blanco por encima del 25% del negro.
const float BLANCO_MAX_FRACCION = 0.25;

// ────────────────────────────────────────────
//  GIRO INICIAL: respaldo por tiempo si no hay giroscopio
// ────────────────────────────────────────────
const unsigned long TIEMPO_GIRO_90_MS  = 500;
const unsigned long TIEMPO_GIRO_180_MS = 1000;
int ronda = 1;

// ────────────────────────────────────────────
//  ANTI-BUCLE: muchos escapes seguidos invierten y agrandan el giro
// ────────────────────────────────────────────
const unsigned long VENTANA_ANTIBUCLE_MS = 3000;
const int ESCAPES_ANTIBUCLE = 3;
const float EXTRA_GIRO_ANTIBUCLE = 45.0;
unsigned long tiemposEscape[ESCAPES_ANTIBUCLE] = {0, 0, 0};
int idxEscape = 0;

// ────────────────────────────────────────────
//  EMPUJE FRONTAL PERDIDO (nos rotan): soltar y flanquear
// ────────────────────────────────────────────
const float ANGULO_FLANQUEO = 60.0;
const unsigned long RETROCESO_FLANQUEO_MS = 200;
const unsigned long AVANCE_FLANQUEO_MS = 250;

// ────────────────────────────────────────────
//  GOLPE / EMPUJE LATERAL fuera de ataque: escapar adelante
// ────────────────────────────────────────────
const unsigned long ESCAPE_ADELANTE_MS = 350;

// ────────────────────────────────────────────
//  TANTEO EN TRACK: avanza barriendo +-3 grados sobre el rival
// ────────────────────────────────────────────
const float TANTEO_DPS = 20.0;                  // velocidad de giro pedida durante el barrido
const unsigned long TANTEO_SEMIPERIODO_MS = 300;
int sentidoTanteo = 1;                          // +1 izquierda, -1 derecha
unsigned long tCambioTanteo = 0;                // inicio del barrido actual; 0 = sin tanteo en curso
bool tanteoInvertidoAlPerder = false;           // ya se invirtio por esta perdida

// ────────────────────────────────────────────
//  ESTADO DE COMBATE
// ────────────────────────────────────────────
bool girarIzquierda = false;  // ultimo sentido de giro elegido (busqueda / escapes)
bool buscando = false;
unsigned long tUltimaDeteccion = 0;

float rumboRival = 0;              // rumbo (grados, marco del giroscopio) donde se vio al rival
bool  rumboRivalValido = false;
unsigned long tRumboRival = 0;
const unsigned long RUMBO_RIVAL_VIGENCIA_MS = 3000;

// ────────────────────────────────────────────
//  ESTADO DE MOTORES: ultima* = aplicado; orden* = pedido
// ────────────────────────────────────────────
float ultimaIzq = 0;
float ultimaDer = 0;
float ordenIzq = 0;
float ordenDer = 0;
unsigned long impulsoIzqHasta = 0;
unsigned long impulsoDerHasta = 0;
unsigned long tUltimoCambioMotores = 0;  // para no confundir nuestra propia aceleracion con un golpe
bool  mandandoRecto = true;              // la orden vigente es recta (o parada)

// ────────────────────────────────────────────
//  AVANCE RECTO: P+I con giroscopio corrige la curva natural
// ────────────────────────────────────────────
const float KP_RECTO = 0.004;             // correccion por cada grado/s (filtrado)
const float KI_RECTO = 0.030;             // correccion por cada grado acumulado
const float INTEGRAL_MAX_RECTO = 10.0;    // grados acumulados, tope anti-windup (0.30 de correccion)
const float CORRECCION_MAX_RECTO = 0.30;  // en unidades de velocidad (0-1)
const float FILTRO_DPS_RECTO = 0.10;      // paso bajo del P: 0.1 por vuelta ~ 30 ms
float correccionRecta = 0;
float integralRecta = 0;
float dpsFiltrado = 0;

// Sonar
float ultimaDistValida = DIST_MAX_SONAR + 1;
unsigned long tUltimoEco = 0;
unsigned long tUltimoIntentoSonar = 0;  // throttle: ver INTERVALO_SONAR_MS

// Que mirar durante un movimiento vigilado (ver moverVigilando)
const int VIGILAR_NADA       = 0;
const int VIGILAR_ADELANTE   = 1;
const int VIGILAR_ATRAS      = 2;
const int VIGILAR_CUALQUIERA = 3;  // pivotes: no hay "lado hacia el que va"

// ────────────────────────────────────────────
//  CONTROL DE MOTORES: velocidad negativa = adelante
// ────────────────────────────────────────────
void setMotorSpeed(int pinIN1, int pinIN2, float velocidad) {
  velocidad = constrain(velocidad, -1.0, 1.0);

#if INVERTIR_MOTORES
  velocidad = -velocidad;
#endif

  int pwm = (int)(fabs(velocidad) * 255);

  if (velocidad > 0) {
    ledcWrite(pinIN1, pwm);
    ledcWrite(pinIN2, 0);
  } else if (velocidad < 0) {
    ledcWrite(pinIN1, 0);
    ledcWrite(pinIN2, pwm);
  } else {
    ledcWrite(pinIN1, 0);
    ledcWrite(pinIN2, 0);
  }
}

float signo(float v) {
  return (v > 0) ? 1.0 : ((v < 0) ? -1.0 : 0.0);
}

// aplicarMotores: capa cruda con impulso no bloqueante (sin delay).
void aplicarMotores(float izq, float der) {
  unsigned long ahora = millis();

  if (ultimaIzq == 0 && izq != 0 && fabs(izq) < VEL_IMPULSO) impulsoIzqHasta = ahora + TIEMPO_IMPULSO_MS;
  if (ultimaDer == 0 && der != 0 && fabs(der) < VEL_IMPULSO) impulsoDerHasta = ahora + TIEMPO_IMPULSO_MS;
  if (izq == 0) impulsoIzqHasta = 0;
  if (der == 0) impulsoDerHasta = 0;

  float aplicarIzq = (ahora < impulsoIzqHasta) ? signo(izq) * VEL_IMPULSO : izq;
  float aplicarDer = (ahora < impulsoDerHasta) ? signo(der) * VEL_IMPULSO : der;

  setMotorSpeed(MOTOR1_IN1, MOTOR1_IN2, aplicarIzq);
  setMotorSpeed(MOTOR2_IN1, MOTOR2_IN2, aplicarDer);

  ultimaIzq = izq;
  ultimaDer = der;
}

void motores(float izq, float der) {
  if (izq != ordenIzq || der != ordenDer) tUltimoCambioMotores = millis();
  ordenIzq = izq;
  ordenDer = der;
  mandandoRecto = (izq == der);
  if (!mandandoRecto) { integralRecta = 0; dpsFiltrado = 0; }
  correccionRecta = 0;
  aplicarMotores(izq, der);
}

void detener() {
  motores(0, 0);
}

void setPixelColor(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

// ────────────────────────────────────────────
//  TELEMETRIA: evento() es macro; con 0 no cuesta nada
// ────────────────────────────────────────────
#if TELEMETRIA
void eventoImpl(String nombre, String detalle) {
  Serial.print("E,");
  Serial.print(millis());
  Serial.print(",");
  Serial.print(nombre);
  Serial.print(",");
  Serial.println(detalle);
}
#define evento(nombre, detalle) eventoImpl((nombre), (detalle))
#else
#define evento(nombre, detalle) do { } while (0)
#endif

void telemetria() {
#if TELEMETRIA
  if (millis() - ultimaTelemetria < INTERVALO_TELEMETRIA_MS) return;
  ultimaTelemetria = millis();

  Serial.print("T,");
  Serial.print(millis());                       Serial.print(",");
  Serial.print(estadoTel);                      Serial.print(",");
  Serial.print(distanciaTel, 1);                Serial.print(",");
  for (int i = 0; i < 4; i++) {
    Serial.print(irCrudo[i]);                   Serial.print(",");
  }
  Serial.print(bordeTel.length() ? bordeTel : String("-"));
  Serial.print(",");
  Serial.print(imuDps, 1);                      Serial.print(",");
  Serial.print(inclinacionDeg, 1);              Serial.print(",");
  Serial.print(dAxG, 3);                        Serial.print(",");
  Serial.print(dAyG, 3);                        Serial.print(",");
  Serial.print(rumboDeg, 1);                    Serial.print(",");
  Serial.print(imuFallos);                      Serial.print(",");
  Serial.println(correccionRecta, 3);
#endif
}

// ────────────────────────────────────────────
//  LEER ULTRASONICO: -1 si no hay eco a ~100cm
// ────────────────────────────────────────────
float pulsoSonar() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  unsigned long duracion = pulseIn(PIN_ECHO, HIGH, 6000UL);  // ~6ms = 100cm ida y vuelta
  if (duracion == 0) return -1;
  float d = duracion * 0.0343 / 2.0;
  return (d <= DIST_MAX_SONAR) ? d : -1;
}

// ECHO alto = modulo ocupado: no dispara, usa la ultima.
float medirDistanciaCm() {
  unsigned long ahora = millis();
  float d = -1;

  if (ahora - tUltimoIntentoSonar >= INTERVALO_SONAR_MS && digitalRead(PIN_ECHO) == LOW) {
    tUltimoIntentoSonar = ahora;
    d = pulsoSonar();
  }

  if (d >= 0) {
    ultimaDistValida = d;
    tUltimoEco = ahora;
  } else if (ahora - tUltimoEco <= RETENCION_DIST_MS) {
    d = ultimaDistValida;
  } else {
    d = DIST_MAX_SONAR + 1;
  }

  distanciaTel = d;
  return d;
}

// ────────────────────────────────────────────
//  LEER BORDE (IR): segunda lectura solo si alguno marca
// ────────────────────────────────────────────
bool esBorde(int valor, int i) {
  if (blancoEsMenor[i]) {
    return valor < umbrales[i];
  } else {
    return valor > umbrales[i];
  }
}

// Refresca irCrudo[] y bordeDet[]. Devuelve si algun sensor ve blanco.
bool actualizarBorde() {
  bool alguno = false;
  for (int i = 0; i < 4; i++) {
    irCrudo[i] = analogRead(pinesIr[i]);
    bordeDet[i] = esBorde(irCrudo[i], i);
    alguno = alguno || bordeDet[i];
  }
  if (alguno) {
    for (int i = 0; i < 4; i++) {
      if (bordeDet[i]) bordeDet[i] = esBorde(analogRead(pinesIr[i]), i);
    }
  }
  return alguno;
}

String leerBorde() {
  if (!actualizarBorde()) {
    bordeTel = "";
    return "";
  }

  bool fl = bordeDet[0], fr = bordeDet[1], rl = bordeDet[2], rr = bordeDet[3];

  String resultado = "";
  if      (fl && fr) resultado = "FRENTE";
  else if (rl && rr) resultado = "ATRAS";
  else if (fr && rr) resultado = "EMPUJE_DERECHA";
  else if (fl && rl) resultado = "EMPUJE_IZQUIERDA";
  else if (fl)       resultado = "FRENTE_IZQ";
  else if (fr)       resultado = "FRENTE_DER";
  else if (rl)       resultado = "ATRAS_IZQ";
  else if (rr)       resultado = "ATRAS_DER";

  bordeTel = resultado;
  return resultado;
}

// ────────────────────────────────────────────
//  MOVIMIENTO VIGILADO: aborta si un IR pasa a blanco
// ────────────────────────────────────────────
bool moverVigilando(float izq, float der, unsigned long ms, int vigilar) {
  actualizarBorde();
  bool yaBlanco[4];
  for (int i = 0; i < 4; i++) yaBlanco[i] = bordeDet[i];

  unsigned long t0 = millis();
  while (millis() - t0 < ms) {
    if (izq == der) avanzarRecto(izq, 0.0); else motores(izq, der);
    leerIMU();
    // Con telemetria, leerBorde() mantiene al dia la columna "borde".
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
    telemetria();
  }
  return false;
}

// Gira 'grados' (+ = izquierda); sin giroscopio, por tiempo.
void girarConFallback(float grados) {
  if (giroListo) {
    girarGradosGiro(grados, VEL_ATAQUE, false, false);
    return;
  }
  float s = signo(grados);
  unsigned long ms = (unsigned long)(TIEMPO_GIRO_90_MS * fabs(grados) / 90.0);
  // Pivote: se vigilan los cuatro sensores.
  moverVigilando(VEL_ATAQUE * s, -VEL_ATAQUE * s, ms, VIGILAR_CUALQUIERA);
  detener();
}

// Giro de escape que se corta si aparece el rival.
void girarConFallbackVigilando(float grados) {
  if (giroListo) {
    girarGradosGiro(grados, VEL_ATAQUE, false, true);
    return;
  }
  float s = signo(grados);
  unsigned long ms = (unsigned long)(TIEMPO_GIRO_90_MS * fabs(grados) / 90.0);
  moverVigilandoSonar(VEL_ATAQUE * s, -VEL_ATAQUE * s, ms, VIGILAR_CUALQUIERA);
  detener();
}

// ────────────────────────────────────────────
//  RUMBO DEL RIVAL
// ────────────────────────────────────────────
float anguloRelativo(float a) {
  while (a > 180.0) a -= 360.0;
  while (a < -180.0) a += 360.0;
  return a;
}

// Gira hacia el ultimo rumbo del rival; si no, alterna.
bool elegirSentidoGiro() {
  bool rumboVigente = rumboRivalValido && (millis() - tRumboRival <= RUMBO_RIVAL_VIGENCIA_MS);
  if (giroListo && rumboVigente && signoGiroIzq != 0) {
    float delta = anguloRelativo(rumboRival - rumboDeg);
    girarIzquierda = (delta * signoGiroIzq) > 0;
  } else {
    girarIzquierda = !girarIzquierda;
  }
  return girarIzquierda;
}

// ────────────────────────────────────────────
//  ANTI-BUCLE
// ────────────────────────────────────────────
void registrarEscape() {
  tiemposEscape[idxEscape] = millis();
  idxEscape = (idxEscape + 1) % ESCAPES_ANTIBUCLE;
}

bool enBucle() {
  unsigned long ahora = millis();
  for (int i = 0; i < ESCAPES_ANTIBUCLE; i++) {
    if (tiemposEscape[i] == 0 || ahora - tiemposEscape[i] > VENTANA_ANTIBUCLE_MS) return false;
  }
  return true;
}

void limpiarEscapes() {
  for (int i = 0; i < ESCAPES_ANTIBUCLE; i++) tiemposEscape[i] = 0;
  idxEscape = 0;
}

// ────────────────────────────────────────────
//  CALIBRACION IR
// ────────────────────────────────────────────
bool botonPresionado() {
  return digitalRead(PIN_BOOT) == LOW;
}

int leerPromedioIr(int pin) {
  long suma = 0;
  for (int k = 0; k < MUESTRAS_CALIBRACION; k++) {
    suma += analogRead(pin);
    delay(2);
  }
  return (int)(suma / MUESTRAS_CALIBRACION);
}

void esperarBotonYLeer(int lecturas[4], uint8_t r, uint8_t g, uint8_t b) {
  setPixelColor(r, g, b);
  while (botonPresionado()) { }
  while (!botonPresionado()) { }
  while (botonPresionado()) { }
  for (int i = 0; i < 4; i++) lecturas[i] = leerPromedioIr(pinesIr[i]);
  setPixelColor(0, 0, 0);
  delay(400);
}

void calibracionPorPasos() {
  int negro[4], blanco[4], dummy[4];
  int sensoresConAviso = 0;

  Serial.println("PASO 1: Sensores sobre NEGRO y presiona BOOT.");
  esperarBotonYLeer(negro, 255, 0, 0);

  Serial.println("PASO 2: Sensores sobre BLANCO y presiona BOOT.");
  esperarBotonYLeer(blanco, 255, 255, 255);

  Serial.println("--- Valores de calibracion ---");
  for (int i = 0; i < 4; i++) {
    umbrales[i] = blanco[i] + (int)((negro[i] - blanco[i]) * FACTOR_UMBRAL[i]);
    blancoEsMenor[i] = (blanco[i] < negro[i]);
    int separacion = abs(negro[i] - blanco[i]);

    Serial.print("Sensor "); Serial.print(i);
    Serial.print(" | negro: "); Serial.print(negro[i]);
    Serial.print(" | blanco: "); Serial.print(blanco[i]);
    Serial.print(" | umbral: "); Serial.print(umbrales[i]);
    Serial.print(" | separacion: "); Serial.print(separacion);
    Serial.print(" | blancoEsMenor: "); Serial.print(blancoEsMenor[i] ? "SI (normal)" : "NO (revisar orden)");
    if (separacion < SEPARACION_MINIMA_IR) {
      Serial.print("  <-- DEBIL: revisar sensor/cable");
      sensoresConAviso++;
    } else if (blancoEsMenor[i] && blanco[i] > negro[i] * BLANCO_MAX_FRACCION) {
      Serial.print("  <-- DEGRADADO: el blanco lee alto, el umbral queda cerca del negro");
      sensoresConAviso++;
    }
    Serial.println();
  }
  Serial.println("------------------------------");
  if (sensoresConAviso > 0) {   // aviso visible sin Serial: tres violeta
    for (int k = 0; k < 3; k++) {
      setPixelColor(255, 0, 255); delay(150);
      setPixelColor(0, 0, 0);     delay(150);
    }
  }

  Serial.println("Calibracion exitosa! Presiona BOOT para combate.");
  esperarBotonYLeer(dummy, 0, 255, 0);

  Serial.println("Iniciando...");
  setPixelColor(255, 255, 0);
  delay(500);
  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  SELECCION DE RONDA: pulsar BOOT 1, 2 o 3 veces
// ────────────────────────────────────────────
int contarPulsacionesBoot(unsigned long ventanaMs) {
  while (!botonPresionado()) { }   // espera la primera pulsacion
  while (botonPresionado()) { }    // espera que la suelten

  int conteo = 1;
  unsigned long ultimoPulso = millis();

  while (millis() - ultimoPulso < ventanaMs) {
    if (botonPresionado()) {
      while (botonPresionado()) { }  // espera que suelten esta tambien
      conteo++;
      ultimoPulso = millis();
    }
  }

  return conteo;
}

void seleccionarRonda() {
  Serial.println("Selecciona la RONDA: presiona BOOT 1, 2 o 3 veces seguidas.");
  setPixelColor(0, 255, 255);  // cian = esperando seleccion de ronda

  int conteo = contarPulsacionesBoot(1200);
  ronda = constrain(conteo, 1, 3);

  Serial.print("Ronda seleccionada: ");
  Serial.println(ronda);

  setPixelColor(0, 0, 0);
  delay(200);
  for (int i = 0; i < ronda; i++) {
    setPixelColor(0, 255, 0);
    delay(200);
    setPixelColor(0, 0, 0);
    delay(200);
  }
}

// ────────────────────────────────────────────
//  ESPERA FINAL: colocar el robot y pulsar BOOT
// ────────────────────────────────────────────
void esperarInicioCombate() {
  Serial.println("Coloca el robot en el dojo y presiona BOOT para iniciar el combate.");
  setPixelColor(255, 255, 255);  // blanco = listo, esperando el BOOT final

  while (botonPresionado()) { }
  while (!botonPresionado()) { }
  while (botonPresionado()) { }

  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (una vez, antes del loop)
// ────────────────────────────────────────────
void giroInicial() {
  if (ronda == 1) return;  // frente a frente: ya queda mirando al rival

  setPixelColor(255, 255, 0);
#if TELEMETRIA
  unsigned long t0 = millis();  // solo lo usa el evento de abajo
#endif
  float grados = (ronda == 2) ? 90.0 : 180.0;

  if (giroListo) {
    girarGradosGiro(-grados, VEL_ATAQUE, true, false);  // negativo: mismo sentido que el codigo original
  } else {
    unsigned long ms = (ronda == 2) ? TIEMPO_GIRO_90_MS : TIEMPO_GIRO_180_MS;
    moverVigilando(-VEL_ATAQUE, VEL_ATAQUE, ms, VIGILAR_CUALQUIERA);
    detener();
  }

  evento("GIRO_INICIAL", String(ronda) + ";" + String(millis() - t0));
  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  COMPORTAMIENTO OFENSIVO: ataque, tanteo o busqueda del rival
// ────────────────────────────────────────────
void comportamientoOfensivo() {
  float distanciaFrontal = medirDistanciaCm();
  bool detectado = distanciaFrontal <= DIST_MAX_SONAR;
  unsigned long ahora = millis();

  golpePendiente = false;  // en ataque el contacto es esperado

  if (detectado) {
    tUltimaDeteccion = ahora;
    buscando = false;
    if (giroListo) {
      rumboRival = rumboDeg;
      rumboRivalValido = true;
      tRumboRival = ahora;
    }

    if (distanciaFrontal < DIST_ATAQUE) {
      tCambioTanteo = 0;   // en ataque, derecho
      if (rotacionForzada()) { reaccionPerdiendoEmpuje(); return; }

      estadoTel = "ATAQUE";
      setPixelColor(255, 0, 0);
      avanzarRecto(-VEL_ATAQUE, 0.0);
    } else {
      estadoTel = "TRACK";
      setPixelColor(255, 165, 0);
      // Tanteo (cambio 31): cada TANTEO_SEMIPERIODO_MS cambia el lado.
      if (tCambioTanteo == 0 || ahora - tCambioTanteo >= TANTEO_SEMIPERIODO_MS) {
        if (tCambioTanteo != 0) sentidoTanteo = -sentidoTanteo;
        tCambioTanteo = ahora;
      }
      tanteoInvertidoAlPerder = false;
      avanzarRecto(-VEL_TRACKING, sentidoTanteo * TANTEO_DPS);
    }

  } else {
    unsigned long esperaPerdido = (ultimaDistValida < DIST_CONTACTO) ? PERDIDO_CONTACTO_MS : PERDIDO_TRAS_MS;
    if (!buscando && ahora - tUltimaDeteccion > esperaPerdido) {
      buscando = true;
      elegirSentidoGiro();
      evento("PERDIDO", girarIzquierda ? "busca_izq" : "busca_der");
    }

    if (buscando) {
      tCambioTanteo = 0;
      estadoTel = "BUSCA";
      setPixelColor(0, 0, 255);
      motores(girarIzquierda ? VEL_BUSQUEDA : -VEL_BUSQUEDA,
              girarIzquierda ? -VEL_BUSQUEDA : VEL_BUSQUEDA);
    } else {
      estadoTel = "AVANCE";
      setPixelColor(255, 165, 0);
      if (ultimaDistValida < DIST_ATAQUE) {
        // Recien perdido estando cerca: sigue a fondo, como en ATAQUE.
        avanzarRecto(-VEL_ATAQUE, 0.0);
      } else if (tCambioTanteo != 0) {
        // Recien perdido tanteando: invierte el barrido una sola vez.
        if (!tanteoInvertidoAlPerder) {
          sentidoTanteo = -sentidoTanteo;
          tCambioTanteo = ahora;
          tanteoInvertidoAlPerder = true;
        }
        avanzarRecto(-VEL_TRACKING, sentidoTanteo * TANTEO_DPS);
      } else {
        avanzarRecto(-VEL_TRACKING, 0.0);
      }
    }
  }
}

// ────────────────────────────────────────────
//  SETUP / LOOP
//  Prioridad del loop: borde > levantamiento > empuje lateral > ataque.
// ────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);  // deja que el puerto se asiente antes de la cabecera
  Serial.println();
  Serial.print("Firmware: ");
  Serial.println(TEXTO(FIRMA_ID));

#if TELEMETRIA
  Serial.println("# T,ms,estado,dist_cm,ir0,ir1,ir2,ir3,borde,giro_dps,inclin_deg,dax_g,day_g,rumbo_deg,imu_fallos,corr");
  Serial.println("# E,ms,evento,detalle");
#endif

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);

  ledcAttach(MOTOR1_IN1, PWM_FREQ, PWM_RES);
  ledcAttach(MOTOR1_IN2, PWM_FREQ, PWM_RES);
  ledcAttach(MOTOR2_IN1, PWM_FREQ, PWM_RES);
  ledcAttach(MOTOR2_IN2, PWM_FREQ, PWM_RES);

  pixel.begin();
  pixel.show();

  detener();
  calibracionPorPasos();

  seleccionarRonda();
  iniciarGiroscopio();
  esperarInicioCombate();
  giroInicial();

  tUltimaDeteccion = millis();  // arranca avanzando; la busqueda espera PERDIDO_TRAS_MS
  limpiarEscapes();
}

void loop() {
  leerIMU();

  String borde = leerBorde();
  if (borde != "") {
    estadoTel = "BORDE";
    telemetria();
    maniobraEscapePreciso(borde);
    return;
  }

  if (detectarLevantado()) {
    estadoTel = "LEVANTADO";
    telemetria();
    reaccionLevantado();
    return;
  }

  if (detectarEmpujeLateral()) {
    estadoTel = "EMPUJADO";
    telemetria();
    reaccionEmpujeLateral();
    return;
  }

  comportamientoOfensivo();
  telemetria();
}
