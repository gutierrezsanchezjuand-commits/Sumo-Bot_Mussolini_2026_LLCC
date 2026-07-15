import board
import keypad
from ideaboard import IdeaBoard
from time import sleep

ib = IdeaBoard()

# Configura botón BOOT en IO0
keys = keypad.Keys((board.IO0,), value_when_pressed=False, pull=True)

# Configura los pines analógicos
sen1 = ib.AnalogIn(board.IO36)
sen2 = ib.AnalogIn(board.IO39)
sen3 = ib.AnalogIn(board.IO34)
sen4 = ib.AnalogIn(board.IO35)

infrarrojos = [sen1, sen2, sen3, sen4]
umbrales = [0, 0, 0, 0]


def esperar_boton_y_leer(color_led):
    """
    Cambia el LED, espera a que se presione el botón BOOT y 
    retorna las lecturas de los 4 sensores en ese instante exacto.
    """
    ib.pixel = color_led
    while True:
        event = keys.events.get()
        if event and event.released:
            # Lee y guarda el valor de los 4 sensores
            lecturas = [sen.value for sen in infrarrojos]
            ib.pixel = (0, 0, 0)
            sleep(0.5)  # Pequeña pausa para no detectar doble toque
            return lecturas


def calibracion_por_pasos():
    """Calibración estática guiada por el usuario."""
    # PASO 1: Leer el fondo Negro
    print("PASO 1: Pon los 4 sensores sobre el fondo NEGRO y presiona BOOT.")
    valores_negro = esperar_boton_y_leer((255, 0, 0))  # LED Rojo
    print(f"Lecturas Negro: {valores_negro}")

    # PASO 2: Leer el borde Blanco
    print("PASO 2: Pon los 4 sensores sobre la línea BLANCA y presiona BOOT.")
    valores_blanco = esperar_boton_y_leer((255, 255, 255))  # LED Blanco
    print(f"Lecturas Blanco: {valores_blanco}")

    # Calcular umbral exacto: (Negro + Blanco) / 2
    for i in range(4):
        umbrales[i] = (valores_negro[i] + valores_blanco[i]) // 2
        print(f"Sensor {i+1} -> Umbral fijado en: {umbrales[i]}")

    # PASO 3: Esperar inicio de combate
    print("¡CALIBRACIÓN EXITOSA! Pon el robot en la línea de salida.")
    print("Presiona BOOT por última vez para iniciar el combate.")
    esperar_boton_y_leer((0, 255, 0))  # LED Verde
    
# Cuenta regresiva reglamentaria (3 Segundos)
    print("Iniciando cuenta regresiva de 3 segundos...")
    for i in range(3, 0, -1):
        print(f"{i}...")
        ib.pixel = (255, 255, 0)  # Amarillo para precaución/cuenta regresiva
        sleep(0.5)
        ib.pixel = (0, 0, 0)
        sleep(0.5)

def leer_borde():
    """
    Retorna True si AL MENOS UN sensor toca la línea blanca.
    El blanco genera números bajos, así que se activa si la lectura es menor al umbral.
    """
    for i, sen in enumerate(infrarrojos):
        if sen.value < umbrales[i]:
            return True
    return False


def maniobra_escape():
    """Ejecuta el escape asumiendo que los motores están invertidos físicamente."""
    ib.pixel = (255, 0, 255)  # Magenta = Tocó borde
    
    # 1. Frenar
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.05)
    
    # 2. Retroceder (Como están invertidos, retroceder requiere valores positivos)
    ib.motor_1.throttle = 1.0
    ib.motor_2.throttle = 1.0
    sleep(0.25)
    
    # 3. Giro de 180 grados (Un motor adelante -, otro atrás +)
    ib.motor_1.throttle = -1.0
    ib.motor_2.throttle = 1.0
    #tiempo para 180 grados (1.20)
    sleep(1.0) # Puedes aumentar o disminuir este valor si gira mucho o muy poco
    
    # 4. Frenar antes de volver a la carga
    ib.motor_1.throttle = 0
    ib.motor_2.throttle = 0
    sleep(0.05)


###### EJECUCIÓN PRINCIPAL #######
ib.motor_1.throttle = 0
ib.motor_2.throttle = 0

# Ejecuta la rutina de calibración de 3 pasos
calibracion_por_pasos()

# Bucle infinito de combate
while True:
    if leer_borde():
        maniobra_escape()
    else:
        # Ir recto a máxima velocidad 
        # (Se usan valores negativos -1.0 porque los motores están invertidos)
        ib.pixel = (0, 255, 255)
        ib.motor_1.throttle = -1.0
        ib.motor_2.throttle = -1.0
