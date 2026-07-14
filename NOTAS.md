# Tomas de Camino Beck / Mod: Evasion Direccional + HC-SR04 + Seguimiento Activo
# Escuela de Sistemas Inteligentes - Universidad Cenfotec
# TRIG=IO25, ECHO=IO26
# v5: Ataque con verificacion continua (busqueda constante durante el ataque)
#     Histeresis reducida | Umbral IR ajustable por sensor + calibracion promediada

import board
import keypad
from ideaboard import IdeaBoard
from time import sleep, monotonic
from hcsr04 import HCSR04

ib = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# ──────────────────────────────────────────────
#  SENSORES
# ──────────────────────────────────────────────
sonar = HCSR04(board.IO25, board.IO26)

sen1 = ib.AnalogIn(board.IO36)  # Frontal Izquierdo
sen2 = ib.AnalogIn(board.IO39)  # Frontal Derecho
sen3 = ib.AnalogIn(board.IO34)  # Trasero Izquierdo
sen4 = ib.AnalogIn(board.IO35)  # Trasero Derecho
infrarrojos = [sen1, sen2, sen3, sen4]
umbrales = [0, 0, 0, 0]

# ──────────────────────────────────────────────
#  PUNTO 2: UMBRAL IR AJUSTABLE POR SENSOR
#  En vez de un punto medio fijo, el umbral se calcula:
#     umbral = blanco + (negro - blanco) * factor
#  factor = 0.50 -> punto medio (comportamiento original)
#  factor > 0.50 -> umbral mas cercano a "negro" -> MAS FACIL
#                   detectar el blanco (mas sensible)
#  factor < 0.50 -> umbral mas cercano a "blanco" -> MAS DIFICIL
#                   detectar (menos falsos positivos)
#
#  Los sensores FRONTALES (sen1, sen2) necesitan valores mas
#  altos de lo normal para marcar el borde -> arrancan con
#  factor mas alto (mas sensibles). Ajusta estos numeros si
#  en tus pruebas siguen sin detectar bien o detectan de mas.
# ──────────────────────────────────────────────
FACTOR_UMBRAL = [0.62, 0.62, 0.50, 0.50]   # [FrontIzq, FrontDer, TrasIzq, TrasDer]

MUESTRAS_CALIBRACION = 12   # Promedia N lecturas por paso para reducir ruido

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
#  PUNTO 1: HISTERESIS REDUCIDA
#  Antes en 7 ciclos, el sumobot podia seguir
#  "atacando a ciegas" durante varios cientos de ms
#  despues de que el rival ya no estuviera ahi.
#  Se reduce a 3: mantiene apenas el colchon necesario
#  para tolerar 1 eco fallido por la carroceria inclinada,
#  pero reacciona casi de inmediato si el rival se fue.
# ──────────────────────────────────────────────
HISTERESIS_CICLOS   = 3
histeresis_contador = 0
ultima_dist_valida  = DIST_MAX_SONAR

# ──────────────────────────────────────────────
#  PUNTO 1: RAFAGA DE ATAQUE CON VERIFICACION
#  En vez de fijar el throttle y olvidarse del rival,
#  el ataque se ejecuta en una rafaga corta que se
#  revisa constantemente. Si el rival se aleja o esquiva,
#  el ataque se corta para relocalizar en vez de seguir
#  embistiendo a ciegas en linea recta.
# ──────────────────────────────────────────────
DURACION_RAFAGA_ATAQUE   = 0.15   # segundos por rafaga antes de reevaluar
INTERVALO_VERIFICACION   = 0.02   # cada cuanto revisa borde/rival en la rafaga
MISSES_PARA_PERDER_RIVAL = 3      # fallos seguidos para asumir que el rival se fue

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
#  LEER BORDE (IR) — doble lectura, umbral por factor
# ──────────────────────────────────────────────
def leer_borde():
    try:
        vals  = [s.value for s in infrarrojos]
        vals2 = [s.value for s in infrarrojos]
        det   = [vals[i] < umbrales[i] and vals2[i] < umbrales[i] for i in range(4)]

        fl = det[0]  # sen1 Frontal Izq
        fr = det[1]  # sen2 Frontal Der
        rl = det[2]  # sen3 Trasero Izq
        rr = det[3]  # sen4 Trasero Der

        if fl and fr:           return "FRENTE"
        if fr and rr:           return "EMPUJE_DERECHA"
        if fl and rl:           return "EMPUJE_IZQUIERDA"
        if fl or rl:            return "IZQUIERDA"
        if fr or rr:            return "DERECHA"
        return None

    except Exception:
        return None


# ──────────────────────────────────────────────
#  CALIBRACION IR
#  PUNTO 2: promedia MUESTRAS_CALIBRACION lecturas
#  por paso (negro/blanco) para reducir el efecto
#  del ruido electrico sobre los sensores frontales.
# ──────────────────────────────────────────────
def leer_promedio_sensores():
    sumas = [0, 0, 0, 0]
    for _ in range(MUESTRAS_CALIBRACION):
        for i, s in enumerate(infrarrojos):
            sumas[i] += s.value
        sleep(0.01)
    return [s / MUESTRAS_CALIBRACION for s in sumas]


def esperar_boton_y_leer(color_led):
    ib.pixel = color_led
    while True:
        event = keys.events.get()
        if event and event.released:
            lecturas = leer_promedio_sensores()
            ib.pixel = (0, 0, 0)
            sleep(0.5)
            return lecturas


def calibracion_por_pasos():
    print("PASO 1: Sensores sobre NEGRO y presiona BOOT.")
    valores_negro = esperar_boton_y_leer((255, 0, 0))

    print("PASO 2: Sensores sobre BLANCO y presiona BOOT.")
    valores_blanco = esperar_boton_y_leer((255, 255, 255))

    for i in range(4):
        # umbral = blanco + (negro - blanco) * factor
        # factor mas alto en sensores frontales = umbral mas
        # cercano a "negro" = mas facil marcar el blanco real
        umbrales[i] = valores_blanco[i] + (valores_negro[i] - valores_blanco[i]) * FACTOR_UMBRAL[i]
        print("  Sensor " + str(i + 1) + ": negro=" + str(round(valores_negro[i], 1))
              + "  blanco=" + str(round(valores_blanco[i], 1))
              + "  umbral=" + str(round(umbrales[i], 1)))

    print("Calibracion exitosa! Presiona BOOT para combate.")
    esperar_boton_y_leer((0, 255, 0))
    ib.pixel = (0, 0, 0)


# ──────────────────────────────────────────────
#  MANIOBRA DE ESCAPE
# ──────────────────────────────────────────────
def maniobra_escape(direccion):
    try:
        ib.pixel = (255, 0, 255)

        if direccion == "EMPUJE_DERECHA":
            t = monotonic()
            while monotonic() - t < 0.30:
                ib.motor_1.throttle = -VEL_ATAQUE
                ib.motor_2.throttle = -0.25
                if leer_borde() == "FRENTE":
                    break
            ib.motor_1.throttle = -VEL_ATAQUE
            ib.motor_2.throttle =  VEL_ATAQUE
            sleep(0.30)
            detener()

        elif direccion == "EMPUJE_IZQUIERDA":
            t = monotonic()
            while monotonic() - t < 0.30:
                ib.motor_1.throttle = -0.25
                ib.motor_2.throttle = -VEL_ATAQUE
                if leer_borde() == "FRENTE":
                    break
            ib.motor_1.throttle =  VEL_ATAQUE
            ib.motor_2.throttle = -VEL_ATAQUE
            sleep(0.30)
            detener()

        elif direccion == "FRENTE":
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
#  PUNTO 1: RAFAGA DE ATAQUE CON VERIFICACION CONTINUA
#  Esto es la "busqueda constante" durante el ataque:
#  ataca a fondo en pequenos intervalos, revisando en
#  cada uno si aparecio el borde (prioridad maxima) o
#  si el rival dejo de estar presente (varios fallos
#  consecutivos). Si el rival se fue, corta el ataque
#  para que el robot vuelva a barrer y relocalizar en
#  vez de seguir empujando a ciegas hacia la nada.
# ──────────────────────────────────────────────
def ejecutar_rafaga_ataque():
    fallos_consecutivos = 0
    t_inicio = monotonic()

    while monotonic() - t_inicio < DURACION_RAFAGA_ATAQUE:
        ib.motor_1.throttle = -VEL_ATAQUE
        ib.motor_2.throttle = -VEL_ATAQUE

        # Prioridad maxima: borde del dojo
        borde = leer_borde()
        if borde is not None:
            maniobra_escape(borde)
            return "escape"

        # Verifica si el rival sigue presente
        d = medir_distancia_cm()
        if d >= DIST_MAX_SONAR:
            fallos_consecutivos += 1
            if fallos_consecutivos >= MISSES_PARA_PERDER_RIVAL:
                detener()
                return "perdido"     # Rival realmente se fue: relocalizar
        else:
            fallos_consecutivos = 0  # Lectura buena: reinicia contador

        sleep(INTERVALO_VERIFICACION)

    return "continua"   # Termino la rafaga y el rival sigue presente


# ──────────────────────────────────────────────
#  COMPORTAMIENTO OFENSIVO
# ──────────────────────────────────────────────
def comportamiento_ofensivo():
    global ultimo_lado_rival, busqueda_izquierda

    try:
        distancia_frontal = medir_con_histeresis()

        # ── FASE 1: ATAQUE CON VERIFICACION CONTINUA ──
        if distancia_frontal < DIST_ATAQUE:
            ib.pixel = (255, 0, 0)
            ejecutar_rafaga_ataque()
            # Si el rival se perdio durante la rafaga, el
            # siguiente ciclo del loop principal automaticamente
            # vuelve a medir y entra en FASE 2/3 para relocalizar.

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
calibracion_por_pasos()

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
