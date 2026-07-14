# Tomas de Camino Beck
# DIAGNOSTICO DE MOTORES — Valores sin invertir
# Escuela de Sistemas Inteligentes - Universidad Cenfotec
#
# Secuencia:
#   1. Adelante
#   2. Atras
#   3. Giro izquierda (en su propio eje)
#   4. Giro derecha   (en su propio eje)
#
# LED indica el paso activo.
# Presiona BOOT para iniciar la secuencia.

import board
import keypad
from ideaboard import IdeaBoard
from time import sleep

ib   = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# ──────────────────────────────────────────────
#  CONFIGURACION
# ──────────────────────────────────────────────
VEL_PRUEBA = 1.0   # Velocidad de prueba (0.0 – 1.0)
DURACION   = 1.20   # Segundos por movimiento
PAUSA      = 0.50   # Pausa entre movimientos

# ──────────────────────────────────────────────
#  COLORES LED POR PASO
# ──────────────────────────────────────────────
COLOR_LISTO     = (255, 255, 255)   # Blanco  — esperando BOOT
COLOR_ADELANTE  = (0,   255,   0)   # Verde
COLOR_ATRAS     = (255,   0,   0)   # Rojo
COLOR_IZQUIERDA = (0,     0, 255)   # Azul
COLOR_DERECHA   = (255, 165,   0)   # Naranja
COLOR_FIN       = (0,   255, 255)   # Cian    — secuencia completa


# ──────────────────────────────────────────────
#  UTILIDADES
# ──────────────────────────────────────────────
def detener():
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    ib.pixel = (0, 0, 0)


def esperar_boton():
    print("  → Presiona BOOT para continuar...")
    while True:
        event = keys.events.get()
        if event and event.released:
            return


def ejecutar_paso(nombre, motor_1, motor_2, color):
    print("[ " + nombre + " ]  motor_1=" + str(motor_1) + "  motor_2=" + str(motor_2))
    ib.pixel = color
    ib.motor_1.throttle = motor_1
    ib.motor_2.throttle = motor_2
    sleep(DURACION)
    detener()
    sleep(PAUSA)


# ──────────────────────────────────────────────
#  SECUENCIA DE DIAGNOSTICO
# ──────────────────────────────────────────────
print("========================================")
print("  DIAGNOSTICO DE MOTORES — SumoBot")
print("  VEL_PRUEBA = " + str(VEL_PRUEBA))
print("  DURACION   = " + str(DURACION) + " s por paso")
print("========================================")

detener()
ib.pixel = COLOR_LISTO
esperar_boton()

# ── PASO 1: ADELANTE ─────────────────────────
#   Ambos motores giran en sentido positivo.
ejecutar_paso(
    "1. ADELANTE",
    motor_1 =  VEL_PRUEBA,
    motor_2 =  VEL_PRUEBA,
    color   = COLOR_ADELANTE
)

# ── PASO 2: ATRAS ────────────────────────────
#   Ambos motores giran en sentido negativo.
ejecutar_paso(
    "2. ATRAS",
    motor_1 = -VEL_PRUEBA,
    motor_2 = -VEL_PRUEBA,
    color   = COLOR_ATRAS
)

# ── PASO 3: GIRO IZQUIERDA (eje propio) ──────
#   Motor izquierdo (1) retrocede,
#   Motor derecho  (2) avanza.
ejecutar_paso(
    "3. GIRO IZQUIERDA",
    motor_1 = -VEL_PRUEBA,
    motor_2 =  VEL_PRUEBA,
    color   = COLOR_IZQUIERDA
)

# ── PASO 4: GIRO DERECHA (eje propio) ────────
#   Motor izquierdo (1) avanza,
#   Motor derecho  (2) retrocede.
ejecutar_paso(
    "4. GIRO DERECHA",
    motor_1 =  VEL_PRUEBA,
    motor_2 = -VEL_PRUEBA,
    color   = COLOR_DERECHA
)

# ── FIN ──────────────────────────────────────
ib.pixel = COLOR_FIN
print("========================================")
print("  Secuencia completada.")
print("  Observa los resultados y ajusta")
print("  la inversion de motores segun necesites.")
print("========================================")
