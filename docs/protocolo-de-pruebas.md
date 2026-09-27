# Protocolo de pruebas del firmware 2026-09-20

Paso a paso para probar el firmware nuevo sobre el robot real. Está
**ordenado por dependencia**: cada prueba asume que las anteriores pasaron.
Anotar el resultado de cada una en [Parametros a calibrar](parametros.md) y en la bitácora.

**Estado al cierre del 2026-09-20** (cinco corridas):

| Paso | Estado |
|---|---|
| 0 subir | ✔ por `arduino-cli`, COM7 |
| 1 calibración IR | ✔ tabla medida; sen1 degradado pero sirve |
| 2 lados | ✔ **MOTOR1 = izquierda confirmado** (giro a la derecha visto + signo del IMU) |
| 3 giro inicial | ✔ 91–94° reales, 407–467 ms, tras subir la desaceleración a 0.75 |
| 4 ocho escapes | ✔ **los ocho casos y el anti-bucle**, colocando el robot a mano sobre la línea (corridas 6–7). El usuario debe pararse **detrás** del robot o el sonar lo ataca |
| 5a falsos positivos | ✔ 30 s sin `LEVANTADO_DET` ni escapes fantasma (con 0.45) |
| 5b levantamiento | ✔ a mano: 22–29°, reacción completa |
| 6 empuje frontal | ✔ `rotado` ×10 y `tiempo` ×2 |
| 7 empuje lateral | ✔ vía golpe |
| 8 sonar | ✔ parcial: contacto intermitente visto y corregido |
| 9 pilas | ⏳ **pendiente — el único paso nunca hecho** |
| 10 `TELEMETRIA 0` | ✔ en el robot y en el repo. **Volver a 1 para cualquier prueba nueva** |
| 11 pivotes vigilados (23-09) | ✔ A: los escapes completan igual (cero cortes falsos). B: empujado sobre la línea mientras pivotea → `GIRO_CORTADO,63.0;90.0` |
| 12 dojo nuevo (25-09) | ✔ negro brillante: escapes fantasma resueltos con umbral 0.10, línea detectada siempre (incluso de costado y rápido) |
| 13 firmware del plan (25-09) | ⚠ **probado el 25-09**: 13c ✔ (7.6 s sin cortar), 13g ✔, 13d ✔ probable, 13b a medias (sin verde agua ✔, pero detecta tarde: 0.2–3.3 s), **13a ✘: encarar se dispara solo** (13 giros en 93 s). 13e y 13f sin hacer. Ver la bitácora **26-09, conservador (sin encarar, levantado corregido)**: 0 levantados falsos, 5 de 5 reales detectados, sin medias vueltas ✔ |
| 14 escapes, tanteo y levantado (26-09) | ⏳ **flasheado el 26-09 (`competencia_2c00113d`), sin probar en el dojo**. Ver la sección 14 |

## Diagnóstico de escapes fantasma (aprendido el 25-09)

Si el robot escapa sin estar en la línea, en este orden:

1. **Telemetría a 2 ms, no a 100 ms.** Poner `INTERVALO_TELEMETRIA_MS` en
   0 (con `TELEMETRIA 1`). A 100 ms se confunden cruces reales con
   destellos — así se sacaron dos conclusiones equivocadas antes de medir
   bien.
2. **¿Superficie o eléctrico?** Sostener el robot quieto sobre negro, con
   los motores girando, ~20 s. Si **no** aparecen excursiones a blanco, es
   la superficie. Si aparecen, es eléctrico (ruido del PWM, contacto).
3. **Si es superficie: mirar la profundidad, no la duración.** El blanco
   real llega al valor calibrado; un destello de negro brillante se queda
   a mitad de camino. El umbral tiene que caer en el hueco entre los dos.
4. **Simular antes de elegir**: correr los factores candidatos sobre la
   captura y contar cruces reales detectados vs destellos que disparan.
5. **Verificar en el dojo**, llevando el robot a la línea **de costado y
   rápido** — un cruce perdido es peor que cualquier fantasma.

Volver `INTERVALO_TELEMETRIA_MS` a 100 y `TELEMETRIA` a 0 al terminar.

Lo que se necesita: el robot, el dojo (o un cartón negro con borde blanco),
una caja o libro para hacer de rival, el cable USB, y el Monitor Serie a
**115200** (ver [Telemetria](telemetria.md)). Con `TELEMETRIA 1` todo
lo que pasa sale por Serial en CSV — copiarlo a una hoja de cálculo al
terminar cada prueba.

> ⚠️ **El puerto es exclusivo.** Cerrar el Monitor Serie antes de subir, y
> subir antes de abrirlo. Y **DTR/RTS reinician el ESP32**: si el robot se
> reinicia solo al abrir el monitor, es eso, no un bug.

## 0. Subir el firmware

**Desde el IDE de Arduino 2.x:**

1. Abrir `mussolini/mussolini.ino` (el IDE
   abre las dos pestañas solo).
2. Placa: **ESP32 Dev Module**. Puerto: el del CH340 (COM7 el 20-09).
3. Verificar que en Herramientas la versión del core esp32 sea **3.x** (se
   instaló la 3.3.12 el 2026-09-20; si el IDE ofrece 2.x, no compila).
4. Sketch → Subir. Si falla con "Failed to connect", mantener BOOT
   presionado mientras arranca la subida y soltarlo cuando empiece a
   escribir.

## 1. Calibración IR — leer la tabla

Secuencia de arranque de siempre: BOOT sobre negro, BOOT sobre blanco, BOOT
para confirmar. Ahora cada paso promedia 12 muestras (tarda ~100 ms más).

Mirar la tabla `--- Valores de calibracion ---`. Columna nueva:
**`separacion`** = |negro − blanco|.

| Qué mirar | Qué significa |
|---|---|
| `separacion` de los cuatro parecida y grande | sensores sanos |
| un sensor con `<-- DEBIL` | separación < 150: no discrimina. Revisar cable/sensor. IO34 (sensor 2, trasero izq.) es el sospechoso conocido |
| sensor 0 con separación mucho menor que sensor 1 | el frontal izquierdo (sen1) sigue degradado — ver [Hardware](hardware.md) |
| `blancoEsMenor: NO` | se calibró al revés (blanco primero). Repetir |

**Anotar los cuatro valores** de negro/blanco/separación en
[Parametros a calibrar](parametros.md). Con eso se decide si `FACTOR_UMBRAL` (0.45 en los
cuatro desde el 20-09; el 0.60 inicial daba escapes fantasma) hay que
moverlo por sensor.

Después de elegir la ronda, el giroscopio calibra **2 s con el robot
quieto de verdad**. El Serial dice cuántas muestras aceptó:
`(398/400 muestras)` es normal; `(26/400)` es que se movió durante esos
2 s — mejor reiniciar y repetir.

## 2. Convención de lados — LA PRUEBA MÁS IMPORTANTE

Todo el código asume que `motores(+V, −V)` pivotea a la **izquierda**.
Si el robot está cableado al revés, los escapes de un solo sensor giran
**hacia** el borde en vez de alejarse. Hay que confirmarlo antes que nada.

1. Ronda 1, robot sobre el negro, sin rival, lejos del borde.
2. Levantar solo el **sensor frontal izquierdo** sobre blanco (un papel
   blanco bajo ese sensor, o acercar el robot al borde de forma que solo ese
   sensor lo pise).
3. Esperado: retrocede ~120 ms y gira a la **derecha** (se aleja del blanco).
   En el Serial: `E,...,ESCAPE,FRENTE_IZQ`.

**Si gira a la izquierda** (hacia el blanco): los lados están invertidos.
Intercambiar los pines de `MOTOR1` y `MOTOR2` en `mussolini.ino` (está
marcado con ⚠ arriba de los `#define`), volver a subir, repetir. No tocar
nada más.

Confirmación cruzada: en el mismo arranque, cuando pasa a `BUSCA`, el evento
`PERDIDO,busca_izq` debe coincidir con un giro físico a la izquierda.

## 3. Giro inicial por giroscopio (rondas 2 y 3)

1. Ronda **2**, robot sobre el negro, marcar con cinta hacia dónde mira.
2. BOOT final → debe girar ~**90° a la derecha** y quedar quieto un
   instante antes de avanzar.
3. Serial: `E,...,GIRO,-90;<logrado>;<ms>`.
4. Repetir con ronda **3** → ~180°.

| Resultado | Ajuste |
|---|---|
| `logrado` entre 86 y 94 (ronda 2) | perfecto, no tocar |
| se pasa (logrado > 94 o el robot gira de más a ojo) | subir `ZONA_DESACELERACION_GRADOS` (30 → 40) o bajar `VEL_DESACELERACION` (0.45 → 0.35) |
| `GIRO_TIMEOUT` | no llega al ángulo: subir `VEL_DESACELERACION` (0.45 → 0.6). Si sigue, `imuFallos` en las líneas T dice si el I2C está fallando |
| el `ms` de 90° | anotarlo: es el dato real para `TIEMPO_GIRO_90_MS` (hoy 725, estimado del compañero) |

Si `GIRO_TIMEOUT` aparece **siempre** y `imuFallos` sube, bajar `I2C_HZ` a
100000 en `giroscopio_control.ino`.

## 4. Los ocho escapes de borde

**Método que funcionó (2026-09-20)**: ronda 1, sin rival, y **colocar el
robot ya sobre la línea** en cada posición antes de soltarlo — el escape
sale en la primera vuelta del loop. Entre casos se levanta (dispara
`LEVANTADO` en la mano, inofensivo) y se vuelve a colocar; no hace falta
reiniciar. **Pararse detrás del robot**: si el sonar ve a la persona, la
ataca y se va contra el borde por su cuenta.

Mirar el evento `ESCAPE,<caso>` y el movimiento.

| Caso | Sensores en blanco | Esperado |
|---|---|---|
| `FRENTE` | los dos frontales | retrocede 180 ms, gira ~200° |
| `ATRAS` | los dos traseros | **avanza** 200 ms, no gira |
| `FRENTE_IZQ` | frontal izq. | retrocede, gira derecha 90° |
| `FRENTE_DER` | frontal der. | retrocede, gira izquierda 90° |
| `ATRAS_IZQ` | trasero izq. | **avanza** 150 ms, gira derecha 45° |
| `ATRAS_DER` | trasero der. | **avanza** 150 ms, gira izquierda 45° |
| `EMPUJE_DERECHA` | frontal y trasero der. | curva a la izquierda 300 ms, pivote izquierda 68° |
| `EMPUJE_IZQUIERDA` | frontal y trasero izq. | curva a la derecha 300 ms, pivote derecha 68° |

Los cuatro casos `ATRAS*` son **nuevos**: antes cualquier trasero en blanco
hacía retroceder al robot hacia el borde. Verificar que en el retroceso de
`FRENTE*` el robot **frena solo** si un trasero pisa blanco (poner blanco
detrás a propósito).

**Anti-bucle**: dejar el robot pegado a la línea de modo que escape tres
veces seguidas. En el tercer escape debe salir `ESCAPE,<caso>;ANTIBUCLE`,
girar hacia el otro lado y con 45° más.

## 5. Levantamiento

**5a — falsos positivos.** Robot sobre el negro sin rival, 20 segundos
buscando y girando libremente. En el Serial **no** debe aparecer ningún
`LEVANTADO_DET`, `GOLPE` ni `EMPUJE_LATERAL`. Mirar la columna `inclin_deg`
de las líneas `T`: durante la búsqueda debe quedarse por debajo de ~6°.

Si dispara solo: subir `INCLINACION_LEVANTADO_DEG` (12 → 15) o
`DURACION_LEVANTADO_MS` (150 → 250). Si sale `GOLPE`, subir `UMBRAL_GOLPE_G`
(0.35 → 0.5).

**5b — detección real.** Con el robot buscando, meter algo plano y rígido
bajo el frente hasta levantar las ruedas delanteras (como haría una rampa).
Esperado en < 200 ms: `LEVANTADO_DET,<inclin>;<dax>;<day>`, LED magenta,
retrocede, gira 90°.

Anotar el `inclin` del disparo. Y anotar **cuál de `dax`/`day` cambió** al
levantar el frente: ese es el eje "adelante" del IMU en este montaje (hoy
no se usa para decidir nada, pero queda registrado).

Si **no** dispara: la inclinación real no llega a 12°. Bajar
`INCLINACION_LEVANTADO_DEG` a 9 y `INCLINACION_SALIDA_DEG` a 6.

## 6. Empuje frontal perdido

1. Poner la caja a ~30 cm de frente → `ATAQUE`, el robot la embiste.
2. Sostener la caja para que no la mueva, y **girar el robot con la mano**
   mientras empuja (como si el rival lo estuviera desviando).
3. Esperado: `EMPUJE_PERDIDO,rotado;<dps>`, retrocede 200 ms, gira 60° en
   contra del sentido en que lo giraste, avanza 250 ms en diagonal, vuelve a
   buscar.
4. ~~Repetir sin girarlo, solo sosteniendo la caja **más de 4 s** →
   `EMPUJE_PERDIDO,tiempo`.~~ **Desde el firmware del plan (25-09) ya no
   existe**: con la caja sostenida sigue empujando. Ver la prueba 13c.

Si dispara `rotado` con solo empujar recto (sin girarlo), subir
`UMBRAL_ROTACION_FORZADA_DPS` (40 → 60).

## 7. Empuje lateral y golpe

1. Robot buscando (sin rival).
2. Empujarlo de costado con la mano, seco.
3. Esperado: `GOLPE,<g>;<dax>;<day>;BUSCA` y de inmediato `EMPUJE_LATERAL`,
   LED verde-agua, arranca hacia adelante 350 ms. Si el rival aparece
   enfrente mientras escapa, el escape se corta y ataca (cambio 32, prueba
   14d). (Girar hacia el golpe, "encarar", se probó el 25-09 y se quitó:
   prueba 13a.)
4. También: mientras avanza (`AVANCE`), girarlo con la mano sin golpe →
   `EMPUJE_LATERAL` por rotación forzada.

## 8. Ultrasónico

1. Caja de frente a 20, 40, 60, 90 cm. Columna `dist_cm` de las líneas `T`
   debe seguir la distancia real ±3 cm.
2. Mover la caja fuera del cono de golpe → el evento `PERDIDO` debe salir
   **~150 ms** después, no antes.
3. Inclinar la caja para que el eco se pierda a ratos: `dist_cm` debe
   **mantenerse** (retención de 80 ms) en vez de saltar a 101.

## 9. Con pilas, no con USB

Repetir 3, 4 y 5b alimentado por las 4 AA. Si el robot se reinicia solo en
un arranque de motor, es el brownout heredado del kit (Parametros a
calibrar) — no es el firmware.

## 10. Antes de competir

1. `#define TELEMETRIA 0` en `mussolini.ino`.
2. Compilar y subir de nuevo.
3. Anotar en [Parametros a calibrar](parametros.md) los valores finales de todo lo que se
   ajustó, y en la bitácora la fecha.

## 13. Firmware del plan (2026-09-25)

Los cambios 21–27 están calificados en el [Simulador](../simulador/README.md), no en el robot. Esto
es lo que hay que ver en el robot real, con `TELEMETRIA 1` para leer los
eventos. Lo que el simulador predice va entre paréntesis.

**13a. Encarar el golpe (y confirmar el eje X del IMU).** *Obsoleta: encarar
falló esta prueba el 25-09 (se disparaba solo) y se quitó con el cambio 28.
Queda como registro.* Robot buscando,
sin rival. Golpe seco con la mano **por la izquierda**: debe salir `GOLPE`
con `dax > 0`, LED verde agua, `ENCARAR,~90` y girar **a la izquierda**.
Repetir por la derecha (`dax < 0`, gira a la derecha) y por detrás (`day > 0`,
media vuelta). (Simulador: golpe por la izquierda → gira 94° a la izquierda.)
**Si gira hacia el lado contrario**, el eje X del IMU apunta a la izquierda:
en `reaccionEmpujeLateral()` cambiar `atan2(golpeAx, -golpeAy)` por
`atan2(-golpeAx, -golpeAy)`. X nunca se midió directamente; se dedujo de que
Z apunta arriba y Y adelante.

**13b. Levantar mientras busca.** Levantar el frente a mano: debe ir
**directo a magenta** (`LEVANTADO_DET`) sin pasar por verde agua. El
filtro de Z caída hace que la inclinación ya no cuente como golpe.
(Simulador: `LEVANTADO_DET` a los 0.35 s, antes 0.47 s.)

**13c. Empuje sostenido.** Caja a 30 cm, sostenerla firme más de 4 s. Debe
**seguir empujando** (LED rojo), sin `EMPUJE_PERDIDO,tiempo`. Si además se
gira el robot con la mano mientras empuja, sí debe salir
`EMPUJE_PERDIDO,rotado` y flanquear, como antes.

**13d. Giro trabado.** Colocarlo sobre la línea para que escape, y **sujetar
el robot con la mano** en cuanto empieza a pivotear. Debe salir
`GIRO_TRABADO` a los ~300 ms (antes quedaba intentando hasta `GIRO_TIMEOUT`
a los 3 s). Soltarlo: el loop retoma solo.

**13e. Acorralado de espaldas.** Robot con la cola sobre la línea y la caja
empujándolo de frente a mano, varias veces seguidas. Al tercer `ESCAPE,ATRAS`
en 3 s (`;ANTIBUCLE`) debe pivotear ~45° antes de avanzar.

**13f. Aviso de IR degradado.** En la calibración, poner en el paso de
BLANCO un sensor sobre algo gris (o tapado a medias). La tabla debe marcarlo
`DEGRADADO` y el LED hacer **tres parpadeos violeta** antes del verde.

**13g. Pérdida de eco en contacto.** Empujando la caja (13c), la columna de
estado puede pasar `ATAQUE → AVANCE → ATAQUE` en un instante: los motores
deben seguir a fondo (columna `corr` sin saltos a 0) y el LED puede
parpadear naranja.

## 14. Escapes, tanteo y levantado (2026-09-26)

Cambios 30–33 (la bitácora). Para leer los eventos hace falta la versión de prueba:
`FLASHEAR.bat` → 2 (graba el Serial en `capturas\`).

**14a. Evasión de frente.** Llevarlo derecho a la línea blanca. Tiene que
retroceder bastante más que antes (~9 cm a 20 cm/s) y dar **media vuelta**,
aunque toque la línea con un solo sensor (antes giraba 90° y quedaba paralelo).
Eventos: `ESCAPE,FRENTE_IZQ` y `GIRO,180;~176;...`.

**14b. Evasión cortada por el sonar.** Repetir 14a con la caja a ~25 cm del
lado hacia el que gira. En cuanto el sonar la vea, tiene que **cortar el giro y
atacar** (LED rojo): `GIRO_INTERRUMPIDO_SONAR,<grados logrados>;180`. Sin la
caja, el giro termina entero.

**14c. Acorralado de espaldas sigue igual.** Robot con la cola en la línea y la
caja empujándolo de frente, varias veces seguidas: al tercer `ESCAPE,ATRAS` en
3 s tiene que pivotear 45° **aunque tenga la caja enfrente** (acá el sonar no
corta, a propósito).

**14d. Golpe con el rival enfrente.** Buscando, golpe de costado con la caja a
~30 cm adelante: el escape hacia adelante se corta en cuanto la ve
(`ESCAPE_INTERRUMPIDO_SONAR`) y ataca.

**14e. Tanteo.** Caja a 60–80 cm, apenas desviada de su frente. Mientras se
acerca (LED naranja) tiene que avanzar con un zigzag **suave** (±3°) y
corregirse hacia la caja. No debería pasar a buscar (LED azul) en el camino.

**14f. Levantamiento.** Levantarle el frente a mano ~2 s y soltarlo mientras
retrocede. Tiene que **seguir retrocediendo hasta apoyar entero** y recién ahí
girar. `LEVANTADO_APOYO,<ms>;plano;<incl>`: `plano` = el IMU confirmó el apoyo;
`tope` = llegó a 1.5 s sin confirmarlo (si pasa seguido, subir
`INCLINACION_SALIDA_DEG` o `PLANO_SOSTENIDO_MS`); `borde` = cortó por la línea
de atrás.
