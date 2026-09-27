# Telemetría

Agregada el 2026-08-30 al firmware. **Es solo de banco, por USB.** Decisión
explícita del usuario: el robot **no se conecta ni se controla de forma
inalámbrica** — el código tiene que hacerlo autónomo. Por eso se descartaron
WiFi y BLE, que sí existen como ejemplos en el repo oficial.

## El interruptor

```cpp
#define TELEMETRIA 1        // 0 para el combate real
const unsigned long INTERVALO_TELEMETRIA_MS = 100;
```

Con `TELEMETRIA` en 0 los cuerpos de `evento()` y `telemetria()` quedan vacíos y
el compilador los elimina: **costo cero en competencia**. Ponerlo en 0 antes de
competir.

## Formato (firmware 2026-09-20)

Todo es CSV a propósito: se pega en una hoja de cálculo tal cual.

```
T,<ms>,<estado>,<dist_cm>,<ir0>,<ir1>,<ir2>,<ir3>,<borde>,<giro_dps>,<inclin_deg>,<dax_g>,<day_g>,<rumbo_deg>,<imu_fallos>,<corr>
E,<ms>,<evento>,<detalle>
```

(`corr`, la última columna, es la corrección de rumbo aplicada en ese
instante, −0.30…+0.30; 0 en pivotes y sin giroscopio. Agregada con el
avance recto el 20-09 por la tarde.)

Las `T` salen cada 100 ms — **también dentro de las maniobras**, porque
`moverVigilando()` y `girarGradosGiro()` llaman a `telemetria()`. Las `E`
salen en el momento exacto del evento. Las líneas que empiezan con `#` son
la cabecera, y las de `[Giro]` son mensajes de arranque del módulo IMU.

Columnas nuevas respecto al 30-08 (`accel_z_g` desapareció):

| Columna | Qué es |
|---|---|
| `inclin_deg` | ángulo entre el vector de aceleración actual y el de reposo; lo que mira el levantamiento |
| `dax_g`, `day_g` | deltas horizontales respecto al reposo; sirven para ver **cuál eje es "adelante"** y para el golpe |
| `rumbo_deg` | rumbo integrado desde el arranque (dead reckoning); lo que usa la memoria del rival |
| `imu_fallos` | lecturas descartadas por I2C o magnitud absurda; si crece, el bus está fallando |

### Estados

`INIT` · `ATAQUE` · `TRACK` · `BUSCA` · `AVANCE` · `BORDE` · `LEVANTADO` ·
`EMPUJADO` · `FLANQUEO`

### Eventos

| Evento | Detalle | Para qué sirve |
|---|---|---|
| `GIRO` | `objetivo;logrado;ms` | **medir el giro real**; el `ms` de 90° es el dato para `TIEMPO_GIRO_90_MS` |
| `GIRO_TIMEOUT` | `logrado;objetivo` | el robot no llega al ángulo y sale por tiempo |
| `GIRO_INICIAL` | `ronda;ms` | cuánto tardó de verdad el giro de ronda |
| `ESCAPE` | caso de borde, `;ANTIBUCLE` si lo disparó el anti-bucle | qué maniobra se disparó y cuándo |
| `PERDIDO` | `busca_izq`/`busca_der` | cuándo se perdió al rival y hacia dónde buscó |
| `LEVANTADO_DET` | `inclin;dax;day` | **el ángulo que disparó** y en qué eje se vio |
| `LEVANTADO_REACCION` | `giro_izq`/`giro_der` | la reacción ejecutada |
| `GOLPE` | `g_horizontal;dax;day;estado` | cada golpe, en cualquier estado (solo reacciona fuera de ataque) |
| `EMPUJE_PERDIDO` | `rotado\|tiempo;dps` | por qué soltó el ataque frontal |
| `EMPUJE_LATERAL` | `dps;dax;day` | reacción de escape hacia adelante |

## Las preguntas abiertas que esto responde solo

1. **¿sen1 sigue dañado?** → las columnas `ir0..ir3` de cualquier línea `T`, y
   ahora también la columna `separacion` de la tabla de calibración. Ver
   [Hardware](hardware.md).
2. **¿Cuánto dura un giro real?** → el evento `GIRO` trae `logrado` y `ms`
   juntos. Ver [Parametros a calibrar](parametros.md).
3. **¿El umbral de levantamiento está bien?** → `LEVANTADO_DET` imprime el
   ángulo exacto del disparo; la columna `inclin_deg` durante la búsqueda dice
   cuánto ruido hay sin levantamiento.
4. **¿Qué eje del IMU es "adelante"?** → `dax_g`/`day_g` al levantar el frente
   o al arrancar.
5. **¿Girar a la izquierda da positivo o negativo?** → el signo de `giro_dps`
   durante un `PERDIDO,busca_izq`. (El firmware lo aprende solo; esto es para
   verificarlo a ojo.)

## Cómo no cuesta tiempo de ciclo

- La lectura de la IMU **no se duplica**: `leerIMU()` es la única lectura por
  vuelta; la telemetría imprime sus resultados. **Cero I2C extra.**
- Los valores crudos de los IR salen de la lectura que `leerBorde()` ya hacía.
- La línea periódica está limitada a una cada 100 ms. A 115200 baudios una
  línea `T` (~80 caracteres) cuesta ~7 ms de `Serial.print` bloqueante: 7 %
  del tiempo con `TELEMETRIA 1`. Otra razón para ponerla en 0 al competir.
- `distanciaTel` solo se refresca en `comportamientoOfensivo()`: en las
  filas `BORDE`, `LEVANTADO`, `EMPUJADO` y `FLANQUEO` la columna `dist_cm`
  trae la última distancia ofensiva, no la del instante.
