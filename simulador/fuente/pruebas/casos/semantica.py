# Prueba de semantica de Python: cada linea impresa se compara con lo esperado.
import time
import math
from time import sleep

print(7 // 2, -7 // 2, 7 % 3, -7 % 3, 7 / 2, 2 ** 10)
print(round(2.5), round(3.5), round(-2.5), round(2.675, 2), int(-3.9), int("42"))
x = [1, 2, 3, 4, 5]
print(x[-1], x[1:3], x[::-1], x[::2], len(x), sum(x), min(x), max(x))
t = (1, "a", 2.5)
print(t, (1,), [], {}, None, True, False)
d = {"a": 1, "b": [1, 2]}
d["c"] = 3
print(d, "a" in d, d.get("z", 0), list(d.keys()), len(d))
print(f"{3.14159:.2f} {42:05d} {'hola':>6}|{7:<4}|{255:x} {1234567:,}")
print("%d-%s-%.1f" % (3, "x", 2.25), "{} y {}".format(1, "dos"), "a,b,c".split(","))
print([i * i for i in range(5) if i % 2 == 0], {k: v for k, v in [("p", 1), ("q", 2)]})
print(sorted([3, 1, 2], reverse=True), sorted(["bb", "a", "ccc"], key=len), list(zip([1, 2], "ab")))
print(any([0, 0, 1]), all([1, 1, 0]), abs(-3), divmod(17, 5), bool([]), bool([0]), "" or "vacio", 0 and 5)
a, b = 1, 2
a, b = b, a
print(a, b)
primero, *resto = [9, 8, 7]
print(primero, resto)

def saludar(nombre, saludo="Hola", *extras, fin="!"):
    return f"{saludo} {nombre}{fin}" + ("" if not extras else str(extras))

print(saludar("Ana"), saludar("Beto", "Chau"), saludar("C", fin="?"), saludar("D", "Ey", 1, 2))

contador = 0
def sumar():
    global contador
    contador += 1
    return contador
sumar(); sumar()
print(contador)

def fabrica(k):
    def mult(v):
        return v * k
    return mult
print(fabrica(3)(5), list(map(lambda v: v + 1, [1, 2])), list(filter(None, [0, 1, 2])))

class Robot:
    ruedas = 2
    def __init__(self, nombre, vel=1.0):
        self.nombre = nombre
        self.vel = vel
    def __str__(self):
        return "Robot(" + self.nombre + ")"
    def avanzar(self, t):
        return self.vel * t

class Rapido(Robot):
    def __init__(self, nombre):
        super().__init__(nombre, 2.0)
    def avanzar(self, t):
        return super().avanzar(t) + 1

r = Rapido("Z")
print(r, r.avanzar(3), Robot.ruedas, isinstance(r, Robot), isinstance(3, int), type(r).__name__ if hasattr(type(r), "__name__") else "?")

try:
    [1][5]
except IndexError as e:
    print("IndexError:", e)
try:
    1 / 0
except ZeroDivisionError as e:
    print("ZeroDivisionError:", e)
try:
    int("x")
except ValueError:
    print("ValueError ok")
class MiError(Exception):
    pass
try:
    raise MiError("propio")
except Exception as e:
    print(type(e).__name__, e)
finally:
    print("finally ok")

for i in range(3):
    if i == 5:
        break
else:
    print("for-else ok")
n = 0
while n < 3:
    n += 1
else:
    print("while-else ok", n)
s = "Sumo Bot"
print(s.upper(), s.lower(), s.replace("o", "0"), s[::-1], s.startswith("Su"), s.find("Bot"), "-".join(["a", "b"]))
print(math.sqrt(16), math.pi > 3, max(3, 7, key=lambda v: -v), [1, 2] + [3], "ab" * 3, [0] * 3)
t0 = time.monotonic()
sleep(0.1)
print("durmio", round(time.monotonic() - t0, 1))
print("fin")
