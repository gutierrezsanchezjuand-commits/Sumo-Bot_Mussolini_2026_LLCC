# ==========================================
# SUMOBOT – MODO COMBATE
# Universidad CENFOTEC
# Basado en Prueba_Dojo.py
#
# Cambios respecto a la versión de prueba:
#   - Calibración automática del piso negro al presionar BOOT
#   - Inicio de ronda personalizado (combate 1/2/3)
#   - Evasión de borde con prioridad absoluta sobre el ataque
#   - Búsqueda y ataque del rival con el sonar
#   - Sin time.sleep(): todo con time.monotonic() (robot 24/7 activo)
#   - sen1 (frontal izquierdo) excluido por estar dañado
#   - Corrección de motores soldados con polaridad invertida
# ==========================================

import board
import keypad
import time
from ideaboard import IdeaBoard
from hcsr04 import HCSR04

# ------------------------------------------
# Inicialización
# ------------------------------------------
ib = IdeaBoard()

# Sensores infrarrojos
# sen1 (frontal izquierdo) está dañado: NO se inicializa ni se usa.
ir2 = ib.AnalogIn(board.IO39)   # sen2 - frontal derecho
ir3 = ib.AnalogIn(board.IO34)   # sen3 - trasero izquierdo
ir4 = ib.AnalogIn(board.IO35)   # sen4 - trasero derecho

# Sensor ultrasónico (para encontrar y atacar al rival)
sonar = HCSR04(board.IO26, board.IO25)

# Botón 0 (BOOT)
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# ------------------------------------------
# Parámetros conocidos de los sensores
# ------------------------------------------
BLANCO_MAX = 5000                            # blanco: 0 < valor < 5000, en cualquier sensor
NEGRO_MAX = {2: 45000, 3: 30000, 4: 15000}   # tope de ruido en negro, medido por sensor

UMBRAL = {2: 0, 3: 0, 4: 0}                  # se calcula en la calibración

DURACION_CALIB = 2.0   # segundos que se muestrea el piso negro al presionar BOOT

# ------------------------------------------
# Parámetros de combate (ajustar en cancha)
# ------------------------------------------
VEL_BUSQUEDA = 1.0
VEL_ATAQUE = 1.0
VEL_EVASION = 1.0
DISTANCIA_ATAQUE = 30      # cm — a partir de aquí se considera "rival encontrado"

T_GIRO_90 = 0.4    # tiempo de pivote para el inicio "de lado"     -> calibrar con el robot real
T_GIRO_180 = 0.8   # tiempo de pivote para el inicio "de espaldas" -> calibrar con el robot real

# ------------------------------------------
# Estados del programa
# ------------------------------------------
ESPERA_CALIB = "ESPERA_CALIB"
CALIBRANDO   = "CALIBRANDO"
ESPERA_RONDA = "ESPERA_RONDA"
INICIO_RONDA = "INICIO_RONDA"
COMBATE      = "COMBATE"

estado = ESPERA_CALIB
ronda = 1

calib_fin = 0.0
calib_min = {}
calib_max = {}
maniobra_fin = 0.0


def _clamp(v):
    if v > 1:
        return 1
    if v < -1:
        return -1
    return v


def motores(m1, m2):
    """Único punto de control de los motores.
    Ambos motores quedaron soldados con la polaridad invertida:
    se corrige aquí, una sola vez, para todo el programa."""
    ib.motor_1.throttle = -_clamp(m1)
    ib.motor_2.throttle = -_clamp(m2)


def boton_soltado():
    evento = keys.events.get()
    return bool(evento and evento.released)


print("Esperando botón BOOT para calibrar...")
ib.pixel = (255, 0, 0)

# ------------------------------------------
# Bucle principal (sin sleep — corre a máxima velocidad)
# ------------------------------------------
while True:
    ahora = time.monotonic()

    # -------- 1. Esperar BOOT para calibrar --------
    if estado == ESPERA_CALIB:
        if boton_soltado():
            estado = CALIBRANDO
            calib_fin = ahora + DURACION_CALIB
            calib_min = {2: NEGRO_MAX[2], 3: NEGRO_MAX[3], 4: NEGRO_MAX[4]}
            calib_max = {2: 0, 3: 0, 4: 0}
            ib.pixel = (255, 255, 0)
            print("Calibrando el fondo del dojo (no mover el robot)...")

    # -------- 2. Calibración automática del fondo negro --------
    elif estado == CALIBRANDO:
        for s, sensor in ((2, ir2), (3, ir3), (4, ir4)):
            v = sensor.value
            if v < calib_min[s]:
                calib_min[s] = v
            if v > calib_max[s]:
                calib_max[s] = v

        if ahora >= calib_fin:
            for s in (2, 3, 4):
                # punto medio entre el techo de blanco y el piso de negro visto,
                # con un mínimo de seguridad por si la calibración salió mal
                UMBRAL[s] = max((BLANCO_MAX + calib_min[s]) / 2, BLANCO_MAX + 200)
            print("Umbrales calculados:", UMBRAL)
            print("Rango de negro visto (min/max):", calib_min, calib_max)
            estado = ESPERA_RONDA
            ronda = 1

    # -------- 3. Esperar BOOT para iniciar la siguiente ronda --------
    elif estado == ESPERA_RONDA:
        if ronda == 1:
            ib.pixel = (0, 255, 0)
        elif ronda == 2:
            ib.pixel = (0, 100, 255)
        else:
            ib.pixel = (180, 0, 255)

        if boton_soltado():
            estado = INICIO_RONDA
            if ronda == 1:          # combate 1: cara a cara -> no gira
                maniobra_fin = ahora
            elif ronda == 2:        # combate 2: de lado -> pivote de 90°
                maniobra_fin = ahora + T_GIRO_90
            else:                    # combate 3: de espaldas -> pivote de 180°
                maniobra_fin = ahora + T_GIRO_180
            print("Iniciando combate", ronda)

    # -------- 4. Maniobra de arranque personalizada por combate --------
    elif estado == INICIO_RONDA:
        if ronda == 1:
            motores(0, 0)
        else:
            ib.pixel = (255, 140, 0)
            motores(VEL_EVASION, -VEL_EVASION)   # pivota para quedar de frente al rival

        if ahora >= maniobra_fin:
            motores(0, 0)
            estado = COMBATE

    # -------- 5. Combate: evasión de borde > ataque/búsqueda --------
    else:
        # El botón siempre puede detener el combate y pasar a la siguiente ronda
        if boton_soltado():
            motores(0, 0)
            ronda = 1 if ronda == 3 else ronda + 1
            estado = ESPERA_RONDA
            continue

        blanco_frente = ir2.value < UMBRAL[2]
        blanco_atras = (ir3.value < UMBRAL[3]) or (ir4.value < UMBRAL[4])

        if blanco_frente:
            ib.pixel = (255, 100, 0)
            motores(-VEL_EVASION, -VEL_EVASION)      # retrocede hasta volver a ver negro
        elif blanco_atras:
            ib.pixel = (0, 150, 255)
            motores(VEL_EVASION, VEL_EVASION)        # avanza hasta volver a ver negro
        else:
            try:
                dist = sonar.dist_cm()
            except RuntimeError:
                dist = -1

            if dist != -1 and dist < DISTANCIA_ATAQUE:
                ib.pixel = (255, 0, 255)
                motores(VEL_ATAQUE, VEL_ATAQUE)       # rival encontrado: atacar
            else:
                ib.pixel = (0, 255, 0)
                motores(VEL_BUSQUEDA, -VEL_BUSQUEDA)  # nadie a la vista: girar buscando
