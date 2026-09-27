# Hardware

Placa **ESP32**. Se confirma
por los GPIO usados y por `ledcAttach(pin, freq, res)`, que es la firma del core
ESP32 **3.x** — con el core 2.x esa llamada no compila.

> ⚠️ El repo del compañero usa **core 2.x** (`ledcSetup` + `ledcAttachPin` +
> canales explícitos). Su código no compila acá y el nuestro no compila allá.
> Cualquier técnica que se tome de su repo hay que traducirla — ver
> el repo del compañero.

El kit oficial trae un **HC-SR05**, no un SR04(el comentario del `.ino` dice
SR04). Son compatibles en modo trigger/echo, que es como está usado. Y tanto el
ultrasónico como los motores **necesitan el jumper SELECT–Vin** puesto: si no se
mueven o el sonar siempre da fuera de rango, revisar eso antes que el código.
Ver los repos de referencia.

## Pines

| Función | Pin | Nota |
|---|---|---|
| HC-SR04 TRIG | 25 | salida |
| HC-SR04 ECHO | 26 | entrada |
| IR frontal izquierdo | 36 | `PIN_SEN1` → índice 0 |
| IR frontal derecho | 39 | `PIN_SEN2` → índice 1 |
| IR trasero izquierdo | 34 | `PIN_SEN3` → índice 2 |
| IR trasero derecho | 35 | `PIN_SEN4` → índice 3 |
| Botón BOOT | 0 | `INPUT_PULLUP`, activo en LOW |
| Motor 1 (izq) IN1 / IN2 | 12 / 14 | ambos por PWM |
| Motor 2 (der) IN1 / IN2 | 13 / 15 | ambos por PWM |
| NeoPixel | 2 | 1 solo píxel, `NEO_GRB + NEO_KHZ800` |
| IMU LSM6DS3TRC | I2C `0x6B` | `Wire.begin()` con pines por defecto |

Los cuatro IR son entradas **analógicas** (`analogRead`), no digitales — por eso la
calibración guarda un umbral numérico por sensor y no un simple HIGH/LOW.

## Motores

Puente H con los dos pines de cada motor en PWM (no hay pin de enable separado):
la dirección se elige poniendo uno de los dos pines a PWM y el otro a 0.

**Convención heredada del código base**: velocidad **negativa = adelante**,
**positiva = atrás**. Es contraintuitiva y es la fuente más probable de errores al
leer el código — ver [Arquitectura del codigo](firmware-arquitectura.md).

Los motores de este robot están **físicamente invertidos**; se corrige con el
interruptor único `INVERTIR_MOTORES 1`, que niega la velocidad dentro de
`setMotorSpeed()`. Ver [Decisiones](decisiones.md).

> ✅ **Lados confirmados (2026-09-20).** `INVERTIR_MOTORES` corrige
> adelante/atrás, no izquierda/derecha, así que había que verificar aparte
> que MOTOR1 fuera la rueda izquierda. Se confirmó por dos vías: el usuario
> vio el giro inicial de la ronda 2 (`girarGradosGiro(−90)`) **a la
> derecha**, y el firmware aprendió `signoGiroIzq = +1` — con el eje Z del
> IMU apuntando arriba (`az = +1.03 g`) eso es lo que dicta la regla de la
> mano derecha para un giro antihorario. **No hay que tocar pines.**
>
> **Motores desparejos**: mandando recto a fondo el robot curva a la
> izquierda a 15–30 °/s (el motor izquierdo tira más). Ver la bitácora.

## PWM

`PWM_FREQ = 20000` (20 kHz), `PWM_RES = 8` (0–255). Los 20 kHz están fuera del
rango audible a propósito — ver [Decisiones](decisiones.md).

## IMU

LSM6DS3TRC por I2C. **Eje de giro = Z** (`GYRO_EJE_GIRO 2`), confirmado con
`giroscopio_diagnostico.ino` sobre el robot real. Si cambia el sensor o el montaje
físico, hay que repetir ese diagnóstico antes de volver a confiar en el módulo.

Nivel medido en reposo: `accelZReposo` ≈ **1.04 g**. Inclinando el chasis a mano
bajó a **0.93–0.95 g** — ese delta es lo que sostiene la detección de levantamiento
en [Parametros a calibrar](parametros.md).

## Librerías

- `Adafruit NeoPixel` (1.15.5)
- **`Adafruit LSM6DS`** (4.7.4) — es el paquete que contiene
  `Adafruit_LSM6DS3TRC.h`; no existe como librería aparte en el gestor.
  Arrastra `Adafruit BusIO` y `Adafruit Unified Sensor`.
- `Wire` (del core)

Core: **`esp32:esp32` 3.3.12** (instalado el 2026-09-20 en
`AppData\Local\Arduino15`, compartido por el IDE y por `arduino-cli`).
Placa para compilar: `esp32:esp32:esp32` (ESP32 Dev Module). Configuración
del IMU desde el 20-09: acelerómetro ±4 g, giroscopio ±1000 °/s, ambos a
416 Hz; I2C a 400 kHz con timeout de 50 ms.

---

## ⚠️ El IR frontal izquierdo pudo haber estado dañado

Rescatado de un borrador viejo del README (el archivo `download` del repo, ya
eliminado), que decía en dos lugares distintos:

> "4x infrarrojo analógico reflectivo (**uno dañado actualmente: frontal
> izquierdo**)"
>
> "Adaptada para trabajar con **3 sensores IR** porque el sensor frontal
> izquierdo (sen1) está dañado."

`sen1` es **`PIN_SEN1` = IO36 = frontal izquierdo**, el mismo índice 0 del array
`pinesIr`.

**El firmware actual asume los 4 sensores buenos.** Si sen1 sigue dañado, la
consecuencia es grave y silenciosa: en `leerBorde()` el caso

```cpp
if (fl && fr) return "FRENTE";
```

**nunca se cumple**, porque `fl` viene de sen1. O sea que el robot **no puede
detectar el borde de frente** — justo el caso que evita salirse de cabeza del
dojo. Peor: caería en `if (fl || rl) return "IZQUIERDA"` dependiendo solo del
trasero izquierdo, ejecutando la maniobra equivocada.

Esto también daría una explicación alternativa al `FACTOR_UMBRAL = [0.62, 0.62,
...]` del v5 en CircuitPython, que subía la sensibilidad de **los dos
frontales** — ver [Linaje del codigo](historia-del-codigo.md). Puede que no fuera ruido eléctrico sino
sensores degradándose.

**No está confirmado que siga dañado**: el borrador es anterior al firmware
actual y pudo haberse reemplazado. Pero **el código de hoy no lo contempla de
ninguna forma**, así que hay que verificarlo antes que cualquier otro ajuste.

**Cómo verificarlo — ya está hecho el trabajo**: `calibracionPorPasos()` imprime
por Serial la tabla con `negro`, `blanco` y `umbral` de los cuatro sensores. Si
el Sensor 0 muestra `negro` y `blanco` casi iguales, o valores fijos que no
cambian entre los dos pasos, está muerto. Un sensor sano tiene que dar una
separación clara.

> Nota cruzada: el compañero reporta problemas en **IO34** (nuestro trasero
> izquierdo, sensor 2), no en IO36. Son sensores distintos en robots distintos —
> pero conviene mirar los cuatro de una vez. Ver [Parametros a calibrar](parametros.md).

### Evidencia de que sen1 ya fue reparado

Reconstruyendo la historia del repo (2026-08-30), el daño y su arreglo quedan
acotados en el tiempo:

| Fecha | Evento |
|---|---|
| 2026-07-14 00:59 | Se sube el **v5**, que usa los **4 sensores** con `FACTOR_UMBRAL = [0.62, 0.62, 0.50, 0.50]` |
| ~2026-07-14/15 | Aparece el **v6**, adaptado a **3 sensores** por sen1 dañado (el borrador `download` lo llamaba "versión oficial actual") |
| 2026-07-15 01:39 | Commit **`Delete sumobot_v6.py`** — la única versión con el rodeo de 3 sensores sale del repo |
| 2026-07-17 00:21 | "primer código con Arduino funcional" — vuelve a usar **los 4** |
| 2026-07-18 00:41 | Se crea el **diagnóstico de IR en Arduino**, que lee los 4 y pide anotar negro/blanco de cada uno |
| 2026-07-18 → hoy | Todo el código posterior, incluido el firmware en uso, asume **4 sensores sanos** |

**Lectura**: el rodeo de 3 sensores existió una sola versión y se descartó. Que
justo después se escribiera un diagnóstico de IR dedicado encaja con haber
revisado el sensor y resuelto el problema. El usuario además recuerda que **sen1
ya sirve**.

**Esto respalda que está reparado, pero no lo prueba**: nada en el repo registra
una medición posterior a la reparación. La comprobación real cuesta dos minutos
con `Diagnósticos en Arduino/Diagnostico de infrarrojos.INO`, que ya está escrito
para exactamente esto.

Se baja la severidad de este punto: **de "riesgo abierto" a "verificar cuando se
conecte el robot"**.

### Verificado el 2026-09-20: degradado, no muerto

Tres calibraciones sobre el dojo real:

| | negro | blanco | separación |
|---|---|---|---|
| sen1 (sensor 0) | 3422–3536 | **1161–2384** | 1038–2375 |
| los otros tres | 1993–2820 | **34–65** | 1956–2771 |

Sobre blanco, sen1 lee lo que los demás leen sobre negro: **refleja mucho
menos**. Pero separa negro de blanco con margen de sobra sobre el aviso de
150, así que `leerBorde()` **sí puede devolver `FRENTE`**. La hipótesis del
`FACTOR_UMBRAL` del v5 tenía razón en el diagnóstico (el frontal izquierdo
es menos sensible) — y la solución final fue la contraria: **bajar** el
factor a 0.45 en todos, porque el problema real resultaron ser los escapes
fantasma del sensor 1 sano, no la falta de sensibilidad del 0.

Sigue valiendo la pena cambiar el sensor si hay repuesto: con la mitad de
margen es el primero que va a fallar cuando las pilas bajen o el dojo esté
sucio.
