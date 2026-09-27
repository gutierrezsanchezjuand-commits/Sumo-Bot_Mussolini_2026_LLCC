// Ejemplo: giros exactos con el giroscopio (IMU LSM6DS3TRC del kit)
//
// Al apretar BOOT el robot gira 90 grados a la izquierda midiendo con el
// giroscopio, frena y muestra cuanto giro de verdad. Sirve para ver en el
// simulador (y en el robot) como se integra la velocidad angular y por que
// hay que restar el desvio (drift) medido en reposo.
//
// Requiere "Adafruit LSM6DS" y "Adafruit NeoPixel" (Library Manager del IDE).
// El IMU del kit esta en la direccion I2C 0x6B.

#include <Wire.h>
#include <Adafruit_LSM6DS3TRC.h>

#define MOTOR_IZQ_IN1 12
#define MOTOR_IZQ_IN2 14
#define MOTOR_DER_IN1 13
#define MOTOR_DER_IN2 15
#define PIN_BOOT 0

Adafruit_LSM6DS3TRC imu;
float drift = 0;            // rad/s que el giroscopio marca quieto

void motores(float izq, float der) {
  int pi = (int)(fabs(izq) * 255), pd = (int)(fabs(der) * 255);
  ledcWrite(MOTOR_IZQ_IN1, izq > 0 ? pi : 0); ledcWrite(MOTOR_IZQ_IN2, izq < 0 ? pi : 0);
  ledcWrite(MOTOR_DER_IN1, der > 0 ? pd : 0); ledcWrite(MOTOR_DER_IN2, der < 0 ? pd : 0);
}

float leerGiroZ() {         // rad/s, positivo = gira a la izquierda
  sensors_event_t a, g, t;
  imu.getEvent(&a, &g, &t);
  return g.gyro.z - drift;
}

void calibrarDrift() {
  Serial.println("Midiendo el drift con el robot quieto...");
  float suma = 0;
  for (int i = 0; i < 200; i++) {
    sensors_event_t a, g, t;
    imu.getEvent(&a, &g, &t);
    suma += g.gyro.z;
    delay(5);
  }
  drift = suma / 200;
  Serial.print("Drift: "); Serial.print(drift * 180 / PI, 3); Serial.println(" grados/s");
}

// Gira hasta acumular 'grados' (con el signo: + izquierda, - derecha).
void girar(float grados) {
  float objetivo = fabs(grados), acumulado = 0;
  int s = grados > 0 ? 1 : -1;
  unsigned long antes = micros(), inicio = millis();
  motores(-0.8 * s, 0.8 * s);
  while (acumulado < objetivo - 3 && millis() - inicio < 3000) {   // 3 grados de margen para la inercia
    unsigned long ahora = micros();
    float dt = (ahora - antes) / 1e6;
    antes = ahora;
    acumulado += fabs(leerGiroZ()) * 180 / PI * dt;
    delay(2);
  }
  motores(0, 0);
  delay(300);                                   // deja que se detenga
  Serial.printf("Pedido %.0f, medido %.1f grados en %lu ms\n", grados, acumulado, millis() - inicio);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  ledcAttach(MOTOR_IZQ_IN1, 20000, 8); ledcAttach(MOTOR_IZQ_IN2, 20000, 8);
  ledcAttach(MOTOR_DER_IN1, 20000, 8); ledcAttach(MOTOR_DER_IN2, 20000, 8);
  motores(0, 0);
  Wire.begin();
  if (!imu.begin_I2C(0x6B)) {
    Serial.println("No se encontro el IMU en 0x6B");
    while (true) delay(100);
  }
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setGyroDataRate(LSM6DS_RATE_416_HZ);
  imu.setAccelDataRate(LSM6DS_RATE_416_HZ);
  calibrarDrift();
}

void loop() {
  Serial.println("Presiona BOOT para girar 90 grados a la izquierda");
  while (digitalRead(PIN_BOOT) == HIGH) delay(5);
  while (digitalRead(PIN_BOOT) == LOW) delay(5);
  girar(90);
}
