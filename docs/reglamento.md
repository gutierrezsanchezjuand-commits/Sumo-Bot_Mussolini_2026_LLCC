# Reglamento

Fuente oficial: `Universidad-Cenfotec/Sumobot` → `reglas de competencia.md`.
Resumen de lo que **condiciona el código**; el reglamento completo tiene además
formato de torneo, desempates y sanciones.

## Especificaciones del robot

- **Peso máximo 315 g**, baterías y sensores incluidos.
- **Exactamente 4 baterías AA.** Nada de 9 V: los motores aguantan 6 V y se
  queman. Las recargables (1.2 V) pesan más y dan menos potencia.
- Se pueden **agregar sensores** mientras no se pase de peso y no toquen al rival.
- Todo agujero visible debe tener un sensor funcional instalado, o el robot no
  es apto.
- **No** se puede modificar el chasis, motores, ruedas ni baterías del kit
  oficial. No se puede bajar la altura de los soportes de los IR — justamente
  porque acercarlos al piso hace fallar la lectura.
- Prohibida cualquier extensión que genere contacto físico intencional.

## El dojo oficial — ⚠️ tiene cubierta de acrílico transparente

Fuente: `Universidad-Cenfotec/Sumobot` → `dojo.md` (leído el 2026-09-25).

| | |
|---|---|
| Área externa (negra) | cuadrado de 100 cm de lado |
| **Círculo de combate** (negro) | **80 cm** de diámetro interior |
| **Anillo blanco** | **5 cm** de ancho (de 80 a 90 cm), "blanco brillante" |
| Zona de seguridad | ~50 cm, borde amarillo/negro |
| **Superficie** | **negro impreso con cubierta de acrílico TRANSPARENTE** |

Cita textual de la especificación:

> *"El dojo oficial tiene una cubierta de acrílico transparente. Esta
> cubierta permite una superficie suave libre de imperfecciones para que
> los robots se muevan libremente (**deben tener eso en cuenta para la
> calibración de sensores**)"*

**Por qué importa**: el acrílico transparente es de las superficies más
especulares que hay — es exactamente el fenómeno del dojo de negro
brillante del 2026-09-25 (reflejo especular que hace parecer blanco al
negro, ver la bitácora). Los organizadores avisan porque es conocido.

El usuario lo describió como "opaco, material acrílico". La especificación
dice **transparente**. Posible lectura: el impreso de abajo es opaco, pero
la superficie que ven los sensores es la lámina transparente de arriba.

**Consecuencias para el código:**
- El umbral en **0.10** (elegido en el dojo brillante) es la preparación
  correcta, pero la **profundidad del destello del acrílico no está
  medida**. Si bajara del ~200, volvería a disparar.
- La guía oficial de IR (`sensores_infrarrojos.md`) usa **un umbral fijo
  de 3000** para los cuatro sensores — justo lo que se rompe sobre
  acrílico. Nuestra calibración por sensor y por dojo es lo que el aviso
  pide.
- El anillo de **5 cm** es ancho: da margen para que un sensor llegue bien
  hondo al blanco antes de salirse, lo que reduce el riesgo de un umbral
  bajo.
- **Calibrar sobre el acrílico**, no sobre el impreso: la lámina cambia la
  distancia del sensor a la tinta y agrega su propio reflejo.

**Condición de victoria**, con las medidas: pierde quien sale
**completamente fuera del círculo negro interno** (80 cm). El anillo blanco
es la zona donde hay que detectar y volver.

## Formato

- Una **partida** = 3 **combates**. Combate = **1 min 30 s** máximo.
- 3 puntos por combate ganado, 1 por empate, 0 por derrota.
- 1 minuto de pausa entre combates para ajustes.

## Condiciones de victoria

1. Expulsar al rival completamente fuera del **círculo negro interno**.
2. El rival queda inmovilizado (falla mecánica, volcado).
3. El rival se sale solo del círculo negro.
4. **El rival no ejecuta ningún movimiento durante todo el combate.**

Empate: si ninguno se mueve, o si al terminar el tiempo ninguno salió.

## Disposición inicial — esto es lo que implementa `giroInicial()`

Cada combate arranca con una disposición distinta:

1. **Frente a frente**, con la parte trasera cerca del borde blanco.
2. **Lado a lado**, en direcciones opuestas.
3. **Espalda con espalda**.

Coincide exactamente con las rondas 1/2/3 de
[Arquitectura del codigo](firmware-arquitectura.md). Dato que el código no aprovecha: en la **ronda 1 el
robot arranca de espaldas al borde**, así que un retroceso en los primeros
instantes lo saca solo.

## Arbitraje

Una vez que el juez declara el inicio, **nadie puede tocar el robot**. Antes de
eso sí se puede manipular.

> Implicación práctica para `esperarInicioCombate()`: el robot arranca a combatir
> en el instante en que se suelta el BOOT, con la mano todavía en el dojo. No es
> ilegal — la pulsación ocurre antes del inicio declarado — pero conviene
> revisar si un retardo de arranque de 1–2 s daría margen para retirar la mano
> sin que el robot ya esté girando. El reglamento **no** exige ese retardo.

## Lo que el reglamento permite y el código no usa

- **Cronómetro de 1:30.** El código no sabe cuánto lleva el combate. Una
  estrategia distinta en los últimos segundos (por ejemplo, dejar de arriesgar
  el borde si vas ganando) es legal y hoy no existe.
- **Sensores adicionales**, dentro del peso.
