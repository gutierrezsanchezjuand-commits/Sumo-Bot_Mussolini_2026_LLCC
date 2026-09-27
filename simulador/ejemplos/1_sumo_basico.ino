// Ejemplo: sumo basico en Arduino (kit IdeaBoard)
//
// Programa de ejemplo del simulador: corre igual en el robot. Hace lo minimo
// que necesita un sumobot para pelear:
//   1. Calibra los 4 sensores de piso (IR) sobre negro y sobre blanco.
//   2. Espera el BOOT de la salida.
//   3. En cada vuelta: si un IR ve el borde blanco, escapa; si no, busca al
//      rival con el sonar y lo empuja.
//
// Pines del kit (los mismos que usa el simulador por defecto):
//   motores  izquierdo 12/14, derecho 13/15 (IN1 en alto = la rueda avanza)
//   sonar    TRIG 25, ECHO 26
//   IR       36 frontal izq, 39 frontal der, 34 trasero izq, 35 trasero der
//   BOOT 0, NeoPixel 2
//
// Requiere la libreria "Adafruit NeoPixel" (Library Manager del IDE).

#include <Adafruit_NeoPixel.h>

// ── pines ──
#define PIN_TRIG 25
#define PIN_ECHO 26
#define PIN_BOOT 0
#define PIN_NEOPIXEL 2
#define MOTOR_IZQ_IN1 12
#define MOTOR_IZQ_IN2 14
#define MOTOR_DER_IN1 13
#define MOTOR_DER_IN2 15

const int PINES_IR[4] = {36, 39, 34, 35};   // frontal izq, frontal der, trasero izq, trasero der

// ── ajustes ──
const float DIST_ATAQUE = 40.0;      // cm: a menos de esto, empuja a fondo
const float DIST_ACERCAR = 90.0;     // cm: a menos de esto, se acerca
const float VEL_ATAQUE = 1.0;
const float VEL_ACERCAR = 0.8;
const float VEL_BUSQUEDA = 0.8;      // girando en el lugar: por debajo de ~0.7 el pivote se traba
const int RETROCESO_MS = 300;        // escape del borde: cuanto retrocede
const int GIRO_ESCAPE_MS = 350;      // y cuanto gira despues
const unsigned long ESPERA_SALIDA_MS = 0;   // si el reglamento pide esperar (p. ej. 5 s), ponelo aca

Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);
int umbral[4];                       // entre negro y blanco, uno por sensor
float ultimaDistancia = 999.0;       // la ultima distancia al rival (cm)
unsigned long tUltimoEco = 0;        // cuando se vio por ultima vez

// ── motores: velocidad de -1 (atras) a 1 (adelante) ──
void motor(int in1, int in2, float vel) {
  vel = constrain(vel, -1.0, 1.0);
  int pwm = (int)(fabs(vel) * 255);
  if (vel >= 0) { ledcWrite(in1, pwm); ledcWrite(in2, 0); }
  else          { ledcWrite(in1, 0);   ledcWrite(in2, pwm); }
}

void motores(float izq, float der) {
  motor(MOTOR_IZQ_IN1, MOTOR_IZQ_IN2, izq);
  motor(MOTOR_DER_IN1, MOTOR_DER_IN2, der);
}

void color(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

// Un evento para el informe del simulador: "E,<ms>,<NOMBRE>,<detalle>".
// En el robot es solo una linea mas por el Serial.
void evento(const char* nombre, String detalle) {
  Serial.print("E,"); Serial.print(millis()); Serial.print(",");
  Serial.print(nombre); Serial.print(","); Serial.println(detalle);
}

// ── sensores ──
float distanciaCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 12000UL);   // 12 ms: unos 2 m
  if (us == 0) return 999.0;                              // sin eco
  return us / 58.0;
}

// Pegado al rival el sonar pierde ecos. Si se lo acaba de ver, se mantiene la
// ultima distancia un rato (mas si estaba muy cerca) en vez de ponerse a buscar.
float distanciaRival() {
  float d = distanciaCm();
  if (d < 999.0) { ultimaDistancia = d; tUltimoEco = millis(); return d; }
  unsigned long retener = ultimaDistancia < 15.0 ? 500 : 150;
  if (millis() - tUltimoEco < retener) return ultimaDistancia;
  ultimaDistancia = 999.0;
  return 999.0;
}

// Blanco lee BAJO y negro ALTO: es borde si la lectura queda debajo del umbral
// en dos vueltas seguidas del loop. En un dojo brillante los reflejos dan
// lecturas bajas sueltas de unos milisegundos que no son borde.
int vecesBlanco[4];
bool esBorde(int i) {
  if (analogRead(PINES_IR[i]) < umbral[i]) vecesBlanco[i]++;
  else vecesBlanco[i] = 0;
  return vecesBlanco[i] >= 2;
}

// ── arranque ──
void esperarBoot() {
  while (digitalRead(PIN_BOOT) == HIGH) { delay(5); }   // espera que lo aprieten
  while (digitalRead(PIN_BOOT) == LOW) { delay(5); }    // y que lo suelten
}

void leerTodos(int destino[4]) {
  for (int i = 0; i < 4; i++) {
    long suma = 0;
    for (int k = 0; k < 8; k++) { suma += analogRead(PINES_IR[i]); delay(2); }
    destino[i] = suma / 8;
  }
}

void calibrar() {
  int negro[4], blanco[4];
  Serial.println("PASO 1: pone los sensores sobre NEGRO y presiona BOOT");
  color(255, 0, 0);
  esperarBoot();
  leerTodos(negro);
  Serial.println("PASO 2: pone los sensores sobre BLANCO y presiona BOOT");
  color(255, 255, 255);
  esperarBoot();
  leerTodos(blanco);
  for (int i = 0; i < 4; i++) {
    umbral[i] = (negro[i] + blanco[i]) / 2;
    Serial.printf("IR %d: negro %d, blanco %d, umbral %d\n", i, negro[i], blanco[i], umbral[i]);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  ledcAttach(MOTOR_IZQ_IN1, 20000, 8);
  ledcAttach(MOTOR_IZQ_IN2, 20000, 8);
  ledcAttach(MOTOR_DER_IN1, 20000, 8);
  ledcAttach(MOTOR_DER_IN2, 20000, 8);
  pixel.begin();
  motores(0, 0);

  calibrar();
  Serial.println("Listo. Coloca el robot y presiona BOOT para empezar el combate");
  color(0, 255, 0);
  esperarBoot();
  color(0, 0, 0);
  delay(ESPERA_SALIDA_MS);
  evento("INICIO", "combate");
}

// ── combate ──
void escapar(bool adelante, bool izquierda) {
  color(255, 0, 255);
  for (int i = 0; i < 4; i++) vecesBlanco[i] = 0;
  if (adelante) {
    evento("BORDE", izquierda ? "frente_izq" : "frente_der");
    motores(-1.0, -1.0);                        // atras
    delay(RETROCESO_MS);
    if (izquierda) motores(1.0, -1.0);          // gira hacia la derecha, lejos del borde
    else           motores(-1.0, 1.0);
    delay(GIRO_ESCAPE_MS);
  } else {
    evento("BORDE", "atras");
    motores(1.0, 1.0);                          // el borde esta atras: adelante
    delay(RETROCESO_MS);
  }
}

void loop() {
  bool fi = esBorde(0), fd = esBorde(1), ti = esBorde(2), td = esBorde(3);
  if (fi || fd) {
    // Borde adelante con el rival pegado: empujarlo un poco mas antes de
    // escapar. El rival pierde recien cuando sale entero del circulo negro.
    if (ultimaDistancia < 15.0) {
      evento("EMPUJE_FINAL", String(ultimaDistancia, 0) + " cm");
      motores(1.0, 1.0);
      delay(150);
    }
    escapar(true, fi);
    return;
  }
  if (ti || td) { escapar(false, ti); return; }

  float d = distanciaRival();
  if (d < DIST_ATAQUE) {
    color(255, 0, 0);
    motores(VEL_ATAQUE, VEL_ATAQUE);
  } else if (d < DIST_ACERCAR) {
    color(255, 165, 0);
    motores(VEL_ACERCAR, VEL_ACERCAR);
  } else {
    color(0, 0, 255);
    motores(-VEL_BUSQUEDA, VEL_BUSQUEDA);      // busca girando a la izquierda
  }
}
