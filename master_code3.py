# Tomas de Camino Beck / Mod: Estrategia Hit & Run (Golpe y Retroceso)
# Escuela de Sistemas Inteligentes - Universidad Cenfotec
# El sumobot golpea 2 veces y reposiciona alternando lados,
# nunca quedandose en contacto prolongado con el rival.

import board
import keypad
from ideaboard import IdeaBoard
from time import sleep
from hcsr04 import HCSR04

ib = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# ──────────────────────────────────────────────
#  SENSOR ULTRASONICO
# ──────────────────────────────────────────────
sonar = HCSR04(board.IO25, board.IO26)

# ──────────────────────────────────────────────
#  SENSORES INFRARROJOS
# ──────────────────────────────────────────────
sen1 = ib.AnalogIn(board.IO36)  # Frontal Izquierdo
sen2 = ib.AnalogIn(board.IO39)  # Frontal Derecho
sen3 = ib.AnalogIn(board.IO34)  # Trasero Izquierdo
sen4 = ib.AnalogIn(board.IO35)  # Trasero Derecho
infrarrojos = [sen1, sen2, sen3, sen4]
umbrales = [0, 0, 0, 0]

# ──────────────────────────────────────────────
#  DISTANCIAS DE REFERENCIA (cm)
# ──────────────────────────────────────────────
DIST_DETECTADO = 60   # Rival en rango  -> iniciar Hit & Run
DIST_IMPACTO   = 22   # Rival muy cerca -> golpe de emergencia

# ──────────────────────────────────────────────
#  PARAMETROS HIT & RUN
# ──────────────────────────────────────────────
TIEMPO_GOLPE       = 0.40   # Duracion del golpe (embestida rapida)
TIEMPO_RETROCESO   = 0.35   # Duracion del retroceso tras el golpe
TIEMPO_REPOSICION  = 0.55   # Duracion del giro al reposicionar
VELOCIDAD_GOLPE    = 1.0    # Velocidad maxima en el golpe
VELOCIDAD_RETRO    = 0.9    # Velocidad de retroceso
VELOCIDAD_REPOS    = 0.7    # Velocidad del giro de reposicion
GOLPES_POR_SERIE   = 2      # Golpes antes de reposicionar

# ──────────────────────────────────────────────
#  ESTADO INTERNO
# ──────────────────────────────────────────────
golpes_dados      = 0       # Contador de golpes en la serie actual
reposicion_izq    = True    # Alterna el lado de reposicion


# ──────────────────────────────────────────────
#  LEER ULTRASONICO
# ──────────────────────────────────────────────
def medir_distancia_cm():
    try:
        return sonar.dist_cm()
    except Exception:
        return 999


# ──────────────────────────────────────────────
#  CALIBRACION IR
# ──────────────────────────────────────────────
def esperar_boton_y_leer(color_led):
    ib.pixel = color_led
    while True:
        event = keys.events.get()
        if event and event.released:
            lecturas = [sen.value for sen in infrarrojos]
            ib.pixel = (0, 0, 0)
            sleep(0.5)
            return lecturas

def calibracion_por_pasos():
    print("PASO 1: Sensores sobre NEGRO y presiona BOOT.")
    valores_negro = esperar_boton_y_leer((255, 0, 0))

    print("PASO 2: Sensores sobre BLANCO y presiona BOOT.")
    valores_blanco = esperar_boton_y_leer((255, 255, 255))

    for i in range(4):
        umbrales[i] = (valores_negro[i] + valores_blanco[i]) // 2

    print("Calibracion exitosa! Presiona BOOT para combate.")
    esperar_boton_y_leer((0, 255, 0))

    print("Iniciando en 3 segundos...")
    for i in range(3, 0, -1):
        ib.pixel = (255, 255, 0)
        sleep(0.5)
        ib.pixel = (0, 0, 0)
        sleep(0.5)


# ──────────────────────────────────────────────
#  LECTURA DE BORDE (IR)
# ──────────────────────────────────────────────
def leer_borde():
    detectados = [False, False, False, False]

    for i, sen in enumerate(infrarrojos):
        if sen.value < umbrales[i]:
            sleep(0.005)
            if sen.value < umbrales[i]:
                detectados[i] = True

    if detectados[0] and detectados[1]:
        return "FRENTE"
    elif detectados[0] or detectados[2]:
        return "IZQUIERDA"
    elif detectados[1] or detectados[3]:
        return "DERECHA"

    return None


# ──────────────────────────────────────────────
#  MANIOBRA DE ESCAPE (IR)
# ──────────────────────────────────────────────
def maniobra_escape(direccion):
    ib.pixel = (255, 0, 255)

    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.10)
    ib.motor_1.throttle = 1.0
    ib.motor_2.throttle = 1.0
    sleep(0.10)
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.10)

    if direccion == "FRENTE":
        ib.motor_1.throttle = -1.0
        ib.motor_2.throttle =  1.0
        sleep(1.20)
    elif direccion == "IZQUIERDA":
        ib.motor_1.throttle = -1.0
        ib.motor_2.throttle =  1.0
        sleep(0.5)
    elif direccion == "DERECHA":
        ib.motor_1.throttle =  1.0
        ib.motor_2.throttle = -1.0
        sleep(0.5)

    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.005)


# ──────────────────────────────────────────────
#  BUSQUEDA: gira hasta encontrar al rival
# ──────────────────────────────────────────────
def buscar_rival():
    ib.pixel = (0, 0, 255)          # Azul: buscando
    ib.motor_1.throttle = -0.6
    ib.motor_2.throttle =  0.6
    sleep(0.12)
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0


# ──────────────────────────────────────────────
#  GOLPE: embestida rapida y corta
# ──────────────────────────────────────────────
def ejecutar_golpe():
    ib.pixel = (255, 0, 0)          # Rojo: golpeando

    # Embestida a fondo
    ib.motor_1.throttle = -VELOCIDAD_GOLPE
    ib.motor_2.throttle = -VELOCIDAD_GOLPE
    sleep(TIEMPO_GOLPE)

    # Freno brusco
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.03)


# ──────────────────────────────────────────────
#  RETROCESO: se aleja rapido del rival
# ──────────────────────────────────────────────
def ejecutar_retroceso():
    ib.pixel = (255, 255, 0)        # Amarillo: retrocediendo

    # Retrocede a alta velocidad
    ib.motor_1.throttle = VELOCIDAD_RETRO
    ib.motor_2.throttle = VELOCIDAD_RETRO
    sleep(TIEMPO_RETROCESO)

    # Freno
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.03)


# ──────────────────────────────────────────────
#  REPOSICION: gira para cambiar angulo de ataque
#  Alterna entre izquierda y derecha cada serie
# ──────────────────────────────────────────────
def ejecutar_reposicion():
    global reposicion_izq

    ib.pixel = (0, 255, 255)        # Cyan: reposicionando

    if reposicion_izq:
        # Gira a la izquierda
        ib.motor_1.throttle =  VELOCIDAD_REPOS
        ib.motor_2.throttle = -VELOCIDAD_REPOS
    else:
        # Gira a la derecha
        ib.motor_1.throttle = -VELOCIDAD_REPOS
        ib.motor_2.throttle =  VELOCIDAD_REPOS

    sleep(TIEMPO_REPOSICION)

    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.03)

    # Alterna lado para la proxima reposicion
    reposicion_izq = not reposicion_izq


# ──────────────────────────────────────────────
#  COMPORTAMIENTO OFENSIVO HIT & RUN
#
#  Logica completa:
#  1. Detecta rival en rango
#  2. Golpe rapido a fondo (TIEMPO_GOLPE)
#  3. Retroceso inmediato (TIEMPO_RETROCESO)
#  4. Si lleva 2 golpes -> reposiciona cambiando angulo
#  5. Si no -> vuelve a apuntar y repite
# ──────────────────────────────────────────────
def comportamiento_ofensivo():
    global golpes_dados

    distancia = medir_distancia_cm()

    # Rival muy cerca: golpe de emergencia directo
    if distancia < DIST_IMPACTO:
        ib.pixel = (255, 0, 0)
        ib.motor_1.throttle = -VELOCIDAD_GOLPE
        ib.motor_2.throttle = -VELOCIDAD_GOLPE
        return

    # Rival en rango: secuencia Hit & Run
    if distancia < DIST_DETECTADO:

        # ── GOLPE ───────────────────────────────
        ejecutar_golpe()
        golpes_dados += 1

        # Verifica borde tras el golpe
        if leer_borde() is not None:
            return

        # ── RETROCESO ───────────────────────────
        ejecutar_retroceso()

        # Verifica borde tras retroceso
        if leer_borde() is not None:
            return

        # ── REPOSICION (cada 2 golpes) ───────────
        if golpes_dados >= GOLPES_POR_SERIE:
            ejecutar_reposicion()
            golpes_dados = 0    # Reinicia contador

            # Verifica borde tras reposicion
            if leer_borde() is not None:
                return

    # Sin rival: buscar girando
    else:
        buscar_rival()


# ──────────────────────────────────────────────
#  EJECUCION PRINCIPAL
# ──────────────────────────────────────────────
ib.motor_1.throttle = 0
ib.motor_2.throttle = 0

calibracion_por_pasos()

while True:
    direccion_impacto = leer_borde()

    if direccion_impacto is not None:
        maniobra_escape(direccion_impacto)
    else:
        comportamiento_ofensivo()
