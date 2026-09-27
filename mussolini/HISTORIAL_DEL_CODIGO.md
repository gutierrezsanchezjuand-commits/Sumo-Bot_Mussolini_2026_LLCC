# Historial del código

El 2026-09-27 los comentarios del firmware se resumieron a 10 palabras como máximo, sin tocar el código. Acá quedan **completos, tal como estaban** (versión `competencia_2c00113d`, cambios 1–33): la historia de cada cambio y las mediciones que justifican cada valor. Antes de cambiar una constante, leer su entrada.

> En GitHub el archivo principal se llama `mussolini.ino`; acá aparece con su nombre anterior, `sumo_arduino.ino`.

## `sumo_arduino.ino`

### Cabecera (historial de cambios)

Líneas 1–160 de la versión anterior.

```cpp
/*
  Tomas de Camino Beck / Mod: Evasion Direccional + HC-SR04
  Escuela de Sistemas Inteligentes - Universidad Cenfotec
  Version Arduino - corregida tras pruebas reales en el sumobot

  CAMBIOS EN ESTA VERSION (segun pruebas reales):
    1. Pitido en cada cambio de accion -> PWM movido a 20kHz (LEDC),
       fuera del rango audible. El pitido anterior era la frecuencia
       por defecto de analogWrite(), que cae en rango audible.
    2. Se congelaba al detectar el borde blanco -> era friccion estatica
       (stiction): el motor recibia la orden pero no tenia suficiente
       fuerza para arrancar desde parado. Se agrego un impulso breve a
       maxima potencia cada vez que un motor arranca desde 0.
    3. Iba hacia atras en modo ataque -> confirmado con pruebas: los
       motores de este robot estan invertidos. Interruptor unico
       INVERTIR_MOTORES (abajo) para corregirlo sin tocar el resto
       del codigo.
    4. Muy lento -> el barrido lateral (barrer_y_localizar) tardaba
       ~250ms por ciclo girando para localizar al rival. Se elimino:
       ahora en la zona de 40-100cm simplemente avanza derecho. Tambien
       se bajo el timeout del sensor ultrasonico de 30ms a 6ms (ya que
       de todas formas se ignora todo lo que este a mas de 100cm).

  CAMBIOS 2026-09-20 (probados en el robot real, nueve corridas; los
  valores de las constantes salen de esas mediciones):
    5. Ningun delay() ciego en las maniobras: moverVigilando() sigue
       leyendo los IR mientras se mueve y aborta si aparece el borde
       del lado hacia el que va.
    6. Impulso anti-stiction no bloqueante: misma duracion (70 ms),
       pero el loop() sigue corriendo mientras tanto.
    7. leerBorde() distingue sensores traseros. Antes un trasero en
       blanco disparaba el mismo escape que un frontal (retroceder), o
       sea retrocedia HACIA el borde. Ahora los casos ATRAS avanzan.
       Ademas el caso EMPUJE_* giraba al reves que los demas casos; se
       unifico la convencion (ver el aviso en los pines de motor).
    8. Calibracion IR promediada (12 muestras por paso) con factor de
       umbral por sensor y aviso de sensor debil.
    9. Ultrasonico: no re-dispara mientras el modulo sigue ocupado con
       un eco perdido (el HC-SR04 ignora el TRIG hasta ~38 ms), y
       conserva la ultima distancia valida un rato corto en vez de
       asumir que el rival desaparecio.
   10. Giro inicial de ronda 2/3 por giroscopio (angulo real), con el
       giro por tiempo solo como respaldo si el sensor no responde.
   11. Memoria de rumbo del rival: la busqueda y el escape frontal
       giran hacia donde se lo vio por ultima vez, usando el rumbo
       integrado del giroscopio.
   12. Anti-bucle: 3 escapes en 3 s invierten el sentido de giro y lo
       agrandan 45 grados para romper la oscilacion en la linea.
   13. Empuje frontal perdido (nos rotan mandando recto, o el empuje
       lleva mas de 4 s) -> retroceder, girar 60 y volver de costado.
       Golpe o rotacion forzada FUERA de ataque -> escapar adelante.
   14. Levantamiento por angulo de inclinacion 3D: compara el vector
       de aceleracion completo (X, Y, Z) contra el de reposo calibrado,
       asi funciona aunque el robot no este nivelado. Con histeresis.
   15. I2C validado: lecturas absurdas se descartan y se cuentan, y el
       bus se destraba a pulsos si el sensor quedo colgado por un reset.
   16. Avance recto con correccion de rumbo por giroscopio
       (avanzarRecto(), P+I): los motores son desparejos y la embestida
       se curvaba sola 15-30 grados/s. Medido despues: +2 grados/s
       avanzando libre, +/-1 empujando.

  CAMBIOS 2026-09-23:
   17. Los pivotes eran ciegos al borde. girarGradosGiro() no leia los
       IR en su bucle, y girarConFallback()/giroInicial() pivoteaban con
       VIGILAR_NADA. Medido: de 136 giros, 25 pasaron de 600 ms y el mas
       largo llego al timeout de 3 s -- todo ese rato el rival podia
       empujarnos sobre la linea sin que el robot se enterara. Ahora los
       pivotes abortan si un sensor CRUZA a blanco durante el giro (lo
       que ya estaba en blanco no cuenta: los escapes arrancan sobre la
       linea). Evento nuevo: GIRO_CORTADO. Modo nuevo: VIGILAR_CUALQUIERA.

  De la revision externa del 2026-09-23 (gracias) se tomo:
   18. Throttle del sonar (INTERVALO_SONAR_MS). Ver el comentario en la
       constante: el guard de ECHO ya cubria el campo abierto, la
       ganancia real es persiguiendo, y es grande.
   19. evento() pasa a ser macro, asi las llamadas desaparecen enteras
       con TELEMETRIA en 0 (antes los String se armaban igual en el
       llamador). La revision arreglaba solo GIRO_INICIAL, que corre una
       vez por combate; el caro era GOLPE, dentro de leerIMU().
   20. Separacion actualizarBorde() / leerBorde(). Se toma porque es mas
       claro, NO por rendimiento: ver el comentario sobre small string
       optimization arriba de esas funciones.

  De esa revision NO se tomo:
    - Subir VEL_TRACKING a 0.85 y bajar el avance a ciegas a 0.65.
      El razonamiento (a ciegas no sabes si apuntas al centro o al
      borde) es bueno, pero ninguno de los dos numeros esta medido y
      subir la persecucion va en la direccion de salirse del ring.
      Decision del usuario: no tocar velocidades sin banco.
    - Su diagnostico de que el "se vuelve loco" era fragmentacion de
      heap por String. Las capturas del 20-09 lo contradicen: era
      FACTOR_UMBRAL en 0.60 (el sensor 1 leia 1633 contra un umbral de
      1711 y cruzaba por vibracion). Con 0.45 se corrieron 30 s sin un
      solo escape fantasma.

  CAMBIOS 2026-09-25 (plan de correcciones de la boveda, calificado con el
  simulador: ~80 peleas por variante contra caja, rival que embiste,
  rival tipico del kit y el firmware anterior en espejo):
   21. Sin corte por tiempo del empuje frontal. A los 4 s en ATAQUE se
       soltaba y flanqueaba, fuera ganando o perdiendo, y cada eco perdido
       reiniciaba ese reloj. Contra un rival parejo el flanqueo no llegaba
       al costado: solo reiniciaba el empuje trabado. Ahora solo se suelta
       si nos ROTAN (rotacionForzada). Simulador: de 0 a 9 victorias de 15.
   22. Eco perdido pegado al rival: el AVANCE a ciegas sigue a fondo si el
       rival estaba a menos de DIST_ATAQUE. Antes bajaba a VEL_TRACKING y,
       al cambiar la orden, reiniciaba la correccion de rumbo y la gracia
       de la rotacion forzada en pleno empuje.
   23. Un "golpe" con el chasis inclinado (Z cae) es un levantamiento y ya
       no cuenta como golpe. (Tambien entraba ENCARAR -girar hacia el
       golpe-; se quito tras probarlo en el robot, ver el cambio 28.)
   24. Giro trabado: si un giro por giroscopio no avanza 8 grados en 300 ms
       (el rival lo sujeta, o esta en el aire) se corta. Antes quedaba
       ciego hasta el timeout de 3 s (medido en el robot el 20-09).
   25. Acorralado de espaldas al borde (anti-bucle en ATRAS): pivotea 45
       grados antes de avanzar, para salir de la linea de empuje.
   26. Calibracion: aviso de sensor IR degradado (blanco por encima del 25 %
       del negro deja el umbral pegado al negro). Tres parpadeos violeta.
   27. MODO_SIMPLE: seguro de torneo, apaga las reacciones del IMU.

  Del plan NO se tomo, porque el simulador no mostro mejora: detectar la
  busqueda trabada, empujar en curva para romper empates, cambiar la
  maniobra de flanqueo, empujar de mas sobre la linea.

  CAMBIOS 2026-09-25, noche (probado el plan en el robot, con telemetria):
   28. ENCARAR quitado: el golpe fuera de ataque vuelve a escapar 350 ms
       hacia adelante. En el robot real el arranque y el cabeceo del chasis
       pasan de 0.35 g y se leian como "golpe por detras": 13 giros en 93 s,
       9 de media vuelta, de espaldas al rival. El simulador no lo vio (su
       IMU no tiene esos sacudones). Decision del usuario: opcion
       conservadora.
   29. Levantado sostenido de verdad: la cuenta de 250 ms arranca de nuevo
       si el detector estuvo sin evaluar (maniobras, giros rapidos), y se
       decide sobre la inclinacion filtrada. En el robot, 8 de 9
       LEVANTADO_DET falsos llegaban justo al terminar un giro, y los
       levantamientos reales tardaban 0.2-3.3 s en detectarse.

  CAMBIOS 2026-09-26 (pedidos del usuario tras verlo en el dojo):
   30. Escape del borde mas decidido: retrocede 450 ms (antes 180) de
       frente y 350 ms (antes 120) con un solo sensor frontal, y ese caso
       ahora da media vuelta (180, antes 90: quedaba paralelo a la linea).
       Los giros de escape de frente y de costado vigilan el sonar: si ve
       al rival, cortan y el loop ataca (evento GIRO_INTERRUMPIDO_SONAR).
       Los de atras no: ahi el rival esta enfrente empujando y el pivote
       es para salir de su linea (con el corte se perdia el acorralado).
       Simulador (fisica 3): foco 31 -> 32 pts, general 52 -> 52, 0
       derrotas; los giros trabados contra el borde, de 300+ a 3-67.
   31. Tanteo en TRACK: con el rival a 40-100 cm avanza barriendo +-3
       grados de lado a lado; el barrido que lo pierde se invierte al
       instante, asi el rumbo se centra solo sobre el rival.
   32. Golpe o empuje de costado: el escape hacia adelante se corta si el
       sonar ve al rival (evento ESCAPE_INTERRUMPIDO_SONAR) y ataca.
   33. Levantamiento: retrocede hasta que el IMU confirma que la base
       volvio a apoyar entera (inclinacion filtrada < 10 grados sostenida
       150 ms), entre 250 y 1500 ms, vigilando el borde de atras (evento
       LEVANTADO_APOYO). Antes eran 280 ms fijos.
   El flanqueo por empuje frontal perdido ("el 50/50") no se toco.

  Requiere "Adafruit NeoPixel" y "Adafruit LSM6DS" (Library Manager).
  Core ESP32 3.x: con el 2.x no compila (ledcAttach cambio de firma).
*/
```

### `#define INVERTIR_MOTORES 1`

Líneas 164–168 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  AJUSTE RAPIDO DE MOTORES
//  Si el robot avanza hacia atras cuando deberia ir hacia adelante
//  (o al reves), cambia este valor entre 0 y 1 y vuelve a subir.
// ────────────────────────────────────────────
```

### `#define MOTOR1_IN1 12`

Líneas 184–188 de la versión anterior.

```cpp
// ⚠ Convencion de lados: MOTOR1 = rueda IZQUIERDA. Todo el codigo
// asume que motores(+V, -V) pivotea a la IZQUIERDA (rueda izquierda
// hacia atras, derecha hacia adelante). PRUEBA DE BANCO OBLIGATORIA:
// si con "girarIzquierda" el robot gira a la derecha, intercambiar
// aca los pines de MOTOR1 y MOTOR2 — y no tocar nada mas.
```

### `#ifndef TELEMETRIA`

Líneas 209–222 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  TELEMETRIA
//  Saca por Serial lo que el robot esta viendo y decidiendo. Dos
//  formatos de linea, ambos CSV:
//
//    T,<ms>,<estado>,<dist>,<ir0>,<ir1>,<ir2>,<ir3>,<borde>,
//      <giro_dps>,<inclin_deg>,<dax_g>,<day_g>,<rumbo_deg>,<imu_fallos>,<corr>
//    E,<ms>,<evento>,<detalle>
//
//  Las "T" salen cada INTERVALO_TELEMETRIA_MS. Las "E" en el momento
//  exacto del evento. Poner TELEMETRIA en 0 para el combate real.
//  FLASHEAR.bat la elige al compilar (-DTELEMETRIA=1) sin tocar este
//  archivo; el 0 de abajo es lo que usa el IDE.
// ────────────────────────────────────────────
```

### `#ifndef FIRMA_ID`

Líneas 228–233 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  FIRMA DE LA VERSION
//  FLASHEAR.bat compila con -DFIRMA_ID=<fecha>_<modo>_<hash del codigo> y
//  el robot la imprime al arrancar: asi se sabe que codigo tiene cargado.
//  Compilado desde el IDE dice "sin_firma_IDE".
// ────────────────────────────────────────────
```

### `#ifndef MODO_SIMPLE`

Líneas 240–247 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  MODO SIMPLE (seguro de torneo)
//  1 = sin reacciones del IMU: no detecta levantamiento, golpe ni
//  rotacion forzada. Quedan el borde, la busqueda, el ataque, los giros
//  por angulo y el avance recto con correccion. Para volver a algo
//  sencillo si alguna reaccion se porta raro el dia del torneo.
//  FLASHEAR.bat tiene la opcion "seguro de torneo" que lo compila en 1.
// ────────────────────────────────────────────
```

### `bool  giroListo = false;`

Líneas 258–263 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  ESTADO DEL IMU
//  Lo escribe leerIMU() en giroscopio_control.ino. Vive aca porque el
//  IDE concatena esta pestaña primero y las variables, a diferencia de
//  las funciones, no reciben declaracion adelantada automatica.
// ────────────────────────────────────────────
```

### `float inclinacionDeg = 0;`

Líneas 268–268 de la versión anterior.

```cpp
float inclinacionDeg = 0;    // angulo entre el vector de aceleracion actual y el de reposo
```

### `int   signoGiroIzq = 1;`

Líneas 271–274 de la versión anterior.

```cpp
// +1 si girar a la izquierda da imuDps positivo, -1 si negativo. Arranca en
// +1 porque se midio en este robot el 2026-09-20 (giro a la derecha visto
// por el usuario + eje Z hacia arriba); el primer pivote lo re-aprende y
// lo corrige si el sensor cambiara de montaje.
```

### `const unsigned long RETENCION_DIST_MS = 80;`

Líneas 284–286 de la versión anterior.

```cpp
// El HC-SR04 se queda ~38 ms ocupado tras un eco perdido. Mientras
// tanto se conserva la ultima distancia valida (RETENCION), y solo si
// ademas pasa PERDIDO_TRAS_MS sin verlo se asume que el rival se fue.
```

### `const float DIST_CONTACTO = 12.0;`

Líneas 289–291 de la versión anterior.

```cpp
// Medido 2026-09-20: pegado al rival (~7 cm) el sonar pierde la mitad de
// los ecos y el robot entraba en busqueda seis veces en 3 s. Desde el
// contacto el rival no puede haberse esfumado: se espera mas.
```

### `const unsigned long INTERVALO_SONAR_MS = 20;`

Líneas 295–302 de la versión anterior.

```cpp
// Throttle del sonar. El guard de ECHO ya evita disparar durante los
// ~38 ms que el modulo queda ocupado tras un eco perdido, asi que en
// campo abierto el costo ya estaba acotado. Donde pesa es PERSIGUIENDO:
// con el rival a 30 cm el eco vuelve en ~1.7 ms, ECHO baja, y se
// disparaba de nuevo en la vuelta siguiente, dejando el ciclo en ~2.6 ms
// contra ~0.9 ms sin sonar. Con 20 ms de por medio (nadie recorre 100 cm
// en ese lapso) el control de rumbo y la lectura de borde corren ~3x mas
// seguido justo cuando se va a fondo contra la linea.
```

### `const float VEL_IMPULSO = 1.0;`

Líneas 309–311 de la versión anterior.

```cpp
// Impulso de arranque: al salir de 0 con una velocidad menor a VEL_IMPULSO,
// se aplica un instante a maxima potencia para vencer la friccion estatica.
// Si algun movimiento sigue sin arrancar, sube TIEMPO_IMPULSO_MS.
```

### `const int   MUESTRAS_CALIBRACION = 12;`

Líneas 315–344 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  CALIBRACION IR
//  FACTOR_UMBRAL: 0.50 = punto medio entre negro y blanco. Mas alto =
//  el umbral se corre hacia el negro y el sensor marca blanco mas
//  facil (mas sensible al borde, mas bordes fantasma posibles).
//  SEPARACION_MINIMA_IR: si negro y blanco quedan mas cerca que esto,
//  el sensor no esta discriminando (IO34 es sospechoso en este kit).
// ────────────────────────────────────────────
// Medido 2026-09-25 en un dojo de NEGRO BRILLANTE: el negro brillante
// funciona como espejo y, andando, a ciertos angulos devuelve el IR
// directo al receptor (reflejo especular). Eso produce "destellos": la
// lectura baja del negro (~1800) a 230-806, cruza un umbral alto y
// dispara un escape fantasma. Con 0.45 hubo 85 escapes en 4 minutos.
//
// Lo que separa un destello de la linea real es la PROFUNDIDAD, no la
// duracion: a 2 ms de resolucion, los 8 cruces reales llegaron a 18-94
// (el blanco calibrado) y los 70 destellos nunca bajaron de 230. Hay un
// hueco limpio entre 94 y 230, y el umbral tiene que caer ahi.
//
// Simulado sobre esa captura: 0.45 dispara con 70/70 destellos; 0.10
// con 1/70, y los 8 cruces reales se siguen detectando con cualquier
// factor. Se eligio 0.10 y no menos a proposito: bajar mas solo gana el
// ultimo destello a cambio de exigirle mas profundidad a un cruce real,
// y perder un cruce cuesta el round.
//
// Confirmado que NO es electrico: 52 s con el robot sostenido quieto y
// los motores girando dieron cero excursiones; aparecieron recien al
// soltarlo. Y es relativo a la calibracion, asi que en un dojo mate
// (sin destellos) 0.10 sigue siendo seguro: el blanco mate tambien lee
// hondo. Historial: 0.60 (20-09, fantasmas por vibracion) -> 0.45 -> 0.10.
```

### `const float BLANCO_MAX_FRACCION = 0.25;`

Líneas 348–350 de la versión anterior.

```cpp
// Sensor degradado: si el blanco lee mas que esta fraccion del negro, el
// umbral queda pegado al negro y cualquier caida de la lectura lo cruza
// (el 20-09 el sensor 0 leia blanco 1161-2384 con negro ~3480).
```

### `const unsigned long TIEMPO_GIRO_90_MS  = 500;`

Líneas 353–363 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (reglamento: 3 combates con
//  disposicion distinta: frente a frente, lado a lado en direcciones
//  opuestas, y espalda con espalda). Con giroscopio el giro es por
//  angulo real; estos tiempos son solo el respaldo si el sensor no
//  responde. Valores derivados de la medicion del companero sobre el
//  mismo kit (360 grados = 2900 ms a fondo).
// ────────────────────────────────────────────
// Medido con giroscopio el 2026-09-20: 90 grados a fondo = 400-560 ms en
// este robot. Los 725 del companero eran largos: el respaldo giraba ~110
// por cada 68 pedidos.
```

### `const unsigned long VENTANA_ANTIBUCLE_MS = 3000;`

Líneas 368–372 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  ANTI-BUCLE: si dispara ESCAPES_ANTIBUCLE escapes dentro de
//  VENTANA_ANTIBUCLE_MS, esta oscilando en la linea blanca. Invierte
//  el sentido de giro y lo agranda para romper el patron.
// ────────────────────────────────────────────
```

### `const float ANGULO_FLANQUEO = 60.0;`

Líneas 379–382 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  EMPUJE FRONTAL PERDIDO (nos rotan) -> soltar y flanquear
//  Ya no hay corte por tiempo: ver el cambio 21.
// ────────────────────────────────────────────
```

### `const unsigned long ESCAPE_ADELANTE_MS = 350;`

Líneas 387–390 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  GOLPE / EMPUJE LATERAL fuera de ataque -> escapar hacia adelante
//  (el escape se corta si el sonar ve al rival: cambio 32)
// ────────────────────────────────────────────
```

### `const float TANTEO_DPS = 20.0;`

Líneas 393–403 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  TANTEO EN TRACK (cambio 31)
//  Con el rival a 40-100 cm, en vez de avanzar derecho barre suave de
//  lado a lado sin dejar de avanzar. Cada barrido dura TANTEO_SEMIPERIODO_MS,
//  o menos si el sonar lo pierde: entonces se invierte enseguida para
//  volver a encontrarlo (antes de que PERDIDO_TRAS_MS lo mande a buscar).
//  Como el barrido hacia el rival dura entero y el que se aleja se corta
//  al perderlo, el rumbo se va centrando solo sobre el: eso confirma
//  donde esta. Con el rival centrado barre +-3 grados (el cono del sonar
//  es de +-15), asi que no lo pierde. Sin medir en el robot todavia.
// ────────────────────────────────────────────
```

### `float ultimaIzq = 0;`

Líneas 422–426 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  ESTADO DE MOTORES
//  ultimaIzq/Der: lo ultimo APLICADO a las ruedas (con correccion).
//  ordenIzq/Der: lo ultimo ORDENADO por la logica (sin correccion).
// ────────────────────────────────────────────
```

### `const float KP_RECTO = 0.004;`

Líneas 436–448 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  AVANCE RECTO CON CORRECCION POR GIROSCOPIO
//  Medido 2026-09-20: a fondo y "recto" el robot curva solo a 15-30
//  grados/s (motor izquierdo mas fuerte). avanzarRecto() corrige con
//  un P+I sobre la velocidad angular: rota a la izquierda -> acelera
//  la rueda izquierda y frena la derecha. El integral absorbe el
//  desbalance constante; el tope evita que se desboque si el rival
//  nos rota. Sin giroscopio o sin signo aprendido, no corrige.
// ────────────────────────────────────────────
// Medido 2026-09-20 (corrida 8): con Kp 0.015 la correccion saturaba con
// 20 grados/s, y el giroscopio manejando tiene +/-10-20 de ruido por
// vibracion: |corr| medio 0.15 para un sesgo real de 0.05-0.10. Por eso
// el P es chico y va filtrado; el sesgo constante lo lleva el integral.
```

### `void setMotorSpeed(int pinIN1, int pinIN2, float velocidad) {`

Líneas 469–474 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  CONTROL DE MOTORES
//  Convencion (igual que el codigo original): velocidad
//  negativa = adelante, positiva = atras. INVERTIR_MOTORES
//  compensa la inversion fisica sin tocar el resto del codigo.
// ────────────────────────────────────────────
```

### `void aplicarMotores(float izq, float der) {`

Líneas 500–510 de la versión anterior.

```cpp
// Impulso anti-stiction NO bloqueante: cuando una rueda arranca desde
// parado con velocidad baja, abre una ventana de TIEMPO_IMPULSO_MS
// durante la cual se aplica potencia maxima. Como no hay delay(), el
// loop() sigue leyendo sensores mientras tanto. Para que la ventana
// se cierre a tiempo, cualquier movimiento sostenido debe volver a
// llamar a motores()/avanzarRecto() — moverVigilando() y
// girarGradosGiro() lo hacen.
//
// aplicarMotores() es la capa cruda (impulso + PWM). motores() es la
// orden directa: pivotes, curvas y parada. Para ir recto se usa
// avanzarRecto() (en giroscopio_control.ino), que corrige el rumbo.
```

### `#if TELEMETRIA`

Líneas 548–558 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  TELEMETRIA: una linea por evento, y una periodica de estado.
//  Con TELEMETRIA en 0 las dos funciones quedan vacias y el
//  compilador las elimina: cero costo en competencia.
// ────────────────────────────────────────────
// evento() es un MACRO, no una funcion, a proposito: los argumentos de
// una funcion se construyen en el llamador aunque el cuerpo este vacio,
// asi que con TELEMETRIA en 0 se seguian armando los String de cada
// llamada ("GIRO", "GOLPE", "ESCAPE"...). El de GOLPE vive dentro de
// leerIMU(), o sea en cada vuelta del loop. Como macro, con TELEMETRIA
// en 0 la llamada entera desaparece antes de compilar.
```

### `float pulsoSonar() {`

Líneas 597–600 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  LEER ULTRASONICO
//  Un disparo. Devuelve -1 si no hubo eco dentro de ~100cm.
// ────────────────────────────────────────────
```

### `float medirDistanciaCm() {`

Líneas 614–617 de la versión anterior.

```cpp
// Tras un eco perdido el modulo mantiene ECHO en HIGH ~38 ms y
// ignora el TRIG. Disparar en ese lapso solo gasta los 6 ms del
// timeout. Asi que: si ECHO esta alto, no se dispara y se usa la
// ultima distancia valida (si es reciente).
```

### `bool esBorde(int valor, int i) {`

Líneas 640–666 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  LEER BORDE (IR)
//  Primera lectura de los 4; solo si alguno marca borde se hace la
//  segunda lectura de confirmacion (anti-ruido). En el caso normal —
//  sin borde— cuesta 4 analogRead en vez de 8. La direccion de
//  deteccion (blancoEsMenor) sale sola de la calibracion.
//
//  Resultados, por prioridad:
//    FRENTE            los dos frontales        -> retroceder y girar
//    ATRAS             los dos traseros         -> avanzar
//    EMPUJE_DERECHA    frontal y trasero der.   -> nos empujan de lado
//    EMPUJE_IZQUIERDA  frontal y trasero izq.
//    FRENTE_IZQ / FRENTE_DER   un frontal       -> retroceder y girar
//    ATRAS_IZQ  / ATRAS_DER    un trasero       -> avanzar y girar
//
//  Estan separadas en dos: actualizarBorde() solo refresca bordeDet[] y
//  dice si hay borde; leerBorde() ademas arma el texto para el resto del
//  codigo. Asi el camino caliente (el while de moverVigilando) no pasa
//  por la clasificacion.
//
//  NO esperar de esto una ganancia de rendimiento: el ESP32 tiene small
//  string optimization con capacidad 14 (SSOSIZE = sizeof(_ptr)+4-1),
//  asi que siete de los ocho textos y el "" del caso normal viven en la
//  pila, sin tocar el heap. El unico que asigna es "EMPUJE_IZQUIERDA"
//  (16 caracteres), que es de los casos mas raros. Se deja separado
//  porque es mas claro, no porque arregle nada.
// ────────────────────────────────────────────
```

### `bool moverVigilando(float izq, float der, unsigned long ms, int vigilar) {`

Líneas 713–723 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  MOVIMIENTO VIGILADO
//  Reemplaza a "motores() + delay()": mueve durante 'ms' pero sigue
//  leyendo los IR (y el IMU) en cada vuelta. Aborta y devuelve true
//  si un sensor del lado hacia el que se mueve PASA de negro a blanco
//  durante el movimiento. Lo que ya estaba en blanco al arrancar no
//  cuenta: si no, en la linea el robot nunca se trasladaria, solo
//  pivotearia (visto el 2026-09-20 en modo sin giroscopio). Vuelve a
//  llamar a motores() en cada vuelta para que la ventana del impulso
//  se cierre.
// ────────────────────────────────────────────
```

### `#if TELEMETRIA`

Líneas 733–735 de la versión anterior.

```cpp
    // Con telemetria encendida se usa leerBorde() para que la columna
    // "borde" del CSV no quede vieja durante las maniobras — es una de
    // las columnas con las que se diagnostica.
```

### `void girarConFallback(float grados) {`

Líneas 753–754 de la versión anterior.

```cpp
// Gira 'grados' (positivo = izquierda) por giroscopio; si no hay
// sensor, por tiempo proporcional a TIEMPO_GIRO_90_MS.
```

### `moverVigilando(VEL_ATAQUE * s, -VEL_ATAQUE * s, ms, VIGILAR_CUALQUIERA);`

Líneas 762–763 de la versión anterior.

```cpp
  // Mismo criterio que girarGradosGiro: un pivote no tiene "lado hacia
  // el que va", asi que se vigilan los cuatro sensores.
```

### `void girarConFallbackVigilando(float grados) {`

Líneas 768–771 de la versión anterior.

```cpp
// Igual que girarConFallback(), pero para los giros de una maniobra de
// escape (borde, golpe, empuje perdido): si el sonar ve al rival, corta
// el giro y ataca (cambio 30). No tiene sentido terminar de evadir para
// recien despues buscarlo, si ya lo tiene enfrente.
```

### `bool elegirSentidoGiro() {`

Líneas 792–795 de la versión anterior.

```cpp
// Elige hacia donde girar: hacia el rumbo donde se vio al rival por
// ultima vez si se conoce (y es reciente, y ya se aprendio el signo
// del giroscopio); si no, alternando como siempre. Deja el resultado
// en girarIzquierda para que el resto del codigo lo comparta.
```

### `int contarPulsacionesBoot(unsigned long ventanaMs) {`

Líneas 902–906 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  SELECCION DE RONDA (una sola vez, antes del combate)
//  Cuenta cuantas veces se presiona BOOT dentro de una ventana de
//  tiempo tras la ultima pulsacion, para elegir la ronda 1/2/3.
// ────────────────────────────────────────────
```

### `void esperarInicioCombate() {`

Líneas 945–949 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  ESPERA FINAL ANTES DE COMBATIR
//  Da tiempo de colocar el robot en el dojo despues de elegir la
//  ronda. El giro inicial (ronda 2/3) no ocurre hasta este punto.
// ────────────────────────────────────────────
```

### `void giroInicial() {`

Líneas 961–967 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  GIRO INICIAL SEGUN LA RONDA (una sola vez, antes de entrar al loop)
//  Con giroscopio: angulo real, desacelerando al final para no
//  pasarse. Sin giroscopio: por tiempo, como antes.
//  La direccion de la ronda 2 sigue siendo una suposicion: si el juez
//  pone al rival del otro lado, la busqueda normal lo encuentra igual.
// ────────────────────────────────────────────
```

### `void comportamientoOfensivo() {`

Líneas 989–994 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  COMPORTAMIENTO OFENSIVO / BUSQUEDA
//  Sin barrido: avance directo. En ataque vigila si nos estan rotando
//  (empuje perdido); si no, empuja hasta que se resuelva. Al perder al
//  rival, busca hacia donde se lo vio por ultima vez.
// ────────────────────────────────────────────
```

### `avanzarRecto(-VEL_ATAQUE, 0.0);`

Líneas 1048–1050 de la versión anterior.

```cpp
        // Recien perdido estando cerca (en contacto el sonar pierde ecos): se
        // sigue a fondo. Con la misma orden que ATAQUE tampoco se reinician
        // la correccion de rumbo ni la gracia de rotacionForzada.
```

### `if (!tanteoInvertidoAlPerder) {`

Líneas 1053–1055 de la versión anterior.

```cpp
        // Recien perdido tanteando: el barrido se paso del borde del rival.
        // Se invierte una sola vez para volver a encontrarlo antes de que
        // PERDIDO_TRAS_MS lo mande a buscar.
```

## `giroscopio_control.ino`

### Cabecera (historial de cambios)

Líneas 1–37 de la versión anterior.

```cpp
/*
  CONTROL POR GIROSCOPIO (LSM6DS3TRC) - modulo adicional para el Sumobot
  Escuela de Sistemas Inteligentes - Universidad Cenfotec

  SEGUNDA PESTAÑA del MISMO sketch: el IDE la compila junto con
  sumo_arduino.ino compartiendo funciones y variables globales. Las
  variables de estado del IMU (imuDps, rumboDeg, inclinacionDeg, ...)
  estan declaradas en sumo_arduino.ino porque esa pestaña se concatena
  primero.

  Logica de giro basada en el codigo base del repo oficial
  (codigos_de_ejemplo/Control_Movimientos.md + code_PDI.py): integra la
  velocidad angular del giroscopio para saber cuanto giro el robot, y
  desacelera cerca del objetivo para no pasarse.

  Este archivo aporta:
    - leerIMU(): UNA lectura validada por vuelta del loop. Todo lo demas
      (giro, levantamiento, golpe, rumbo) sale de esa lectura.
    - girarGradosGiro(): giro por angulo real; se corta si se traba.
    - detectarLevantado(): inclinacion 3D (filtrada) contra el vector
      de reposo, sostenida sin cortes.
    - rotacionForzada() / detectarEmpujeLateral(): nos estan moviendo
      sin que lo mandemos.
    - maniobraEscapePreciso(), reaccionLevantado(),
      reaccionPerdiendoEmpuje(), reaccionEmpujeLateral().
  Con MODO_SIMPLE en 1 (sumo_arduino.ino) no se detectan levantamiento,
  golpe ni rotacion forzada.

  EJE DE GIRO: confirmado con "giroscopio_diagnostico.ino" en el robot
  real -> es el eje Z (GYRO_EJE_GIRO = 2). El SIGNO (si girar a la
  izquierda da positivo o negativo) NO se asume: se aprende solo la
  primera vez que el robot pivotea (signoGiroIzq).

  Si iniciarGiroscopio() no encuentra el sensor, giroListo queda en
  false y todo cae al comportamiento por tiempo. El robot nunca se
  queda sin reaccion por falta de sensor.
*/
```

### `#define GYRO_EJE_GIRO 2`

Líneas 42–42 de la versión anterior.

```cpp
#define GYRO_EJE_GIRO 2  // 0=X  1=Y  2=Z  -> confirmado con el diagnostico en el robot real
```

### `const uint32_t I2C_HZ = 400000;`

Líneas 44–44 de la versión anterior.

```cpp
const uint32_t I2C_HZ = 400000;  // el LSM6DS3TR-C soporta 400 kHz; bajar a 100000 si suben los imuFallos
```

### `const unsigned long TIMEOUT_GIRO_MS = 3000;`

Líneas 48–48 de la versión anterior.

```cpp
const unsigned long TIMEOUT_GIRO_MS = 3000;         // limite de seguridad (180 a fondo mide ~1450 ms en este kit)
```

### `const float ZONA_DESACELERACION_GRADOS = 25.0;`

Líneas 49–51 de la versión anterior.

```cpp
// Medido 2026-09-20: a 0.45 el robot se quedo parado a 72 de 90 grados
// hasta el timeout. 0.75 es la velocidad de busqueda, que si pivotea.
// Sin desacelerar, un giro de 90 termina en 92-95 reales por inercia.
```

### `const float FILTRO_DRIFT_RAD_S = 0.015;`

Líneas 54–54 de la versión anterior.

```cpp
const float FILTRO_DRIFT_RAD_S = 0.015;             // muestras mas rapidas que esto no entran al promedio del drift
```

### `const unsigned long VENTANA_GIRO_TRABADO_MS = 300;`

Líneas 55–56 de la versión anterior.

```cpp
// Giro trabado: si en una ventana no avanza ni esto, algo lo sujeta (el
// rival) o esta en el aire. Un pivote sano a 0.75 hace 27+ grados en 300 ms.
```

### `const float INCLINACION_LEVANTADO_DEG = 15.0;`

Líneas 60–67 de la versión anterior.

```cpp
// ── Levantamiento (inclinacion 3D) ──
// Una rampa que levanta el frente inclina el chasis unos 15-25 grados.
// Se mide el angulo entre el vector de aceleracion actual y el de
// reposo (calibrado al arrancar, asi no importa si el robot no esta
// nivelado ni como esta montado el IMU). Histeresis: entra por encima
// de INCLINACION_LEVANTADO_DEG y sale por debajo de INCLINACION_SALIDA_DEG.
// Medido 2026-09-20: levantamientos reales leen 22-27 grados; manejando
// normal hay picos momentaneos de 13-17 que los 150 ms sostenidos filtran.
```

### `const unsigned long DURACION_LEVANTADO_MS = 250;`

Líneas 70–72 de la versión anterior.

```cpp
// Medido 2026-09-20: los giros y golpes producen picos de 22-27 grados de
// un solo ciclo; 150 ms los filtraba por poco. Un levantamiento real dura
// segundos, asi que 250 ms discrimina sin retrasar demasiado la reaccion.
```

### `const unsigned long HUECO_EVAL_LEVANTADO_MS = 50;`

Líneas 74–85 de la versión anterior.

```cpp
// Probado en el robot el 2026-09-25: 8 de 9 LEVANTADO_DET falsos llegaron
// 27-48 ms despues de terminar un giro. Una muestra de mas de 15 grados
// antes de la maniobra arrancaba la cuenta, la maniobra corria sin evaluar
// (este detector solo se llama desde el loop) y el frenazo al terminar
// completaba los "250 ms sostenidos". Ahora la cuenta arranca de nuevo si
// pasaron mas de HUECO_EVAL_LEVANTADO_MS sin evaluar (el loop normal da
// una vuelta cada pocos ms; cualquier maniobra dura mas).
// Y se decide sobre la inclinacion filtrada: con el robot de verdad en el
// aire y los motores a fondo, la vibracion bajaba muestras sueltas de 15
// grados, reiniciaba la cuenta y la deteccion tardaba 0.2-3.3 s. Con
// 100 ms de filtro, un sacudon de 30 ms sube la filtrada ~7 grados (no
// llega a 15) y un levantamiento real la cruza en ~60 ms.
```

### `const unsigned long RETROCESO_ESCAPE_FRENTE_MS = 450;`

Líneas 89–95 de la versión anterior.

```cpp
// ── Escape del borde: retroceso y giro (cambio 30) ──
// Pedido del usuario (26-09): la evasion se veia leve. El retroceso era de
// 120-180 ms (3-4 cm a los ~20 cm/s medidos) y el caso mas comun, un solo
// sensor frontal, giraba 90 grados: quedaba paralelo al borde. Ahora
// retrocede mas y da media vuelta. El retroceso sigue vigilando el borde
// de atras, asi que alargarlo no lo tira del otro lado. Sin medir en un
// escape real todavia: primer valor a probar en el robot.
```

### `const unsigned long DURACION_DETECCION_GIRO_MS = 60;`

Líneas 100–105 de la versión anterior.

```cpp
// Si el sonar ve al rival mientras dura el giro de un escape (borde, golpe
// o empuje de costado), se corta y se ataca: no tiene sentido terminar de
// evadir para recien despues buscarlo, si ya lo tiene enfrente. Cuenta solo
// un eco NUEVO (posterior al inicio del giro; la retencion de 80 ms del
// sonar podria traer uno viejo) sostenido DURACION_DETECCION_GIRO_MS, para
// que un eco suelto no corte el escape por error.
```

### `const unsigned long RETROCESO_MIN_LEVANTADO_MS = 250;`

Líneas 109–114 de la versión anterior.

```cpp
// ── Levantamiento: retroceder hasta volver a apoyar (cambio 33) ──
// Pedido del usuario (26-09): la evasion era corta, 280 ms fijos de
// retroceso. Ahora retrocede hasta que el IMU diga que la base volvio a
// apoyar entera en el dojo: inclinacion filtrada bajo INCLINACION_SALIDA_DEG
// sostenida PLANO_SOSTENIDO_MS. Con un minimo (salir de la rampa aunque la
// inclinacion baje enseguida) y un tope (por si el IMU no lo confirma).
```

### `const float UMBRAL_GIRO_ACTIVO = 120.0;`

Líneas 118–122 de la versión anterior.

```cpp
// Antes 30 grados/s, lo que apagaba la deteccion durante toda la
// busqueda (~90 grados/s). Ese valor respondia al metodo viejo (solo eje
// Z), donde la vibracion del giro parecia una caida de g. Con el angulo
// 3D sostenido 150 ms la vibracion no dispara; solo se apaga en giros
// realmente violentos. PRUEBA: buscar libremente 20 s sin LEVANTADO_DET.
```

### `const unsigned long GRACIA_TRAS_CAMBIO_MS = 150;`

Líneas 129–129 de la versión anterior.

```cpp
const unsigned long GRACIA_TRAS_CAMBIO_MS = 150;    // tras cambiar la orden de motores, nuestra propia aceleracion no es golpe
```

### `const float UMBRAL_ROTACION_FORZADA_DPS = 60.0;`

Líneas 130–132 de la versión anterior.

```cpp
// Medido 2026-09-20: mandando recto a fondo el robot curva solo a 15-30
// grados/s (motores desparejos). Las rotaciones forzadas reales midieron
// 100+. 60 deja margen a ambos lados.
```

### `const float Z_GOLPE_INCLINADO_G = 0.05;`

Líneas 136–138 de la versión anterior.

```cpp
// Inclinar el chasis reparte la gravedad entre los ejes: Y sube ~0.4 g (y
// parece un golpe desde atras) mientras Z BAJA. Un golpe de verdad no
// cambia Z. A 20 grados Z ya cae 0.06 g.
```

### `const float GIRO_LEVANTADO_GRADOS = 90.0;`

Líneas 141–142 de la versión anterior.

```cpp
// ── Reaccion al levantamiento ──
// El retroceso ya no es un tiempo fijo (eran 280 ms): ver el cambio 33.
```

### `float golpeAz = 0;`

Líneas 155–155 de la versión anterior.

```cpp
float golpeAz = 0;                    // cambio de Z en el ultimo golpe, en g: si cae, era el chasis inclinandose
```

### `float leerEjeGiro(float gx, float gy, float gz) {`

Líneas 161–166 de la versión anterior.

```cpp
// Devuelve el eje configurado (X/Y/Z) de una lectura de giroscopio.
// Recibe los 3 valores sueltos, no el sensors_event_t completo: el
// generador de prototipos del IDE inserta las declaraciones de funciones
// ANTES que el #include de esta pestaña, y como sensors_event_t se
// define recien en ese include, usarlo como parametro rompia la
// compilacion. Con float no hay ese problema.
```

### `void recuperarBusI2C() {`

Líneas 173–177 de la versión anterior.

```cpp
// Si el ESP32 se reinicio a mitad de una transaccion I2C (reset por RTS,
// brownout, boton), el sensor puede quedar con SDA en bajo esperando
// clocks, y Wire.begin() no lo destraba. Nueve pulsos en SCL y un STOP
// lo sueltan. Visto el 2026-09-20: "No se encontro el LSM6DS3TRC" tras
// un reset en pleno combate.
```

### `lsmGiro.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);`

Líneas 222–223 de la versión anterior.

```cpp
  // 416 Hz: una muestra nueva cada ~2.4 ms, a la par del loop. Con el
  // default de 104 Hz se leia la misma muestra varias veces seguidas.
```

### `bool leerIMU() {`

Líneas 269–275 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  LECTURA UNICA DEL IMU POR VUELTA
//  Valida la lectura (I2C y magnitud plausible), actualiza velocidad
//  angular, rumbo integrado, inclinacion y deltas horizontales, y
//  aprende el signo del giro. Ante una lectura mala deja los valores
//  anteriores y suma un fallo. Devuelve true si hubo lectura valida.
// ────────────────────────────────────────────
```

### `if (ultimaIzq != 0 && ultimaDer == -ultimaIzq && fabs(imuDps) > DPS_GIRO_EVIDENTE) {`

Líneas 304–305 de la versión anterior.

```cpp
  // Signo del giro: cuando se manda un pivote puro y el giroscopio
  // responde, se anota si "izquierda" sale positivo o negativo.
```

### `float horizontal = sqrt(dAxG * dAxG + dAyG * dAyG);`

Líneas 310–311 de la versión anterior.

```cpp
  // Golpe: aceleracion horizontal brusca que no es nuestra (la orden
  // de motores no cambio hace poco) y no esta en cooldown.
```

### `void avanzarRecto(float vel, float objetivoDps) {`

Líneas 326–337 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  AVANCE RECTO CON CORRECCION
//  vel con la convencion de motores(): negativo = adelante. Rotar a la
//  izquierda (e > 0) se compensa acelerando la rueda izquierda y
//  frenando la derecha: izq = vel - corr, der = vel + corr. La misma
//  formula sirve marcha atras, porque siempre agrega una rotacion hacia
//  la derecha independiente de la velocidad base. Sin giroscopio o sin
//  el signo aprendido, corr = 0 y es motores(vel, vel).
//  objetivoDps (cambio 31): en vez de corregir hacia "sin girar", corrige
//  hacia esa velocidad angular. TRACK la alterna +-TANTEO_DPS para
//  tantear de lado a lado sin dejar de avanzar; el resto llama con 0.0
//  (recto de verdad).
```

### `void girarGradosGiro(float grados, float velocidad, bool desacelerar, bool vigilarSonar) {`

Líneas 359–373 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  GIRO POR ANGULO
//  Gira 'grados' (positivo = izquierda, igual que motores(+V,-V)).
//  Se detiene dentro del margen de error en vez de exigir el grado
//  exacto (con un MEMS integrado, exigir el grado exacto solo produce
//  oscilacion). desacelerar=true baja la velocidad en los ultimos
//  ZONA_DESACELERACION_GRADOS para no pasarse (giro de ronda);
//  false mantiene la velocidad todo el giro (escapes).
//  vigilarSonar=true (los giros de escape del borde, cambio 30): si el
//  sonar ve al rival mas cerca que DIST_ATAQUE, sostenido
//  DURACION_DETECCION_GIRO_MS, corta el giro y deja escapeInterrumpido
//  PorSonar en true - nunca tiene sentido terminar de evadir el borde
//  para recien despues buscarlo, si ya lo tiene enfrente. El loop()
//  ataca en la vuelta siguiente, con su prioridad normal.
// ────────────────────────────────────────────
```

### `leerIMU();`

Líneas 385–385 de la versión anterior.

```cpp
  leerIMU();  // fija la base de tiempo: lo que paso antes no cuenta
```

### `actualizarBorde();`

Líneas 387–393 de la versión anterior.

```cpp
  // Un pivote puede durar mucho mas de lo que parece: medido el
  // 2026-09-20, 25 de 136 giros pasaron de 600 ms y el mas largo llego
  // al timeout de 3 s (el rival trabandolo). Sin mirar los IR aca, el
  // robot queda ciego al borde todo ese rato y lo pueden empujar sobre
  // la linea sin que se entere. Se aborta el giro si un sensor CRUZA a
  // blanco durante el pivote; lo que ya estaba en blanco al empezar no
  // cuenta, porque los escapes arrancan justamente sobre la linea.
```

### `if (millis() - tVentana >= VENTANA_GIRO_TRABADO_MS) {`

Líneas 420–424 de la versión anterior.

```cpp
    // Trabado: en VENTANA_GIRO_TRABADO_MS no giro ni GIRO_MINIMO_VENTANA
    // grados (el rival lo sujeta, o esta en el aire). Seguir mandando el
    // pivote lo dejaria ciego hasta el timeout de 3 s: se corta y el loop
    // decide con los sensores. Medido 2026-09-20: 25 de 136 giros pasaron
    // de 600 ms y uno llego al timeout.
```

### `#if TELEMETRIA`

Líneas 434–437 de la versión anterior.

```cpp
    // actualizarBorde(), no leerBorde(): pivotando sobre la linea el
    // texto seria "EMPUJE_IZQUIERDA" (16 chars, el unico que no entra en
    // SSO) y se estaria pidiendo y soltando heap en cada iteracion del
    // giro. Aca solo hacen falta los booleanos.
```

### `if (bordeNuevo) evento("GIRO_CORTADO", String(acumulado, 1) + ";" + String(objetivo, 1));`

Líneas 453–454 de la versión anterior.

```cpp
  // El loop() atiende el borde o el ataque en la vuelta siguiente, con su
  // prioridad normal; el anti-bucle cuenta ese escape como cualquier otro.
```

### `bool moverVigilandoSonar(float izq, float der, unsigned long ms, int vigilar) {`

Líneas 459–467 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  MOVIMIENTO VIGILADO, CON SONAR (cambio 30)
//  Igual que moverVigilando(), y ademas corta el movimiento (dejando
//  escapeInterrumpidoPorSonar en true) si el sonar ve al rival mas cerca
//  que DIST_ATAQUE, sostenido DURACION_DETECCION_GIRO_MS. Se usa en los
//  tramos de escape que terminan mirando hacia donde se avanza (golpe,
//  empuje perdido, borde): no tiene sentido terminar de escapar para
//  recien despues buscarlo, si ya lo tiene enfrente.
// ────────────────────────────────────────────
```

### `bool detectarLevantado() {`

Líneas 506–517 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  DETECCION DE LEVANTAMIENTO
//  Cuando el rival mete su rampa debajo del chasis, el frente sube y
//  el vector de gravedad que ve el acelerometro se inclina respecto al
//  de reposo. Se mide ese angulo directamente (usa X, Y y Z), asi que
//  no depende de que el robot este nivelado ni de como esta montado
//  el IMU. Se ignora mientras el robot gira rapido (la vibracion del
//  giro se confunde con inclinacion) y exige DURACION_LEVANTADO_MS
//  sostenidos, sin cortes y sobre la inclinacion filtrada, para no
//  disparar por una frenada, un golpe o el final de un giro.
//  Solo detecta y avisa - la reaccion esta en reaccionLevantado().
// ────────────────────────────────────────────
```

### `if (ahora - tUltimaEvalLevante > HUECO_EVAL_LEVANTADO_MS) tInicioLevante = 0;`

Líneas 521–522 de la versión anterior.

```cpp
  // Sostenido = observado sin cortes. Una maniobra no pasa por aca, y un
  // giro rapido no se evalua: si hubo un hueco, la cuenta arranca de nuevo.
```

### `bool rotacionForzada() {`

Líneas 546–552 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  ROTACION FORZADA
//  Mandando recto (o parado) y el giroscopio dice que rotamos mas de
//  UMBRAL_ROTACION_FORZADA_DPS sostenidos: alguien nos esta girando.
//  En ataque significa que vamos perdiendo el empuje; fuera de ataque,
//  que nos empujan de costado.
// ────────────────────────────────────────────
```

### `bool rotando = fabs(imuDps) >= UMBRAL_ROTACION_FORZADA_DPS ||`

Líneas 556–560 de la versión anterior.

```cpp
  // Con la correccion de rumbo activa, parte de la rotacion impuesta se
  // compensa y el giroscopio la ve menor. Por eso tambien cuenta que el
  // integral este al tope Y siga rotando: la correccion maxima no alcanza,
  // alguien nos esta girando. (La primera version miraba solo la
  // saturacion y disparaba con 7-25 grados/s de ruido.)
```

### `bool detectarEmpujeLateral() {`

Líneas 571–572 de la versión anterior.

```cpp
// Fuera de ataque, un golpe o una rotacion forzada significan que el
// rival nos alcanzo por donde no lo esperabamos.
```

### `bool golpeReciente = golpePendiente && (millis() - tUltimoGolpe) < VIGENCIA_GOLPE_MS &&`

Líneas 577–580 de la versión anterior.

```cpp
  // Un golpe registrado durante una maniobra (flanqueo, escape) no debe
  // disparar al terminar la maniobra: solo cuenta si es reciente. Y un
  // "golpe" con Z caida es el chasis inclinandose: lo resuelve
  // detectarLevantado(), no esto.
```

### `void maniobraEscapePreciso(String direccion) {`

Líneas 587–595 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  MANIOBRA DE ESCAPE DEL BORDE
//  Cada tramo recto va vigilando el lado hacia el que se mueve, y
//  los giros son por angulo real (o por tiempo si no hay sensor).
//  Los angulos vienen de los tiempos del codigo original
//  (400 ms = 90, 900 ms = 200) - no estan medidos en un escape real.
//  Si el anti-bucle detecta oscilacion, invierte el sentido y suma
//  EXTRA_GIRO_ANTIBUCLE grados.
// ────────────────────────────────────────────
```

### `escapeInterrumpidoPorSonar = false;`

Líneas 609–615 de la versión anterior.

```cpp
  // Los giros de escape de los casos de FRENTE y de COSTADO vigilan el
  // sonar (cambio 30): si el rival aparece mientras gira, corta y el loop
  // ataca en la vuelta siguiente. El retroceso previo no se corta: primero
  // hay que salir de la linea. Los casos de ATRAS no: ahi el rival suele
  // estar justo enfrente empujandonos contra el borde, y el pivote es
  // justamente para salir de su linea de empuje (el simulador lo mostro:
  // con el corte, contra uno 20 % mas fuerte se perdian las dos peleas).
```

### `if (emergencia) girarConFallback(girarIzquierda ? 45.0 : -45.0);`

Líneas 624–628 de la versión anterior.

```cpp
    // Si se repite (anti-bucle), lo estan empujando de espaldas contra el
    // borde: pivotear 45 grados lo saca de la linea de empuje antes de
    // avanzar. En el simulador era la unica derrota que quedaba. Sin corte
    // por sonar: el rival esta enfrente, y el pivote es para salir de su
    // linea de empuje.
```

### `bool haciaIzq = (direccion == "EMPUJE_DERECHA");`

Líneas 633–635 de la versión anterior.

```cpp
    // Los dos sensores de un lado en blanco: vamos paralelos al borde.
    // Curva hacia ADENTRO (la rueda de afuera mas rapida) y despues
    // pivote hacia adentro.
```

### `if (!escapeInterrumpidoPorSonar) moverVigilando(-VEL_ATAQUE, -VEL_ATAQUE, 150, VIGILAR_ADELANTE);`

Líneas 640–642 de la versión anterior.

```cpp
    // Pivotear en el lugar no saca los sensores de la linea: despues del
    // giro hay que trasladarse hacia adentro (visto el 2026-09-20). Si el
    // sonar corto el giro, el loop ya va a atacar: no hace falta.
```

### `bool haciaDer = (direccion == "FRENTE_IZQ");`

Líneas 646–647 de la versión anterior.

```cpp
    // Un solo sensor frontal: el borde esta adelante y de costado. Antes
    // giraba 90 y quedaba paralelo a la linea; ahora da media vuelta.
```

### `golpePendiente = false;`

Líneas 660–660 de la versión anterior.

```cpp
  golpePendiente = false;  // el tiron del propio escape no es un golpe del rival
```

### ``

Líneas 663–669 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  REACCION AL LEVANTAMIENTO: retroceder y reposicionar
//  Retrocede (vigilando el borde trasero) para salir de la rampa,
//  despues gira hacia donde estaba el rival para no volver a encarar
//  el mismo angulo a ciegas. Ese giro NO se corta por el sonar: el rival
//  tiene rampa, y volver a entrarle de frente es volver a subirse.
// ────────────────────────────────────────────
```

### `void retrocederHastaApoyar() {`

Líneas 671–674 de la versión anterior.

```cpp
// Retrocede hasta que el IMU confirme que la base volvio a apoyar entera
// en el dojo (cambio 33): inclinacion filtrada bajo INCLINACION_SALIDA_DEG
// sostenida PLANO_SOSTENIDO_MS, despues de RETROCESO_MIN_LEVANTADO_MS y
// antes de RETROCESO_MAX_LEVANTADO_MS. Vigila el borde de atras.
```

### `void reaccionPerdiendoEmpuje() {`

Líneas 723–730 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  EMPUJE FRONTAL PERDIDO (nos rotan): soltar y flanquear
//  Retrocede corto, gira ANGULO_FLANQUEO contra la rotacion que nos
//  imponian (para re-centrar sobre el rival), avanza un tramo en
//  diagonal y deja que el loop lo vuelva a encontrar - ahora de costado.
//  Solo se llega aca por rotacionForzada(): el corte por tiempo se quito
//  (cambio 21).
// ────────────────────────────────────────────
```

### `void reaccionEmpujeLateral() {`

Líneas 748–756 de la versión anterior.

```cpp
// ────────────────────────────────────────────
//  EMPUJE LATERAL / GOLPE fuera de ataque: escapar hacia adelante
//  Sale de la linea de empuje a fondo (vigilando el borde frontal).
//  Despues el loop busca al rival hacia donde se lo vio por ultima vez.
//  El 25-09 se probo ENCARAR (girar hacia el golpe) y se quito: en el
//  robot real el arranque propio pasa de 0.35 g y se leia como golpe por
//  detras -> media vuelta de espaldas al rival (13 giros en 93 s). Con
//  esta reaccion un golpe falso cuesta 350 ms hacia adelante.
// ────────────────────────────────────────────
```

### `moverVigilandoSonar(-VEL_ATAQUE, -VEL_ATAQUE, ESCAPE_ADELANTE_MS, VIGILAR_ADELANTE);`

Líneas 762–763 de la versión anterior.

```cpp
  // Cambio 32: el escape vigila el sonar. Si el rival aparece adelante,
  // deja de escapar y el loop ataca en la vuelta siguiente.
```
