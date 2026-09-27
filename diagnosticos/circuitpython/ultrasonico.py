# DIAGNOSTICO HC-SR04 - Sumobot ESP32 / IdeaBoard
# Usa la libreria oficial hcsr04 de Tomas de Camino Beck
# Presiona BOOT para cambiar entre modos de prueba.

import board
import keypad
from ideaboard import IdeaBoard
from time import sleep
from hcsr04 import HCSR04

ib = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

sonar = HCSR04(board.IO25, board.IO26)

MUESTRAS_STATS = 20
PAUSA_LECTURA  = 0.05

MODOS = ["CONTINUO", "ESTADISTICAS", "RANGO_MAXIMO"]
modo_actual = 0


# -------------------------------------------------
#  BARRA VISUAL ASCII
# -------------------------------------------------
def barra_distancia(cm, max_cm=100, ancho=25):
    if cm is None or cm < 0:
        return "[---- SIN LECTURA ----]"
    cm_clamp = min(cm, max_cm)
    lleno = int((cm_clamp / max_cm) * ancho)
    vacio = ancho - lleno
    return "[" + "#" * lleno + "." * vacio + "]"


# -------------------------------------------------
#  COLOR LED segun distancia
# -------------------------------------------------
def color_por_distancia(cm):
    if cm is None or cm < 0:
        return (255, 0, 0)
    elif cm < 15:
        return (255, 0, 0)
    elif cm < 35:
        return (255, 165, 0)
    elif cm < 60:
        return (0, 255, 0)
    else:
        return (0, 0, 255)


# -------------------------------------------------
#  LEER CON MANEJO DE ERROR
# -------------------------------------------------
def leer_distancia():
    try:
        dist = sonar.dist_cm()
        return dist
    except Exception:
        return None


# -------------------------------------------------
#  MODO 1: LECTURA CONTINUA
# -------------------------------------------------
def modo_continuo():
    print("")
    print("==================================================")
    print("  MODO: LECTURA CONTINUA")
    print("  Acerca/aleja un objeto frente al sensor.")
    print("  Presiona BOOT para cambiar de modo.")
    print("==================================================")

    while True:
        event = keys.events.get()
        if event and event.released:
            return

        dist = leer_distancia()
        ib.pixel = color_por_distancia(dist)

        if dist is None:
            print("  [ERROR] No se pudo leer el sensor")
        else:
            barra = barra_distancia(dist)
            print("  Distancia: " + str(round(dist, 1)) + " cm   " + barra)

        sleep(PAUSA_LECTURA)


# -------------------------------------------------
#  MODO 2: ESTADISTICAS
# -------------------------------------------------
def modo_estadisticas():
    print("")
    print("==================================================")
    print("  MODO: ESTADISTICAS (" + str(MUESTRAS_STATS) + " muestras)")
    print("  Manten el objeto quieto frente al sensor.")
    print("==================================================")

    muestras = []
    errores  = 0

    ib.pixel = (255, 255, 0)

    for i in range(MUESTRAS_STATS):
        dist    = leer_distancia()
        prefijo = "  Muestra " + str(i + 1) + "/" + str(MUESTRAS_STATS) + ": "

        if dist is None:
            print(prefijo + "ERROR - sin lectura")
            errores += 1
        else:
            print(prefijo + str(round(dist, 1)) + " cm")
            muestras.append(dist)

        sleep(0.1)

    print("")
    print("--------------------------------------------------")
    print("  RESULTADOS:")

    if muestras:
        promedio = sum(muestras) / len(muestras)
        minimo   = min(muestras)
        maximo   = max(muestras)
        varianza = sum((x - promedio) ** 2 for x in muestras) / len(muestras)
        desv_std = varianza ** 0.5

        print("  Lecturas validas : " + str(len(muestras)) + "/" + str(MUESTRAS_STATS))
        print("  Minimo           : " + str(round(minimo, 1)) + " cm")
        print("  Maximo           : " + str(round(maximo, 1)) + " cm")
        print("  Promedio         : " + str(round(promedio, 1)) + " cm")
        print("  Desv. estandar   : " + str(round(desv_std, 2)) + " cm  <- ruido del sensor")

        print("")
        print("  DIAGNOSTICO:")
        if desv_std < 1.0:
            print("  [OK] Sensor muy estable (ruido < 1 cm)")
        elif desv_std < 3.0:
            print("  [OK] Sensor aceptable (algo de ruido)")
        else:
            print("  [!!] Sensor inestable - revisa conexiones")

        if maximo > 60:
            print("  [OK] Rango > 60 cm - apto para combate")
        elif maximo > 30:
            print("  [>>] Rango limitado (30-60 cm) - ajusta DIST_AVANCE")
        else:
            print("  [!!] Rango muy corto (<30 cm) - revisa alimentacion 5V")

    if errores > 0:
        print("")
        print("  Errores: " + str(errores) + " de " + str(MUESTRAS_STATS))
        if errores == MUESTRAS_STATS:
            print("  [!!] 100% errores - revisa TRIG(IO25) y ECHO(IO26)")

    print("--------------------------------------------------")
    ib.pixel = (0, 255, 0)
    print("  Presiona BOOT para continuar.")

    while True:
        event = keys.events.get()
        if event and event.released:
            return


# -------------------------------------------------
#  MODO 3: RANGO MAXIMO
# -------------------------------------------------
def modo_rango_maximo():
    print("")
    print("==================================================")
    print("  MODO: RANGO MAXIMO")
    print("  Aleja el objeto lentamente hasta que el sensor")
    print("  pierda la lectura. Esa es tu distancia real.")
    print("  Presiona BOOT para cambiar de modo.")
    print("==================================================")

    errores_consecutivos = 0
    ultima_valida        = 0.0

    while True:
        event = keys.events.get()
        if event and event.released:
            return

        dist = leer_distancia()

        if dist is None:
            errores_consecutivos += 1
            ib.pixel = (255, 0, 0)
            print("  [SIN LECTURA x" + str(errores_consecutivos) + "]"
                  + "  ultima valida: " + str(round(ultima_valida, 1)) + " cm")
        else:
            errores_consecutivos = 0
            ultima_valida        = dist
            ib.pixel = color_por_distancia(dist)
            barra = barra_distancia(dist, max_cm=150, ancho=25)
            print("  [OK] " + str(round(dist, 1)) + " cm  " + barra)

        sleep(0.05)


# -------------------------------------------------
#  EJECUCION PRINCIPAL
# -------------------------------------------------
print("")
print("##################################################")
print("  DIAGNOSTICO HC-SR04 - SUMOBOT")
print("  TRIG: IO25   ECHO: IO26")
print("  Presiona BOOT para cambiar de modo.")
print("##################################################")

ib.pixel = (0, 255, 255)
sleep(1)

while True:
    nombre_modo = MODOS[modo_actual]

    if nombre_modo == "CONTINUO":
        modo_continuo()
    elif nombre_modo == "ESTADISTICAS":
        modo_estadisticas()
    elif nombre_modo == "RANGO_MAXIMO":
        modo_rango_maximo()

    modo_actual = (modo_actual + 1) % len(MODOS)
    print("")
    print("  -> Cambiando a modo: " + MODOS[modo_actual])
    sleep(0.5)

