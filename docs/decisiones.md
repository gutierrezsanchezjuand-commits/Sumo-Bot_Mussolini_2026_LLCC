# Decisiones

Cambios ya tomados y **por qué**, para no volver a discutirlos ni deshacerlos por
error. Los primeros cinco vienen documentados en el encabezado de
`mussolini.ino` como resultado de pruebas reales sobre el robot.

## PWM a 20 kHz en vez de `analogWrite()`

**Síntoma**: pitido en cada cambio de acción.
**Causa**: la frecuencia por defecto de `analogWrite()` cae dentro del rango
audible, y el motor la reproduce.
**Solución**: LEDC a 20 kHz, fuera del oído humano.

## Impulso de arranque (anti-stiction)

**Síntoma**: el robot se congelaba al detectar el borde blanco.
**Causa**: fricción estática — el motor recibía la orden pero no tenía fuerza para
arrancar desde parado a velocidad baja.
**Solución**: 70 ms a potencia máxima cada vez que una rueda arranca desde 0
(`TIEMPO_IMPULSO_MS`). Si algún movimiento sigue sin arrancar, subir ese valor.

## `INVERTIR_MOTORES`

**Síntoma**: iba hacia atrás en modo ataque.
**Causa**: los motores de este robot están físicamente invertidos.
**Solución**: un solo `#define` que niega la velocidad dentro de
`setMotorSpeed()`, en vez de invertir signos repartidos por todo el código.

## Eliminación del barrido lateral

**Síntoma**: muy lento.
**Causa**: `barrer_y_localizar()` gastaba ~250 ms por ciclo girando para localizar
al rival.
**Solución**: en la zona de 40–100 cm ahora simplemente avanza derecho.

## Timeout del ultrasónico 30 ms → 6 ms

Como de todas formas se ignora todo lo que esté a más de 100 cm, esperar el eco de
objetos fuera de rango era tiempo perdido en cada ciclo del `loop()`.

## Detección de polaridad del IR en la calibración

En vez de asumir que el blanco da lecturas más bajas, `calibracionPorPasos()`
deduce `blancoEsMenor[i]` comparando las dos muestras. Así el código funciona sin
importar cómo se comporte el sensor específico, y la tabla de diagnóstico avisa si
la calibración se hizo en el orden equivocado.

## El módulo IMU degrada, no falla

Si `iniciarGiroscopio()` no encuentra el sensor, `giroListo` queda en `false` y
todas las funciones del módulo caen al comportamiento por tiempo que ya existía.
El robot nunca se queda sin reacción de escape por falta de sensor.

## `detectarLevantado()` se ignora mientras gira rápido — **umbral superado el 2026-09-20**

La vibración de un giro rápido mueve el acelerómetro lo suficiente como para
parecer un levantamiento. Por eso solo se confiaba en el acelerómetro cuando
el giroscopio marcaba menos de 30 °/s.

> **Superado**: ese umbral apagaba la detección durante **toda** la búsqueda
> (~90 °/s). Respondía al método viejo (caída de g solo en Z), donde la
> vibración parecía una caída. Con el ángulo de inclinación 3D sostenido
> 150 ms la vibración no dispara, así que el umbral subió a **120 °/s**: solo
> se apaga en giros realmente violentos. Queda por confirmar con la prueba 5a
> de [Protocolo de pruebas](protocolo-de-pruebas.md).

## BOOT final antes del combate

`esperarInicioCombate()` existe para separar la elección de ronda del arranque:
permite colocar el robot en el dojo después de configurarlo, y hace que el giro
inicial no ocurra hasta ese momento.

---

# Decisiones del 2026-09-20

Las cuatro primeras las tomó el usuario por votación (con recomendación de
Claude); las demás son decisiones de implementación que se explican acá para
no deshacerlas por error. Nada de esto está probado en el robot todavía.

## Ultrasónico: reintento + memoria, no 3 lecturas por ciclo

**Elegido**: no re-disparar mientras el módulo sigue ocupado con un eco
perdido, y retener la última distancia válida 80 ms.
**Descartado**: mínima de 3 (v5) y mediana de 3 (compañero).
**Por qué**: la falla real es el eco perdido por carrocería inclinada, no el
eco espurio. Tres lecturas triplican el tiempo de ciclo y no arreglan que el
HC-SR04 ignore el TRIG durante ~38 ms tras un eco perdido — que era lo que
hacía "desaparecer" al rival.

## Empuje frontal perdido: soltar y flanquear

**Elegido**: si nos rotan mandando recto (> 40 °/s sostenidos) o el ataque
lleva más de 4 s, retroceder, girar 60° contra la rotación y volver de
costado.
**Descartado**: soltar solo por tiempo; nunca soltar.
**Por qué**: con solo IMU (sin encoders) no se puede saber si se está
perdiendo un empuje parejo — la aceleración en régimen es cero. Lo que sí se
ve es que nos **desvían**: ser rotado mandando recto es la señal más
confiable de que el rival tiene más agarre. El tiempo es la red de seguridad.

## Empuje lateral: escapar hacia adelante

**Elegido**: fuera de ataque, ante golpe o rotación forzada, a fondo hacia
adelante 350 ms (vigilando el borde frontal).
**Descartado**: girar hacia el rival (recomendación de Claude); retroceder.
**Por qué (del usuario)**: no depende de saber qué eje del IMU es "lateral"
ni su signo, que hoy no están confirmados. Salir de la línea de empuje es
robusto aunque el sensor esté montado de cualquier forma.

## Umbral IR: 0.60 → **0.45** en los cuatro sensores (cambiado el mismo día)

**Primera decisión (sin datos)**: 0.60 en los cuatro. El usuario priorizó no
salirse nunca sobre los bordes fantasma.

**Segunda decisión (con datos de la corrida 3)**: **0.45 en los cuatro**.
El blanco lee **35–70** en tres sensores y ~1160 en el degradado; el negro
lee 2000–3500. Con 0.60 el umbral del sensor 1 quedaba a ~500 cuentas de su
negro normal y las vibraciones lo cruzaban: seis escapes fantasma en 16 s,
el robot "dando vueltas con el LED morado". El factor no hace falta para
ver el blanco real — está a más de 1000 cuentas de cualquier umbral
razonable — y solo aumenta la sensibilidad al ruido. Ver la bitácora.

Lección registrada: la decisión de sensibilidad **no se puede tomar sin la
tabla de calibración del robot real**.

## Umbral IR: 0.45 → **0.10** (2026-09-25, dojo de negro brillante)

**Síntoma**: en otro dojo, de negro brillante, 85 escapes fantasma en 4
minutos.
**Causa**: reflejo especular. El negro brillante devuelve el IR al
receptor a ciertos ángulos mientras el robot anda — confirmado porque con
el robot sostenido quieto y los motores girando no hubo ni una excursión.
**Discriminante**: la **profundidad**, no la duración. Destellos: 230–806.
Blanco real: 18–94. Con 0.45 el umbral caía en plena banda de destellos.
**Elegido**: 0.10, por el usuario con recomendación. Simulado: 1/70
destellos y 8/8 cruces reales. Verificado en el dojo: cero disparos en la
banda de destellos, y la línea se detectó siempre, incluso de costado y
rápido.
**Descartado**: 0.07 y menos (cero destellos, pero cada escalón le exige
más profundidad a un cruce real — y perder un cruce cuesta el round) y
0.15 (más margen, pero ~4 fantasmas cada 40 s).

**Por qué 0.10 también sirve en un dojo mate**: el factor es relativo a la
calibración, y el blanco mate lee tan hondo como el brillante. Lo único
que cambia en mate es que no hay destellos que filtrar.

Nota: esta es la **tercera** vez que se mueve este número (0.60 → 0.45 →
0.10), y las tres con datos. No es inestabilidad: es que cada dojo nuevo
enseñó algo. Recalibrar siempre sobre el dojo de competencia.

## Ningún `delay()` ciego en maniobras, pero sin reescribir a máquina de estados

**Elegido**: `moverVigilando()` reemplaza a `motores() + delay()` y sigue
mirando IR e IMU. La estructura bloqueante se mantiene.
**Descartado**: reescritura completa sin `delay()` como la del compañero.
**Por qué**: sin hardware para probar, un rewrite es la forma más fácil de
meter errores invisibles. Vigilar dentro del `delay` da casi toda la
seguridad con una fracción del riesgo. El rewrite queda como candidato para
después de que este firmware haya combatido.

## Los sensores traseros avanzan, no retroceden

Hasta el 30-08, `leerBorde()` mezclaba frontal y trasero del mismo lado en
`IZQUIERDA`/`DERECHA`, y el escape para esos casos era **retroceder** 120 ms
y girar. Con un trasero en blanco eso empuja el robot **hacia** el borde. En
la ronda 1 el robot arranca de espaldas al borde ([Reglamento](reglamento.md)), así que
cualquier lectura de un trasero en los primeros instantes lo sacaba solo.
Ahora hay ocho casos y los cuatro `ATRAS*` avanzan.

## Convención de lados unificada — y pendiente de confirmar

En el código del 30-08, el caso `EMPUJE_*` usaba la orden de motores
**opuesta** a la de los demás casos para "el mismo" sentido de giro: en
`FRENTE`, `girarIzquierda` mandaba `motores(+V, −V)`; en `EMPUJE_DERECHA`,
`haciaIzq` mandaba `motores(−V, +V)` y una curva con la rueda izquierda más
rápida (que va a la derecha). Uno de los dos estaba al revés.

Se unificó sobre la convención declarada en [Hardware](hardware.md) (MOTOR1 = rueda
izquierda): **`motores(+V, −V)` = pivote a la izquierda**, y en una curva la
rueda de afuera es la rápida. Si en el robot resulta ser al revés, se
intercambian los pines de `MOTOR1` y `MOTOR2`, y **nada más** — el resto del
código es coherente consigo mismo. Prueba 2 de [Protocolo de pruebas](protocolo-de-pruebas.md).

## El signo del giroscopio se aprende, no se asume

El eje Z está confirmado, pero **nunca se midió si girar a la izquierda da
positivo o negativo**. En vez de un `#define` que alguien tendría que
verificar, `leerIMU()` observa el primer pivote comandado y anota el signo
(`signoGiroIzq`). Hasta que lo aprende, la búsqueda alterna como antes.

## Levantamiento por inclinación 3D, no por caída de g en Z

El umbral viejo (`0.12 g` de caída en Z) equivale a **~28° de inclinación**
— `cos(28°) = 0.88`. Una rampa que levanta el frente inclina el chasis
15–25°: con el método viejo, un levantamiento real probablemente **no
disparaba** (coincide con que la inclinación manual del diagnóstico, ~25°,
tampoco disparó). El ángulo entre el vector de aceleración actual y el de
reposo usa X, Y y Z juntos y a ángulos chicos la señal está en X/Y — que es
exactamente la intuición del usuario. Umbral 12°, salida 8°, 150 ms
sostenidos.

## Desaceleración del giro: 0.45 en los últimos 30°, no 0.18 en la segunda mitad

El 0.18 venía de `code_PDI.py`, que gira a 0.25 y desacelera a 0.15. Nuestro
giro es a 1.0: bajar a 0.18 es un salto de 5.5× y a esa potencia el robot
probablemente ni se mueve, con lo que un giro de 180° con desaceleración
habría terminado en `GIRO_TIMEOUT` a mitad de camino. Proporcionalmente
equivale a ~0.6; se eligió 0.45 en una zona corta. Timeout subido de 2000 a
3000 ms porque 180° a fondo ya mide ~1450 ms en este kit.

## Tiempos de giro de respaldo: 725/1450 ms

Los 400/800 ms nunca se midieron (lo decía el propio `.ino`). El compañero
midió 360° = 2900 ms en el mismo kit. Como ahora solo son el respaldo sin
sensor, se adoptó su medición. Si el IMU funciona, no se usan.

## IMU a 416 Hz e I2C a 400 kHz

Con el default de 104 Hz el loop leía la misma muestra varias veces
seguidas. 416 Hz da una muestra nueva cada ~2.4 ms, a la par del ciclo. El
bus a 400 kHz (el sensor lo soporta) hace la lectura ~4× más corta. Si
`imuFallos` sube en las líneas `T`, bajar `I2C_HZ` a 100000.

## `maniobraEscape()` eliminada

Era código muerto desde que `loop()` llama a `maniobraEscapePreciso()`. Se
borró; la versión con `delay()` puro está en `respaldo_2026-08-30\`.

## Avance recto: P+I sobre velocidad angular, P chico y filtrado

**Elegido**: `avanzarRecto()` con `Kp 0.004` sobre la velocidad angular
filtrada (~30 ms) y `Ki 0.030` con integral acotado a ±10°.
**Descartado**: el PID de `code_PDI.py` tal cual (`Kp 0.15, Ki 0.8, Kd
0.05`, con el `dt` fijado en 1 — ver [Control por giroscopio](giroscopio.md)); y la
primera sintonía propia (`Kp 0.015`).
**Por qué**: el giroscopio manejando tiene ±10–20 °/s de ruido de
vibración. Un P que satura con 20 °/s pelea contra ese ruido (|corr| medio
0.15 para un sesgo real de 0.05) y hace saltar `rotado` sin motivo. El
sesgo de los motores es constante: es trabajo para el integral, no para el
P. Medido: la deriva bajó de −6.6 a +2 °/s en embestida y a ±1 °/s
empujando.

## `rotado` mira el integral al tope, no la saturación

Con la corrección activa, el giroscopio ve **menos** rotación de la que el
rival impone (parte se compensa). La primera idea —disparar cuando la
corrección satura— resultó demasiado sensible (13 disparos en 70 s, varios
con 7–25 °/s). Ahora: `|dps| ≥ 60`, **o** integral al tope **y** `|dps| ≥
30` sostenidos 100 ms. Empujando recto contra la caja 3.4 s no disparó, y
el flanqueo salió por tiempo (4 s), que es lo esperado.

## `signoGiroIzq` arranca en +1

En la ronda 1 no hay pivote antes de la primera embestida, y sin signo la
corrección de rumbo está apagada justo en el tramo más limpio. Como el
signo se midió en este robot (giro a la derecha visto + eje Z arriba), se
deja +1 como inicial; el aprendizaje en el primer pivote sigue activo y lo
corregiría si el sensor cambiara de montaje.

## Plan de correcciones (2026-09-25): decidido con el simulador como banco

El usuario pidió aplicar el el plan de correcciones y pulirlo con
simulaciones. **Criterio**: un cambio entra solo si mejora los puntos en las
baterías del [Simulador](../simulador/README.md), o si arregla un defecto concreto sin empeorar
nada. Los que no movieron la aguja se descartaron aunque el plan los
recomendara. **No deshacer sin volver a correr las baterías.**

- **Sin corte por tiempo del empuje** (`EMPUJE_MAX_MS` eliminado): el
  cambio que más pesa, de 42 a 54 pts.
- **Encarar el golpe** en vez de huir hacia adelante: el ataque de costado
  deja de ganarnos. Depende del signo del eje X del IMU (prueba 13a).
  **Revertido el 25-09 (cambio 28)**: en el robot el arranque propio se leía
  como golpe por detrás (13 medias vueltas en 93 s). Quedó el escape hacia
  adelante, y desde el 26-09 se corta si el sonar ve al rival (cambio 32).
- **Una inclinación no es un golpe**: si Z cae más de 0.05 g, el "golpe" es
  el chasis levantándose.
- **Giro trabado**: cortar a los 300 ms sin avance, no esperar los 3 s.
- **Pivote de 45° acorralado de espaldas** (anti-bucle en `ATRAS`).
- **Seguir a fondo si se pierde el eco pegado**: evita reiniciar la
  corrección y la gracia en pleno empuje.
- **Aviso de IR degradado** y **`MODO_SIMPLE`** como seguro de torneo.
- **Descartado**: detectar la búsqueda trabada (D4), empujar en curva para
  romper empates (empeoró), cambiar el flanqueo, empuje final en la línea.
- **Las velocidades no se tocaron**: sigue valiendo la decisión del 23-09.
  La velocidad recta del simulador no está medida.

## Barrido amplio al perseguir: probado y descartado (2026-09-27)

Pedido del usuario: que a 40–100 cm no avance derecho, sino que gire hacia
los lados para confirmar dónde está el rival. El tanteo de ±3° (cambio 31) ya
hacía eso en chico; se probaron barridos más amplios, en zigzag, con el
giroscopio marcando el centro del eco. Mismas peleas para todas las
variantes ([simulador](../simulador/README.md), física 3.1):

| Variante | General (30 peleas) | Foco (24 peleas) |
|---|---|---|
| **Tanteo ±3° (el actual)** | **50 pts**, 4 derrotas | **28 pts**, 6 derrotas |
| ±45° | 45, 5 derrotas (con 60 peleas: 86 contra 94) | 23, 7 |
| ±20° | 40, 6 | 20, 8 |
| ±10°, rueda exterior 0.8 | 45, 5 | 23, 7 |
| ±10° a motores al máximo (exterior 1.0) | 42–44, 6–8 | 21–23, 7–9 |

Todas salen peor. Al apartar el frente del rival, uno que embiste llega en
ángulo o de costado (en una pelea de ±45°: golpe lateral de 1.07 g a los 2 s
y afuera). **Límite de la prueba**: el simulador no tiene ecos falsos (gente u
objetos fuera del dojo), así que mide el costo de barrer pero no el beneficio
de confirmar. Si en el dojo real el robot persigue cosas que no son el rival,
vale la pena volver a mirarlo con esa captura.

## Nivelación de motores: probada y descartada (2026-09-27)

Pedido del usuario al ver en el [simulador](../simulador/README.md) el arco de
una carga. La curva es real: el robot tiene un motor más fuerte y el simulador
lo copia (derecha +11 %). La corrección por giroscopio ya la endereza: en una
carga de ~30 cm contra la caja se desvía 0.8–1.0 cm de costado y 2.0–2.6° de
rumbo. Se probaron tres formas de nivelar más, con las mismas peleas:

| Variante | Carga de ~30 cm | General (30 peleas) | Foco (24 peleas) |
|---|---|---|---|
| **actual** | 0.8–1.0 cm, 2.0–2.6° | **50 pts**, 4 derrotas | **28 pts**, 6 derrotas |
| nivelación automática (aprende qué motor es más fuerte y le quita potencia) | 0.7–0.9 cm, 1.5–2.2° | 48, 4 | 26, 6 |
| corrector más firme (`KI_RECTO` 0.03 → 0.05) | 0.5–0.7 cm, 1.3–1.7° | 45, 5 | 25, 7 |
| las dos juntas | 0.4–0.6 cm, 1.0–1.5° | 44, 6 | 24, 8 |
| las dos juntas, con el desbalance al revés | — | 35, **13** | 15, **13** |

(El actual con el desbalance al revés: 45 pts, 7 derrotas; foco 24, 8.)

La carga sale más derecha, pero las peleas empeoran en las dos baterías, y con
el desbalance del otro lado la combinación se desarma. **No se cambió nada.**
Una nivelación fija tampoco sirve: el motor más fuerte cambia de lado entre
sesiones ([Parámetros](parametros.md)).
