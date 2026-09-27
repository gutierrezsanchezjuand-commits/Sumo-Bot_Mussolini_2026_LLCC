# Control por giroscopio: de dónde sale y en qué nos desviamos

`giroscopio_control.ino` dice basarse en `Control_Movimientos.md` y `code_PDI.py`
del repo oficial (los repos de referencia), de Tomás de Camino Beck. Al leer la
fuente aparecen **tres desviaciones respecto al original** y **una función
completa que no se aprovechó**.

## Cómo funciona el giro por IMU

El giroscopio mide **velocidad angular** en rad/s, no ángulo. Para saber cuánto
giró el robot hay que **integrar en el tiempo**: sumar `velocidad × dt` en cada
vuelta. Como el sensor tiene un error constante (**drift**) que no es cero ni
estando quieto, se mide ese error al arrancar y se resta siempre.

Es *dead reckoning*: no hay referencia externa que corrija, así que el error se
acumula. Por eso los giros son confiables en tramos cortos y no para navegar.

## Desviación 1 — el filtro del drift es 6 veces más flojo

| | `code_PDI.py` | `giroscopio_control.ino` |
|---|---|---|
| Descarta muestras con | `abs(v) < 0.008` rad/s | `fabs(v) < 0.05` rad/s |
| En grados/s | ≈ 0.46 °/s | ≈ **2.9 °/s** |
| Duración | 5 s | 2 s |

El filtro existe para descartar sacudidas durante la calibración. El nuestro
acepta como "quieto" cualquier cosa por debajo de 2.9 °/s, o sea que un
movimiento leve del robot durante esos 2 s **entra al promedio del drift**.

Como se promedian ~400 muestras y el ruido suele ser simétrico, en la práctica
tiende a compensarse. Pero si alguien mueve el robot en una sola dirección
mientras calibra, el sesgo pasa entero. **El comentario del código dice "igual
que code_PDI.py" — y no es igual.**

## Desviación 2 — giramos a 4 veces la velocidad del original

`code_PDI.py` gira con `velocidad=0.25` por defecto y desacelera a `0.15`.
Nosotros llamamos a `girarGradosGiro(..., VEL_ATAQUE, ...)`, o sea **1.0**, y
desaceleramos a `0.18`.

Es una decisión defendible — en combate un giro lento es un giro perdido — pero
tiene consecuencias que el original no tenía que enfrentar:

- El bucle integra mientras el robot rota mucho más rápido, así que **cada
  vuelta del bucle vale más grados** y el sobregiro es más probable. Por eso
  existe `MARGEN_ERROR_GRADOS = 4.0`.
- Vale **verificar el rango del giroscopio configurado por la librería**. Si
  quedara en ±250 °/s y el robot lo superara, el sensor satura, la integral
  cuenta de menos y el robot gira **de más** o sale por el timeout de 2000 ms.

  Contra esta hipótesis: el compañero mide 360° en 2900 ms a fondo, o sea ~124 °/s
  de promedio — bastante por debajo de 250. Con motores parecidos, **es poco
  probable que estemos saturando**. Queda como algo a descartar, no como la
  explicación principal.

**Síntoma que delata el problema**: `[Giro] Timeout en girarGradosGiro` repetido
en el Serial. Si aparece seguido, el robot no está llegando al ángulo y sale por
tiempo. Vale la pena mirarlo antes de tocar ninguna constante.

## Desviación 3 — la corrección de sobregiro cambió de forma

El original resta 2° al objetivo (`grados = abs(grados)-2`) y gira hasta
alcanzarlo. Nosotros paramos a 4° antes (`objetivo - MARGEN_ERROR_GRADOS`).

Son la misma idea con distinto número, y el nuestro es el doble de conservador —
coherente con girar 4 veces más rápido. Está bien; solo conviene saber que **no
son equivalentes** si alguna vez se comparan resultados con el código base.

## La función que no se aprovechó: `straight_move()` con control PDI

`code_PDI.py` trae un **avance en línea recta con control PDI** que usa el mismo
giroscopio para corregir el rumbo en tiempo real: si el robot empieza a
desviarse, ajusta cada motor para volver a la recta.

```python
error = sensor.gyro[2] - drift          # se está desviando
correccion = Kp*error + Ki*integral + Kd*derivativo
v1 = base + correccion
v2 = base - correccion
```

Ganancias del original: `Kp=0.15, Ki=0.8, Kd=0.05`, con la corrección limitada a
±0.3 para no sobrecorregir.

**Por qué importa en sumo**: empujar es empujar *derecho*. Si un motor tira más
que el otro —y con motores de kit y pilas descargándose desigual, siempre pasa—
la embestida se va curvando, el contacto con el rival se pierde de costado y
podés terminar saliéndote solo. Hoy nuestro ataque es `motores(-1.0, -1.0)` a
lazo abierto: **no hay nada que corrija esa curva.**

Es la mejora de mayor techo que sale de esta lectura, y también la más cara: hay
que traducir el PDI a C++, ajustar tres ganancias y no romper el impulso
anti-stiction. Candidata a después de lo barato de [Linaje del codigo](historia-del-codigo.md).

> ⚠️ Un detalle del original que **no** hay que copiar: en `straight_move()` el
> `dt` está fijado a `1` con el cálculo real comentado (`dt = 1 #t_actual -
> t_anterior`). Eso desvirtúa los términos integral y derivativo — quedan
> escalados por el tiempo de ciclo en vez de ser independientes de él. Si se
> porta, usar el `dt` real.

## Lo que sí replicamos bien

- Restar el drift en cada lectura.
- Desacelerar en el último tramo para no pasarse.
- La lógica de integración y el eje Z (`sensor.gyro[2]` en el original,
  `GYRO_EJE_GIRO 2` en el nuestro), confirmado además con el diagnóstico en el
  robot real — ver [Hardware](hardware.md).
- El fallback por tiempo cuando no hay sensor, que el original ni siquiera tiene.

---

# Qué cambió el 2026-09-20

Las tres desviaciones de arriba se atendieron, y aparecieron dos cosas que
el original no tiene. Detalle de implementación en [Arquitectura del codigo](firmware-arquitectura.md);
razones en [Decisiones](decisiones.md).

| Desviación | Estado |
|---|---|
| 1 — filtro del drift 6× más flojo | `FILTRO_DRIFT_RAD_S = 0.015` (antes 0.05; el original 0.008). Se imprime cuántas muestras entraron al promedio |
| 2 — giramos a 4× la velocidad | sigue a 1.0 (defendible en combate), pero la desaceleración pasó de 0.18 a **0.45 en los últimos 30°** — 0.18 desde 1.0 era un salto de 5.5× y a esa potencia el robot probablemente no gira; el original baja de 0.25 a 0.15 (1.7×) |
| 3 — margen de 4° | sin cambio |
| Rango del giroscopio | ahora explícito: **±1000 °/s**, 416 Hz. Con el default de 104 Hz el loop leía la misma muestra varias veces |
| `straight_move()` con PDI | **portado el 20-09 por la tarde** como `avanzarRecto()`: P+I sobre velocidad angular, P chico y filtrado, integral acotado, `dt` real (no el `dt = 1` del original). Deriva medida: de −6.6 / +15–30 °/s a +2 libre y ±1 empujando. Ver [Arquitectura del codigo](firmware-arquitectura.md) y [Decisiones](decisiones.md) |

## Dos cosas nuevas que el original no tiene

**El signo se aprende.** El eje Z está confirmado, pero nunca se midió si
girar a la izquierda da velocidad angular positiva o negativa. `leerIMU()`
mira el primer pivote comandado (`der == −izq`, `|dps| > 30`) y anota
`signoGiroIzq`. Con eso la búsqueda puede girar **hacia** el rumbo donde se
vio al rival por última vez, sin que nadie tenga que verificar el montaje.

**Rumbo continuo.** `rumboDeg` integra `imuDps × dt` en cada vuelta —
también dentro de `girarGradosGiro()` y de `moverVigilando()`, que llaman a
`leerIMU()`. Es dead reckoning: acumula error, pero para "¿hacia dónde
estaba el rival hace 2 s?" alcanza de sobra. Vigencia de la memoria: 3 s.

## Lo que hay que tener presente

- `girarGradosGiro()` sigue integrando `|dps|` (valor absoluto), como el
  original: si el rival nos empuja en sentido contrario durante el giro,
  cuenta igual hacia el objetivo. Con `signoGiroIzq` aprendido se podría
  integrar con signo; se dejó como estaba para no cambiar dos cosas a la vez.
- Un `dt > 100 ms` (hueco largo sin lecturas) se descarta: `rumboDeg` no
  integra basura, pero tampoco integra lo que pasó en ese hueco. Con
  `leerIMU()` dentro de todas las maniobras, no debería haber huecos.
