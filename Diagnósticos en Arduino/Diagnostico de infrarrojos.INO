/*
  DIAGNOSTICO DE SENSORES IR - Sumobot
  Universidad Cenfotec

  Este sketch NO controla motores ni hace calibracion. Solo imprime
  en el Monitor Serie los valores crudos (analogRead) de los 4
  sensores IR, varias veces por segundo, para ver exactamente que
  numero da cada sensor sobre negro y sobre blanco.

  COMO USARLO:
    1. Sube este sketch (reemplaza temporalmente el del combate).
    2. Abre el Monitor Serie (Herramientas -> Monitor Serie), a 115200 baudios.
    3. Pon el robot sobre la zona NEGRA del dojo y anota los 4 numeros.
    4. Pon el robot sobre la LINEA/BORDE BLANCO y anota los 4 numeros.
    5. Repite un par de veces por sensor para ver si son consistentes.
    6. Pasame esos numeros (los de negro y los de blanco, por cada sensor).
*/

#define PIN_SEN1 36  // Frontal Izquierdo
#define PIN_SEN2 39  // Frontal Derecho
#define PIN_SEN3 34  // Trasero Izquierdo
#define PIN_SEN4 35  // Trasero Derecho

const int pinesIr[4] = {PIN_SEN1, PIN_SEN2, PIN_SEN3, PIN_SEN4};
const char* nombres[4] = {"SEN1 (Frontal Izq)", "SEN2 (Frontal Der)", "SEN3 (Trasero Izq)", "SEN4 (Trasero Der)"};

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== DIAGNOSTICO DE SENSORES IR ===");
  Serial.println("Mueve el robot entre la zona negra y el borde blanco.");
  Serial.println();
}

void loop() {
  for (int i = 0; i < 4; i++) {
    int valor = analogRead(pinesIr[i]);
    Serial.print(nombres[i]);
    Serial.print(": ");
    Serial.print(valor);
    Serial.print("    ");
  }
  Serial.println();

  delay(200);  // ~5 lecturas por segundo, facil de leer
}
