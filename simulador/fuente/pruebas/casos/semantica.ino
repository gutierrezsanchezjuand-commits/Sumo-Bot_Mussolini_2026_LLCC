// Prueba de semantica de C++ de Arduino: cada linea impresa se compara con lo esperado.
#define CUADRADO(x) ((x) * (x))
#define TEXTO_(x) #x
#define TEXTO(x) TEXTO_(x)
#define VERSION 3

struct Punto { int x; float y; };
enum Estado { BUSCA, ATAQUE = 5, BORDE };

int global = 10;
const int N = 4;
int arr[N] = {1, 2};
uint8_t byteVal = 250;
String nombre = "Sumo";

int dividir(int a, int b) { return a / b; }
void duplicar(int &v) { v *= 2; }
float promedio(const int datos[], int n) {
  long suma = 0;
  for (int i = 0; i < n; i++) suma += datos[i];
  return (float)suma / n;
}
int contar() {
  static int veces = 0;
  return ++veces;
}

void setup() {
  Serial.begin(115200);
  Serial.println(7 / 2);
  Serial.println(-7 / 2);
  Serial.println(-7 % 3);
  Serial.println(7.0 / 2);
  Serial.println(7 / 2.0, 3);
  int x = 2.9;
  Serial.println(x);
  byteVal += 10;
  Serial.println(byteVal);
  unsigned long t = 5;
  Serial.println(t - 10);
  Serial.println(CUADRADO(3 + 1));
  Serial.println(TEXTO(VERSION));
  Serial.println(arr[1] + arr[3]);
  Serial.println(sizeof(arr) / sizeof(arr[0]));
  Punto p = {3, 1.5};
  Punto q = p;
  q.x = 9;
  Serial.println(p.x);
  Serial.println(ATAQUE + BORDE);
  int v = 21;
  duplicar(v);
  Serial.println(v);
  Serial.println(promedio(arr, N));
  contar(); contar();
  Serial.println(contar());
  Serial.println(nombre + " " + String(3.14159, 2) + " " + 42);
  Serial.println(nombre.length());
  Serial.println(String(255, HEX));
  Serial.println(255, BIN);
  Serial.print('A');
  Serial.println((char)66);
  char c = 'a' + 2;
  Serial.println(c);
  Serial.println(nombre.substring(1, 3) + nombre.indexOf('m'));
  String s = "  hola ";
  s.trim();
  s.toUpperCase();
  Serial.println(s);
  Serial.printf("%d|%5.2f|%s|%03d|%x\n", 7, 3.14159, "ok", 5, 255);
  Serial.println(map(512, 0, 1023, 0, 255));
  Serial.println(constrain(300, 0, 255));
  Serial.println(min(3, 8) * max(2, 5));
  Serial.println(abs(-4.5));
  bool b = 5;
  Serial.println(b);
  Serial.println(true + true);
  Serial.println(1 << 4 | 1);
  Serial.println(global == 10 ? "diez" : "otro");
  int suma = 0;
  for (int i = 0; i < 10; i++) {
    if (i % 2) continue;
    if (i > 6) break;
    suma += i;
  }
  Serial.println(suma);
  switch (BORDE) {
    case BUSCA: Serial.println("busca"); break;
    case BORDE: Serial.println("borde");
    default: Serial.println("cae");
  }
  Serial.println(2.25, 1);
  Serial.println(dividir(9, 2));
  unsigned long t0 = millis();
  delay(250);
  Serial.println(millis() - t0 >= 250 ? "delay ok" : "delay mal");
  Serial.println("fin");
}

void loop() {
  delay(1000);
}
