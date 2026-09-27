import board
from ideaboard import IdeaBoard
from time import sleep

ib = IdeaBoard()
sleep(1.0)

sen1 = ib.AnalogIn(board.IO36)
sen2 = ib.AnalogIn(board.IO39)
sen3 = ib.AnalogIn(board.IO34)
sen4 = ib.AnalogIn(board.IO35)

print("Valores crudos — CTRL+C para salir")
print("S1(IO36) S2(IO39) S3(IO34) S4(IO35)")

while True:
    print(f"  {sen1.value:6}   {sen2.value:6}   {sen3.value:6}   {sen4.value:6}")
    sleep(0.3)

