# Parámetros a calibrar

Valores que hoy son **estimados o supuestos**, no medidos en el robot real. Cada
uno tiene su prueba propuesta. Anotar acá el valor medido cuando se pruebe.

> **2026-09-20**: el firmware nuevo cambió varios de los valores de abajo y
> agregó muchos otros. La tabla consolidada está al final de esta página
> (**Parámetros del firmware 2026-09-20**); lo que sigue entre medio es la
> historia de cómo se llegó a ellos, que sigue valiendo.

## Giro inicial por ronda

| Constante | Valor actual | Estado |
|---|---|---|
| `TIEMPO_GIRO_90_MS` | 400 ms | **sin medir** |
| `TIEMPO_GIRO_180_MS` | 800 ms | **sin medir** |

**Prueba**: en banco, sin oponente, marcar la orientación inicial y verificar que
el giro sea de ~90° y ~180° reales. Ajustar hasta que cierre.

También es una suposición **la dirección del giro de la ronda 2**: si el juez
coloca al rival del otro lado, el robot igual lo encuentra por búsqueda normal,
solo tarda más.

> Nota: si `giroInicial()` se migra a `girarGradosGiro()` (ver
> [Arquitectura del codigo](firmware-arquitectura.md)), estas dos constantes dejan de importar para el
> giro de ronda — pero siguen usándose como fallback en `reaccionLevantado()`.

## Ángulos de `maniobraEscapePreciso()`

Derivados **por proporción** con los tiempos del código original, no medidos en un
escape real:

| Situación | Ángulo | Equivalencia asumida |
|---|---|---|
| `EMPUJE_*` | ±68° | ~300 ms del original |
| `FRENTE` | ±200° | ~900 ms del original |
| `IZQUIERDA` / `DERECHA` | ±90° | 400 ms del original |

**Prueba**: forzar cada tipo de borde con el robot sobre el dojo y ver si termina
mirando hacia adentro. El caso `FRENTE` (200°) es el más sospechoso: 200° es más
de media vuelta, elegido para "pasarse" a propósito.

## Detección de levantamiento

| Constante | Valor actual | Estado |
|---|---|---|
| `UMBRAL_LEVANTADO` | 0.12 g | estimado, con respaldo parcial |
| `DURACION_LEVANTADO_MS` | 150 ms | estimado |
| `UMBRAL_GIRO_ACTIVO` | 30 °/s | estimado |

Respaldo que sí existe: el diagnóstico midió **1.04 g en reposo** y **0.93–0.95 g**
inclinando el chasis a mano. El delta real observado es de ~0.09–0.11 g, o sea
**apenas por debajo del umbral de 0.12** — es probable que 0.12 sea demasiado alto
y no dispare con una inclinación leve. Candidato a bajar a ~0.07–0.08.

**Prueba en dos partes**:
1. Dejar que el robot busque y gire libremente → **no** debería disparar (falsos
   positivos por vibración).
2. Con el robot quieto, levantar el frente del chasis a mano → **sí** debería
   disparar. Mirar el Serial.

## Reacción al levantamiento

| Constante | Valor actual | Estado |
|---|---|---|
| retroceso | 280 ms | estimado |
| giro posterior | ±90° | estimado |

No medidos en un levantamiento real.

## Margen del giro por IMU

`MARGEN_ERROR_GRADOS = 4.0` es la tolerancia pedida (±4°). `TIMEOUT_GIRO_MS = 2000`
es el límite de seguridad por si el sensor falla o el drift quedó mal calibrado —
conviene revisar el Serial buscando `[Giro] Timeout`, porque si aparece seguido
significa que el robot **no está llegando al ángulo pedido** y sale por tiempo.

## Riesgos heredados del kit (reportados por el compañero)

Mismo kit, mismos problemas probables. Ver los repos de referencia.

| Riesgo | Detalle |
|---|---|
| **Brownout con pilas** | Reinicios espontáneos al alimentar por baterías, no por USB. Mitigable por software bajando el umbral de brownout; el arreglo real es hardware (condensador en la entrada, o pilas de mejor descarga). **Probar el robot alimentado por pilas, no por USB** — el bug no aparece en el escritorio. |
| **IR en IO34** | Lecturas inconsistentes en varias sesiones. En nuestro código IO34 es `PIN_SEN3`, **trasero izquierdo**. Revisar su columna en la tabla de diagnóstico de la calibración: si `negro` y `blanco` salen muy pegados, ese sensor no está discriminando. |

## Umbral de los IR frontales

El v5 en CircuitPython usaba `FACTOR_UMBRAL = [0.62, 0.62, 0.50, 0.50]` porque
**los dos frontales resultaron menos sensibles** y necesitaban un umbral corrido
hacia el negro. El Arduino actual usa punto medio para los cuatro. Detalle en
[Linaje del codigo](historia-del-codigo.md).

**Prueba**: mirar la tabla de diagnóstico que ya imprime `calibracionPorPasos()`
y comparar la separación `negro`–`blanco` de los frontales contra la de los
traseros. Si los frontales tienen menos separación, el factor 0.62 estaba
justificado y hay que reponerlo.

---

# Contraste con datos del compañero (2026-08-30)

Su robot corre el **mismo kit**: mismos motores, mismas pilas, mismo chasis. Sus
constantes, ajustadas empíricamente sobre hardware equivalente, son la mejor
referencia externa que tenemos. Ver el repo del compañero.

## El tiempo de giro de 90 ms está probablemente corto — a la mitad

Él mide **360° a fondo = 2900 ms** (`TIEMPO_GIRO_360_MS`), y deriva los demás
ángulos por proporción. De ahí sale:

| Ángulo | Gerardo (medido) | Mussolini (supuesto) |
|---|---|---|
| 90° | **725 ms** | 400 ms |
| 180° | **1450 ms** | 800 ms |

Ambos giran pivoteando a potencia máxima, así que la comparación es justa salvo
por diferencias de masa y estado de las pilas. **Nuestros valores son casi la
mitad de los suyos.** Como los nuestros nunca se midieron —el propio `.ino` lo
dice— la explicación más simple es que están cortos, y que el giro inicial de la
ronda 2 se queda en ~50° en vez de 90°.

**Esto no invalida la prueba de banco: la reemplaza por una hipótesis concreta.**
Medir 360° en nuestro robot y derivar de ahí, igual que hizo él, en vez de
tantear 90° a ojo. Es más fácil de ver a simple vista si una vuelta completa
quedó completa que si un cuarto de vuelta quedó exacto.

## Corrección: el umbral de levantamiento probablemente NO estaba alto

> **Esto corrige lo que escribí antes en esta misma página.** La afirmación
> anterior era que `UMBRAL_LEVANTADO = 0.12` estaba demasiado alto y había que
> bajarlo a ~0.07–0.08. El dato nuevo la debilita.

Él dispara con `z < 9.10 m/s²`, ajustado por prueba física. Nuestro umbral
equivale a:

```
accelZReposo 1.04 g = 10.20 m/s²
disparo en   1.04 - 0.12 = 0.92 g = 9.03 m/s²
```

**9.03 contra 9.10: prácticamente el mismo umbral**, alcanzado por dos equipos
por caminos independientes. Eso es convergencia, no coincidencia.

Lo que sigue siendo cierto es la observación original: la inclinación manual del
diagnóstico dio **0.93–0.95 g = 9.12–9.32 m/s²**, que **no cruza ninguno de los
dos umbrales** — ni el nuestro ni el suyo, por poco.

La lectura correcta ya no es "nuestro umbral está mal", sino **"la inclinación a
mano del diagnóstico fue más suave que un levantamiento real"**. Una rampa que se
mete debajo del chasis lo inclina bastante más que un empujoncito con la mano.

**Prueba que decide**: repetir el diagnóstico inclinando el robot como lo haría
una rampa —metiendo algo plano y rígido bajo el frente hasta levantar las ruedas
delanteras— y ver hasta cuánto baja `z`. Si baja de 9.0, los dos umbrales están
bien y no hay nada que tocar. Si se queda en 9.1–9.3, hay que subir el umbral en
ambos robots.

## Dos refinamientos suyos que no tenemos

- **Histéresis de salida**: entra en levantado bajo 9.10 pero solo sale sobre
  **9.50**. Evita que el estado titile en el límite. Nosotros usamos el mismo
  umbral para entrar y salir.
- **Confirmación de 1250 ms** contra nuestros 150 ms. El suyo es 8 veces más
  conservador: casi imposible un falso positivo, pero reacciona tarde. El
  nuestro reacciona rápido y arriesga disparar por una sacudida. Ninguno de los
  dos está obviamente bien — depende de si en la práctica sobran falsos
  positivos o faltan detecciones.

## Riesgo de I2C sin validar — **resuelto el 2026-09-20**

Su IMU descarta lecturas cuya magnitud del vector de aceleración cae fuera de
`[2.0, 40.0] m/s²` y retiene el último valor bueno. Hasta el 30-08 la nuestra
no validaba nada. Desde el 20-09 `leerIMU()` aplica exactamente ese filtro,
retiene los valores anteriores y cuenta los fallos en `imuFallos` (columna
de la telemetría).

---

# Parámetros del firmware 2026-09-20

Todos son **puntos de partida sin medir**. La prueba de cada uno está en
[Protocolo de pruebas](protocolo-de-pruebas.md) (el número entre paréntesis es el paso). Anotar acá
el valor medido y la fecha.

## IR

| Constante | Valor | Qué es | Prueba |
|---|---|---|---|
| `MUESTRAS_CALIBRACION` | 12 | muestras promediadas por paso | (1) ✔ |
| `FACTOR_UMBRAL[4]` | **0.10** ×4 (0.60 → 0.45 el 20-09 → 0.10 el 25-09) | corrimiento del umbral hacia el negro | ✔ medido en dojo de negro brillante: con 0.45, 70/70 destellos disparaban; con 0.10, 0 en la banda de destellos y todos los cruces reales detectados |
| `SEPARACION_MINIMA_IR` | 150 | bajo esto, aviso `DEBIL` | (1) ✔ ninguno avisó |

**Medido el 2026-09-20** (tres calibraciones sobre el dojo real; varía con
la posición exacta de los sensores):

| Sensor | negro | blanco | separación | nota |
|---|---|---|---|---|
| 0 frontal izq (IO36) | 3422–3536 | **1161–2384** | 1038–2375 | **degradado**: refleja mucho menos; sirve |
| 1 frontal der (IO39) | 2230–2820 | 47–65 | 2165–2771 | sano; **su negro manejando cae a ~2200** |
| 2 trasero izq (IO34) | 1993–2194 | 34–37 | 1956–2160 | sano (el sospechoso del compañero, acá no) |
| 3 trasero der (IO35) | 2469–2612 | 41–47 | 2423–2571 | sano |

Con 0.45 los umbrales quedan en ~2230 / ~1300 / ~1000 / ~1200: más de 1000
cuentas del blanco y ~900–1200 del negro manejando.

**Medido el 2026-09-25 en un dojo de negro brillante** (otro dojo):

| Sensor | negro | blanco | umbral con 0.10 |
|---|---|---|---|
| 0 frontal izq | 3193–3393 | 75–80 | ~411 |
| 1 frontal der | 1688–1780 | 22–25 | ~189 |
| 2 trasero izq | 1200–1701 | 18–20 | ~174 |
| 3 trasero der | 1786–2070 | 21–22 | ~226 |

Dos cosas cambian contra el dojo del 20-09: **el sensor 0 ya no parece
degradado** (su blanco lee 75–80, igual que los otros), y el negro de este
dojo lee más bajo — refleja más. **Destellos medidos: 230–806. Blanco
real: 18–94.** El umbral tiene que caer en ese hueco.

## Ultrasónico

| Constante | Valor | Qué es | Prueba |
|---|---|---|---|
| `RETENCION_DIST_MS` | 80 ms | cuánto se conserva la última distancia válida sin eco | (8) |
| `PERDIDO_TRAS_MS` | 150 ms | sin ver al rival este tiempo → búsqueda | (8) |
| `DIST_CONTACTO` | 12 cm | por debajo, se considera contacto | ✔ medido: en contacto la caja lee ~7 cm |
| `PERDIDO_CONTACTO_MS` | 500 ms | desde el contacto, espera antes de búsqueda | ✔ medido: con 150 ms entraba en búsqueda 6 veces en 3 s de empuje |

## Giros

| Constante | Valor | Qué es | Prueba |
|---|---|---|---|
| `MARGEN_ERROR_GRADOS` | 4° | se detiene este margen antes del objetivo | ✔ medido: el rumbo real termina 5–9° más allá del corte por inercia; 90° → 92–95° reales |
| `ZONA_DESACELERACION_GRADOS` | **25°** (era 30) | últimos grados a velocidad reducida (giro de ronda) | ✔ |
| `VEL_DESACELERACION` | **0.75** (era 0.45) | velocidad en esa zona | ✔ medido: a 0.45 se quedó parado a 72° hasta el timeout; a 0.75 el giro de 90 tardó 467 ms y llegó a ~94 |
| `TIMEOUT_GIRO_MS` | 3000 ms | corte de seguridad | ✔ se vio disparar (a 0.45) |
| `TIEMPO_GIRO_90_MS` / `_180_MS` | **500 / 1000 ms** (eran 725/1450) | **solo respaldo** sin IMU | ✔ medido con IMU: 90° a fondo = 400–560 ms. Con 725 el respaldo giró ~150° en la corrida 4 (el usuario vio "media vuelta") |
| `FILTRO_DRIFT_RAD_S` | 0.015 | muestras más rápidas no entran al drift | ✔ 397–400/400 aceptadas; drift 0.33–0.46 °/s |
| `I2C_HZ` | 400000 | velocidad del bus | ✔ 0 fallos en calma; 4–6 en golpes fuertes, descartados |

Ángulos de escape (heredados por proporción): `FRENTE` 200°, `EMPUJE_*`
68°, `FRENTE_*` 90° ✔ (medido 84–100° reales), `ATRAS_*` 45°. `FRENTE`,
`EMPUJE_*` y `ATRAS_*` todavía sin ver en el robot.

## Levantamiento

| Constante | Valor | Qué es | Prueba |
|---|---|---|---|
| `INCLINACION_LEVANTADO_DEG` | **15°** (era 12) | entra por encima de esto | ✔ medido: levantar a mano lee 22.6 / 26.7 / 23.1 al disparar; empujando a fondo llega a 10–14 momentáneo |
| `INCLINACION_SALIDA_DEG` | **10°** (era 8) | sale por debajo (histéresis) | ✔ |
| `DURACION_LEVANTADO_MS` | **250 ms** (era 150) | sostenido antes de disparar | ✔ medido: giros y golpes dan picos de 22–27° de un ciclo; con 150 filtraba por poco |
| `UMBRAL_GIRO_ACTIVO` | 120 °/s | girando más rápido, no se evalúa | ✔ 25 s de combate sin falsos positivos |
| `RETROCESO_LEVANTADO_MS` | 280 ms | retroceso de la reacción | visto, sin medir el efecto |
| `GIRO_LEVANTADO_GRADOS` | 90° | giro posterior | ✔ |

Eje "adelante" del IMU: al levantar el frente a mano, **`day` subió a
+0.42/+0.45** y `dax` casi no cambió. O sea **Y es el eje longitudinal**
(adelante/atrás) y X el lateral, con el frente levantado dando `day > 0`.
Hoy no se usa para decidir nada; queda para cuando haga falta el lado del
empuje.

## Golpe y empuje

| Constante | Valor | Qué es | Prueba |
|---|---|---|---|
| `UMBRAL_GOLPE_G` | 0.35 g | aceleración horizontal que cuenta como golpe | ✔ contacto con la caja: 0.36–1.86 g; manoseo: 0.35–0.71 |
| `COOLDOWN_GOLPE_MS` | 300 ms | entre golpes | ✔ |
| `VIGENCIA_GOLPE_MS` | 200 ms | un golpe más viejo ya no dispara reacción | ✔ nuevo: sin esto, un golpe durante una maniobra disparaba al terminarla |
| `GRACIA_TRAS_CAMBIO_MS` | 150 ms | tras cambiar la orden de motores, nada cuenta | ✔ |
| `UMBRAL_ROTACION_FORZADA_DPS` | **60 °/s** (era 40) | mandando recto, rotar más que esto | ✔ medido: recto a fondo el robot curva solo a 15–30; rotaciones reales 100+ |
| `DURACION_ROTACION_FORZADA_MS` | 100 ms | sostenido | ✔ |
| ~~`EMPUJE_MAX_MS`~~ | ~~4000 ms~~ | **eliminado el 25-09** (cambio 21): soltaba ganando o perdiendo | — |
| `ANGULO_FLANQUEO` | 60° | | (6) |
| `RETROCESO_FLANQUEO_MS` / `AVANCE_FLANQUEO_MS` | 200 / 250 ms | | (6) |
| `ESCAPE_ADELANTE_MS` | 350 ms | reacción a la rotación forzada fuera de ataque (el golpe ahora encara) | (7) |

## Anti-bucle

| Constante | Valor | Prueba |
|---|---|---|
| `VENTANA_ANTIBUCLE_MS` | 3000 ms | (4) |
| `ESCAPES_ANTIBUCLE` | 3 | (4) |
| `EXTRA_GIRO_ANTIBUCLE` | 45° | (4) |

## Rumbo del rival

| Constante | Valor | Qué es |
|---|---|---|
| `RUMBO_RIVAL_VIGENCIA_MS` | 3000 ms | más viejo que esto, se vuelve a alternar |
| `DPS_GIRO_EVIDENTE` | 30 °/s | pivote claro para aprender `signoGiroIzq` |
| `signoGiroIzq` (inicial) | **+1** | medido el 20-09; el primer pivote lo re-aprende |

## Avance recto (corrección por giroscopio) — medido el 2026-09-20

| Constante | Valor | Qué es | Medido |
|---|---|---|---|
| `KP_RECTO` | 0.004 | corrección por °/s (filtrado) | ✔ con 0.015 saturaba y peleaba con el ruido |
| `KI_RECTO` | 0.030 | corrección por grado acumulado | ✔ lleva el sesgo constante (0.04–0.06 en este robot) |
| `INTEGRAL_MAX_RECTO` | 10° | tope anti-windup (= 0.30 de corrección) | ✔ |
| `CORRECCION_MAX_RECTO` | 0.30 | tope total | ✔ |
| `FILTRO_DPS_RECTO` | 0.10 | paso bajo del P, ~30 ms | ✔ |

Resultado: deriva en embestida libre **+1.8 / +2.1 / +4.0 °/s** (sin
corrección: −6.6 hoy, +15–30 en la corrida 3); empujando 2–3 s, **−0.6 /
+0.9 / −1.3 °/s**. Si alguna vez oscila (la corrección alternando de
signo cada pocos ciclos), bajar `KP_RECTO` a 0.002; si tarda en enderezar,
subir `KI_RECTO` a 0.04.


## Firmware del plan (2026-09-25) — constantes nuevas, sin medir en el robot

Elegidas y calificadas en el [Simulador](../simulador/README.md); la prueba en el robot está en
[Protocolo de pruebas](protocolo-de-pruebas.md) (sección 13).

| Constante | Valor | Qué es | Prueba |
|---|---|---|---|
| `ANGULO_MINIMO_ENCARAR` | 30° | golpe casi de frente: no se gira, el sonar ya lo ve | (13a) |
| `Z_GOLPE_INCLINADO_G` | 0.05 g | si Z cayó más que esto en el golpe, es el chasis inclinándose (a 20° cae 0.06) | (13b) |
| `VENTANA_GIRO_TRABADO_MS` | 300 ms | ventana para medir si un giro avanza | (13d) |
| `GIRO_MINIMO_VENTANA` | 8° | menos que esto en la ventana = trabado (un pivote sano a 0.75 hace 27+) | (13d) |
| `BLANCO_MAX_FRACCION` | 0.25 | blanco por encima de esta fracción del negro = sensor degradado | (13f) |
| `MODO_SIMPLE` | 0 | `#define`: 1 apaga levantamiento, golpe y rotación forzada | — |

Riesgo a vigilar: **el eje X del IMU** (derecha) no está medido, se dedujo de
Z arriba y Y adelante. Si en 13a el robot gira al revés del golpe, hay que
invertir el signo de `golpeAx` en `reaccionEmpujeLateral()`.

## Medido el 2026-09-26 (capturas + simulador, física 3)

| Parámetro | Valor | De dónde sale |
|---|---|---|
| Velocidad recta a fondo | **~20 cm/s por USB** (antes se suponían 30) | acercamiento a la caja en TRACK/ATAQUE, 18 tramos de 1 s o más: p50 18.9 cm/s. Con pilas puede ser más: falta cronometrar |
| Arranque en recto | la primera lectura da +0.13 g y la siguiente ~0: tarda ~70 ms más que el pivote en tomar velocidad | capturas, pasar de BUSCA a TRACK/ATAQUE |
| `TAU_INCLINACION_S` | 0.10 s (cambio 29) | simulador: 100 % de levantamientos detectados, mediana 0.39 s, 0.3 falsos/min |
| `HUECO_EVAL_LEVANTADO_MS` | 50 ms (cambio 29) | el loop da una vuelta cada pocos ms; cualquier maniobra dura más |
| `DURACION_LEVANTADO_MS` | se queda en 250 | 350 baja los falsos de 0.3 a 0.2/min pero la mediana sube a 0.56 s |
| Golpes falsos del propio robot | 23–80 por minuto según el estado (umbral 0.35 g) | capturas; con la reacción de avanzar no cuestan casi nada, con encarar costaban medias vueltas |

## Cambios 30–33 (2026-09-26): primeros valores, sin medir en el robot

| Constante | Valor | Qué hace |
|---|---|---|
| `RETROCESO_ESCAPE_FRENTE_MS` | 450 (antes 180) | retroceso del escape con los dos sensores frontales |
| `RETROCESO_ESCAPE_LATERAL_MS` | 350 (antes 120) | retroceso con un solo sensor frontal |
| `ANGULO_ESCAPE_LATERAL` | 180 (antes 90) | giro con un solo sensor frontal (el de dos sigue en 200) |
| `DURACION_DETECCION_GIRO_MS` | 60 | eco nuevo < 40 cm sostenido para cortar un escape por el sonar |
| `TANTEO_DPS` / `TANTEO_SEMIPERIODO_MS` | 20 °/s / 300 ms | barrido del tanteo: ±3° |
| `RETROCESO_MIN_LEVANTADO_MS` / `MAX` | 250 / 1500 | límites del retroceso por levantamiento |
| `PLANO_SOSTENIDO_MS` | 150 | inclinación filtrada < 10° sostenida para dar la base por apoyada |

Si el escape de frente todavía se ve corto en el dojo, subir los dos
retrocesos: el retroceso vigila el borde de atrás, así que alargarlo no lo
tira del otro lado. Si `LEVANTADO_APOYO` termina seguido en `tope` sin estar
levantado, el umbral de 10° es bajo para la vibración de ese dojo.
