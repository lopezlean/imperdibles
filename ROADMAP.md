# Roadmap: imperdibles.com.ar

Actualizado el 10/11/2026. Reemplaza el plan de fases de `idea.md` en los puntos que las pruebas invalidaron.

## Qué es

Una selección diaria de productos donde Mercado Libre está mucho más barato que otras tiendas, publicada con link de afiliado. Regla visible para el público: solo se publica cuando ML gana por al menos el umbral definido.

## Fase 0: validación (hecha)

| Pregunta | Resultado |
|---|---|
| ¿La API de ML da precios de terceros? | Solo por catálogo: `/products/{id}/items` responde 200. `/items/{id}` y `/sites/MLA/search` responden 403 con token. |
| ¿Se puede armar el link de afiliado por código? | No. El link corto resuelve a una URL con un parámetro `ref` cifrado y los términos prohíben alterarlo. Se genera a mano. |
| ¿Hay diferencias grandes entre ML y otras tiendas? | En aspiradoras robot, 4 de 9 productos con ML al menos 15% más barato que Frávega. Ninguno llega al 20%. |
| ¿Se puede leer ML con navegador automatizado? | Exige sesión iniciada. Descartado por el riesgo para la cuenta. |
| ¿Existe competencia? | MejoresCompras hace historial y veredicto de descuentos de ML. No compara contra otras tiendas. |

## Fase 1: versión mínima para el Black Friday (hasta el 27/11/2026)

Sin web. El objetivo es medir si el contenido genera clics y comisiones.

Capacidad: 4 horas por día de trabajo propio (unas 65 horas hasta el 27/11) y dos agentes de IA que construyen. Las horas propias alcanzan para trámites, decisiones, revisión y también para dirigir a los agentes de cerca.

Alcance con ese tiempo:

- Núcleo primero: Frávega como única tienda y una categoría por corrida, hasta que la lista de candidatos funcione de punta a punta.
- Después se suman dos tiendas más y la rotación de categorías, que pasan de la Fase 2 a esta fase.
- Página única en imperdibles.com.ar con las ofertas del día. Sirve como medio declarable en el programa de afiliados y adelanta la indexación; las páginas por producto siguen en la Fase 3.
- Publicación automática en Telegram. La de X queda sujeta a verificar los límites y el costo de su API; si no cierra, se publica a mano.
- La tarjeta es una plantilla única, sin variantes.

Reparto entre los dos agentes, unidos por una lista de candidatos con formato fijo:

- **Agente de datos:** recolector, emparejado, filtro e historial (pasos 1 a 4).
- **Agente de salida:** lista corta diaria, tarjeta y publicación (pasos 5 a 7).

Calendario:

| Semana | Agentes | Trabajo propio |
|---|---|---|
| Hasta el 15/11 | Verificaciones de la API; recolector y filtro generando la lista de candidatos | Declarar medios, condición fiscal, crear el canal y el bot de Telegram |
| Hasta el 20/11 | Lista corta diaria, tarjeta y publicación en Telegram; corridas de prueba sin publicar | Revisar tarjetas y candidatos, ajustar el umbral |
| Hasta el 24/11 | Dos tiendas más, rotación de categorías, página única en imperdibles.com.ar | Publicar las primeras ofertas reales, verificar la API de X |
| 25 al 27/11 | Corridas diarias reales, solo correcciones | Pegar links de afiliado cada mañana, publicar en X |

Antes de construir:

- [ ] Confirmar que las ofertas de catálogo traen el precio anterior y cuántas consultas por día permite la API.
- [ ] Declarar la cuenta de X y el canal como medios en el programa de afiliados.
- [ ] Confirmar la condición fiscal para cobrar (monotributo o responsable inscripto).
- [ ] Revisar los términos de uso de las tiendas que se van a leer.

Para construir, en este orden:

1. **Recolector de precios.** ML por API de catálogo; Frávega por su listado público. Una categoría por corrida.
2. **Emparejado de modelos** entre tiendas (mismo modelo exacto).
3. **Filtro** de diferencia mínima. Umbral inicial: 15%.
4. **Historial propio.** Guardar cada precio leído desde el primer día.
5. **Lista corta diaria.** Los 5 a 10 candidatos llegan cada mañana; se pega el link de afiliado de los elegidos.
6. **Tarjeta "ML contra el resto".** Imagen con el precio de ML y los de las otras tiendas.
7. **Publicación** en un canal de Telegram y en X.

## Fase 2: ampliar (diciembre de 2026)

- Sumar más tiendas (Cetrogar, Naldo, Carrefour y On City ya están; faltan Musimundo, otras).
- Rotación de una categoría por día.
- Medir clics y comisiones por canal y por categoría; ajustar el umbral con esos datos.
- Canal de WhatsApp si Telegram muestra que el formato funciona.

## Fase 3: web y doble sello (desde enero de 2027)

- Sello "precio más bajo en 30 días", con el historial propio acumulado desde la Fase 1.
- Sitio imperdibles.com.ar con las ofertas del día y una página por producto, pensado para buscadores.
- Gráfica de historial por producto.

## Decisiones abiertas

- Umbral definitivo (15% es el valor inicial, no una decisión tomada).
- Qué tiendas entran en la Fase 1 además de Frávega.
- Dónde corre el sistema. `idea.md` propone Cloudflare Workers y D1; sigue siendo una propuesta.
- Cómo se compara el precio en cuotas y el envío.
