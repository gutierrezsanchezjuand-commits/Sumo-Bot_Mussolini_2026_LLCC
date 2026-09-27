# Documentación técnica

Notas del desarrollo de Mussolini, escritas mientras se construía y se probaba el robot. Están
fechadas: cuando algo cambió, la nota dice qué había antes y por qué se cambió.

**Para entender el firmware, en este orden:**

1. [Hardware](hardware.md) — la placa, los sensores, los pines y lo que se midió de cada uno.
2. [Arquitectura del firmware](firmware-arquitectura.md) — cómo está armado el código de
   `code2026_Arduino/sumo_arduino/`: `setup()`, el `loop()` y sus prioridades, los motores, el
   borde, el sonar, el ataque y el módulo del IMU.
3. [Control por giroscopio](giroscopio.md) — giros por ángulo, avance recto corregido,
   levantamiento, golpes y empujes laterales.
4. [Decisiones](decisiones.md) — qué se eligió en cada punto discutible y qué se descartó.

**Para ajustarlo y probarlo:**

- [Parámetros a calibrar](parametros.md) — cada constante del código, qué hace y cuánto vale hoy.
- [Protocolo de pruebas](protocolo-de-pruebas.md) — las pruebas en el dojo, paso por paso, con
  lo que se espera ver en cada una.
- [Telemetría](telemetria.md) — las líneas `T,…` y `E,…` que imprime el firmware con
  `TELEMETRIA 1` y cómo leerlas.
- [Simulador](../simulador/README.md) — probar cualquier programa del kit sin el robot.

**Contexto:**

- [Reglamento](reglamento.md) — resumen de las reglas de la competencia que afectan al código.
- [Historia del código](historia-del-codigo.md) — de dónde viene cada versión del repositorio.
