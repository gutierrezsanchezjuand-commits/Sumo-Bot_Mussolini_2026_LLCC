# Ejemplo: sumo basico en CircuitPython (kit IdeaBoard)
#
# Programa de ejemplo del simulador: corre igual en el robot (code.py). Hace
# lo mismo que el ejemplo de Arduino:
#   1. Calibra los 4 sensores de piso (IR) sobre negro y sobre blanco.
#   2. Espera el BOOT de la salida.
#   3. En cada vuelta: si un IR ve el borde blanco, escapa; si no, busca al
#      rival con el sonar y lo empuja.
#
# Librerias del kit: ideaboard (motores, LED, entradas analogicas) y hcsr04
# (sonar). keypad viene con CircuitPython.
import time
import board
import keypad
from ideaboard import IdeaBoard
from hcsr04 import HCSR04

ib = IdeaBoard()
sonar = HCSR04(board.IO25, board.IO26)                # TRIG, ECHO
boton = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)
sensores = [ib.AnalogIn(pin) for pin in (board.IO36, board.IO39, board.IO34, board.IO35)]
# orden: frontal izquierdo, frontal derecho, trasero izquierdo, trasero derecho

DIST_ATAQUE = 40      # cm: a menos de esto, empuja a fondo
DIST_ACERCAR = 90     # cm: a menos de esto, se acerca
VEL_BUSQUEDA = 0.8    # girando en el lugar: por debajo de ~0.7 el pivote se traba


def motores(izq, der):
    ib.motor_1.throttle = izq
    ib.motor_2.throttle = der


def esperar_boot():
    boton.events.clear()
    while True:
        evento = boton.events.get()
        if evento and evento.released:
            return


def leer_todos():
    lecturas = []
    for s in sensores:
        suma = 0
        for _ in range(8):
            suma += s.value
            time.sleep(0.002)
        lecturas.append(suma // 8)
    return lecturas


def calibrar():
    print("PASO 1: pone los sensores sobre NEGRO y presiona BOOT")
    ib.pixel = (255, 0, 0)
    esperar_boot()
    negro = leer_todos()
    print("PASO 2: pone los sensores sobre BLANCO y presiona BOOT")
    ib.pixel = (255, 255, 255)
    esperar_boot()
    blanco = leer_todos()
    umbral = [(n + b) // 2 for n, b in zip(negro, blanco)]
    for i in range(4):
        print(f"IR {i}: negro {negro[i]}, blanco {blanco[i]}, umbral {umbral[i]}")
    return umbral


ultima = 999          # la ultima distancia al rival (cm)
t_ultimo_eco = 0
def distancia_rival():
    # Pegado al rival el sonar pierde ecos: si se lo acaba de ver, se mantiene
    # la ultima distancia un rato en vez de ponerse a buscar.
    global ultima, t_ultimo_eco
    try:
        d = sonar.dist_cm()
    except RuntimeError:
        d = 999
    if d > 300:
        d = 999
    ahora = time.monotonic()
    if d < 999:
        ultima = d
        t_ultimo_eco = ahora
        return d
    retener = 0.5 if ultima < 15 else 0.15
    if ahora - t_ultimo_eco < retener:
        return ultima
    ultima = 999
    return 999


veces_blanco = [0, 0, 0, 0]
def bordes(umbral):
    # Blanco lee BAJO y negro ALTO. Un borde cuenta si se ve en dos vueltas
    # seguidas: en un dojo brillante los reflejos dan lecturas bajas sueltas.
    for i in range(4):
        if sensores[i].value < umbral[i]:
            veces_blanco[i] += 1
        else:
            veces_blanco[i] = 0
    return [v >= 2 for v in veces_blanco]


def escapar(adelante, izquierda):
    ib.pixel = (255, 0, 255)
    for i in range(4):
        veces_blanco[i] = 0
    if adelante:
        print("E,%d,BORDE,%s" % (time.monotonic() * 1000, "frente_izq" if izquierda else "frente_der"))
        motores(-1.0, -1.0)
        time.sleep(0.3)
        if izquierda:
            motores(1.0, -1.0)     # gira a la derecha, lejos del borde
        else:
            motores(-1.0, 1.0)
        time.sleep(0.35)
    else:
        print("E,%d,BORDE,atras" % (time.monotonic() * 1000))
        motores(1.0, 1.0)
        time.sleep(0.3)


# ── arranque ──
motores(0, 0)
umbral = calibrar()
print("Listo. Coloca el robot y presiona BOOT para empezar el combate")
ib.pixel = (0, 255, 0)
esperar_boot()
ib.pixel = (0, 0, 0)

# ── combate ──
while True:
    fi, fd, ti, td = bordes(umbral)
    if fi or fd:
        if ultima < 15:            # rival pegado sobre el borde: un empujon mas
            motores(1.0, 1.0)
            time.sleep(0.15)
        escapar(True, fi)
        continue
    if ti or td:
        escapar(False, ti)
        continue
    d = distancia_rival()
    if d < DIST_ATAQUE:
        ib.pixel = (255, 0, 0)
        motores(1.0, 1.0)
    elif d < DIST_ACERCAR:
        ib.pixel = (255, 165, 0)
        motores(0.8, 0.8)
    else:
        ib.pixel = (0, 0, 255)
        motores(-VEL_BUSQUEDA, VEL_BUSQUEDA)
