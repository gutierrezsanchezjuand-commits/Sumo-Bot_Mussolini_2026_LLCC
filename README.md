# 🥋 Sumo Bot "Mussolini" — 2026 LLCC

Documentación del desarrollo de **Mussolini**, mi robot de sumo, rumbo a la competencia en
**Guanacaste (2026)**: el firmware que corre hoy, las versiones anteriores, los diagnósticos, la
documentación técnica y un **simulador** que corre cualquier programa del kit.

![Sumo Bot](Sumo%20Bot.jpeg)

---

## 🧭 Por dónde empezar

| Si querés… | andá a |
|---|---|
| ver el código que corre hoy en el robot | [`code2026_Arduino/sumo_arduino/`](code2026_Arduino/sumo_arduino) |
| entender cómo está armado ese código | [`docs/`](docs) — empezá por [Arquitectura del firmware](docs/firmware-arquitectura.md) |
| probar tu propio código sin el robot | [`simulador/`](simulador) — un solo HTML, se abre con doble clic |
| ver de dónde salió cada versión | [Historia del código](docs/historia-del-codigo.md) y la [bitácora](#️-bitácora) |

---

## 📌 Sobre el proyecto

- **Competencia:** Sumobot — Universidad CENFOTEC ([reglamento oficial](https://github.com/Universidad-Cenfotec/Sumobot/blob/main/reglas%20de%20competencia.md), resumen en [docs/reglamento.md](docs/reglamento.md))
- **Evento objetivo:** Guanacaste, 2026
- **Kit base:** Sumobot CENFOTEC 2025 (chasis PCB + IdeaBoard ESP32)
- **Plataformas:** Arduino/C++ para el firmware de combate; CircuitPython (Thonny) para los primeros códigos y los diagnósticos

El robot debe pesar **menos de 315 g** con baterías, usar **exactamente 4 pilas AA**, y no se le
puede modificar el chasis, los motores ni las ruedas del kit oficial. Sí se permite modificar el
código libremente y agregar sensores dentro del peso.

---

## ⚙️ Firmware en uso

👉 **[`code2026_Arduino/sumo_arduino/`](code2026_Arduino/sumo_arduino)** — la versión que corre hoy en el robot (26-09-2026).

Son **dos archivos `.ino` en la misma carpeta**, que el IDE de Arduino compila como un solo
sketch compartiendo funciones y variables:

| Archivo | Rol |
|---|---|
| `sumo_arduino.ino` | motores, sensores, calibración, lógica de combate, `setup()` y `loop()` |
| `giroscopio_control.ino` | módulo IMU: giro por ángulo real, avance recto corregido, levantamiento, golpes y empujes laterales, escapes precisos |

El módulo del giroscopio **degrada en vez de fallar**: si no encuentra el sensor al arrancar, todas
sus funciones caen al comportamiento por tiempo y el robot sigue combatiendo igual.

Tres interruptores al principio de `sumo_arduino.ino`: `TELEMETRIA` (0 para competir; 1 imprime
el estado cada 100 ms y cada evento, ver [docs/telemetria.md](docs/telemetria.md)),
`MODO_SIMPLE` (1 apaga las reacciones del IMU, como seguro de torneo) e `INVERTIR_MOTORES`.

Al arrancar imprime `Firmware: <modo>_<hash>`, para saber qué versión exacta tiene el robot.

---

## 🔧 Hardware

- **Microcontrolador:** IdeaBoard (ESP32) — requiere **core de ESP32 3.x**, porque el firmware usa la API `ledcAttach(pin, freq, res)`
- **Chasis:** placa PCB del kit CENFOTEC 2025, con los sensores IR, el acelerómetro y el giroscopio **ya integrados**
- **Sensores de línea:** 4 infrarrojos analógicos (frontal izq/der, trasero izq/der)
- **Sensor de distancia:** ultrasónico HC-SR05 en modo trigger/echo
- **IMU:** LSM6DS3TRC por I2C (`0x6B`), giro sobre el **eje Z**
- **Motores:** 2 × Microgear 200 RPM, puente H con ambos pines por PWM
- **Batería:** 4 × AA
- **Indicador:** NeoPixel de 1 píxel

| Función | Pin |
|---|---|
| Ultrasónico TRIG / ECHO | 25 / 26 |
| IR frontal izq / der | 36 / 39 |
| IR trasero izq / der | 34 / 35 |
| Motor 1 (izquierdo) IN1 / IN2 | 12 / 14 |
| Motor 2 (derecho) IN1 / IN2 | 13 / 15 |
| Botón BOOT | 0 |
| NeoPixel | 2 |
| IMU | I2C `0x6B` |

> ⚠️ Tanto el ultrasónico como los motores necesitan el **jumper entre SELECT y Vin** puesto en el
> shield. Si los motores no se mueven o el sonar siempre da fuera de rango, revisar eso antes que
> el código.

Detalle y mediciones en [docs/hardware.md](docs/hardware.md).

---

## 🧠 Estrategia y lógica del bot

### Prioridades del ciclo principal

```
1. ¿Veo el borde blanco?           → maniobra de escape según qué sensores lo ven
2. ¿Me están levantando?           → retroceder hasta que la base vuelva a apoyar, girar
3. ¿Me empujan de costado o golpean? → escapar hacia adelante
4. Si no                           → buscar, perseguir y atacar
```

El borde siempre gana: salirse es derrota inmediata según el reglamento.

### Rival

| Distancia | Comportamiento | LED |
|---|---|---|
| < 40 cm | ataque a fondo, con el rumbo corregido por el giroscopio | 🔴 rojo |
| 40–100 cm | avance tanteando ±3° de lado a lado para no perderlo del cono del sonar | 🟠 naranja |
| recién perdido | sigue avanzando un momento (el sonar pierde ecos pegado al rival) | 🟠 naranja |
| perdido | busca girando hacia donde lo vio por última vez | 🔵 azul |

Si mientras empuja lo están **rotando** (el giroscopio lo detecta), suelta, retrocede y lo flanquea.

### Borde

Los 4 IR se calibran al arrancar sobre negro y sobre blanco (12 muestras por paso); el umbral y la
polaridad de cada sensor se deducen solos. Un borde se confirma con una segunda lectura. La
combinación de sensores define la maniobra: de frente retrocede 450 ms y gira ~200°; con un solo
sensor frontal, 350 ms y 180°; si los dos del mismo lado ven blanco, lo están empujando de costado.
Los giros de escape se cortan si el sonar ve al rival a menos de 40 cm, para atacarlo en vez de
terminar de huir. Un anti-bucle agranda el giro si escapa 3 veces en 3 s.

### Rondas

El reglamento marca una disposición inicial distinta en cada uno de los 3 combates: frente a
frente, lado a lado en direcciones opuestas, y espalda con espalda. Antes de arrancar se elige la
ronda pulsando BOOT 1, 2 o 3 veces, y el robot ejecuta el giro inicial correspondiente con el
giroscopio.

### Detalles que salieron de pruebas reales

- **PWM a 20 kHz.** Con la frecuencia por defecto los motores chillaban en cada cambio de acción.
- **Impulso de arranque.** A velocidad baja el motor no arranca desde parado (fricción estática):
  cada arranque desde 0 recibe 70 ms a potencia máxima, sin bloquear el programa.
- **Motores invertidos.** Se corrige con un solo `#define INVERTIR_MOTORES`.
- **Avance recto con giroscopio.** Sin corrección el robot deriva 15–30 °/s por la diferencia entre
  motores; un control P+I sobre la velocidad angular lo deja en ±3° empujando.
- **Levantamiento de verdad.** La inclinación se compara con el vector de reposo en 3D y se filtra;
  una lectura suelta después de un giro ya no cuenta como levantamiento.

Las decisiones y lo que se descartó están en [docs/decisiones.md](docs/decisiones.md).

---

## 🎮 Simulador

En [`simulador/`](simulador) hay un simulador del robot del kit que corre **código de Arduino o
de CircuitPython sin cambiarlo**: se carga el `.ino` o el `code.py`, y pelea en el dojo contra una
caja, un rival típico del kit u otro programa. Muestra lo que lee cada sensor, las variables del
programa, el Serial y un informe; y evalúa un programa en las 3 rondas del reglamento. La física
se ajustó contra mediciones de este robot.

**Para usarlo:** descargar [`simulador/simulador.html`](simulador/simulador.html) (botón
*Download raw file*) y abrirlo con doble clic. No hay que instalar nada. Instrucciones completas en
[simulador/README.md](simulador/README.md).

---

## 🚀 Cómo compilar y subir

**Firmware (Arduino IDE):**

1. Instalar el soporte de placas **ESP32 (core 3.x)** desde el Boards Manager.
2. Instalar las librerías **Adafruit NeoPixel** y **Adafruit LSM6DS** desde el Library Manager.
3. Abrir `code2026_Arduino/sumo_arduino/sumo_arduino.ino`. Las dos pestañas se cargan solas.
4. Seleccionar la placa **ESP32 Dev Module** y el puerto, y subir.
5. Abrir el Monitor Serie a **115200** baudios para ver la calibración y el diagnóstico.

**Secuencia de arranque en el robot:**

1. 🔴 Poner los sensores sobre **negro** → BOOT
2. ⚪ Poner los sensores sobre **blanco** → BOOT (imprime la tabla de calibración)
3. 🟢 BOOT para confirmar
4. 🩵 Elegir ronda: BOOT 1, 2 o 3 veces (el LED verde parpadea el número elegido)
5. El robot mide el giroscopio 2 s: dejarlo quieto
6. ⚪ Colocar el robot en el dojo → BOOT para iniciar el combate

**Diagnósticos:** los `.ino` de `Diagnósticos en Arduino/` se suben aparte (no tocan el firmware);
los `.py` de `Diagnósticos en Thonny Python/` se abren con Thonny.

---

## 📂 Estructura del repositorio

```
Sumo-Bot_Mussolini_2026_LLCC/
├── README.md
├── NOTAS.md                          ← v5 en CircuitPython (versión anterior)
├── Sumo Bot.jpeg
├── code2026_Arduino/                 ← línea de desarrollo en Arduino
│   ├── sumo_arduino/                 ← ⭐ FIRMWARE EN USO
│   │   ├── sumo_arduino.ino
│   │   └── giroscopio_control.ino
│   ├── Arduino code 1.ino            ← versiones anteriores
│   ├── code 2.ino
│   ├── Code3_INO+Diagnostico.ino
│   └── extension de codigo.ino
├── Codigos base del 20206/           ← códigos base del kit y variantes (CircuitPython)
├── Diagnósticos en Arduino/          ← IR y giroscopio (con este se confirmó el eje Z)
├── Diagnósticos en Thonny Python/    ← motores, IR, ultrasónico, borde blanco
├── docs/                             ← documentación técnica del firmware
└── simulador/                        ← simulador para cualquier programa del kit
    ├── simulador.html
    ├── README.md
    ├── ejemplos/
    └── fuente/
```

> Los archivos de código tienen su extensión (`.ino`, `.py`) desde el 27-09-2026, para que GitHub
> los muestre con colores. `Code3:INO+Diagnostico` se renombró a `Code3_INO+Diagnostico.ino`: los
> dos puntos no son válidos en Windows y hacían fallar `git clone`.

---

## 🗓️ Bitácora

| Fecha | Avance |
|---|---|
| — | Diagnósticos en Thonny: motores, IR, ultrasónico, borde blanco |
| — | Códigos base y variantes de combate |
| — | v5 en CircuitPython: calibración promediada, histéresis, ráfaga de ataque con verificación (`NOTAS.md`) |
| — | Port a Arduino: PWM a 20 kHz, impulso anti-stiction, motores invertidos |
| — | Diagnóstico del giroscopio: confirmado el eje Z |
| 2026-08-30 | Firmware con giroscopio integrado subido al repo |
| 2026-09-20 | Reescritura: maniobras que vigilan el borde, avance recto por giroscopio, anti-bucle, detección de empujes y golpes, calibración de 12 muestras. Probado en 9 corridas reales |
| 2026-09-25 | Plan de correcciones sobre las capturas del Serial: sin corte por tiempo del ataque, giro trabado, empuje final, `MODO_SIMPLE` |
| 2026-09-26 | Escapes de borde más decididos y cortables por el sonar, tanteo al perseguir, levantamiento que retrocede hasta volver a apoyar |
| 2026-09-27 | Simulador para cualquier programa del kit (Arduino y CircuitPython), documentación técnica en `docs/` |

---

## 👤 Autor

Juan D. Gutiérrez Sánchez

## 📄 Licencia

Este proyecto se comparte con fines educativos y de documentación personal. *(Podés cambiar esto por una licencia como MIT si querés que otros reutilicen el código libremente.)*
