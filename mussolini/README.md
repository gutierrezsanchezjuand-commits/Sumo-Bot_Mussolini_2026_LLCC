# ⭐ Mussolini — el código actual

Esta carpeta es el programa que corre hoy en el robot. Es un sketch de Arduino de **dos archivos**
que el IDE compila juntos:

| Archivo | Qué tiene |
|---|---|
| [`mussolini.ino`](mussolini.ino) | el archivo principal: motores, sensores, calibración, ataque y búsqueda, `setup()` y `loop()` |
| [`giroscopio_control.ino`](giroscopio_control.ino) | el giroscopio: giros por ángulo, avance recto, levantamiento, golpes, escapes del borde |
| [`mussolini_completo.ino`](mussolini_completo.ino) | ⚡ **los dos archivos de arriba, en uno solo** — para copiarlo y pegarlo entero en un sketch nuevo, sin bajar nada |
| [`HISTORIAL_DEL_CODIGO.md`](HISTORIAL_DEL_CODIGO.md) | la historia de cada cambio y las mediciones detrás de cada valor |

**Versión:** comportamiento del 26-09-2026 (cambios 1–33); comentarios resumidos el 27-09-2026.

---

## Subirlo al robot

1. Instalar el [Arduino IDE](https://www.arduino.cc/en/software).
2. En **Boards Manager**, instalar **esp32** (de Espressif), **versión 3.x**. Con la 2.x no compila.
3. En **Library Manager**, instalar **Adafruit NeoPixel** y **Adafruit LSM6DS**.
4. Cargar el código, de una de las dos formas:
   - **Copiar y pegar (rápido, sin bajar el repo):** Archivo → Nuevo Sketch en el IDE, borrar lo que
     trae, abrir [`mussolini_completo.ino`](mussolini_completo.ino) acá en GitHub (botón **Raw**),
     copiar todo y pegarlo en el sketch nuevo.
   - **Bajando el repo:** abrir **`mussolini.ino`**. La pestaña `giroscopio_control.ino` se abre sola.
5. Elegir la placa **ESP32 Dev Module** y el puerto del robot, y subir.
6. Abrir el Monitor Serie a **115200** baudios para ver la calibración.

> `mussolini_completo.ino` es exactamente el mismo código que los dos archivos de arriba, uno
> después del otro en un solo archivo: el IDE de Arduino ya los concatenaba así al compilar, así
> que el comportamiento es idéntico. Si vas a seguir modificándolo, mejor trabajar con los dos
> archivos separados (`mussolini.ino` + `giroscopio_control.ino`): son más cortos y más fáciles de
> navegar.

> Si los motores no se mueven o el sonar siempre da "fuera de rango", revisar el **jumper entre
> SELECT y Vin** del shield antes que el código.

## Arrancarlo en el dojo

| Paso | LED | Qué hacer |
|---|---|---|
| 1 | 🔴 rojo | sensores sobre **negro** → BOOT |
| 2 | ⚪ blanco | sensores sobre **blanco** → BOOT |
| 3 | 🟢 verde | BOOT para confirmar. *Tres parpadeos violeta antes = un sensor IR débil: revisarlo* |
| 4 | 🩵 cian | elegir la ronda: BOOT **1, 2 o 3 veces** (el verde parpadea el número elegido) |
| 5 | — | dejarlo **quieto 2 s** (calibra el giroscopio). *Tres parpadeos rojos = no encontró el giroscopio; pelea igual, con giros por tiempo* |
| 6 | ⚪ blanco | ponerlo en el dojo → **BOOT: empieza el combate** |

## Qué está haciendo, según el color

| LED | Estado |
|---|---|
| 🔴 rojo | **ataca**: rival a menos de 40 cm, a fondo |
| 🟠 naranja | **persigue**: rival a 40–100 cm, avanzando con un tanteo de ±3° |
| 🔵 azul | **busca**: perdió al rival, gira hacia donde lo vio por última vez |
| 🟣 violeta | **escapa del borde** |
| 🩷 magenta | **lo están levantando**: retrocede hasta volver a apoyar |
| 🟢 verde agua | **golpe o empuje de costado**: sale hacia adelante |
| 🟠 naranja rojizo | **lo están girando mientras empuja**: suelta y lo flanquea |
| 🟡 amarillo | giro inicial de la ronda 2 o 3 |

## Cómo pelea

En cada vuelta del programa, en este orden de prioridad:

```
1. ¿Veo el borde blanco?             → maniobra de escape según qué sensores lo ven
2. ¿Me están levantando?             → retroceder hasta que la base vuelva a apoyar, y girar
3. ¿Me empujan de costado o golpean? → salir hacia adelante (si ve al rival, lo ataca)
4. Si no                             → buscar, perseguir y atacar
```

El borde siempre gana: salirse es derrota inmediata.

**Rival.** A menos de 40 cm ataca a fondo, con el rumbo corregido por el giroscopio. Entre 40 y
100 cm lo persigue con un **tanteo**: barre ±3° de lado a lado y el barrido que lo pierde se invierte
al instante, así se centra solo sobre él. Si lo pierde, sigue un momento (pegado al rival el sonar
pierde ecos) y después busca girando hacia donde lo vio. Si mientras empuja lo están rotando,
suelta, retrocede, gira 60° y vuelve de costado. Se probaron barridos más amplios (±10°, ±20°,
±45°): todos salen peor en el simulador, ver [Decisiones](../docs/decisiones.md).

**Borde.** Los 4 sensores IR se calibran al arrancar; un borde se confirma con una segunda lectura.
De frente retrocede 450 ms y gira ~200°; con un solo sensor frontal, 350 ms y media vuelta; con los
sensores de atrás avanza. Los giros de escape de frente y de costado se cortan si el sonar ve al
rival, para atacarlo en vez de terminar de huir. Si escapa 3 veces en 3 s, invierte y agranda el giro.

**Golpes y empujes de costado.** Fuera del ataque, un golpe (más de 0.35 g que no provocó el propio
robot) o un giro que no pidió significan que el rival llegó por donde no se lo esperaba: sale
**hacia adelante a fondo 350 ms**, y si el rival aparece enfrente, deja de escapar y lo ataca. Un
"golpe" con el chasis inclinado cuenta como levantamiento. Girar hacia el golpe se probó el 25-09 y
se quitó: el arranque del propio robot se leía como golpe por detrás.

**Levantamiento.** Compara la inclinación con la de reposo, en 3D: 15° sostenidos 250 ms. Retrocede
hasta que el giroscopio confirma que la base volvió a apoyar (entre 0.25 y 1.5 s) y gira 90°.

**Rondas.** Ronda 1: frente a frente, sale derecho. Ronda 2: lado a lado, gira 90°. Ronda 3:
espalda con espalda, gira 180°.

## Interruptores

Al principio de `mussolini.ino`:

| `#define` | Valor | Qué hace |
|---|---|---|
| `INVERTIR_MOTORES` | 1 | si el robot avanza al revés, cambiar a 0 |
| `TELEMETRIA` | 0 | 1 = imprime por Serial lo que ve y decide ([cómo leerlo](../docs/telemetria.md)). 0 para competir |
| `MODO_SIMPLE` | 0 | 1 = apaga levantamiento, golpe y rotación forzada. Seguro de torneo si algo del giroscopio se porta raro |

## Pines

| Función | Pin |
|---|---|
| Ultrasónico TRIG / ECHO | 25 / 26 |
| IR frontal izq / der | 36 / 39 |
| IR trasero izq / der | 34 / 35 |
| Motor 1 (izquierdo) IN1 / IN2 | 12 / 14 |
| Motor 2 (derecho) IN1 / IN2 | 13 / 15 |
| Botón BOOT | 0 |
| NeoPixel | 2 |
| Giroscopio LSM6DS3TRC | I2C `0x6B` |

## Para entenderlo a fondo

- [Arquitectura del firmware](../docs/firmware-arquitectura.md): cómo está armado el código.
- [Parámetros](../docs/parametros.md): cada constante, cuánto vale y de dónde salió el número.
- [Protocolo de pruebas](../docs/protocolo-de-pruebas.md): cómo probarlo en el dojo.
- [Simulador](../simulador): probar cambios sin el robot.
