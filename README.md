# 🥋 Sumo Bot "Mussolini" — 2026 LLCC

Documentación cronológica del desarrollo de **Mussolini**, mi robot de sumo, rumbo a la competencia en **Guanacaste (2026)**.

![Sumo Bot](Sumo%20Bot.jpeg)

---

## 📌 Sobre el proyecto

Este repositorio funciona como bitácora del proceso: pruebas, diagnósticos, código y avances de construcción del bot, desde los primeros experimentos hasta la versión final de competencia.

- **Competencia:** Sumobot — Universidad CENFOTEC ([reglamento oficial](https://github.com/Universidad-Cenfotec/Sumobot/blob/main/reglas%20de%20competencia.md))
- **Evento objetivo:** Guanacaste, 2026
- **Kit base:** Sumobot CENFOTEC 2025 (chasis PCB + IdeaBoard ESP32)
- **Plataformas usadas:** Arduino/C++ para el firmware de combate, y MicroPython vía Thonny para los diagnósticos de sensores y motores

El robot debe pesar **menos de 315 g** con baterías, usar **exactamente 4 pilas AA**, y no se le puede modificar el chasis, los motores ni las ruedas del kit oficial. Sí se permite modificar el código libremente y agregar sensores dentro del peso.

---

## ⚙️ Firmware en uso

👉 **[`code2026_Arduino/sumo_arduino/`](code2026_Arduino/sumo_arduino)** — esta es la versión que corre hoy en el robot.

Son **dos archivos `.ino` en la misma carpeta**, que el IDE de Arduino compila como un solo sketch compartiendo funciones y variables:

| Archivo | Rol |
|---|---|
| `sumo_arduino.ino` | motores, sensores, calibración, lógica de combate |
| `giroscopio_control.ino` | módulo IMU: giro por ángulo real, detección de levantamiento, escape preciso |

El módulo del giroscopio **degrada en vez de fallar**: si no encuentra el sensor al arrancar, todas sus funciones caen al comportamiento por tiempo y el robot sigue combatiendo igual.

Las carpetas restantes son historia del proceso, no el código activo.

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

### Pines

| Función | Pin |
|---|---|
| Ultrasónico TRIG / ECHO | 25 / 26 |
| IR frontal izq / der | 36 / 39 |
| IR trasero izq / der | 34 / 35 |
| Motor 1 IN1 / IN2 | 12 / 14 |
| Motor 2 IN1 / IN2 | 13 / 15 |
| Botón BOOT | 0 |
| NeoPixel | 2 |
| IMU | I2C `0x6B` |

> ⚠️ Tanto el ultrasónico como los motores necesitan el **jumper entre SELECT y Vin** puesto en el shield. Si los motores no se mueven o el sonar siempre da fuera de rango, revisar eso antes que el código.

---

## 🧠 Estrategia y lógica del bot

### Prioridades del ciclo principal

```
1. ¿Me están levantando?  → retroceder y reposicionar
2. ¿Veo el borde blanco?  → maniobra de escape
3. Si no                  → buscar y atacar
```

El borde siempre gana sobre el ataque: salirse solo es derrota inmediata según el reglamento.

### Detección del rival

Ultrasónico frontal con timeout ajustado a ~100 cm. Todo lo que esté más lejos se ignora.

| Distancia | Comportamiento | LED |
|---|---|---|
| < 40 cm | ataque a potencia máxima | 🔴 rojo |
| 40–100 cm | avance directo | 🟠 naranja |
| sin detección (tras 4 lecturas) | giro de búsqueda, alternando lado | 🔵 azul |

### Detección del borde

Los 4 IR se calibran al arrancar sobre negro y sobre blanco; el umbral y la polaridad de cada sensor se deducen solos, así que funciona sin importar cómo se comporte cada sensor. Cada lectura se hace **dos veces** como filtro anti-ruido.

La combinación de sensores que se activa define la maniobra: los dos frontales significan borde de frente; dos del mismo lado se interpretan como que el rival está **empujando lateralmente**, y tienen su propio escape.

### Rondas

El reglamento marca una disposición inicial distinta en cada uno de los 3 combates: frente a frente, lado a lado en direcciones opuestas, y espalda con espalda. Antes de arrancar se elige la ronda pulsando BOOT 1, 2 o 3 veces, y el robot ejecuta el giro inicial correspondiente.

### Detalles que salieron de pruebas reales

- **PWM a 20 kHz.** Con la frecuencia por defecto de `analogWrite()` los motores chillaban en cada cambio de acción, porque cae dentro del rango audible.
- **Impulso de arranque.** El robot se congelaba al detectar el borde: era fricción estática, el motor recibía la orden pero no arrancaba desde parado a velocidad baja. Ahora cada arranque desde 0 recibe un impulso breve a potencia máxima.
- **Motores invertidos.** Los de este robot están físicamente al revés; se corrige con un solo `#define INVERTIR_MOTORES`, sin tocar el resto del código.
- **Sin barrido lateral.** La versión anterior giraba para localizar al rival y perdía ~250 ms por ciclo. Se eliminó.

---

## 🚀 Cómo compilar y subir

**Firmware (Arduino IDE):**

1. Instalar el soporte de placas **ESP32 (core 3.x)** desde el Boards Manager.
2. Instalar las librerías **Adafruit NeoPixel** y **Adafruit LSM6DS** desde el Library Manager.
3. Abrir `code2026_Arduino/sumo_arduino/sumo_arduino.ino`. Las dos pestañas se cargan solas.
4. Seleccionar la placa ESP32 y el puerto, y subir.
5. Abrir el Monitor Serie a **115200** baudios para ver la calibración y el diagnóstico.

**Secuencia de arranque en el robot:**

1. 🔴 Poner los sensores sobre **negro** → BOOT
2. ⚪ Poner los sensores sobre **blanco** → BOOT
3. 🟢 BOOT para confirmar
4. 🔵 Elegir ronda: BOOT 1, 2 o 3 veces
5. ⚪ Colocar el robot en el dojo → BOOT para iniciar el combate

**Diagnósticos (Thonny / MicroPython):** abrir los archivos de `Diagnósticos en Thonny Python/` directamente con Thonny.

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
│   ├── Arduino code 1
│   ├── code 2 .INO
│   ├── Code3:INO+Diagnostico
│   └── extención de codigo
├── Codigos base del 20206/           ← códigos base y variantes generadas con IA
│   ├── Base de código_ sencillo
│   ├── Code idea 1 de combate_hit_and_run
│   ├── code1 / Code2 / code 3_AI_Gemini_revisado por Claude
│   └── NOTAS.md
├── Diagnósticos en Arduino/
│   ├── Diagnostico de infrarrojos.INO
│   └── Diagnostico del giroscopio    ← con este se confirmó el eje Z de la IMU
└── Diagnósticos en Thonny Python/
    ├── Borde blanco DG
    ├── Motores DG
    ├── Ultrasónicos DG
    └── sensores infrarrojos DG
```

> ⚠️ El archivo `code2026_Arduino/Code3:INO+Diagnostico` tiene dos puntos en el nombre, que es un carácter **inválido en Windows**. Un `git clone` de este repo falla en el checkout desde Windows hasta que se renombre.

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

---

## 👤 Autor

Juan D. Gutiérrez Sánchez

## 📄 Licencia

Este proyecto se comparte con fines educativos y de documentación personal. *(Podés cambiar esto por una licencia como MIT si querés que otros reutilicen el código libremente.)*
