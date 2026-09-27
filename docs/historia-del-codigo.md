# Linaje del código: qué se ganó y qué se perdió al pasar a Arduino

El `NOTAS.md` del repo propio (los repos de referencia) guarda el **v5 en
CircuitPython**, anterior al código Arduino actual. Comparando los dos aparece
que el port **no fue una traducción 1:1**: se ganaron cosas, pero también se
perdieron mejoras que ya habían sido probadas y justificadas por escrito.

Esto importa porque varias de las cosas perdidas **eran respuestas a problemas
reales medidos en el robot**, no adornos.

## Lo que se ganó en Arduino

- PWM a 20 kHz (el pitido), impulso anti-stiction, `INVERTIR_MOTORES` — ver
  [Decisiones](decisiones.md).
- Todo el módulo IMU: giro por ángulo real, detección de levantamiento.
- Selección de ronda y giro inicial según el [Reglamento](reglamento.md).
- Detección automática de la polaridad del IR (`blancoEsMenor`).

## Lo que se perdió

### 1. Calibración promediada — el más importante

| | CircuitPython v5 | Arduino actual |
|---|---|---|
| Muestras por paso | **12, promediadas** (`MUESTRAS_CALIBRACION`) | **1 sola** `analogRead` |

El v5 promedia 12 lecturas **explícitamente** "para reducir el efecto del ruido
eléctrico sobre los sensores frontales". El código Arduino toma una sola muestra
por sensor y por paso, y sobre esa única muestra construye el umbral de todo el
combate.

**Es un retroceso directo sobre un problema que ya se había diagnosticado.** Si
la muestra única cae en un pico de ruido, el umbral queda corrido y el robot o
ve bordes fantasma o no ve el borde real. Y como la calibración se hace una vez
al principio, el error dura todo el combate.

### 2. Umbral por factor, no punto medio

El v5 calculaba `umbral = blanco + (negro - blanco) * factor` con:

```
FACTOR_UMBRAL = [0.62, 0.62, 0.50, 0.50]   # [FrontIzq, FrontDer, TrasIzq, TrasDer]
```

Con el comentario: *"Los sensores FRONTALES necesitan valores más altos de lo
normal para marcar el borde"*. O sea, **empíricamente los dos IR frontales
resultaron menos sensibles** y se les subió el umbral hacia el negro para que
detectaran el blanco más fácil.

El Arduino usa punto medio fijo `(negro + blanco) / 2` para los cuatro — que es
exactamente el `factor = 0.50` que el v5 había descartado para los frontales.

**Los frontales son los que disparan `FRENTE`**, el caso de borde más crítico
(es el que evita salirse de cabeza). Perder sensibilidad justo ahí es caro.

### 3. Triple lectura del ultrasónico

El v5 hacía 3 mediciones y se quedaba con **la menor válida**. El Arduino hace un
solo `pulseIn`. El compañero llegó por su lado a la misma conclusión y usa
**filtro de mediana** (los repos de referencia) — dos implementaciones
independientes que coinciden en que una sola lectura del sonar no alcanza.

### 4. Memoria de dónde estaba el rival

El v5 guardaba `ultimo_lado_rival` y lo usaba en dos lados:

- La **búsqueda** giraba hacia el lado donde el rival fue visto por última vez.
- El **escape frontal** giraba hacia ese lado en vez de alternar a ciegas.

El Arduino solo tiene `girarIzquierda`, que **alterna mecánicamente** sin
información. Buscar hacia donde el rival estaba hace un segundo es
estrictamente mejor que tirar una moneda.

### 5. Histéresis de distancia

El v5 tenía `HISTERESIS_CICLOS = 3` con `ultima_dist_valida`: si el sonar fallaba
un eco, seguía usando la última distancia buena en vez de asumir que el rival
desapareció. El comentario explica por qué: *"tolerar 1 eco fallido por la
carrocería inclinada"*.

El Arduino tiene `LECTURAS_PERDIDAS_MAX = 4`, que cubre **parcialmente** lo
mismo: espera 4 lecturas perdidas antes de pasar a búsqueda, y mientras tanto
sigue avanzando. La diferencia es que el v5 **conservaba el valor**, así que
seguía distinguiendo ataque de tracking; el Arduino en esas 4 lecturas avanza a
`VEL_TRACKING` aunque el rival estuviera a 10 cm.

### 6. Ráfaga de ataque con verificación

El v5 atacaba en ráfagas de 150 ms revisando cada 20 ms si apareció el borde o si
el rival se fue (`MISSES_PARA_PERDER_RIVAL = 3`).

En el Arduino esto se cubre **de otra forma**: el `loop()` entero reevalúa borde
y distancia en cada vuelta, así que el efecto es parecido — salvo por los
`delay()` bloqueantes del impulso de arranque (70 ms) y de las maniobras, donde
el robot **no está mirando nada**. El compañero eliminó todos los `delay()` por
esta razón.

## Lo que se eliminó a propósito, y está bien

`barrer_y_localizar()` — los micro-giros para localizar al rival costaban ~250 ms
por ciclo. Se quitó por lentitud, decisión registrada en [Decisiones](decisiones.md). **No
recuperarlo.** Lo que sí vale rescatar de esa función es `ultimo_lado_rival`, que
no dependía del barrido.

## Orden sugerido para recuperar

1. **Calibración promediada** (12 muestras) — el más barato y el de mayor
   impacto: son dos líneas y ataca un problema ya diagnosticado.
2. **`FACTOR_UMBRAL` por sensor** — un array en vez de un punto medio.
3. **Mediana o mínimo de 3 lecturas del sonar** — coincidencia de dos fuentes
   independientes.
4. **`ultimo_lado_rival`** — búsqueda dirigida.

Los cuatro son cambios chicos y localizados. Ninguno toca la lógica de combate ni
el módulo IMU.
