# Tomas de Camino Beck / Mod: Estrategia de Flanqueo Alternado
# Escuela de Sistemas Inteligentes - Universidad Cenfotec
# El sumobot detecta al rival y lo empuja posicionandose a un lado,
# alternando entre izquierda y derecha en cada ataque.

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
DIST_DETECTADO  = 60   # Rival en rango    -> iniciar flanqueo
DIST_EMPUJE     = 18   # Rival muy cerca   -> empujar a fondo

# ──────────────────────────────────────────────
#  PARAMETROS DE FLANQUEO
# ──────────────────────────────────────────────
# Cuanto tiempo gira para posicionarse al lado del rival
TIEMPO_RODEO        = 0.45   # segundos girando para flanquear
# Velocidad del arco mientras se posiciona
VELOCIDAD_ARCO_RAP  = 0.85   # rueda rapida
VELOCIDAD_ARCO_LENT = 0.40   # rueda lenta (hace el arco)
# Velocidad del empuje final
VELOCIDAD_EMPUJE    = 1.0

# Lado actual de flanqueo: alterna cada ataque
# True = flanquea por IZQUIERDA, False = por DERECHA
flanqueo_izquierda = True


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
#  MANIOBRA DE ESCAPE (IR) — igual que siempre
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
        ib.motor_2.throttle = 1.0
        sleep(1.20)
    elif direccion == "IZQUIERDA":
        ib.motor_1.throttle = -1.0
        ib.motor_2.throttle = 1.0
        sleep(0.5)
    elif direccion == "DERECHA":
        ib.motor_1.throttle = 1.0
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

    # Giro lento hacia la derecha hasta detectar algo
    ib.motor_1.throttle = -0.6
    ib.motor_2.throttle =  0.6
    sleep(0.12)

    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0


# ──────────────────────────────────────────────
#  FLANQUEO: se posiciona al lado y empuja
#
#  Logica:
#  1. Apunta al rival (esta al frente por el barrido)
#  2. En vez de ir directo, hace un arco hacia un lado
#     para quedar perpendicular al rival
#  3. Empuja a fondo cuando esta al costado
#  4. Alterna el lado en cada ejecucion
# ──────────────────────────────────────────────
def ejecutar_flanqueo():
    global flanqueo_izquierda

    # ── FASE 1: ACERCAMIENTO EN ARCO ────────────────
    # En vez de avanzar recto, una rueda va mas rapido
    # que la otra, creando una trayectoria curva que
    # lleva al sumobot al costado del rival.

    ib.pixel = (255, 100, 0)        # Naranja oscuro: flanqueando

    if flanqueo_izquierda:
        # Arco hacia la IZQUIERDA:
        # Motor derecho (M2) mas rapido -> curva a la izquierda
        ib.motor_1.throttle = -VELOCIDAD_ARCO_LENT
        ib.motor_2.throttle = -VELOCIDAD_ARCO_RAP
    else:
        # Arco hacia la DERECHA:
        # Motor izquierdo (M1) mas rapido -> curva a la derecha
        ib.motor_1.throttle = -VELOCIDAD_ARCO_RAP
        ib.motor_2.throttle = -VELOCIDAD_ARCO_LENT

    # Verifica borde mientras hace el arco
    tiempo_arco = 0
    while tiempo_arco < TIEMPO_RODEO:
        if leer_borde() is not None:
            return          # Sale: el loop principal maneja el escape
        sleep(0.05)
        tiempo_arco += 0.05

    # ── FASE 2: EMPUJE LATERAL A FONDO ──────────────
    # Ya esta posicionado al costado: empuja directo
    ib.pixel = (255, 0, 0)          # Rojo: empujando

    tiempo_empuje = 0
    while tiempo_empuje < 0.6:
        if leer_borde() is not None:
            return
        ib.motor_1.throttle = -VELOCIDAD_EMPUJE
        ib.motor_2.throttle = -VELOCIDAD_EMPUJE
        sleep(0.05)
        tiempo_empuje += 0.05

    # ── FASE 3: FRENO Y ALTERNADO ───────────────────
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.05)

    # Alterna el lado para el proximo ataque
    flanqueo_izquierda = not flanqueo_izquierda


# ──────────────────────────────────────────────
#  COMPORTAMIENTO OFENSIVO PRINCIPAL
# ──────────────────────────────────────────────
def comportamiento_ofensivo():
    distancia = medir_distancia_cm()

    # Rival muy cerca: empuje directo de emergencia
    if distancia < DIST_EMPUJE:
        ib.pixel = (255, 0, 0)
        ib.motor_1.throttle = -VELOCIDAD_EMPUJE
        ib.motor_2.throttle = -VELOCIDAD_EMPUJE

    # Rival en rango: ejecutar flanqueo
    elif distancia < DIST_DETECTADO:
        ejecutar_flanqueo()

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
