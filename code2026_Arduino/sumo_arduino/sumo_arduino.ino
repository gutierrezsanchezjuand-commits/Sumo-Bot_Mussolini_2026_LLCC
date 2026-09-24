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

  CAMBIOS 2026-09-20 (probados en el robot real, nueve corridas; los
  valores de las constantes salen de esas mediciones):
    5. Ningun delay() ciego en las maniobras: moverVigilando() sigue
       leyendo los IR mientras se mueve y aborta si aparece el borde
       del lado hacia el que va.
    6. Impulso anti-stiction no bloqueante: misma duracion (70 ms),
       pero el loop() sigue corriendo mientras tanto.
    7. leerBorde() distingue sensores traseros. Antes un trasero en
       blanco disparaba el mismo escape que un frontal (retroceder), o
       sea retrocedia HACIA el borde. Ahora los casos ATRAS avanzan.
       Ademas el caso EMPUJE_* giraba al reves que los demas casos; se
       unifico la convencion (ver el aviso en los pines de motor).
    8. Calibracion IR promediada (12 muestras por paso) con factor de
       umbral por sensor y aviso de sensor debil.
    9. Ultrasonico: no re-dispara mientras el modulo sigue ocupado con
       un eco perdido (el HC-SR04 ignora el TRIG hasta ~38 ms), y
       conserva la ultima distancia valida un rato corto en vez de
       asumir que el rival desaparecio.
   10. Giro inicial de ronda 2/3 por giroscopio (angulo real), con el
       giro por tiempo solo como respaldo si el sensor no responde.
   11. Memoria de rumbo del rival: la busqueda y el escape frontal
       giran hacia donde se lo vio por ultima vez, usando el rumbo
       integrado del giroscopio.
   12. Anti-bucle: 3 escapes en 3 s invierten el sentido de giro y lo
       agrandan 45 grados para romper la oscilacion en la linea.
   13. Empuje frontal perdido (nos rotan mandando recto, o el empuje
       lleva mas de 4 s) -> retroceder, girar 60 y volver de costado.
       Golpe o rotacion forzada FUERA de ataque -> escapar adelante.
   14. Levantamiento por angulo de inclinacion 3D: compara el vector
       de aceleracion completo (X, Y, Z) contra el de reposo calibrado,
       asi funciona aunque el robot no este nivelado. Con histeresis.
   15. I2C validado: lecturas absurdas se descartan y se cuentan, y el
       bus se destraba a pulsos si el sensor quedo colgado por un reset.
   16. Avance recto con correccion de rumbo por giroscopio
       (avanzarRecto(), P+I): los motores son desparejos y la embestida
       se curvaba sola 15-30 grados/s. Medido despues: +2 grados/s
       avanzando libre, +/-1 empujando.

  CAMBIOS 2026-09-23:
   17. Los pivotes eran ciegos al borde. girarGradosGiro() no leia los
       IR en su bucle, y girarConFallback()/giroInicial() pivoteaban con
       VIGILAR_NADA. Medido: de 136 giros, 25 pasaron de 600 ms y el mas
       largo llego al timeout de 3 s -- todo ese rato el rival podia
       empujarnos sobre la linea sin que el robot se enterara. Ahora los
       pivotes abortan si un sensor CRUZA a blanco durante el giro (lo
       que ya estaba en blanco no cuenta: los escapes arrancan sobre la
       linea). Evento nuevo: GIRO_CORTADO. Modo nuevo: VIGILAR_CUALQUIERA.

  De la revision externa del 2026-09-23 (gracias) se tomo:
   18. Throttle del sonar (INTERVALO_SONAR_MS). Ver el comentario en la
       constante: el guard de ECHO ya cubria el campo abierto, la
       ganancia real es persiguiendo, y es grande.
   19. evento() pasa a ser macro, asi las llamadas desaparecen enteras
       con TELEMETRIA en 0 (antes los String se armaban igual en el
       llamador). La revision arreglaba solo GIRO_INICIAL, que corre una
       vez por combate; el caro era GOLPE, dentro de leerIMU().
   20. Separacion actualizarBorde() / leerBorde(). Se toma porque es mas
       claro, NO por rendimiento: ver el comentario sobre small string
       optimization arriba de esas funciones.

  De esa revision NO se tomo:
    - Subir VEL_TRACKING a 0.85 y bajar el avance a ciegas a 0.65.
      El razonamiento (a ciegas no sabes si apuntas al centro o al
      borde) es bueno, pero ninguno de los dos numeros esta medido y
      subir la persecucion va en la direccion de salirse del ring.
      Decision del usuario: no tocar velocidades sin banco.
    - Su diagnostico de que el "se vuelve loco" era fragmentacion de
      heap por String. Las capturas del 20-09 lo contradicen: era
      FACTOR_UMBRAL en 0.60 (el sensor 1 leia 1633 contra un umbral de
      1711 y cruzaba por vibracion). Con 0.45 se corrieron 30 s sin un
      solo escape fantasma.

  Requiere "Adafruit NeoPixel" y "Adafruit LSM6DS" (Library Manager).
  Core ESP32 3.x: con el 2.x no compila (ledcAttach cambio de firma).
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

// ⚠ Convencion de lados: MOTOR1 = rueda IZQUIERDA. Todo el codigo
// asume que motores(+V, -V) pivotea a la IZQUIERDA (rueda izquierda
// hacia atras, derecha hacia adelante). PRUEBA DE BANCO OBLIGATORIA:
// si con "girarIzquierda" el robot gira a la derecha, intercambiar
// aca los pines de MOTOR1 y MOTOR2 — y no tocar nada mas.
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
//  TELEMETRIA
//  Saca por Serial lo que el robot esta viendo y decidiendo. Dos
//  formatos de linea, ambos CSV:
//
//    T,<ms>,<estado>,<dist>,<ir0>,<ir1>,<ir2>,<ir3>,<borde>,
//      <giro_dps>,<inclin_deg>,<dax_g>,<day_g>,<rumbo_deg>,<imu_fallos>,<corr>
//    E,<ms>,<evento>,<detalle>
//
//  Las "T" salen cada INTERVALO_TELEMETRIA_MS. Las "E" en el momento
//  exacto del evento. Poner TELEMETRIA en 0 para el combate real.
// ────────────────────────────────────────────
#define TELEMETRIA 0   // 1 para probar en banco; 0 para competir
const unsigned long INTERVALO_TELEMETRIA_MS = 100;

unsigned long ultimaTelemetria = 0;
int    irCrudo[4]  = {0, 0, 0, 0};
float  distanciaTel = 0;
String bordeTel  = "";
String estadoTel = "INIT";

// ────────────────────────────────────────────
//  ESTADO DEL IMU
//  Lo escribe leerIMU() en giroscopio_control.ino. Vive aca porque el
//  IDE concatena esta pestaña primero y las variables, a diferencia de
//  las funciones, no reciben declaracion adelantada automatica.
// ────────────────────────────────────────────
bool  giroListo = false;
float imuDps = 0;            // velocidad angular en Z, grados/s, ya sin drift
float imuDt = 0;             // segundos entre las dos ultimas lecturas validas
float rumboDeg = 0;          // integral de imuDps desde el arranque (dead reckoning)
float inclinacionDeg = 0;    // angulo entre el vector de aceleracion actual y el de reposo
float dAxG = 0, dAyG = 0;    // deltas horizontales respecto al reposo, en g
unsigned long imuFallos = 0; // lecturas descartadas por I2C o por magnitud absurda
// +1 si girar a la izquierda da imuDps positivo, -1 si negativo. Arranca en
// +1 porque se midio en este robot el 2026-09-20 (giro a la derecha visto
// por el usuario + eje Z hacia arriba); el primer pivote lo re-aprende y
// lo corrige si el sensor cambiara de montaje.
int   signoGiroIzq = 1;
bool  golpePendiente = false;

// ────────────────────────────────────────────
//  CONSTANTES DE COMPORTAMIENTO
// ────────────────────────────────────────────
const float DIST_MAX_SONAR = 100.0;  // Ignora objetos mas alla de 100cm
const float DIST_ATAQUE    = 40.0;   // Carga a fondo

// El HC-SR04 se queda ~38 ms ocupado tras un eco perdido. Mientras
// tanto se conserva la ultima distancia valida (RETENCION), y solo si
// ademas pasa PERDIDO_TRAS_MS sin verlo se asume que el rival se fue.
const unsigned long RETENCION_DIST_MS = 80;
const unsigned long PERDIDO_TRAS_MS   = 150;
// Medido 2026-09-20: pegado al rival (~7 cm) el sonar pierde la mitad de
// los ecos y el robot entraba en busqueda seis veces en 3 s. Desde el
// contacto el rival no puede haberse esfumado: se espera mas.
const float DIST_CONTACTO = 12.0;
const unsigned long PERDIDO_CONTACTO_MS = 500;

// Throttle del sonar. El guard de ECHO ya evita disparar durante los
// ~38 ms que el modulo queda ocupado tras un eco perdido, asi que en
// campo abierto el costo ya estaba acotado. Donde pesa es PERSIGUIENDO:
// con el rival a 30 cm el eco vuelve en ~1.7 ms, ECHO baja, y se
// disparaba de nuevo en la vuelta siguiente, dejando el ciclo en ~2.6 ms
// contra ~0.9 ms sin sonar. Con 20 ms de por medio (nadie recorre 100 cm
// en ese lapso) el control de rumbo y la lectura de borde corren ~3x mas
// seguido justo cuando se va a fondo contra la linea.
const unsigned long INTERVALO_SONAR_MS = 20;

const float VEL_ATAQUE   = 1.0;   // Maxima potencia en contacto
const float VEL_TRACKING = 0.80;  // Avance directo hacia el rival (40-100cm)
const float VEL_BUSQUEDA = 0.75;  // Giro de busqueda

// Impulso de arranque: al salir de 0 con una velocidad menor a VEL_IMPULSO,
// se aplica un instante a maxima potencia para vencer la friccion estatica.
// Si algun movimiento sigue sin arrancar, sube TIEMPO_IMPULSO_MS.
const float VEL_IMPULSO = 1.0;
const unsigned long TIEMPO_IMPULSO_MS = 70;

// ────────────────────────────────────────────
//  CALIBRACION IR
//  FACTOR_UMBRAL: 0.50 = punto medio entre negro y blanco. Mas alto =
//  el umbral se corre hacia el negro y el sensor marca blanco mas
//  facil (mas sensible al borde, mas bordes fantasma posibles).
//  SEPARACION_MINIMA_IR: si negro y blanco quedan mas cerca que esto,
//  el sensor no esta discriminando (IO34 es sospechoso en este kit).
// ────────────────────────────────────────────
// Medido 2026-09-20: el blanco lee 35-70 en tres sensores (y ~1160 en el
// frontal izquierdo, degradado) contra 2000-3500 el negro. Con 0.60 el
// umbral quedaba a 500 cuentas del negro y las vibraciones lo cruzaban
// (escapes fantasma). Con 0.45 sobra margen hacia los dos lados.
const int   MUESTRAS_CALIBRACION = 12;
const float FACTOR_UMBRAL[4] = {0.45, 0.45, 0.45, 0.45};  // [FrontIzq, FrontDer, TrasIzq, TrasDer]
const int   SEPARACION_MINIMA_IR = 150;

// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (reglamento: 3 combates con
//  disposicion distinta: frente a frente, lado a lado en direcciones
//  opuestas, y espalda con espalda). Con giroscopio el giro es por
//  angulo real; estos tiempos son solo el respaldo si el sensor no
//  responde. Valores derivados de la medicion del companero sobre el
//  mismo kit (360 grados = 2900 ms a fondo).
// ────────────────────────────────────────────
// Medido con giroscopio el 2026-09-20: 90 grados a fondo = 400-560 ms en
// este robot. Los 725 del companero eran largos: el respaldo giraba ~110
// por cada 68 pedidos.
const unsigned long TIEMPO_GIRO_90_MS  = 500;
const unsigned long TIEMPO_GIRO_180_MS = 1000;
int ronda = 1;

// ────────────────────────────────────────────
//  ANTI-BUCLE: si dispara ESCAPES_ANTIBUCLE escapes dentro de
//  VENTANA_ANTIBUCLE_MS, esta oscilando en la linea blanca. Invierte
//  el sentido de giro y lo agranda para romper el patron.
// ────────────────────────────────────────────
const unsigned long VENTANA_ANTIBUCLE_MS = 3000;
const int ESCAPES_ANTIBUCLE = 3;
const float EXTRA_GIRO_ANTIBUCLE = 45.0;
unsigned long tiemposEscape[ESCAPES_ANTIBUCLE] = {0, 0, 0};
int idxEscape = 0;

// ────────────────────────────────────────────
//  EMPUJE FRONTAL PERDIDO -> soltar y flanquear
// ────────────────────────────────────────────
const unsigned long EMPUJE_MAX_MS = 4000;        // en ataque sin resolverse mas de esto: soltar
const float ANGULO_FLANQUEO = 60.0;
const unsigned long RETROCESO_FLANQUEO_MS = 200;
const unsigned long AVANCE_FLANQUEO_MS = 250;

// ────────────────────────────────────────────
//  GOLPE / EMPUJE LATERAL fuera de ataque -> escapar hacia adelante
// ────────────────────────────────────────────
const unsigned long ESCAPE_ADELANTE_MS = 350;

// ────────────────────────────────────────────
//  ESTADO DE COMBATE
// ────────────────────────────────────────────
bool girarIzquierda = false;  // ultimo sentido de giro elegido (busqueda / escapes)
bool buscando = false;
unsigned long tUltimaDeteccion = 0;
unsigned long tInicioEmpuje = 0;   // desde cuando esta en ATAQUE sin resolverse

float rumboRival = 0;              // rumbo (grados, marco del giroscopio) donde se vio al rival
bool  rumboRivalValido = false;
unsigned long tRumboRival = 0;
const unsigned long RUMBO_RIVAL_VIGENCIA_MS = 3000;

// ────────────────────────────────────────────
//  ESTADO DE MOTORES
//  ultimaIzq/Der: lo ultimo APLICADO a las ruedas (con correccion).
//  ordenIzq/Der: lo ultimo ORDENADO por la logica (sin correccion).
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
//  AVANCE RECTO CON CORRECCION POR GIROSCOPIO
//  Medido 2026-09-20: a fondo y "recto" el robot curva solo a 15-30
//  grados/s (motor izquierdo mas fuerte). avanzarRecto() corrige con
//  un P+I sobre la velocidad angular: rota a la izquierda -> acelera
//  la rueda izquierda y frena la derecha. El integral absorbe el
//  desbalance constante; el tope evita que se desboque si el rival
//  nos rota. Sin giroscopio o sin signo aprendido, no corrige.
// ────────────────────────────────────────────
// Medido 2026-09-20 (corrida 8): con Kp 0.015 la correccion saturaba con
// 20 grados/s, y el giroscopio manejando tiene +/-10-20 de ruido por
// vibracion: |corr| medio 0.15 para un sesgo real de 0.05-0.10. Por eso
// el P es chico y va filtrado; el sesgo constante lo lleva el integral.
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

float signo(float v) {
  return (v > 0) ? 1.0 : ((v < 0) ? -1.0 : 0.0);
}

// Impulso anti-stiction NO bloqueante: cuando una rueda arranca desde
// parado con velocidad baja, abre una ventana de TIEMPO_IMPULSO_MS
// durante la cual se aplica potencia maxima. Como no hay delay(), el
// loop() sigue leyendo sensores mientras tanto. Para que la ventana
// se cierre a tiempo, cualquier movimiento sostenido debe volver a
// llamar a motores()/avanzarRecto() — moverVigilando() y
// girarGradosGiro() lo hacen.
//
// aplicarMotores() es la capa cruda (impulso + PWM). motores() es la
// orden directa: pivotes, curvas y parada. Para ir recto se usa
// avanzarRecto() (en giroscopio_control.ino), que corrige el rumbo.
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
//  TELEMETRIA: una linea por evento, y una periodica de estado.
//  Con TELEMETRIA en 0 las dos funciones quedan vacias y el
//  compilador las elimina: cero costo en competencia.
// ────────────────────────────────────────────
// evento() es un MACRO, no una funcion, a proposito: los argumentos de
// una funcion se construyen en el llamador aunque el cuerpo este vacio,
// asi que con TELEMETRIA en 0 se seguian armando los String de cada
// llamada ("GIRO", "GOLPE", "ESCAPE"...). El de GOLPE vive dentro de
// leerIMU(), o sea en cada vuelta del loop. Como macro, con TELEMETRIA
// en 0 la llamada entera desaparece antes de compilar.
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
//  LEER ULTRASONICO
//  Un disparo. Devuelve -1 si no hubo eco dentro de ~100cm.
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

// Tras un eco perdido el modulo mantiene ECHO en HIGH ~38 ms y
// ignora el TRIG. Disparar en ese lapso solo gasta los 6 ms del
// timeout. Asi que: si ECHO esta alto, no se dispara y se usa la
// ultima distancia valida (si es reciente).
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
//  LEER BORDE (IR)
//  Primera lectura de los 4; solo si alguno marca borde se hace la
//  segunda lectura de confirmacion (anti-ruido). En el caso normal —
//  sin borde— cuesta 4 analogRead en vez de 8. La direccion de
//  deteccion (blancoEsMenor) sale sola de la calibracion.
//
//  Resultados, por prioridad:
//    FRENTE            los dos frontales        -> retroceder y girar
//    ATRAS             los dos traseros         -> avanzar
//    EMPUJE_DERECHA    frontal y trasero der.   -> nos empujan de lado
//    EMPUJE_IZQUIERDA  frontal y trasero izq.
//    FRENTE_IZQ / FRENTE_DER   un frontal       -> retroceder y girar
//    ATRAS_IZQ  / ATRAS_DER    un trasero       -> avanzar y girar
//
//  Estan separadas en dos: actualizarBorde() solo refresca bordeDet[] y
//  dice si hay borde; leerBorde() ademas arma el texto para el resto del
//  codigo. Asi el camino caliente (el while de moverVigilando) no pasa
//  por la clasificacion.
//
//  NO esperar de esto una ganancia de rendimiento: el ESP32 tiene small
//  string optimization con capacidad 14 (SSOSIZE = sizeof(_ptr)+4-1),
//  asi que siete de los ocho textos y el "" del caso normal viven en la
//  pila, sin tocar el heap. El unico que asigna es "EMPUJE_IZQUIERDA"
//  (16 caracteres), que es de los casos mas raros. Se deja separado
//  porque es mas claro, no porque arregle nada.
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
//  MOVIMIENTO VIGILADO
//  Reemplaza a "motores() + delay()": mueve durante 'ms' pero sigue
//  leyendo los IR (y el IMU) en cada vuelta. Aborta y devuelve true
//  si un sensor del lado hacia el que se mueve PASA de negro a blanco
//  durante el movimiento. Lo que ya estaba en blanco al arrancar no
//  cuenta: si no, en la linea el robot nunca se trasladaria, solo
//  pivotearia (visto el 2026-09-20 en modo sin giroscopio). Vuelve a
//  llamar a motores() en cada vuelta para que la ventana del impulso
//  se cierre.
// ────────────────────────────────────────────
bool moverVigilando(float izq, float der, unsigned long ms, int vigilar) {
  actualizarBorde();
  bool yaBlanco[4];
  for (int i = 0; i < 4; i++) yaBlanco[i] = bordeDet[i];

  unsigned long t0 = millis();
  while (millis() - t0 < ms) {
    if (izq == der) avanzarRecto(izq); else motores(izq, der);
    leerIMU();
    // Con telemetria encendida se usa leerBorde() para que la columna
    // "borde" del CSV no quede vieja durante las maniobras — es una de
    // las columnas con las que se diagnostica.
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

// Gira 'grados' (positivo = izquierda) por giroscopio; si no hay
// sensor, por tiempo proporcional a TIEMPO_GIRO_90_MS.
void girarConFallback(float grados) {
  if (giroListo) {
    girarGradosGiro(grados, VEL_ATAQUE, false);
    return;
  }
  float s = signo(grados);
  unsigned long ms = (unsigned long)(TIEMPO_GIRO_90_MS * fabs(grados) / 90.0);
  // Mismo criterio que girarGradosGiro: un pivote no tiene "lado hacia
  // el que va", asi que se vigilan los cuatro sensores.
  moverVigilando(VEL_ATAQUE * s, -VEL_ATAQUE * s, ms, VIGILAR_CUALQUIERA);
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

// Elige hacia donde girar: hacia el rumbo donde se vio al rival por
// ultima vez si se conoce (y es reciente, y ya se aprendio el signo
// del giroscopio); si no, alternando como siempre. Deja el resultado
// en girarIzquierda para que el resto del codigo lo comparta.
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
    if (separacion < SEPARACION_MINIMA_IR) Serial.print("  <-- DEBIL: revisar sensor/cable");
    Serial.println();
  }
  Serial.println("------------------------------");

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

  while (botonPresionado()) { }
  while (!botonPresionado()) { }
  while (botonPresionado()) { }

  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (una sola vez, antes de entrar al loop)
//  Con giroscopio: angulo real, desacelerando al final para no
//  pasarse. Sin giroscopio: por tiempo, como antes.
//  La direccion de la ronda 2 sigue siendo una suposicion: si el juez
//  pone al rival del otro lado, la busqueda normal lo encuentra igual.
// ────────────────────────────────────────────
void giroInicial() {
  if (ronda == 1) return;  // frente a frente: ya queda mirando al rival

  setPixelColor(255, 255, 0);
#if TELEMETRIA
  unsigned long t0 = millis();  // solo lo usa el evento de abajo
#endif
  float grados = (ronda == 2) ? 90.0 : 180.0;

  if (giroListo) {
    girarGradosGiro(-grados, VEL_ATAQUE, true);  // negativo: mismo sentido que el codigo original
  } else {
    unsigned long ms = (ronda == 2) ? TIEMPO_GIRO_90_MS : TIEMPO_GIRO_180_MS;
    moverVigilando(-VEL_ATAQUE, VEL_ATAQUE, ms, VIGILAR_CUALQUIERA);
    detener();
  }

  evento("GIRO_INICIAL", String(ronda) + ";" + String(millis() - t0));
  setPixelColor(0, 0, 0);
}

// ────────────────────────────────────────────
//  COMPORTAMIENTO OFENSIVO / BUSQUEDA
//  Sin barrido: avance directo. En ataque vigila si nos estan rotando
//  (empuje perdido) o si el empuje se eterniza. Al perder al rival,
//  busca hacia donde se lo vio por ultima vez.
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
      if (tInicioEmpuje == 0) tInicioEmpuje = ahora;
      if (rotacionForzada()) { reaccionPerdiendoEmpuje("rotado"); return; }
      if (ahora - tInicioEmpuje > EMPUJE_MAX_MS) { reaccionPerdiendoEmpuje("tiempo"); return; }

      estadoTel = "ATAQUE";
      setPixelColor(255, 0, 0);
      avanzarRecto(-VEL_ATAQUE);
    } else {
      tInicioEmpuje = 0;
      estadoTel = "TRACK";
      setPixelColor(255, 165, 0);
      avanzarRecto(-VEL_TRACKING);
    }

  } else {
    tInicioEmpuje = 0;

    unsigned long esperaPerdido = (ultimaDistValida < DIST_CONTACTO) ? PERDIDO_CONTACTO_MS : PERDIDO_TRAS_MS;
    if (!buscando && ahora - tUltimaDeteccion > esperaPerdido) {
      buscando = true;
      elegirSentidoGiro();
      evento("PERDIDO", girarIzquierda ? "busca_izq" : "busca_der");
    }

    if (buscando) {
      estadoTel = "BUSCA";
      setPixelColor(0, 0, 255);
      motores(girarIzquierda ? VEL_BUSQUEDA : -VEL_BUSQUEDA,
              girarIzquierda ? -VEL_BUSQUEDA : VEL_BUSQUEDA);
    } else {
      estadoTel = "AVANCE";
      setPixelColor(255, 165, 0);
      avanzarRecto(-VEL_TRACKING);
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

#if TELEMETRIA
  Serial.println();
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
