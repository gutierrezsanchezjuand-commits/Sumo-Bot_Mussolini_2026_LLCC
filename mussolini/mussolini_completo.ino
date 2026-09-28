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

// ============================================================
// Antes eran dos pestañas del mismo sketch (mussolini.ino +
// giroscopio_control.ino); acá van concatenadas en un solo
// archivo para poder copiarlo y pegarlo entero en un sketch nuevo.
// El comportamiento es exactamente el mismo: el IDE de Arduino ya
// las concatenaba así al compilar.
// ============================================================
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
