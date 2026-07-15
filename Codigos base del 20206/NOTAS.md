# ✅ Bugs corregidos

Estos 3 archivos ya fueron corregidos (versión actual en esta misma carpeta). La versión oficial de competencia sigue siendo [`firmware/oficial/sumobot_v6.py`](../oficial/sumobot_v6.py) — estos son una base alternativa/histórica ya funcional, útil como referencia o punto de partida para nuevas estrategias.

## `master_code.py`
- **Pines del sonar invertidos** → corregido a `HCSR04(board.IO25, board.IO26)`.
- **Lógica de línea invertida** en `leer_sensores()` → corregido a `sen.value < valor_critico` (blanco = valores bajos).

## `master_code2.py`
- **Umbral fijo (`VALOR_CRITICO = 10000`) para los 4 sensores** → reemplazado por una calibración por sensor (botón BOOT + promedio de negro/blanco), igual que en el resto del proyecto.
- **Dirección de comparación invertida** → corregida a `value > umbral` (True = Negro).
- **Bug adicional encontrado al corregir:** `avanzar()` y `retroceder()` ponían los dos motores con signo **opuesto** (igual que un giro), así que en vez de ir recto el robot giraba en su propio eje sin avanzar. Además ignoraban el parámetro de velocidad y siempre iban al 100%. Ambos quedaron corregidos.

## `master_code3.py`
- **Mismo problema de pines del sonar** → corregido.
- **Dirección de comparación invertida** en `leer_sensores_independientes()` → corregida a `value > VALOR_CRITICO`. Con este único cambio, las condiciones `not (s3 and s4)` / `not (s1 and s2)` (que ya estaban bien planteadas como lógica) empiezan a disparar en el momento correcto.
- **Orden de funciones:** `stop()` ahora se define antes de `verificar_bateria()`, para evitar un error si en algún momento se activa la verificación de batería (hoy está comentada).

## Convención del proyecto (para futuros códigos)
- Mantené siempre `HCSR04(board.IO25, board.IO26)` (TRIG, ECHO en ese orden).
- **Valores bajos = blanco/borde**, **valores altos = negro/piso seguro**. La comparación de borde va `valor < umbral` (o su equivalente `es_negro = valor > umbral`).
- Si usás un umbral fijo (sin calibrar en caliente), calibralo por sensor individualmente — no reutilices el mismo número para los 4.
- Para movimiento recto (avanzar/retroceder), los dos motores deben llevar el **mismo signo**. Signos opuestos = giro en su propio eje, no avance.
