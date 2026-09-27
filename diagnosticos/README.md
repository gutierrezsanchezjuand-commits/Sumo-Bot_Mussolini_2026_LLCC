# Diagnósticos

Programas cortos para revisar el hardware del robot. **No tienen nada del código de combate**: se
suben aparte, se usan, y después se vuelve a subir [`mussolini/`](../mussolini).

## Arduino (con el IDE de Arduino)

Cada uno está en su propia carpeta, como pide el IDE. Se abre el `.ino`, se sube y se mira el
Monitor Serie a **115200** baudios.

| Programa | Qué prueba |
|---|---|
| [`diagnostico_infrarrojos`](arduino/diagnostico_infrarrojos/diagnostico_infrarrojos.ino) | imprime los valores crudos de los 4 sensores IR, para ver qué número da cada uno sobre negro y sobre blanco. No mueve los motores |
| [`diagnostico_giroscopio`](arduino/diagnostico_giroscopio/diagnostico_giroscopio.ino) | busca el giroscopio LSM6DS3TRC por I2C y muestra qué eje se mueve al girar el robot sobre la mesa. Con este se confirmó que el giro es el eje Z. No mueve los motores |

## CircuitPython (con Thonny)

Para la placa con CircuitPython: se abre el archivo en Thonny y se corre en la placa.

| Programa | Qué prueba |
|---|---|
| [`motores.py`](circuitpython/motores.py) | con BOOT arranca la secuencia adelante, atrás, giro izquierda y giro derecha; el LED marca el paso. Sirve para ver si algún motor gira al revés |
| [`infrarrojos.py`](circuitpython/infrarrojos.py) | imprime los valores crudos de los 4 sensores IR |
| [`ultrasonico.py`](circuitpython/ultrasonico.py) | varios modos de prueba del sonar HC-SR04; BOOT cambia de modo |
| [`borde_blanco.py`](circuitpython/borde_blanco.py) | calibra los IR sobre negro y blanco y prueba la detección del borde y la maniobra de escape |
