# ⚠️ Archivo histórico — bugs conocidos

Estos 3 archivos se conservan como **referencia del proceso**, no como código funcional. La versión oficial actual es [`firmware/oficial/sumobot_v6.py`](../oficial/sumobot_v6.py).

## `master_code.py`
- **Pines del sonar invertidos:** usa `HCSR04(board.IO26, board.IO25)`. El orden correcto (usado en el resto del proyecto) es `HCSR04(board.IO25, board.IO26)` → TRIG=IO25, ECHO=IO26.
- **Lógica de línea invertida:** `leer_sensores()` compara `sen.value > valor_critico`, pero el propio comentario del archivo dice "blanco = valores bajos", así que la comparación correcta sería `<`. Esto hace que el robot confunda el piso seguro con el borde.

## `master_code2.py`
- **Umbral fijo (`VALOR_CRITICO = 10000`) para los 4 sensores.** Según la calibración real vista en otros archivos del proyecto, cada sensor tiene un rango de "negro" muy distinto (~12,000 a ~45,000), así que un solo número no puede funcionar para todos.
- El etiquetado `True = Negro` cuando `valor < 10000` también queda invertido respecto a la convención usada en el resto del proyecto (blanco = valores bajos).

## `master_code3.py`
- **Mismo problema de pines del sonar** que `master_code.py` (`HCSR04(board.IO26, board.IO25)`).
- **Condición de borde matemáticamente al revés:** `if not (s3 and s4):` se cumple casi siempre (incluso con el robot tranquilo sobre negro), y **no se cumple** en el único caso en que ambos sensores confirman que sí están sobre el borde.

## Cómo evitar repetir estos bugs
- Mantené siempre `HCSR04(board.IO25, board.IO26)` (TRIG, ECHO en ese orden).
- Recordá la convención del proyecto: **valores bajos = blanco/borde**, **valores altos = negro/piso seguro**. La comparación de borde siempre debería ser `valor < umbral`.
- Si vas a usar un umbral fijo (sin calibración en caliente), calibralo por sensor individualmente con `diagnostico_motores.py` / lecturas crudas, nunca un solo número para los 4.
