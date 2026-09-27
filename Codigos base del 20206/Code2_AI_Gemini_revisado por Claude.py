import board
import keypad
from ideaboard import IdeaBoard
from time import sleep
from hcsr04 import HCSR04
import random

# Instanciación de componentes
sonar = HCSR04(board.IO25, board.IO26)
ib = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# Configuración de sensores infrarrojos analógicos independientes
sen1 = ib.AnalogIn(board.IO36)  # SENSOR 1 (Adelante Izquierdo)
sen2 = ib.AnalogIn(board.IO39)  # SENSOR 2 (Adelante Derecho)
sen3 = ib.AnalogIn(board.IO34)  # SENSOR 3 (Atrás Izquierdo)
sen4 = ib.AnalogIn(board.IO35)  # SENSOR 4 (Atrás Derecho)
infrarrojos = [sen1, sen2, sen3, sen4]

# Umbral por sensor (se calculan en la calibración de arranque)
umbrales = [0, 0, 0, 0]

# ==========================================
# CALIBRACIÓN POR SENSOR
# ==========================================
def esperar_boton():
    keys.events.clear()
    while True:
        event = keys.events.get()
        if event and event.released:
            return

def leer_promedio(muestras=15):
    sumas = [0, 0, 0, 0]
    for _ in range(muestras):
        for i, s in enumerate(infrarrojos):
            sumas[i] += s.value
        sleep(0.01)
    return [s / muestras for s in sumas]

def calibrar_sensores():
    print("--- CALIBRACIÓN DE PISTA ---")
    ib.pixel = (0, 0, 255)
    print("1. Coloca el robot en el CENTRO (NEGRO) y presiona BOOT...")
    esperar_boton()
    negro = leer_promedio()

    ib.pixel = (255, 255, 0)
    print("2. Coloca los sensores sobre la LÍNEA (BLANCO) y presiona BOOT...")
    esperar_boton()
    blanco = leer_promedio()

    for i in range(4):
        umbrales[i] = (negro[i] + blanco[i]) / 2
        print("Sensor " + str(i + 1) + ": negro=" + str(round(negro[i]))
              + " blanco=" + str(round(blanco[i]))
              + " umbral=" + str(round(umbrales[i])))

    ib.pixel = (0, 0, 0)

# ==========================================
# FUNCIONES LÓGICAS Y DE MOVIMIENTO OPTIMIZADAS
# ==========================================

def leer_sensores_independientes():
    """
    Retorna una lista de 4 elementos booleanos (True=Negro, False=Blanco).
    Negro = valores altos, Blanco = valores bajos (convención del proyecto).
    """
    return [sen1.value > umbrales[0],
            sen2.value > umbrales[1],
            sen3.value > umbrales[2],
            sen4.value > umbrales[3]]

def zigzag_adelante(veces, velocidad=1.0):
    """ Movimiento oscilante agresivo ultra rápido """
    for _ in range(veces):
        ib.pixel = (0, 0, 255)  # Azul
        ib.motor_1.throttle = velocidad
        ib.motor_2.throttle = velocidad * 0.2
        sleep(0.08)
        ib.motor_1.throttle = velocidad * 0.2
        ib.motor_2.throttle = velocidad
        sleep(0.08)

def zigzag_atras(veces, velocidad=-1.0):
    """ Retroceso táctico en zigzag a máxima potencia """
    for _ in range(veces):
        ib.pixel = (255, 165, 0)  # Naranja
        ib.motor_1.throttle = -velocidad
        ib.motor_2.throttle = -velocidad * 0.2
        sleep(0.08)
        ib.motor_1.throttle = -velocidad * 0.2
        ib.motor_2.throttle = -velocidad
        sleep(0.08)

def avanzar(velocidad=1.0):
    ib.pixel = (0, 255, 0)  # Verde - Máxima potencia de empuje
    ib.motor_1.throttle = -velocidad
    ib.motor_2.throttle = -velocidad

def retroceder(velocidad=1.0):
    ib.pixel = (255, 0, 0)  # Rojo
    ib.motor_1.throttle = velocidad
    ib.motor_2.throttle = velocidad

def girar_izquierda(velocidad=1.0):
    ib.motor_1.throttle = -velocidad
    ib.motor_2.throttle = velocidad

def girar_derecha(velocidad=1.0):
    ib.motor_1.throttle = velocidad
    ib.motor_2.throttle = -velocidad

def stop():
    ib.pixel = (0, 0, 0)
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0

def medir_distancia():
    """ Medición optimizada sin retardos artificiales """
    try:
        dist = sonar.dist_cm()
        if dist <= 0:
            return 999
        return dist
    except:
        return 999

# ==========================================
# BUCLE PRINCIPAL: REACCIÓN EN TIEMPO REAL
# ==========================================

print("SumoBot Inicializado.")
calibrar_sensores()
print("Presiona BOOT para iniciar combate...")
esperar_boton()
print("Iniciando en 3s...")
sleep(3)

giros_busqueda = 0

while True:
    # 1. Lectura inmediata de sensores (True = Negro, False = Blanco)
    s1_negro, s2_negro, s3_negro, s4_negro = leer_sensores_independientes()

    # -----------------------------------------------------------------
    # RAZONAMIENTO DEFENSIVO (Acciones evasivas a velocidad 1.0)
    # -----------------------------------------------------------------

    # Caso A: Los sensores de ATRÁS detectan Blanco (Peligro de caída trasera)
    if not s3_negro or not s4_negro:
        # Reacción instantánea: Giro a potencia máxima sin detenerse antes
        dir_azar = random.choice([-1, 1])
        ib.pixel = (255, 0, 255)
        ib.motor_1.throttle = dir_azar * -1.0
        ib.motor_2.throttle = dir_azar * 1.0
        sleep(0.25)  # Menor tiempo necesario porque gira el doble de rápido a full potencia

        # Escape a máxima velocidad
        avanzar(1.0)
        sleep(0.15)
        giros_busqueda = 0
        continue

    # Caso B: Los sensores de ADELANTE detectan Blanco
    elif not s1_negro or not s2_negro:
        # Se eliminaron las pausas de stop() previas para que mida la distancia al vuelo
        distancia_frente = medir_distancia()

        # Si NO detecta nada al frente (Rival atacando por la espalda)
        if distancia_frente > 40:
            # Giro violento de 180° a potencia máxima para encararlo
            dir_azar = random.choice([-1, 1])
            ib.motor_1.throttle = dir_azar * -1.0
            ib.motor_2.throttle = dir_azar * 1.0
            sleep(0.35)  # Reducido a la mitad: a 1.0 de potencia da la vuelta en menos tiempo
            giros_busqueda = 0
        else:
            # Si detecta al rival (Lo estamos empujando pero pisamos la línea)
            # Salir en zigzag inverso inmediato para no suicidarse
            zigzag_atras(veces=1, velocidad=1.0)
        continue

    # -----------------------------------------------------------------
    # RAZONAMIENTO AGRESIVO (Ataque y Escaneo Veloz)
    # -----------------------------------------------------------------
    else:
        distancia_enemigo = medir_distancia()

        # Si detecta un objetivo en rango
        if distancia_enemigo < 45:
            giros_busqueda = 0

            # Ataque de ráfaga: Desestabiliza en zigzag y embiste con todo a 1.0
            zigzag_adelante(veces=1, velocidad=1.0)
            avanzar(1.0)

        else:
            # Escaneo rápido del dojo si no ve nada
            if giros_busqueda < 2:
                # Giros cortos y agresivos a la derecha para barrido rápido
                girar_derecha(0.8)
                sleep(0.12)  # Pulsos rápidos de giro
                stop()       # Detener un instante frena la inercia para medir mejor
                sleep(0.02)  # Espera mínima de estabilización física
                giros_busqueda += 1
            else:
                # Si no encuentra nada, avanza a velocidad de crucero para buscar en otra zona
                avanzar(0.7)
                sleep(0.3)
                giros_busqueda = 0

    # Delay del bucle general reducido al mínimo absoluto (2 milisegundos)
    sleep(0.002)
