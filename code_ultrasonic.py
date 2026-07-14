# ==========================================
# UNIVERSIDAD CENFOTEC - ESCUELA DE SISTEMAS INTELIGENTES
# PROYECTO: SUMOBOT AUTÓNOMO (MÁXIMA VELOCIDAD Y REACCIÓN)
# Adaptado para IdeaBoard (CircuitPython) - Versión Final
# ==========================================

import board
import digitalio
from ideaboard import IdeaBoard
from time import sleep
from hcsr04 import HCSR04
import random

# Instanciación de componentes
sonar = HCSR04(board.IO26, board.IO25)
ib = IdeaBoard()
boton_boot = digitalio.DigitalInOut(board.IO0)
boton_boot.direction = digitalio.Direction.INPUT
boton_boot.pull = digitalio.Pull.UP

# Configuración de sensores infrarrojos
sen1 = ib.AnalogIn(board.IO36)
sen2 = ib.AnalogIn(board.IO39)
sen3 = ib.AnalogIn(board.IO34)
sen4 = ib.AnalogIn(board.IO35)
infrarrojos = [sen1, sen2, sen3, sen4]

# Parámetros de seguridad
VOLTAJE_MINIMO = 7.0

# ==========================================
# FUNCIONES DE SISTEMA Y SEGURIDAD
# ==========================================

def esperar_boton():
    while boton_boot.value: pass
    while not boton_boot.value: pass
    print("¡Botón presionado, capturando...")

# Suponiendo que el pin de batería es el IO33 (ajusta si tu placa usa otro)
pin_bateria = ib.AnalogIn(board.IO33) 

def verificar_bateria():
    # El valor analógico suele ir de 0 a 65535 en CircuitPython
    # Debes calcular el factor de escala: (Voltaje_leído * Referencia_ADC) / divisor
    # Para una batería 2S (8.4V máx), un divisor común es 2.
    
    # Lectura cruda (0-65535)
    valor_adc = pin_bateria.value
    
    # Conversión a voltaje (fórmula referencial, ajusta según tu divisor)
    # Si el divisor es 2, el voltaje real es aproximadamente (valor_adc / 65535) * 3.3V * 2
    voltaje = (valor_adc / 65535) * 3.3 * 2 
    
    if voltaje < VOLTAJE_MINIMO:
        print(f"¡ALERTA! Voltaje crítico: {voltaje:.2f}V. Deteniendo.")
        while True:
            stop()
            ib.pixel = (255, 0, 0)
    print(f"Voltaje verificado: {voltaje:.2f}V")

def calibrar_sensores():
    print("--- CALIBRACIÓN DE PISTA ---")
    print("1. Coloca el robot sobre BLANCO y presiona BOOT")
    esperar_boton()
    vals_b = [sum([s.value for s in infrarrojos])/4 for _ in range(20)]
    val_blanco = sum(vals_b)/20
    
    print("2. Coloca el robot sobre NEGRO y presiona BOOT")
    esperar_boton()
    vals_n = [sum([s.value for s in infrarrojos])/4 for _ in range(20)]
    val_negro = sum(vals_n)/20
    
    umbral = (val_blanco + val_negro) / 2
    print(f"Calibración exitosa. Umbral: {umbral}")
    return umbral

# Ejecutar rutina de inicio
#verificar_bateria()
VALOR_CRITICO = calibrar_sensores()
print("¡Sistema listo! Iniciando en 3s...")
sleep(3)

# ==========================================
# FUNCIONES LÓGICAS Y DE MOVIMIENTO
# ==========================================

def leer_sensores_independientes():
    return [s.value < VALOR_CRITICO for s in infrarrojos]

def zigzag_atras(velocidad=1.0):
    ib.pixel = (255, 165, 0)
    for _ in range(2):
        ib.motor_1.throttle, ib.motor_2.throttle = -velocidad, -velocidad * 0.2
        sleep(0.08)
        ib.motor_1.throttle, ib.motor_2.throttle = -velocidad * 0.2, -velocidad
        sleep(0.08)

def avanzar(vel=1.0):
    ib.pixel = (0, 255, 0)
    ib.motor_1.throttle, ib.motor_2.throttle = vel, vel

def stop():
    ib.pixel = (0, 0, 0)
    ib.motor_1.throttle = ib.motor_2.throttle = 0

def medir_distancia():
    try:
        d = sonar.dist_cm()
        return d if d > 0 else 999
    except: return 999

# ==========================================
# BUCLE PRINCIPAL
# ==========================================

giros_busqueda = 0

while True:
    s1, s2, s3, s4 = leer_sensores_independientes()
    
    # Razonamiento Defensivo (Línea)
    if not (s3 and s4): # Sensores traseros detectan blanco
        ib.motor_1.throttle, ib.motor_2.throttle = 1.0, -1.0
        sleep(0.2)
        avanzar(1.0)
        sleep(0.15)
        continue
    
    elif not (s1 and s2): # Sensores delanteros detectan blanco
        if medir_distancia() > 40:
            dir_z = random.choice([-1, 1])
            ib.motor_1.throttle, ib.motor_2.throttle = dir_z * -1.0, dir_z * 1.0
            sleep(0.35)
        else:
            zigzag_atras(1.0)
        continue

    # Razonamiento Agresivo (Busqueda)
    dist = medir_distancia()
    if dist < 45:
        avanzar(1.0)
        giros_busqueda = 0
    else:
        if giros_busqueda < 2:
            ib.motor_1.throttle, ib.motor_2.throttle = 0.8, -0.8
            sleep(0.12)
            stop()
            sleep(0.02)
            giros_busqueda += 1
        else:
            avanzar(0.7)
            sleep(0.3)
            giros_busqueda = 0
            
    sleep(0.002)