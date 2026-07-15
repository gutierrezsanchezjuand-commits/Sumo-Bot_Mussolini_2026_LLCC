import board
import keypad
import time
import random
from ideaboard import IdeaBoard
from hcsr04 import HCSR04

# ==========================================
#        CONFIGURACIÓN DE HARDWARE
# ==========================================
sonar = HCSR04(board.IO26, board.IO25)
ib = IdeaBoard()
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# Sensores Infrarrojos
sen1 = ib.AnalogIn(board.IO36)  # SENSOR 1 (adelante izquierdo)
sen2 = ib.AnalogIn(board.IO39)  # SENSOR 2 (adelante derecho)
sen3 = ib.AnalogIn(board.IO34)  # SENSOR 3 (atrás izquierdo)
sen4 = ib.AnalogIn(board.IO35)  # SENSOR 4 (atrás derecho)
infrarrojos = [sen1, sen2, sen3, sen4]

# ==========================================
#        FUNCIONES DE SENSORES
# ==========================================
def arreglo_a_entero(bits):
    valor = 0
    for bit in bits:
        valor = (valor << 1) | bit
    return valor

def leer_sensores(infrarrojos, valor_critico):
    # Detecta línea blanca (1) si el valor es MAYOR al umbral (blanco = valores Bajos)
    return [int(sen.value > valor_critico) for sen in infrarrojos]

def line_status(infrarrojos, valor_critico):
    sensores = leer_sensores(infrarrojos, valor_critico)
    return arreglo_a_entero(sensores)

def esperar_click():
    keys.events.clear()
    while True:
        event = keys.events.get()
        if event and event.released:
            return

def leer_promedio(infrarrojos, lecturas=10):
    suma_total = 0
    for _ in range(lecturas):
        promedio_instante = sum([sen.value for sen in infrarrojos]) / 4
        suma_total += promedio_instante
        time.sleep(0.5)
    return suma_total / lecturas

def autocalibrar():
    print("--- INICIANDO AUTOCALIBRACIÓN ---")
    
    # 1. Calibrar Fondo (Negro = Valores Altos)
    ib.pixel = (0, 0, 255)  # AZUL
    print("Pon el robot en el centro (NEGRO) y presiona BOOT...")
    esperar_click()
    valor_negro = leer_promedio(infrarrojos)
    print(f"Negro registrado: {valor_negro:.0f}")
    
    ib.pixel = (0, 0, 0)
    time.sleep(0.5)
    
    # 2. Calibrar Borde (Blanco = Valores Bajos)
    ib.pixel = (255, 255, 0)  # AMARILLO
    print("Pon los sensores sobre la línea (BLANCO) y presiona BOOT...")
    esperar_click()
    valor_blanco = leer_promedio(infrarrojos)
    print(f"Blanco registrado: {valor_blanco:.0f}")
    
    ib.pixel = (0, 0, 0)
    time.sleep(0.5)
    
    # 3. Calcular Umbral
    umbral = (valor_negro + valor_blanco) / 2
    print(f"¡Calibración lista! Umbral (th): {umbral:.0f}")
    return umbral

# ==========================================
#        FUNCIONES DE MOVIMIENTO
# ==========================================
def forward(speed=0.5):
    ib.pixel = (10, 0, 0)
    ib.motor_1.throttle = speed
    ib.motor_2.throttle = speed

def backward(speed=0.5):
    ib.pixel = (150, 255, 0)
    ib.motor_1.throttle = -speed
    ib.motor_2.throttle = -speed

def right(speed=0.8):
    ib.pixel = (50, 55, 100)
    ib.motor_1.throttle = speed
    ib.motor_2.throttle = -speed

def left(speed=0.8):
    ib.pixel = (50, 55, 100)
    ib.motor_1.throttle = -speed
    ib.motor_2.throttle = speed
    
def stop():
    ib.pixel = (0, 0, 0)
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0

def evadir_linea(status):
    if 1 <= status <= 3:
        # Sensores traseros tocan línea -> Escapar hacia adelante
        forward(1.0)
        time.sleep(0.05) 
    else:
        # Sensores delanteros tocan línea -> Reversa y giro
        backward(1.0)
        time.sleep(0.05)
        
        direccion = random.choice([1, -1])
        ib.pixel = (255, 0, 1)
        ib.motor_1.throttle = direccion * -1.0
        ib.motor_2.throttle = direccion * 1.0
        time.sleep(0.5)
        
    stop()

def esperar_boton_pelea():
    print("Modo Combate Listo. Esperando BOOT para iniciar...")
    ib.pixel = (255, 100, 0) # NARANJA
    while True:
        event = keys.events.get()
        if event and event.released:
            print("¡Iniciando en 3 segundos!")
            ib.pixel = (0, 255, 0) # VERDE
            time.sleep(3)
            ib.pixel = (0, 0, 0)
            return

# ==========================================
#              CÓDIGO PRINCIPAL
# ==========================================
stop()

# Rutina Pre-Combate
th = autocalibrar()
esperar_boton_pelea()

# Loop Continuo de Combate
while True:
    time.sleep(0.50) # Pausa necesaria para el eco del ultrasonido
    
    # 1. SUPERVIVENCIA: Revisar borde del Dojo
    estado_linea = line_status(infrarrojos, th)
    if estado_linea != 0:
        evadir_linea(estado_linea)
        continue 
    
    # 2. BÚSQUEDA Y ATAQUE
    try:
        distancia = sonar.dist_cm()
    except RuntimeError:
        distancia = -1 # Seguro contra fallos de lectura del sensor
        
    # Validamos que sea una medida lógica antes de atacar
    if 2 < distancia < 40:
        forward(1.0)
    else:
        right(0.8)
        left(0.8)
