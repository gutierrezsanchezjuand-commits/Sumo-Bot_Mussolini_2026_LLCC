/*
  DIAGNOSTICO DE GIROSCOPIO (LSM6DS3TRC) - Sumobot
  Escuela de Sistemas Inteligentes - Universidad Cenfotec

  Sketch de SOLO LECTURA: no mueve motores, no toca sumo_arduino.ino.
  Se sube aparte (temporalmente), igual que "Diagnostico de infrarrojos.INO".

  Objetivo, en este orden:
    1) Confirmar que el LSM6DS3TRC responde en el bus I2C (conector Qwiic).
    2) Confirmar EMPIRICAMENTE cual eje (X, Y o Z) es el que se mueve
       cuando el robot gira sobre la mesa en su propio plano. En el
       codigo base del repo (codigos_de_ejemplo/code_PDI.py) ese eje es
       el Z (gyro[2]) - lo normal si el sensor va montado plano sobre
       el shield, pero conviene comprobarlo en el robot real antes de
       confiar en el.
    3) Medir el drift (offset en reposo) de cada eje.

  Requiere instalar, por el Library Manager del Arduino IDE:
    "Adafruit LSM6DS"  (instala tambien Adafruit BusIO y Adafruit Unified
    Sensor, que son dependencias suyas - acepta instalarlas si el IDE
    las ofrece).

  Conexion: el sensor va al puerto Qwiic/I2C del shield.
  Pines I2C por defecto del ESP32 en Arduino: SDA=IO21, SCL=IO22.
  Si el escaneo de abajo no encuentra nada, revisa ese cable primero.
*/

#include <Wire.h>
#include <Adafruit_LSM6DS3TRC.h>

Adafruit_LSM6DS3TRC lsm;

const float RAD_A_GRADOS = 180.0 / PI;

void escanearI2C() {
  Serial.println("--- Escaneo I2C ---");
  int encontrados = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("  Dispositivo en 0x");
      Serial.println(addr, HEX);
      encontrados++;
    }
  }
  if (encontrados == 0) {
    Serial.println("  Nada encontrado. Revisa el cable Qwiic / alimentacion.");
  }
  Serial.println("-------------------");
}

void setup() {
  Serial.begin(115200);
  delay(800);

  Wire.begin();  // SDA=21, SCL=22 por defecto en ESP32
  escanearI2C();

  Serial.println("Buscando LSM6DS3TRC en 0x6B...");
  if (!lsm.begin_I2C(0x6B)) {
    Serial.println("NO se encontro en 0x6B.");
    Serial.println("Revisa el escaneo de arriba: si aparecio otra direccion");
    Serial.println("(por ejemplo 0x6A), cambia el 0x6B de este archivo por esa.");
    while (1) delay(10);
  }
  Serial.println("LSM6DS3TRC encontrado.");

  Serial.print("Rango de giroscopio: ");
  switch (lsm.getGyroRange()) {
    case LSM6DS_GYRO_RANGE_125_DPS:  Serial.println("125 grados/s"); break;
    case LSM6DS_GYRO_RANGE_250_DPS:  Serial.println("250 grados/s"); break;
    case LSM6DS_GYRO_RANGE_500_DPS:  Serial.println("500 grados/s"); break;
    case LSM6DS_GYRO_RANGE_1000_DPS: Serial.println("1000 grados/s"); break;
    case LSM6DS_GYRO_RANGE_2000_DPS: Serial.println("2000 grados/s (default de la libreria, alcanza de sobra)"); break;
    default: Serial.println("otro"); break;
  }

  Serial.println();
  Serial.println("Deja el robot QUIETO sobre la mesa 5 segundos (midiendo drift)...");
  delay(1000);

  float sumaX = 0, sumaY = 0, sumaZ = 0;
  int n = 0;
  unsigned long t0 = millis();
  while (millis() - t0 < 5000) {
    sensors_event_t accel, gyro, temp;
    lsm.getEvent(&accel, &gyro, &temp);
    sumaX += gyro.gyro.x;
    sumaY += gyro.gyro.y;
    sumaZ += gyro.gyro.z;
    n++;
    delay(5);
  }
  Serial.print("Drift X: "); Serial.print(sumaX / n, 5); Serial.println(" rad/s");
  Serial.print("Drift Y: "); Serial.print(sumaY / n, 5); Serial.println(" rad/s");
  Serial.print("Drift Z: "); Serial.print(sumaZ / n, 5); Serial.println(" rad/s");

  Serial.println();
  Serial.println("Ahora gira el robot A MANO sobre la mesa (como si buscara al");
  Serial.println("rival, girando sobre su propio eje vertical) y mira cual de");
  Serial.println("los 3 valores de abajo se mueve fuerte. Ese es tu eje real de giro.");
  Serial.println();
}

void loop() {
  sensors_event_t accel, gyro, temp;
  lsm.getEvent(&accel, &gyro, &temp);

  float gx = gyro.gyro.x * RAD_A_GRADOS;
  float gy = gyro.gyro.y * RAD_A_GRADOS;
  float gz = gyro.gyro.z * RAD_A_GRADOS;

  Serial.print("Gyro grados/s  X:"); Serial.print(gx, 1);
  Serial.print("  Y:"); Serial.print(gy, 1);
  Serial.print("  Z:"); Serial.print(gz, 1);

  Serial.print("   |   Accel g  X:"); Serial.print(accel.acceleration.x / 9.81, 2);
  Serial.print("  Y:"); Serial.print(accel.acceleration.y / 9.81, 2);
  Serial.print("  Z:"); Serial.println(accel.acceleration.z / 9.81, 2);

  delay(100);
}
