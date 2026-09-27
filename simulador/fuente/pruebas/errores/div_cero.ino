int d = 0;
void setup() {
  Serial.begin(115200);
}
void loop() {
  delay(100);
  Serial.println(10 / d);
}
