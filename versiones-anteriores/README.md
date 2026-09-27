# Versiones anteriores

Cómo se llegó al código actual. **Nada de esto corre hoy en el robot**: queda como referencia. El
código actual está en [`mussolini/`](../mussolini).

## 1. CircuitPython (primera etapa)

| Archivo | Qué es |
|---|---|
| [`base_sencillo.py`](circuitpython/base_sencillo.py) | código base sencillo: calibración automática, evasión del borde y ataque |
| [`idea_hit_and_run.py`](circuitpython/idea_hit_and_run.py) | primera idea de combate: pegar y retirarse |
| [`gemini_code1.py`](circuitpython/gemini_code1.py), [`gemini_code2.py`](circuitpython/gemini_code2.py), [`gemini_code3.py`](circuitpython/gemini_code3.py) | tres variantes escritas con Gemini y revisadas con Claude. Los errores que se les corrigieron están en [`BUGS_CORREGIDOS.md`](circuitpython/BUGS_CORREGIDOS.md) |
| [`v5_circuitpython.py`](circuitpython/v5_circuitpython.py) | **la última versión en CircuitPython** (v5): calibración promediada, umbral por sensor, histéresis y ataque con verificación. Antes estaba en la raíz del repositorio como `NOTAS.md` |

## 2. Arduino (desde que se pasó a C++)

| Archivo | Qué agregó |
|---|---|
| [`code1.ino`](arduino/code1.ino) | el paso a Arduino: PWM a 20 kHz (el motor dejó de chillar), impulso de arranque, motores invertidos, avance directo sin el barrido lateral que lo hacía lento |
| [`code2.ino`](arduino/code2.ino) | selección de ronda con BOOT (1, 2 o 3 pulsaciones), espera final y giro inicial según la ronda |
| [`code3_con_diagnostico.ino`](arduino/code3_con_diagnostico.ino) | detección automática de la polaridad de cada sensor IR y mensajes de diagnóstico en la calibración |
| [`extension_giroscopio.ino`](arduino/extension_giroscopio.ino) | la primera pestaña del giroscopio: giros por ángulo real. De acá salió `giroscopio_control.ino` |

Después vino [`mussolini/`](../mussolini). Qué se ganó y qué se perdió al pasar de CircuitPython a
Arduino: [docs/historia-del-codigo.md](../docs/historia-del-codigo.md).

> Los archivos se renombraron el 27-09-2026 para que sea más fácil orientarse (antes: `Arduino code
> 1.ino`, `code 2.ino`, `Code3_INO+Diagnostico.ino`, `extension de codigo.ino`, y en la carpeta
> `Codigos base del 20206`: `Base de código_ sencillo.py`, `Code idea 1 de combate_hit_and_run.py`,
> `code1_AI_Gemini_rivisado por Claude.py`, `Code2_AI_Gemini_revisado por Claude.py`,
> `code 3_AI_Gemini_revisado por Claude.py`). El contenido no cambió.
