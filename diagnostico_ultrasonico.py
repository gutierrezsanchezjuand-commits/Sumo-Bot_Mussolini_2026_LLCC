# Tomas de Camino Beck / Mod: Evasion Direccional + HC-SR04 + Seguimiento Activo
# Escuela de Sistemas Inteligentes - Universidad Cenfotec
# TRIG=IO25, ECHO=IO26
# v6: sen1 eliminado (falla hardware). Umbrales fijos por rango conocido de negro.
#     sen2 como unico sensor frontal. Histeresis y rafaga de ataque mantenidas.

import board
import keypad
from ideaboard import IdeaBoard
from time import sleep, monotonic
from hcsr04 import HCSR04

ib = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# ──────────────────────────────────────────────
#  SENSORES
#  sen1 (IO36) eliminado: falla de hardware irrecuperable.
#  sen2 = unico sensor frontal.
#  sen3, sen4 = sensores traseros.
# ──────────────────────────────────────────────
sonar = HCSR04(board.IO25, board.IO26)

sen2 = ib.AnalogIn(board.IO39)  # Frontal (unico)
sen3 = ib.AnalogIn(board.IO34)  # Trasero Izquierdo
sen4 = ib.AnalogIn(board.IO35)  # Trasero Derecho
infrarrojos = [sen2, sen3, sen4]

# ──────────────────────────────────────────────
#  UMBRALES FIJOS POR RANGO CONOCIDO DE NEGRO
#
#  El blanco produce valores bajos y estables en todos los
#  sensores, por lo que no necesita ajuste.
#  El negro produce valores ALTOS pero inestables segun sensor:
#
#    sen2 (frontal): negro entre 30000 y 45000
#                    -> umbral en el piso del rango: 30000
#    sen3 (trasero izq): negro entre 30000 y 35000
#                    -> umbral en el piso del rango: 30000
#    sen4 (trasero der): negro entre 12000 y 20000
#                    -> umbral en el piso del rango: 12000
#
#  Si el valor leido supera el umbral correspondiente,
#  se considera que el sensor esta sobre el negro (borde del dojo).
#  Estos umbrales NO dependen de calibracion en caliente;
#  son valores hardcodeados basados en el comportamiento
#  observado de cada sensor.
# ──────────────────────────────────────────────
UMBRAL_SEN2 = 30000   # Frontal
UMBRAL_SEN3 = 30000   # Trasero Izquierdo
UMBRAL_SEN4 = 12000   # Trasero Derecho

# ──────────────────────────────────────────────
#  CONSTANTES SONAR
# ──────────────────────────────────────────────
DIST_MAX_SONAR     = 100
DIST_ATAQUE        = 30
DIST_AVANCE        = 90

TIEMPO_MICRO_GIRO  = 0.09
UMBRAL_CORRECCION  = 6

VEL_ATAQUE         = 1.0
VEL_TRACKING       = 0.90
VEL_CORRECCION_RAP = 0.90
VEL_CORRECCION_LEN = 0.45
VEL_BUSQUEDA       = 0.75

# ──────────────────────────────────────────────
#  HISTERESIS (sonar)
# ──────────────────────────────────────────────
HISTERESIS_CICLOS   = 3
histeresis_contador = 0
ultima_dist_valida  = DIST_MAX_SONAR

# ──────────────────────────────────────────────
#  RAFAGA DE ATAQUE
# ──────────────────────────────────────────────
DURACION_RAFAGA_ATAQUE   = 0.15
INTERVALO_VERIFICACION   = 0.02
MISSES_PARA_PERDER_RIVAL = 3

busqueda_izquierda = False
ultimo_lado_rival  = "FRENTE"


# ──────────────────────────────────────────────
#  DETENER MOTORES
# ──────────────────────────────────────────────
def detener():
    try:
        ib.motor_1.throttle = 0
        ib.motor_2.throttle = 0
    except Exception:
        pass


# ──────────────────────────────────────────────
#  LEER ULTRASONICO — triple lectura, la menor valida
# ──────────────────────────────────────────────
def medir_distancia_cm():
    try:
        lecturas = []
        for _ in range(3):
            try:
                d = sonar.dist_cm()
                if d is not None and d <= DIST_MAX_SONAR:
                    lecturas.append(d)
            except Exception:
                pass
        if lecturas:
            return min(lecturas)
        return DIST_MAX_SONAR
    except Exception:
        return DIST_MAX_SONAR


def medir_con_histeresis():
    global histeresis_contador, ultima_dist_valida

    dist = medir_distancia_cm()

    if dist < DIST_MAX_SONAR:
        ultima_dist_valida  = dist
        histeresis_contador = HISTERESIS_CICLOS
        return dist
    elif histeresis_contador > 0:
        histeresis_contador -= 1
        return ultima_dist_valida
    else:
        ultima_dist_valida = DIST_MAX_SONAR
        return DIST_MAX_SONAR


# ──────────────────────────────────────────────
#  LEER BORDE (IR) — umbrales fijos, doble lectura
#
#  Con solo 3 sensores funcionales la logica de deteccion
#  se simplifica:
#    - sen2 (frontal): detecta borde por delante
#    - sen3 (trasero izq): borde por atras-izquierda
#    - sen4 (trasero der): borde por atras-derecha
#
#  Combinaciones:
#    sen3 Y sen4  -> FRENTE  (robot avanzando hacia el borde)
#    solo sen2    -> FRENTE  (borde justo adelante)
#    sen3 Y sen4  -> TRASERO (arrastrado hacia atras)
#    solo sen3    -> IZQUIERDA
#    solo sen4    -> DERECHA
#
#  La doble lectura filtra picos electricos puntuales.
# ──────────────────────────────────────────────
def leer_borde():
    try:
        # Primera lectura
        v2a = sen2.value; v3a = sen3.value; v4a = sen4.value
        # Segunda lectura
        v2b = sen2.value; v3b = sen3.value; v4b = sen4.value

        # Ambas lecturas deben superar el umbral para confirmar negro
        f  = (v2a > UMBRAL_SEN2) and (v2b > UMBRAL_SEN2)   # Frontal
        rl = (v3a > UMBRAL_SEN3) and (v3b > UMBRAL_SEN3)   # Trasero Izq
        rr = (v4a > UMBRAL_SEN4) and (v4b > UMBRAL_SEN4)   # Trasero Der

        if f:               return "FRENTE"
        if rl and rr:       return "TRASERO"
        if rl:              return "IZQUIERDA"
        if rr:              return "DERECHA"
        return None

    except Exception:
        return None


# ──────────────────────────────────────────────
#  CALIBRACION SIMPLIFICADA
#  Sin sen1 y con umbrales fijos ya no se necesita
#  calibracion de negro/blanco por pasos. Solo se
#  hace un paso de verificacion visual para confirmar
#  que los sensores activos leen valores coherentes,
#  y luego el boton arranca el combate.
# ──────────────────────────────────────────────
def calibracion_verificacion():
    print("Sumobot v6 listo. Umbrales fijos:")
    print("  sen2 (frontal)      UMBRAL=" + str(UMBRAL_SEN2))
    print("  sen3 (trasero izq)  UMBRAL=" + str(UMBRAL_SEN3))
    print("  sen4 (trasero der)  UMBRAL=" + str(UMBRAL_SEN4))
    print("")
    print("Presiona BOOT para iniciar combate.")

    ib.pixel = (0, 255, 0)
    while True:
        event = keys.events.get()
        if event and event.released:
            break
    ib.pixel = (0, 0, 0)
    sleep(0.5)


# ──────────────────────────────────────────────
#  MANIOBRA DE ESCAPE
# ──────────────────────────────────────────────
def maniobra_escape(direccion):
    try:
        ib.pixel = (255, 0, 255)

        if direccion == "TRASERO":
            # Arrastrado hacia atras: avanzar fuerte y girar
            ib.motor_1.throttle = -VEL_ATAQUE
            ib.motor_2.throttle = -VEL_ATAQUE
            sleep(0.20)
            if ultimo_lado_rival == "IZQUIERDA":
                ib.motor_1.throttle =  VEL_ATAQUE
                ib.motor_2.throttle = -VEL_ATAQUE
            else:
                ib.motor_1.throttle = -VEL_ATAQUE
                ib.motor_2.throttle =  VEL_ATAQUE
            sleep(0.70)
            detener()

        elif direccion == "FRENTE":
            # Borde adelante: retroceder y girar hacia el rival
            ib.motor_1.throttle = 1.0
            ib.motor_2.throttle = 1.0
            sleep(0.18)
            detener()
            if ultimo_lado_rival == "IZQUIERDA":
                ib.motor_1.throttle =  VEL_ATAQUE
                ib.motor_2.throttle = -VEL_ATAQUE
            else:
                ib.motor_1.throttle = -VEL_ATAQUE
                ib.motor_2.throttle =  VEL_ATAQUE
            sleep(0.90)
            detener()

        elif direccion == "IZQUIERDA":
            ib.motor_1.throttle = 1.0
            ib.motor_2.throttle = 1.0
            sleep(0.12)
            ib.motor_1.throttle = -VEL_ATAQUE
            ib.motor_2.throttle =  VEL_ATAQUE
            sleep(0.40)
            detener()

        elif direccion == "DERECHA":
            ib.motor_1.throttle = 1.0
            ib.motor_2.throttle = 1.0
            sleep(0.12)
            ib.motor_1.throttle =  VEL_ATAQUE
            ib.motor_2.throttle = -VEL_ATAQUE
            sleep(0.40)
            detener()

        detener()

    except Exception:
        detener()


# ──────────────────────────────────────────────
#  BARRIDO: localiza al rival con micro-giros
# ──────────────────────────────────────────────
def barrer_y_localizar():
    try:
        resultados = {}

        d1 = medir_distancia_cm()
        d2 = medir_distancia_cm()
        resultados["FRENTE"] = min(d1, d2)

        ib.motor_1.throttle =  0.6
        ib.motor_2.throttle = -0.6
        sleep(TIEMPO_MICRO_GIRO)
        detener()
        d1 = medir_distancia_cm()
        d2 = medir_distancia_cm()
        resultados["IZQUIERDA"] = min(d1, d2)

        ib.motor_1.throttle = -0.6
        ib.motor_2.throttle =  0.6
        sleep(TIEMPO_MICRO_GIRO)
        detener()

        ib.motor_1.throttle = -0.6
        ib.motor_2.throttle =  0.6
        sleep(TIEMPO_MICRO_GIRO)
        detener()
        d1 = medir_distancia_cm()
        d2 = medir_distancia_cm()
        resultados["DERECHA"] = min(d1, d2)

        ib.motor_1.throttle =  0.6
        ib.motor_2.throttle = -0.6
        sleep(TIEMPO_MICRO_GIRO)
        detener()

        lado_optimo = min(resultados, key=resultados.get)
        dist_optima = resultados[lado_optimo]
        return dist_optima, lado_optimo

    except Exception:
        detener()
        return DIST_MAX_SONAR, "FRENTE"


# ──────────────────────────────────────────────
#  CORRECCION DE RUMBO
# ──────────────────────────────────────────────
def corregir_rumbo(lado):
    try:
        if lado == "IZQUIERDA":
            ib.motor_1.throttle =  VEL_CORRECCION_LEN
            ib.motor_2.throttle = -VEL_CORRECCION_RAP
        elif lado == "DERECHA":
            ib.motor_1.throttle = -VEL_CORRECCION_RAP
            ib.motor_2.throttle =  VEL_CORRECCION_LEN
        else:
            ib.motor_1.throttle = -VEL_TRACKING
            ib.motor_2.throttle = -VEL_TRACKING
        sleep(0.07)

    except Exception:
        detener()


# ──────────────────────────────────────────────
#  RAFAGA DE ATAQUE CON VERIFICACION CONTINUA
# ──────────────────────────────────────────────
def ejecutar_rafaga_ataque():
    fallos_consecutivos = 0
    t_inicio = monotonic()

    while monotonic() - t_inicio < DURACION_RAFAGA_ATAQUE:
        ib.motor_1.throttle = -VEL_ATAQUE
        ib.motor_2.throttle = -VEL_ATAQUE

        borde = leer_borde()
        if borde is not None:
            maniobra_escape(borde)
            return "escape"

        d = medir_distancia_cm()
        if d >= DIST_MAX_SONAR:
            fallos_consecutivos += 1
            if fallos_consecutivos >= MISSES_PARA_PERDER_RIVAL:
                detener()
                return "perdido"
        else:
            fallos_consecutivos = 0

        sleep(INTERVALO_VERIFICACION)

    return "continua"


# ──────────────────────────────────────────────
#  COMPORTAMIENTO OFENSIVO
# ──────────────────────────────────────────────
def comportamiento_ofensivo():
    global ultimo_lado_rival, busqueda_izquierda

    try:
        distancia_frontal = medir_con_histeresis()

        # ── FASE 1: ATAQUE ────────────────────────────
        if distancia_frontal < DIST_ATAQUE:
            ib.pixel = (255, 0, 0)
            ejecutar_rafaga_ataque()

        # ── FASE 2: TRACKING ACTIVO ───────────────────
        elif distancia_frontal < DIST_AVANCE:
            ib.pixel = (255, 165, 0)

            dist_optima, lado_optimo = barrer_y_localizar()

            borde = leer_borde()
            if borde is not None:
                maniobra_escape(borde)
                return

            if lado_optimo != "FRENTE" and abs(dist_optima - distancia_frontal) > UMBRAL_CORRECCION:
                ultimo_lado_rival = lado_optimo
                corregir_rumbo(lado_optimo)
            else:
                ib.motor_1.throttle = -VEL_ATAQUE
                ib.motor_2.throttle = -VEL_ATAQUE
                sleep(0.04)

        # ── FASE 3: BUSQUEDA ──────────────────────────
        else:
            ib.pixel = (0, 0, 255)

            if ultimo_lado_rival == "IZQUIERDA":
                ib.motor_1.throttle =  VEL_BUSQUEDA
                ib.motor_2.throttle = -VEL_BUSQUEDA
            elif ultimo_lado_rival == "DERECHA":
                ib.motor_1.throttle = -VEL_BUSQUEDA
                ib.motor_2.throttle =  VEL_BUSQUEDA
            else:
                if busqueda_izquierda:
                    ib.motor_1.throttle =  VEL_BUSQUEDA
                    ib.motor_2.throttle = -VEL_BUSQUEDA
                else:
                    ib.motor_1.throttle = -VEL_BUSQUEDA
                    ib.motor_2.throttle =  VEL_BUSQUEDA
                busqueda_izquierda = not busqueda_izquierda

            sleep(0.10)

    except Exception:
        detener()


# ──────────────────────────────────────────────
#  EJECUCION PRINCIPAL
# ──────────────────────────────────────────────
detener()
calibracion_verificacion()

while True:
    try:
        borde = leer_borde()
        if borde is not None:
            maniobra_escape(borde)
        else:
            comportamiento_ofensivo()

    except Exception:
        detener()
        sleep(0.01)
