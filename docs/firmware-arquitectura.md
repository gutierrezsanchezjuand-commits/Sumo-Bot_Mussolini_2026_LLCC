# Arquitectura del código

Firmware en [`mussolini/`](../mussolini).

**Dos archivos `.ino` en la misma carpeta = un solo sketch.** El IDE
concatena las pestañas (la principal primero, el resto en orden alfabético)
y genera prototipos de las **funciones** automáticamente — pero **no de las
variables**. Por eso todo el estado compartido del IMU (`imuDps`,
`rumboDeg`, `inclinacionDeg`, `giroListo`, …) está declarado en
`mussolini.ino` aunque lo escriba `giroscopio_control.ino`.

| Archivo | Rol |
|---|---|
| `mussolini.ino` | motores, sensores, calibración, ofensiva, anti-bucle, rumbo del rival, `setup()`/`loop()` |
| `giroscopio_control.ino` | IMU: lectura validada, giro por ángulo, levantamiento, golpe, rotación forzada, y todas las reacciones |

Otra trampa del generador de prototipos: no usar tipos propios (`enum`,
`struct`, `sensors_event_t`) como **parámetro** de función. Por eso
`moverVigilando()` recibe un `int` (`VIGILAR_NADA/ADELANTE/ATRAS`) y no un
enum.

## Flujo de `setup()`

1. `calibracionPorPasos()` — BOOT sobre negro, BOOT sobre blanco. Cada paso
   **promedia 12 muestras** por sensor. Umbral por sensor:
   `blanco + (negro − blanco) × FACTOR_UMBRAL[i]` (0.60 los cuatro, decisión
   del usuario). Deduce la polaridad sola. Imprime la tabla con la
   **separación** por sensor y marca `DEBIL` si es menor que 150.
2. `seleccionarRonda()` — pulsaciones de BOOT en ventana de 1200 ms.
3. `iniciarGiroscopio()` — primero `recuperarBusI2C()` (9 pulsos en SCL y
   un STOP, por si el sensor quedó trabado por un reset a mitad de
   transacción), después I2C a 400 kHz con timeout de 50 ms y hasta
   **tres intentos** de `begin_I2C`. IMU a **416 Hz**, giroscopio
   ±1000 °/s, acelerómetro ±4 g. 2 s quieto midiendo drift (filtro
   0.015 rad/s) y el **vector de reposo completo** (X, Y, Z). Si no
   encuentra el sensor: **tres parpadeos rojos**, `giroListo = false` y
   todo degrada a tiempo.
4. `esperarInicioCombate()` — BOOT final.
5. `giroInicial()` — ronda 2: −90°, ronda 3: −180° por
   `girarGradosGiro(…, desacelerar=true)`. Sin sensor: 725/1450 ms.
6. `tUltimaDeteccion = millis()` para que arranque avanzando 150 ms antes de
   buscar.

## Flujo de `loop()`

```
leerIMU()                       una lectura I2C validada por vuelta
leerBorde()      → != ""       → maniobraEscapePreciso(borde)   return
detectarLevantado()  → true    → reaccionLevantado()            return
detectarEmpujeLateral() → true → reaccionEmpujeLateral()        return
comportamientoOfensivo()        (adentro: reaccionPerdiendoEmpuje)
telemetria()
```

Prioridad explícita: **borde > levantamiento > empuje lateral > ataque**.
El borde va primero por decisión del usuario (los IR son lo más
importante); las reacciones de abajo son todas edge-aware igual, porque
mueven con `moverVigilando()`.

## Motores

Tres capas desde el 20-09 (tarde):

- `aplicarMotores(izq, der)` — la cruda: impulso anti-stiction + PWM.
  Guarda lo **aplicado** en `ultimaIzq/Der`.
- `motores(izq, der)` — la orden directa para pivotes, curvas y parada.
  Guarda la **orden** en `ordenIzq/Der`, marca `mandandoRecto = (izq == der)`,
  actualiza `tUltimoCambioMotores` si la orden cambió, y resetea el
  integral de rumbo si no es recta.
- `avanzarRecto(vel)` — para ir recto con corrección de rumbo (abajo).

Convención heredada **negativa = adelante, positiva = atrás**, con
`INVERTIR_MOTORES` que niega todo. **`motores(+V, −V)` pivotea a la
izquierda** (rueda izquierda atrás, derecha adelante) — confirmado en el
robot el 20-09 (MOTOR1 = izquierda).

## Avance recto con corrección por giroscopio

`avanzarRecto(vel)` es un **P+I sobre la velocidad angular**. Con
`e = imuDps × signoGiroIzq` (positivo = derivando a la izquierda):

```
dpsFiltrado += 0.10 × (e − dpsFiltrado)          paso bajo ~30 ms
integral     = clamp(integral + e × dt, ±10)      grados acumulados
corr         = clamp(0.004 × dpsFiltrado + 0.030 × integral, ±0.30)
aplicarMotores(vel − corr, vel + corr)
```

Rotar a la izquierda se compensa acelerando la rueda izquierda y frenando
la derecha; la misma fórmula sirve marcha atrás porque siempre agrega una
rotación hacia la derecha independiente de la velocidad base. El P chico y
filtrado no pelea con el ruido de vibración (±10–20 °/s); el integral lleva
el sesgo constante de los motores. Sin giroscopio o sin signo, `corr = 0`.
El integral y el filtro se resetean al cambiar la orden o al pivotear.

La usan `comportamientoOfensivo()` (ataque, seguimiento, avance) y
`moverVigilando()` cuando `izq == der` — o sea todos los tramos rectos de
las maniobras, incluidos los retrocesos.

Medido el 20-09: deriva en embestida de −6.6 °/s a +2; empujando 3 s, rumbo
dentro de ±3°. Ver la bitácora.

**Impulso anti-stiction no bloqueante**: al arrancar una rueda desde 0 con
velocidad < `VEL_IMPULSO` se abre una ventana de 70 ms durante la cual se
aplica potencia máxima. `motores()` no hace `delay()`: la ventana se cierra
en la siguiente llamada que caiga después de los 70 ms. Consecuencia:
**cualquier movimiento sostenido tiene que seguir llamando a `motores()`** —
`moverVigilando()` y `girarGradosGiro()` lo hacen en cada vuelta. Un
`motores(x); delay(300)` dejaría la potencia máxima los 300 ms enteros.

`tUltimoCambioMotores` guarda cuándo cambió la orden por última vez, para
que la aceleración propia no se confunda con un golpe ni con rotación
forzada (gracia de 150 ms).

## `moverVigilando(izq, der, ms, vigilar)`

Reemplaza a `motores() + delay()`. Lee los IR una vez al arrancar y
recuerda qué sensores **ya estaban** en blanco. Después mueve durante `ms`
y en cada vuelta: vuelve a llamar a `motores()`, lee el IMU, lee los IR, y
si `vigilar` es `VIGILAR_ATRAS` y un trasero **pasa** de negro a blanco (o
`VIGILAR_ADELANTE` y un frontal) **aborta y devuelve `true`**. Lo que ya
estaba en blanco no aborta: si no, parado sobre la línea el robot nunca se
trasladaría, solo pivotearía (visto en la corrida 4 del 2026-09-20, ver
la bitácora). Los pivotes en el lugar usan `VIGILAR_NADA`. También imprime
telemetría, así las maniobras se ven en el CSV.

`girarConFallback(grados)`: `girarGradosGiro()` si hay sensor, si no un
pivote por tiempo proporcional a `TIEMPO_GIRO_90_MS`.

## Sensor de borde

`leerBorde()` lee los 4 IR una vez; **solo si alguno marca borde** hace la
segunda lectura de confirmación (técnica del compañero: 4 `analogRead` en
el caso normal en vez de 8). Deja el detalle por sensor en `bordeDet[4]`
para que `moverVigilando()` sepa qué lado mirar.

Devuelve, por prioridad:

| Sensores | Resultado | Escape |
|---|---|---|
| FL + FR | `FRENTE` | atrás **450 ms** (vigilando atrás), giro ~200° hacia el rival, **cortable por sonar** |
| RL + RR | `ATRAS` | **adelante** 200 ms (vigilando adelante), sin giro; con anti-bucle, pivote 45° antes (25-09) |
| FR + RR | `EMPUJE_DERECHA` | curva a la izquierda 300 ms, pivote izquierda 68° **cortable por sonar**, adelante 150 ms (se saltea si el sonar cortó) |
| FL + RL | `EMPUJE_IZQUIERDA` | curva a la derecha 300 ms, pivote derecha 68° **cortable por sonar**, adelante 150 ms (ídem) |
| FL | `FRENTE_IZQ` | atrás **350 ms**, pivote derecha **180°**, **cortable por sonar** |
| FR | `FRENTE_DER` | atrás **350 ms**, pivote izquierda **180°**, **cortable por sonar** |
| RL | `ATRAS_IZQ` | **adelante** 150 ms, pivote derecha 45° |
| RR | `ATRAS_DER` | **adelante** 150 ms, pivote izquierda 45° |

**Desde el 26-09 (cambio 30, pedido del usuario)** la evasión de frente es
más decidida: antes retrocedía 120–180 ms (3–4 cm a ~20 cm/s) y el caso de un
solo sensor frontal giraba 90° y quedaba paralelo a la línea. Además, los
giros de escape de frente y de costado **vigilan el sonar**
(`girarConFallbackVigilando`): si ve al rival a menos de 40 cm con un eco
nuevo sostenido 60 ms, cortan (`GIRO_INTERRUMPIDO_SONAR`) y el loop ataca.
El retroceso previo no se corta: primero hay que salir de la línea. **Los
casos de atrás no se cortan**: ahí el rival suele estar enfrente empujando, y
el pivote es para salir de su línea (con el corte, el simulador perdía las
dos peleas de acorralado contra uno 20 % más fuerte).

Los casos `ATRAS*` son nuevos: hasta el 30-08 un trasero en blanco caía en
`IZQUIERDA`/`DERECHA` junto con el frontal del mismo lado, y el escape
**retrocedía** — hacia el borde. Y el caso `EMPUJE_*` curvaba y pivoteaba al
revés que los demás (ver [Decisiones](decisiones.md)).

**Anti-bucle**: cada escape se registra en un anillo de 3 marcas de tiempo.
Si las 3 caen dentro de 3 s, el escape actual invierte `girarIzquierda`,
suma 45° al giro y limpia el anillo. Evento `ESCAPE,<caso>;ANTIBUCLE`.
`ATRAS` no gira, así que ahí el anti-bucle no hacía nada: desde el 25-09
pivotea 45° hacia `girarIzquierda` antes de avanzar (acorralado de espaldas
por un rival que empuja de frente).

## Ultrasónico

`pulsoSonar()`: un disparo, `pulseIn` con timeout de 6 ms (~100 cm), −1 si no
hay eco. `medirDistanciaCm()` envuelve eso con dos cosas:

- **No dispara si `ECHO` está en HIGH.** Tras un eco perdido el HC-SR04
  mantiene ECHO alto ~38 ms e ignora el TRIG; disparar ahí solo gasta los
  6 ms del timeout. Esto además hace el ciclo más corto justo cuando el
  sonar no ve nada.
- **Retención**: sin eco, devuelve la última distancia válida si tiene menos
  de 80 ms (`RETENCION_DIST_MS`). Después, "fuera de rango".

`comportamientoOfensivo()` declara al rival perdido cuando pasan **150 ms**
(`PERDIDO_TRAS_MS`) sin verlo — en tiempo, no en ciclos, porque el ciclo ya
no dura siempre lo mismo.

## Comportamiento ofensivo

| Distancia | Acción | LED | Además |
|---|---|---|---|
| < 40 cm | `ATAQUE` a fondo | rojo | vigila rotación forzada (desde el 25-09 ya **no** hay límite de tiempo) |
| 40–100 cm | `TRACK` 0.80 **con tanteo** (26-09) | naranja | barre ±3° de lado a lado cada 300 ms |
| perdido < 150 ms (500 ms si estaba pegado) | `AVANCE` 0.80, **a fondo si el rival estaba a < 40 cm** (25-09); si venía tanteando, invierte el barrido una vez | naranja | |
| perdido más que eso | `BUSCA` pivote 0.75 | azul | hacia el rumbo del rival |

**Tanteo en `TRACK`** (cambio 31, pedido del usuario): en vez de avanzar
derecho, `avanzarRecto(-0.80, ±20)` le pide a la corrección de rumbo un giro
de ±20 °/s que se invierte cada 300 ms (±3° de barrido; el cono del sonar es
de ±15°). Si el sonar pierde al rival, el barrido se invierte al instante
para volver a encontrarlo antes de que `PERDIDO_TRAS_MS` lo mande a buscar.
Como el barrido hacia el rival dura entero y el que se aleja se corta al
perderlo, el rumbo se centra solo sobre él. `avanzarRecto(vel, objetivoDps)`
corrige hacia esa velocidad angular en vez de hacia cero; todo lo demás lo
llama con 0.

Cada vez que ve al rival guarda `rumboRival = rumboDeg` (vigencia 3 s).
`elegirSentidoGiro()` decide hacia dónde girar: si hay rumbo vigente **y ya
se aprendió el signo del giroscopio**, hacia el rumbo; si no, alterna como
antes. Lo usan la búsqueda, el escape `FRENTE` y la reacción al
levantamiento.

**Empuje frontal perdido** (dentro de `ATAQUE`): si `rotacionForzada()` —
mandando recto y el giroscopio marca ≥ 60 °/s sostenidos 100 ms— →
`reaccionPerdiendoEmpuje()`: retrocede 200 ms, gira 60° **contra** la
rotación impuesta, avanza 250 ms en diagonal y deja que el loop lo
reencuentre de costado. Evento `EMPUJE_PERDIDO,rotado;<dps>`.

> **Desde el 2026-09-25 no hay corte por tiempo** (antes: más de 4 s en
> `ATAQUE` → `EMPUJE_PERDIDO,tiempo`). Soltaba el empuje fuera ganando o
> perdiendo, y cada eco perdido en contacto reiniciaba el reloj. Ver
> el plan de correcciones.

## Módulo IMU

**`leerIMU()`** es la única lectura I2C por vuelta. Descarta la lectura si
`getEvent()` falla o si la magnitud del vector de aceleración cae fuera de
[2, 40] m/s² (contador `imuFallos`), y con una lectura válida actualiza:

- `imuDps`: velocidad angular en Z sin drift, °/s. `imuDt`: segundos desde
  la lectura anterior (0 si el hueco fue > 100 ms, para no integrar basura).
- `rumboDeg += imuDps × imuDt` — dead reckoning continuo.
- `inclinacionDeg`: ángulo entre el vector de aceleración actual y el de
  reposo calibrado, en 3D. Es lo que usa el levantamiento.
- `dAxG`, `dAyG`: deltas horizontales respecto al reposo (para telemetría y
  para el golpe).
- **`signoGiroIzq`**: cuando la orden es un pivote puro (`der == −izq`) y
  `|imuDps| > 30`, anota si "izquierda" da positivo o negativo. Se aprende
  en el primer pivote del combate y corrige cualquier suposición sobre el
  montaje del sensor.
- **Golpe**: `√(dAx² + dAy²) > 0.35 g`, con 150 ms de gracia tras un cambio
  de orden de motores y 300 ms de cooldown → `golpePendiente` y evento
  `GOLPE`. Guarda `golpeAz = azg − az0`: si Z cayó (chasis inclinado) no es
  golpe. (El vector completo, para encarar, se quitó con encarar el 25-09.)
- `inclinacionFiltrada`: `inclinacionDeg` con un pasa-bajos de 100 ms
  (cambio 29). Es lo que usa el levantamiento.

**`girarGradosGiro(grados, vel, desacelerar, vigilarSonar)`**: integra `|imuDps| × imuDt`
hasta `objetivo − 4°`, con timeout de 3000 ms. Con `desacelerar` baja a
**0.75 en los últimos 25°** (valores del 20-09; esta página decía 0.45 y 30°,
que eran los del 30-08, ver [Control por giroscopio](giroscopio.md)). Llama a `leerIMU()`
y lee los IR en cada vuelta (aborta si un IR cruza a blanco,
`GIRO_CORTADO`). **Giro trabado** (25-09): si en una ventana de 300 ms no
avanza 8°, se corta con `GIRO_TRABADO` en vez de seguir ciego hasta el
timeout. Con `vigilarSonar` (26-09, giros de escape de frente y de
costado) también se corta si el sonar ve al rival: `GIRO_INTERRUMPIDO_SONAR`.

**`detectarLevantado()`**: `inclinacionFiltrada > 15°` sostenida 250 ms **sin
cortes** → entra; sale por debajo de 10° (histéresis). Si pasaron más de 50
ms sin evaluar (una maniobra o un giro rápido), la cuenta arranca de nuevo
(cambio 29: 8 de 9 levantados falsos salían al terminar un giro). No evalúa
si `|imuDps| > 120 °/s`. Solo detecta; la reacción es `reaccionLevantado()`:
**retrocede hasta que el IMU confirma que la base volvió a apoyar entera**
(`retrocederHastaApoyar()`, cambio 33, idea del usuario: inclinación filtrada
< 10° sostenida 150 ms, entre 250 y 1500 ms, vigilando atrás; evento
`LEVANTADO_APOYO,<ms>;plano|borde|tope;<incl>`). Antes eran 280 ms fijos.
Después pivotea 90° hacia el rival, **sin** corte por sonar: el rival tiene
rampa, y volver a entrarle de frente es volver a subirse.

**`rotacionForzada()`**: `mandandoRecto` (orden recta o parada), sin
gracia de motores, y sostenido 100 ms: `|imuDps| ≥ 60`, **o** el integral
de rumbo al tope y `|imuDps| ≥ 30` — porque con la corrección activa parte
de la rotación impuesta se compensa y el giroscopio la ve menor; si con la
corrección máxima sigue rotando, alguien lo está girando. **`detectarEmpujeLateral()`**: fuera de
`ATAQUE`, rotación forzada o golpe pendiente (y no inclinado) →
`reaccionEmpujeLateral()`:

adelante a fondo 350 ms vigilando el borde frontal, y desde el 26-09
(cambio 32) **vigilando el sonar** (`moverVigilandoSonar`): si el rival
aparece adelante, deja de escapar (`ESCAPE_INTERRUMPIDO_SONAR`) y el loop
ataca. ("Encarar" —girar hacia el lado del golpe— se probó el 25-09 y se
quitó: en el robot el arranque propio se leía como golpe por detrás.)

**`MODO_SIMPLE`** (`#define` en `mussolini.ino`, 0 por defecto): en 1,
`detectarLevantado()`, `rotacionForzada()` y `detectarEmpujeLateral()`
devuelven siempre falso. Seguro de torneo.

## Puntos abiertos en el código

1. **Un solo combate por arranque**: sin máquina de estados de rondas ni
   cronómetro de 1:30.
2. Los `String` de estado (`estadoTel`, resultados de `leerBorde()`) se
   reasignan en cada vuelta. Heredado; no ha dado problema, pero es heap.
3. `girarGradosGiro()` integra `|dps|` (valor absoluto): un empujón en
   contra durante el giro cuenta hacia el objetivo. Con `signoGiroIzq`
   conocido podría integrar con signo.

(Los dos que estaban acá antes —convención de lados y avance recto—
quedaron resueltos el 20-09.)
