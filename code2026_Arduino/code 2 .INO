/*
  Tomas de Camino Beck / Mod: Evasion Direccional + HC-SR04
  Escuela de Sistemas Inteligentes - Universidad Cenfotec
  Version Arduino - corregida tras pruebas reales en el sumobot

  CAMBIOS EN ESTA VERSION (segun pruebas reales):
    1. Pitido en cada cambio de accion -> PWM movido a 20kHz (LEDC),
       fuera del rango audible. El pitido anterior era la frecuencia
       por defecto de analogWrite(), que cae en rango audible.
    2. Se congelaba al detectar el borde blanco -> era friccion estatica
       (stiction): el motor recibia la orden pero no tenia suficiente
       fuerza para arrancar desde parado. Se agrego un impulso breve a
       maxima potencia cada vez que un motor arranca desde 0.
    3. Iba hacia atras en modo ataque -> confirmado con pruebas: los
       motores de este robot estan invertidos. Interruptor unico
       INVERTIR_MOTORES (abajo) para corregirlo sin tocar el resto
       del codigo.
    4. Muy lento -> el barrido lateral (barrer_y_localizar) tardaba
       ~250ms por ciclo girando para localizar al rival. Se elimino:
       ahora en la zona de 40-100cm simplemente avanza derecho. Tambien
       se bajo el timeout del sensor ultrasonico de 30ms a 6ms (ya que
       de todas formas se ignora todo lo que este a mas de 100cm).

  Requiere la libreria "Adafruit NeoPixel" (Library Manager de Arduino IDE).
*/

#include <Adafruit_NeoPixel.h>

// ────────────────────────────────────────────
//  AJUSTE RAPIDO DE MOTORES
//  Si el robot avanza hacia atras cuando deberia ir hacia adelante
//  (o al reves), cambia este valor entre 0 y 1 y vuelve a subir.
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

#define MOTOR1_IN1 12
#define MOTOR1_IN2 14
#define MOTOR2_IN1 13
#define MOTOR2_IN2 15

#define PIN_NEOPIXEL 2

const int pinesIr[4] = {PIN_SEN1, PIN_SEN2, PIN_SEN3, PIN_SEN4};
int umbrales[4] = {0, 0, 0, 0};

Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);

// ────────────────────────────────────────────
//  PWM (LEDC) - 20kHz para que no chille el motor
// ────────────────────────────────────────────
const int PWM_FREQ = 20000;  // 20kHz, fuera del oido humano
const int PWM_RES  = 8;      // 0-255

// ────────────────────────────────────────────
//  CONSTANTES DE COMPORTAMIENTO
// ────────────────────────────────────────────
const float DIST_MAX_SONAR = 100.0;  // Ignora objetos mas alla de 100cm
const float DIST_ATAQUE    = 40.0;   // Carga a fondo

const int LECTURAS_PERDIDAS_MAX = 4;  // 3 a 5 lecturas sin deteccion -> busqueda

const float VEL_ATAQUE   = 1.0;   // Maxima potencia en contacto
const float VEL_TRACKING = 0.80;  // Avance directo hacia el rival (40-100cm)
const float VEL_BUSQUEDA = 0.75;  // Giro de busqueda

// Impulso de arranque: al salir de 0 con una velocidad menor a VEL_IMPULSO,
// se aplica un instante a maxima potencia para vencer la friccion estatica.
// Si algun movimiento sigue sin arrancar, sube TIEMPO_IMPULSO_MS.
const float VEL_IMPULSO = 1.0;
const unsigned long TIEMPO_IMPULSO_MS = 70;

// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (reglamento: 3 combates con
//  disposicion distinta cada vez: frente a frente, lado a lado
//  en direcciones opuestas, y espalda con espalda).
//  IMPORTANTE: estos tiempos son un punto de partida, no estan
//  medidos en tu robot real. Prueba en banco (sin oponente) y
//  ajusta hasta que el giro sea de ~90 y ~180 grados reales.
//  La direccion del giro de la ronda 2 (izq/der) tambien es una
//  suposicion: si el juez coloca al rival del otro lado, el robot
//  igual lo va a encontrar por el modo de busqueda normal, solo
//  tarda un poco mas.
// ────────────────────────────────────────────
const unsigned long TIEMPO_GIRO_90_MS  = 400;  // ajustar con pruebas reales
const unsigned long TIEMPO_GIRO_180_MS = 800;  // ajustar con pruebas reales
int ronda = 1;

bool girarIzquierda = false;  // alterna sentido de giro (busqueda / escape frontal)
int  lecturasSinDeteccion = 0;
bool buscando = false;

int umbralesListos = 0;
float ultimaIzq = 0;
float ultimaDer = 0;

// ────────────────────────────────────────────
//  CONTROL DE MOTORES
//  Convencion (igual que el codigo original): velocidad
//  negativa = adelante, positiva = atras. INVERTIR_MOTORES
//  compensa la inversion fisica sin tocar el resto del codigo.
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

// Da un impulso breve a maxima potencia cuando una rueda arranca desde
// parado con una velocidad baja, para vencer la friccion estatica.
void motores(float izq, float der) {
  bool arranqueIzq = (ultimaIzq == 0 && izq != 0 && fabs(izq) < VEL_IMPULSO);
  bool arranqueDer = (ultimaDer == 0 && der != 0 && fabs(der) < VEL_IMPULSO);

  if (arranqueIzq || arranqueDer) {
    float impIzq = (izq > 0) ? VEL_IMPULSO : (izq < 0 ? -VEL_IMPULSO : 0);
    float impDer = (der > 0) ? VEL_IMPULSO : (der < 0 ? -VEL_IMPULSO : 0);
    setMotorSpeed(MOTOR1_IN1, MOTOR1_IN2, impIzq);
    setMotorSpeed(MOTOR2_IN1, MOTOR2_IN2, impDer);
    delay(TIEMPO_IMPULSO_MS);
  }

  setMotorSpeed(MOTOR1_IN1, MOTOR1_IN2, izq);
  setMotorSpeed(MOTOR2_IN1, MOTOR2_IN2, der);

  ultimaIzq = izq;
  ultimaDer = der;
}

void detener() {
  motores(0, 0);
}

void setPixelColor(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

// ────────────────────────────────────────────
//  LEER ULTRASONICO
//  Timeout ajustado a ~100cm (antes 30ms, ahora 6ms) para no
//  perder tiempo esperando eco de objetos fuera de rango.
// ────────────────────────────────────────────
float medirDistanciaCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  unsigned long duracion = pulseIn(PIN_ECHO, HIGH, 6000UL);  // ~6ms = 100cm ida y vuelta
  if (duracion == 0) {
    return DIST_MAX_SONAR + 1;
  }

  float distancia = duracion * 0.0343 / 2.0;
  if (distancia > DIST_MAX_SONAR) {
    return DIST_MAX_SONAR + 1;
  }
  return distancia;
}

// ────────────────────────────────────────────
//  LEER BORDE (IR)
//  Doble lectura anti-ruido sin delay entre ellas.
// ────────────────────────────────────────────
String leerBorde() {
  int v1[4], v2[4];
  for (int i = 0; i < 4; i++) v1[i] = analogRead(pinesIr[i]);
  for (int i = 0; i < 4; i++) v2[i] = analogRead(pinesIr[i]);

  bool det[4];
  for (int i = 0; i < 4; i++) {
    det[i] = (v1[i] < umbrales[i]) && (v2[i] < umbrales[i]);
  }

  bool fl = det[0], fr = det[1], rl = det[2], rr = det[3];

  if (fl && fr) return "FRENTE";
  if (fr && rr) return "EMPUJE_DERECHA";
  if (fl && rl) return "EMPUJE_IZQUIERDA";
  if (fl || rl) return "IZQUIERDA";
  if (fr || rr) return "DERECHA";
  return "";
}

// ────────────────────────────────────────────
//  CALIBRACION IR
// ────────────────────────────────────────────
bool botonPresionado() {
  return digitalRead(PIN_BOOT) == LOW;
}

void esperarBotonYLeer(int lecturas[4], uint8_t r, uint8_t g, uint8_t b) {
  setPixelColor(r, g, b);
  while (botonPresionado()) { }
  while (!botonPresionado()) { }
  while (botonPresionado()) { }
  for (int i = 0; i < 4; i++) lecturas[i] = analogRead(pinesIr[i]);
  setPixelColor(0, 0, 0);
  delay(400);
}

void calibracionPorPasos() {
  int negro[4], blanco[4], dummy[4];

  Serial.println("PASO 1: Sensores sobre NEGRO y presiona BOOT.");
  esperarBotonYLeer(negro, 255, 0, 0);

  Serial.println("PASO 2: Sensores sobre BLANCO y presiona BOOT.");
  esperarBotonYLeer(blanco, 255, 255, 255);

  for (int i = 0; i < 4; i++) {
    umbrales[i] = (negro[i] + blanco[i]) / 2;
  }

  Serial.println("Calibracion exitosa! Presiona BOOT para combate.");
  esperarBotonYLeer(dummy, 0, 255, 0);

  Serial.println("Iniciando...");
  setPixelColor(255, 255, 0);
  delay(500);
  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  SELECCION DE RONDA (una sola vez, antes del combate)
//  Cuenta cuantas veces se presiona BOOT dentro de una ventana de
//  tiempo tras la ultima pulsacion, para elegir la ronda 1/2/3.
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

  // Confirmacion visual: parpadea tantas veces como la ronda elegida
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
//  ESPERA FINAL ANTES DE COMBATIR
//  Da tiempo de colocar el robot en el dojo despues de elegir la
//  ronda. El giro inicial (ronda 2/3) no ocurre hasta este punto.
// ────────────────────────────────────────────
void esperarInicioCombate() {
  Serial.println("Coloca el robot en el dojo y presiona BOOT para iniciar el combate.");
  setPixelColor(255, 255, 255);  // blanco = listo, esperando el BOOT final

  while (botonPresionado()) { }   // por si ya estaba presionado
  while (!botonPresionado()) { }  // espera a que lo presionen
  while (botonPresionado()) { }   // espera a que lo suelten

  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (una sola vez, antes de entrar al loop)
// ────────────────────────────────────────────
void giroInicial() {
  if (ronda == 1) {
    return;  // frente a frente: ya queda mirando al rival, no gira
  }

  setPixelColor(255, 255, 0);

  if (ronda == 2) {
    // Lado a lado, direcciones opuestas: el rival queda ~90 grados
    // a un lado. Gira hacia ese lado para encararlo mas rapido.
    motores(-VEL_ATAQUE, VEL_ATAQUE);
    delay(TIEMPO_GIRO_90_MS);
  } else if (ronda == 3) {
    // Espalda con espalda: el rival queda ~180 grados, detras.
    motores(-VEL_ATAQUE, VEL_ATAQUE);
    delay(TIEMPO_GIRO_180_MS);
  }

  detener();
  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  MANIOBRA DE ESCAPE
// ────────────────────────────────────────────
void maniobraEscape(String direccion) {
  setPixelColor(255, 0, 255);

  if (direccion == "EMPUJE_DERECHA" || direccion == "EMPUJE_IZQUIERDA") {
    bool haciaIzq = (direccion == "EMPUJE_DERECHA");
    unsigned long t0 = millis();
    while (millis() - t0 < 300) {
      motores(haciaIzq ? -VEL_ATAQUE : -0.25,
              haciaIzq ? -0.25 : -VEL_ATAQUE);
      if (leerBorde() == "FRENTE") break;
    }
    motores(haciaIzq ? -VEL_ATAQUE : VEL_ATAQUE,
            haciaIzq ? VEL_ATAQUE : -VEL_ATAQUE);
    delay(300);
  }
  else if (direccion == "FRENTE") {
    motores(1.0, 1.0);
    delay(180);
    detener();
    motores(girarIzquierda ? VEL_ATAQUE : -VEL_ATAQUE,
            girarIzquierda ? -VEL_ATAQUE : VEL_ATAQUE);
    delay(900);
    girarIzquierda = !girarIzquierda;
  }
  else if (direccion == "IZQUIERDA" || direccion == "DERECHA") {
    bool haciaDer = (direccion == "IZQUIERDA");
    motores(1.0, 1.0);
    delay(120);
    motores(haciaDer ? -VEL_ATAQUE : VEL_ATAQUE,
            haciaDer ? VEL_ATAQUE : -VEL_ATAQUE);
    delay(400);
  }

  detener();
}

// ────────────────────────────────────────────
//  COMPORTAMIENTO OFENSIVO / BUSQUEDA
//  Sin barrido: avance directo. Mucho mas rapido.
// ────────────────────────────────────────────
void comportamientoOfensivo() {
  float distanciaFrontal = medirDistanciaCm();
  bool detectado = distanciaFrontal <= DIST_MAX_SONAR;

  if (detectado) {
    lecturasSinDeteccion = 0;
    buscando = false;

    if (distanciaFrontal < DIST_ATAQUE) {
      setPixelColor(255, 0, 0);
      motores(-VEL_ATAQUE, -VEL_ATAQUE);
    } else {
      setPixelColor(255, 165, 0);
      motores(-VEL_TRACKING, -VEL_TRACKING);
    }

  } else {
    if (lecturasSinDeteccion < 1000) lecturasSinDeteccion++;

    if (lecturasSinDeteccion == LECTURAS_PERDIDAS_MAX) {
      buscando = true;
      girarIzquierda = !girarIzquierda;
    }

    if (buscando) {
      setPixelColor(0, 0, 255);
      motores(girarIzquierda ? VEL_BUSQUEDA : -VEL_BUSQUEDA,
              girarIzquierda ? -VEL_BUSQUEDA : VEL_BUSQUEDA);
    } else {
      setPixelColor(255, 165, 0);
      motores(-VEL_TRACKING, -VEL_TRACKING);
    }
  }
}

// ────────────────────────────────────────────
//  SETUP / LOOP
// ────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

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
  esperarInicioCombate();
  giroInicial();
}

void loop() {
  String borde = leerBorde();
  if (borde != "") {
    maniobraEscape(borde);
  } else {
    comportamientoOfensivo();
  }
}
