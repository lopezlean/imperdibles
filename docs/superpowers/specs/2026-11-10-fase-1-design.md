# imperdibles.ar: diseño de la Fase 1

Fecha: 10/11/2026. Fuente de verdad del plan: `ROADMAP.md`. Si `idea.md` discrepa, prevalece `ROADMAP.md`. Diseño visual aceptado: `Main.dc.html` (página) y `Tarjeta.dc.html` (tarjeta de 1200x675).

Convención: las decisiones que tomó el agente líder y que el propietario aún no confirmó llevan la marca "Decisión del agente, pendiente de confirmar". Se reúnen en la sección 8. Las decisiones del propietario se marcan "Decisión del propietario".

Decisión del propietario: la Fase 1 se queda en el plan GRATUITO de Cloudflare por ahora y parte del trabajo corre localmente en su computadora. El propietario no dijo qué partes; el reparto de la sección 4 es una decisión del agente, pendiente de confirmar.

## 1. Intención y por qué

imperdibles.ar publica cada día una selección corta de productos en los que Mercado Libre (Argentina) es al menos 15% más barato que otras tiendas, con el enlace de afiliado del propietario. La regla es pública: si la diferencia no alcanza el umbral, el producto no aparece.

La Fase 1 debe funcionar para el Black Friday, 27/11/2026. Su objetivo es medir si este contenido genera clics y comisiones, no construir la versión definitiva. Por eso el alcance es mínimo: una categoría por corrida, pocas tiendas, una sola tarjeta y una sola página.

Capacidad disponible: 4 horas diarias del propietario (unas 65 horas hasta el 27/11) y dos agentes de IA que construyen. El diseño reparte el trabajo en dos mitades con un contrato fijo entre ellas para que los agentes avancen en paralelo sin bloquearse.

## 2. Objetivos, no objetivos y anti-objetivos

### Objetivos

- Una corrida diaria que lee precios, empareja modelos, filtra por umbral y entrega una lista de candidatos con formato fijo.
- Cada mañana, el propietario recibe por Telegram una lista corta de hasta 10 candidatos (los que pasen, aunque sean menos de 5) y solo debe pegar el enlace de afiliado de los que elige.
- Publicación automática de los elegidos en un canal de Telegram y en la página única de imperdibles.ar. La publicación en X depende de verificar su API (sección 9); si no cierra, es manual con material listo.
- Historial propio: cada precio leído queda guardado desde el primer día.
- Todo componente se construye con pruebas escritas primero y fixtures grabados.

### No objetivos (quedan fuera de la Fase 1)

- Páginas por producto, gráficas de historial y sello "precio más bajo en 30 días" (Fase 3).
- Medición de clics y comisiones, canal de WhatsApp (Fase 2).
- Comparar cuotas y envío. Se compara precio de lista, como indica la leyenda del diseño.
- Generar enlaces de afiliado por código, leer el sitio de Mercado Libre con navegador automatizado, leer trackers de terceros.
- Cuentas de usuario, panel de administración, más de una plantilla de tarjeta.

### Anti-objetivos (fracasos aunque el sistema funcione)

- Publicar una afirmación falsa de "más barato" por un emparejado de modelo equivocado (otra variante, otro pack, un accesorio).
- Publicar un precio que ya cambió sin revalidarlo.
- Alterar, acortar, resolver o reescribir un enlace de afiliado.
- Poner en riesgo la cuenta de Mercado Libre: scraping del sitio, uso de la API fuera de sus términos, exceso de consultas.
- Publicar productos usados (excluidos por el programa) o enlaces sin la leyenda de afiliado.
- Que el propietario deba hacer algo más que elegir y pegar enlaces para que el día salga.

## 3. Restricciones

Lo verificado con pruebas reales (rutas y respuestas de la API de ML, lectura de Frávega sin sesión, resultado del 10/11/2026) no se vuelve a discutir. No está verificado: los términos de uso de Frávega sobre lectura automatizada (ver riesgos).

- API de Mercado Libre con token de usuario: solo la ruta de catálogo da precios de terceros.
  - `GET /products/search?site_id=MLA&status=active&q=` responde 200 con relevancia débil.
  - `GET /products/{id}` responde 200.
  - `GET /products/{id}/items` responde 200 con `item_id`, `seller_id` y precio por oferta.
  - `/sites/MLA/search`, `/items/{id}` y `/items/{id}/prices` responden 403. No se usan.
- Autenticación: solo Authorization Code. El token de acceso dura 6 horas y hay refresh token. La aplicación es de solo lectura; la URI de redirección es `https://imperdibles.ar`.
- Enlaces de afiliado: cortos (`meli.la/...`), con parámetro cifrado; los términos del programa prohíben alterarlos. No se generan por código: el propietario los pega a mano cada mañana.
- El sitio de Mercado Libre exige sesión para los listados. Leerlo con navegador automatizado está descartado.
- Frávega: el listado se lee sin sesión en `https://www.fravega.com/l/?keyword=<términos>`, con un `<article>` por producto. Frávega también es marketplace con vendedores terceros.
- Prueba del 10/11/2026 en aspiradoras robot: 4 de 9 modelos emparejados tuvieron a ML al menos 15% más barato; ninguno llegó a 20%. El emparejado exacto fue lo difícil (un caso dudoso).
- Programa de afiliados: atribución de 24 horas; los medios (sitio, cuenta de X, canal) deben estar declarados; los productos usados quedan excluidos.
- Plazo: Fase 1 operativa el 27/11/2026. Trabajo propio: 4 horas diarias.

## 4. Arquitectura

### Vista general

Dos mitades unidas por un contrato:

- Agente de datos: recolector, emparejado, filtro, historial. Produce la `ListaDeCandidatos`.
- Agente de salida: lista corta, tarjeta, publicación, página única. Consume la `ListaDeCandidatos`.

Decisión del propietario: plan gratuito de Cloudflare, con parte del trabajo en su computadora.

Decisión del agente, pendiente de confirmar: el reparto. Un mismo código TypeScript, dos entornos, con D1 como punto común:

- Trabajo local (tarea programada en el Mac del propietario, lanzada por un comando, por ejemplo con `launchd`): recolección de precios (API de catálogo de ML y listados de tiendas), emparejado, filtro, escritura del historial, renderizado de tarjetas, renovación del token de ML, envío de la lista corta y revalidación previa a publicar. Escribe en D1 por la API de Cloudflare o `wrangler`.
- Worker de Cloudflare (plan gratuito): sirve la página única, recibe el webhook del bot de Telegram (respuestas con enlace, "rechazar"), publica en el canal y avisa si no hubo recolección. Cada invocación debe ser liviana (límites verificados en la sección 9). La página no calcula nada por solicitud: se genera con los datos del día y el Worker la sirve ya armada.

Base D1 y TypeScript en ambos. Las partes que no caben en los límites gratuitos pasan al trabajo local; por eso la revalidación y el renderizado de tarjetas no están en el Worker.

Cada tienda se oculta tras una interfaz común:

```ts
interface AdaptadorTienda {
  id: string;                                  // "ml", "fravega", ...
  buscar(termino: string): Promise<Publicacion[]>;
}
```

### 4.1 Recolector de precios

- Qué hace (trabajo local): dada la categoría del día, lee precios de Mercado Libre y de las demás tiendas.
- Entrada: categoría y sus términos de búsqueda (configuración); presupuesto de consultas por corrida.
- Primera categoría: aspiradoras robot. Presupuesto de consultas: valor conservador por defecto definido en `config`; si las respuestas traen cabeceras de límite, se leen y el recolector se detiene antes de agotarlo. Decisión del agente, pendiente de confirmar.
- Salida: filas en `publicaciones_tienda` y `observaciones_precio`; lista de `Publicacion` sin emparejar.
- Depende de: token de ML vigente, red, D1.
- Orden de lectura (decisión del agente, pendiente de confirmar): se lee primero el listado de Frávega, que define el universo de modelos. Luego, para cada modelo, se consulta ML por catálogo (`/products/search`, `/products/{id}/items`) y, desde que existan, las otras tiendas con el mismo adaptador. Para asociar un producto de Frávega con un producto de catálogo de ML se aplican las reglas de la sección 4.2 a los resultados de `/products/search`: con cero resultados `alta` o con más de uno, no hay emparejado y el producto se descarta con registro.
- Precio de ML: la oferta de menor precio entre las ofertas del producto de catálogo, solo condición nueva. Se guardan `item_id` y `seller_id`.
- Frávega: solo se aceptan publicaciones vendidas por Frávega. Si el listado no permite determinar el vendedor, la publicación se rechaza (no es candidata) y se cuenta en el registro de la corrida (ver riesgos). Decisión del agente, pendiente de confirmar.
- Todo precio leído se guarda, pase o no el filtro.
- Respeta el presupuesto de consultas, con espera y reintento acotado ante 429 o 5xx.

### 4.2 Emparejado de modelos

- Qué hace: decide si una publicación de otra tienda es el mismo modelo exacto que un producto de catálogo de ML.
- Entrada: una `Publicacion` de ML (con atributos del catálogo) y una de otra tienda.
- Salida: `Emparejado` con `confianza` en `alta` o `dudosa`, la regla aplicada y la evidencia.
- Depende de: reglas de normalización (marca, código de modelo, palabras de variante).
- Reglas, en orden. Decisión del agente, pendiente de confirmar:
  1. Si ambos lados traen GTIN/EAN y coinciden: `alta`. Si traen GTIN y difieren: no hay emparejado.
  2. Sin GTIN: la marca coincide, el código de modelo (token alfanumérico con letras y dígitos, normalizado a mayúsculas y sin guiones ni espacios) coincide exacto, y el conjunto de palabras de variante (Pro, Plus, Max, Ultra, Lite, Mini, SE, "+", y equivalentes) es idéntico en ambos lados: `alta`.
  3. Cualquier otro caso con marca y parte del código coincidentes: `dudosa`.
  4. Guarda de precio: si el cociente entre ambos precios cae fuera de 0,5 a 2,0, el emparejado baja a `dudosa` (posible pack o accesorio).
- Solo `alta` sigue el flujo. Las `dudosa` se registran con su motivo, no se envían al propietario ni se publican.

### 4.3 Filtro

- Qué hace: aplica el umbral y arma los candidatos.
- Entrada: emparejados `alta` con precios vigentes; `umbral_pct` desde configuración (inicial 15, ajustable).
- Salida: `ListaDeCandidatos` (sección 4.8) y `modelos_comparados`.
- Fórmula (decisión del agente, pendiente de confirmar): `diferencia_pct = (precio_otra - precio_ml) / precio_otra * 100`, calculada contra la otra tienda más barata del grupo. Pasa si el valor sin redondear es mayor o igual al umbral. Se muestra truncado a un decimal, nunca redondeado hacia arriba.
- Precios en pesos enteros, de lista, sin envío ni cuotas.
- Es una función pura: mismos datos, mismo resultado.

### 4.4 Historial

- Qué hace: conserva cada lectura de precio, con fecha y corrida.
- Entrada: cada observación del recolector.
- Salida: consulta de precios por publicación y rango de fechas (para Fase 3).
- Depende de: D1. No decide nada en la Fase 1; solo acumula.

### 4.5 Lista corta diaria

- Qué hace: el trabajo local envía al propietario, por mensaje privado del bot de Telegram, hasta 10 candidatos de mayor `diferencia_pct` (los que pasen, aunque sea uno); el Worker recibe por webhook los enlaces de afiliado. Con cero candidatos el trabajo local envía un mensaje corto de "hoy no hay candidatos". Decisión del agente, pendiente de confirmar.
- Rechazo: el propietario puede responder "rechazar" a un candidato; el par queda `rechazado` en `emparejados` y no se vuelve a proponer. Decisión del agente, pendiente de confirmar.
- Entrada: `ListaDeCandidatos` del día; mensajes del propietario por webhook del bot.
- Salida: candidatos marcados `elegido`, con `enlace_afiliado` guardado tal cual se recibió.
- Un mensaje por candidato, con la tarjeta como foto (ver 4.6): modelo, precio de ML, precios de las otras tiendas, diferencia, título y enlace de cada lado (para que el propietario verifique el emparejado) y el enlace de ML sin afiliado. El propietario responde a ese mensaje con el enlace de afiliado.
- Validaciones del enlace: el mensaje debe venir del chat del propietario; el host debe ser `meli.la`; se guarda la cadena exacta, sin resolverla, acortarla ni modificarla.
- Decisión del agente, pendiente de confirmar: el bot recibe por webhook del Worker y el propietario elige respondiendo con el enlace; lo que no recibe respuesta no se publica. El manejo del webhook es mínimo (validar, guardar en D1, responder), apto para el límite de CPU del Worker gratuito.
- Depende de: Telegram Bot API, `ListaDeCandidatos`.

### 4.6 Tarjeta

- Qué hace (trabajo local): genera la imagen "ML contra el resto" de 1200x675 según `Tarjeta.dc.html`, para cada candidato de la lista corta.
- Entrada: un `Candidato`.
- Salida: PNG y su `file_id` de Telegram.
- Decisión del agente, pendiente de confirmar: Satori (o equivalente) con las fuentes Inter y Space Grotesk, ejecutado en el Mac, no en el Worker (el Worker gratuito tiene 10 ms de CPU por invocación y no es apto para rasterizar).
- Almacenamiento de las tarjetas, decisión del agente, pendiente de confirmar: no se alojan en Cloudflare. El trabajo local envía el PNG al propietario como foto en la lista corta y guarda el `file_id` que devuelve Telegram en `candidatos.telegram_file_id`. Para publicar, el Worker envía al canal esa misma foto por `file_id`, sin subir nada. Motivo: es gratis, no agrega servicio ni cuenta y la página no necesita mostrar la tarjeta. Cloudflare R2 queda descartado por ahora (tiene capa gratuita de 10 GB, pero agrega un servicio que no hace falta). Si un `file_id` falla, el trabajo local vuelve a subir el PNG.
- Contenido: marca, insignia "X,X% menos", recuadro de reemplazo en lugar de foto (la Fase 1 sale sin fotos salvo que el propietario confirme que los términos del programa de afiliados permiten usar las del catálogo de ML), nombre, barras proporcionales de precios (ancho = precio / mayor precio mostrado), pie con fecha y diferencia en pesos. Hasta 3 tiendas rivales, ordenadas de menor a mayor.
- Color de acento y textos tomados del diseño; el porcentaje y la fecha vienen de los datos.

### 4.7 Publicación

- Qué hace: en dos pasos. (a) Trabajo local, poco antes de la hora de publicación: revalida los candidatos elegidos. (b) Worker, a la hora configurada: publica los validados.
- Entrada: candidatos `elegido` con `enlace_afiliado`.
- Salida: mensaje con tarjeta (por `file_id`) en el canal de Telegram; registro en `salidas`; página regenerada; copia para X (el Worker la envía al propietario).
- Revalidación (local): se vuelven a leer ambos precios. Si el candidato sigue pasando el umbral, queda `validado` con su fecha y hora; si no, `invalidado`, no se publica y se avisa al propietario. El Worker solo publica `validado` de los últimos 30 minutos, de modo que un precio no se publica sin revalidar. Se hace en local porque leer el listado de la tienda y emparejar excede el CPU del Worker gratuito.
- Cada mensaje lleva la leyenda de afiliado.
- Respuesta tardía: si el propietario responde con el enlace después de la hora de publicación, el candidato queda `elegido` hasta la siguiente revalidación del mismo día (la tarea programada o `imperdibles revalidar` a mano). Al terminar, el trabajo local llama a un punto del Worker protegido por secreto que publica los `validado` pendientes de inmediato. Solo el mismo día; no se traslada al siguiente. Con el Mac apagado no hay publicación tardía. Decisión del agente, pendiente de confirmar.
- X: tras publicar, el bot envía al propietario la tarjeta y el texto listos para pegar. Solo si la verificación de la API de X cierra, se publica automáticamente. Decisión del agente, pendiente de confirmar.
- Depende de: Telegram Bot API, Tarjeta (`file_id`), Página única, lectores de precio (solo la revalidación local).

### 4.8 Página única

- Qué hace (Worker): genera la página de `Main.dc.html` con los imperdibles del día y la sirve.
- Entrada: candidatos publicados del día, `modelos_comparados`, `umbral_pct`.
- Salida: HTML guardado en la tabla `paginas` y servido por el Worker en `/`.
- Secciones: encabezado, "Los imperdibles de hoy" ("Los imperdibles del <fecha>" cuando se muestra un día anterior), "Cómo elegimos", llamada al canal de Telegram, pie con la leyenda de afiliado.
- Los textos que citan el umbral ("15% o más") se generan desde `umbral_pct`, no se escriben a mano.
- Si hoy no hay publicados, muestra el último día con publicaciones, con el encabezado "Los imperdibles del <fecha>" de ese día en lugar de "de hoy", nunca una página vacía simulada.
- Los enlaces de afiliado salen como `rel="sponsored noopener"`, con la cadena exacta guardada.

### Contrato: `ListaDeCandidatos` (versión 1)

Es el único punto de unión entre los agentes. Cambiarlo requiere acuerdo de ambos y subir `version`. Se valida en el borde con un esquema (librería a criterio de quien construye).

```ts
type ListaDeCandidatos = {
  version: 1;
  corrida_id: string;
  fecha: string;               // YYYY-MM-DD, zona America/Argentina/Buenos_Aires
  categoria: string;           // ej. "aspiradoras-robot"
  umbral_pct: number;          // umbral usado en la corrida
  modelos_comparados: number;  // emparejados alta evaluados
  candidatos: Candidato[];     // ordenados por diferencia_pct descendente
};

type Candidato = {
  candidato_id: string;
  modelo_id: string;
  marca: string;
  titulo: string;                  // nombre mostrable
  imagen_url: string | null;
  ml: OfertaTienda;                // tienda === "ml"
  otras: OfertaTienda[];           // al menos 1, ordenadas por precio ascendente
  diferencia_ars: number;          // entero: otras[0].precio_ars - ml.precio_ars
  diferencia_pct: number;          // sin redondear
  confianza: "alta";               // las dudosas no entran
  regla_emparejado: "gtin" | "marca_codigo_variante";
};

type OfertaTienda = {
  tienda: string;                  // "ml", "fravega", ...
  titulo_listado: string;
  url: string;
  precio_ars: number;              // entero, pesos
  observado_en: string;            // ISO 8601 con zona
  ref_externa: string;             // item_id en ML, URL o SKU en otras
  vendedor: string | null;
  ml_product_id?: string;          // solo en ml
  ml_seller_id?: string;           // solo en ml
};
```

### Modelo de datos (D1)

Precios en pesos enteros (`INTEGER`). Fechas en texto ISO 8601.

| Tabla | Columnas |
|---|---|
| `tiendas` | `id` PK, `nombre`, `habilitada` |
| `modelos` | `id` PK, `categoria`, `marca`, `codigo_modelo`, `clave` UNIQUE, `gtin` NULL, `ml_product_id` NULL, `titulo`, `imagen_url` NULL, `creado_en` |
| `publicaciones_tienda` | `id` PK, `tienda_id` FK, `modelo_id` FK NULL, `ref_externa`, `titulo`, `url`, `vendedor` NULL, `condicion` NULL, `primera_vez`, `ultima_vez`; UNIQUE(`tienda_id`, `ref_externa`) |
| `observaciones_precio` | `id` PK, `publicacion_id` FK, `precio_ars`, `observado_en`, `corrida_id` FK |
| `emparejados` | `id` PK, `modelo_id` FK, `publicacion_id` FK, `confianza`, `regla`, `evidencia` (JSON), `estado` (`auto`, `rechazado`), `creado_en` |
| `corridas` | `id` PK, `fecha`, `categoria`, `estado` (`ok`, `parcial`, `fallida`), `modelos_comparados`, `consultas_usadas`, `error` NULL, `iniciada_en`, `terminada_en` |
| `candidatos` | `id` PK, `corrida_id` FK, `modelo_id` FK, `payload` (JSON del `Candidato`), `estado` (`pendiente`, `elegido`, `validado`, `descartado`, `publicado`, `invalidado`), `enlace_afiliado` NULL, `telegram_file_id` NULL, `validado_en` NULL |
| `salidas` | `id` PK, `candidato_id` FK, `canal` (`telegram_canal`, `x`, `x_manual`), `mensaje_externo_id` NULL, `publicado_en` |
| `paginas` | `clave` PK, `html`, `generada_en` |
| `config` | `clave` PK, `valor` (`umbral_pct`, horas de los pasos, términos por categoría, presupuesto de consultas) |
| `tokens_ml` | `id` PK, `access_token`, `refresh_token`, `expira_en` |

Los secretos de Telegram y de X van como secretos del Worker, no en D1. Los tokens de ML sí, porque se renuevan en ejecución; los usa y renueva solo el trabajo local. El trabajo local guarda sus credenciales (token de la API de Cloudflare, secretos de Telegram) fuera del repositorio. Todo lo que escribe el trabajo local sigue las cuotas de D1 del plan gratuito (sección 9).

## 5. Flujo diario

Zona horaria America/Argentina/Buenos_Aires. Las horas son valores iniciales y se cambian en `config`. Los Cron Triggers de Cloudflare se expresan en UTC (ART es UTC-3 y no tiene horario de verano). La tarea local usa la hora del Mac. Usa 2 de los 5 Cron Triggers del plan gratuito.

1. 06:00, local, recolección. Se renueva el token de ML si le quedan menos de 30 minutos. Se elige la categoría del día (rotación, desde que exista). Se leen precios y se guardan observaciones en D1.
2. Local, a continuación, emparejado y filtro. Se arma y valida la `ListaDeCandidatos` y se guarda en `candidatos`.
3. Local, a continuación, tarjetas y lista corta. Se renderizan las tarjetas y el bot envía hasta 10 de los mejores candidatos al propietario por mensaje privado, con la tarjeta como foto; se guarda el `file_id` (los que pasen, aunque sea uno; con cero, un aviso corto).
4. 07:30, Worker (cron). Si no hay corrida del día en `corridas`, avisa al propietario que no se recolectó nada (ver sección 6).
5. Mañana, trabajo del propietario. Verifica emparejados contra los títulos y enlaces del mensaje, genera el enlace de afiliado en Mercado Libre y lo pega como respuesta a cada candidato elegido. El Worker (webhook) confirma cada enlace recibido o explica por qué lo rechaza.
6. 10:45, local, revalidación. Para cada elegido, relee ambos precios y deja el candidato `validado` o `invalidado`.
7. 11:00, Worker (cron), publicación. Publica en el canal los `validado` (foto por `file_id`), registra la salida, regenera la página única y envía al propietario el material para X.
8. Cierre. La corrida queda en `corridas` con su estado. Si algo falló, el bot envía un aviso corto al propietario.

Si el propietario responde después de las 10:45, el producto se publica en la siguiente revalidación del mismo día (ver 4.7).

La atribución del programa dura 24 horas; por eso las publicaciones de la mañana tienen más ventana útil y la hora de publicación no debería ser tardía.

## 6. Manejo de errores

Regla general: ante la duda, no se publica. Un día sin publicación es aceptable; una afirmación falsa no.

| Situación | Qué ocurre |
|---|---|
| El Mac del propietario está apagado o sin conexión a la hora programada | No se recolecta nada ese día y no hay lista corta. A las 07:30 el Worker detecta que no hay corrida del día y el bot avisa: "hoy no se recolectó". El propietario puede ejecutar la corrida a mano más tarde el mismo día (`imperdibles correr`); la lista corta llega entonces y la publicación sigue el flujo de respuesta tardía. Sin Mac encendido ese día no hay candidatos. |
| Falla el envío de la tarea local a D1 (red, API de Cloudflare) | La corrida queda `fallida` en el registro local y se reintenta una vez. Nada se publica con datos a medio escribir: el Worker solo publica `validado`. |
| Token de ML vencido | Se renueva con el refresh token y se reintenta una vez. Si la renovación falla (refresh inválido o revocado), la corrida falla sin leer nada, el bot avisa al propietario y se detiene hasta que se reautorice (script local con Authorization Code). |
| Respuesta 403 en una ruta de catálogo | Se trata como error de permisos. No se prueba otra ruta de ML. Se registra, se avisa y la corrida termina `fallida`. |
| 429 o 5xx de ML | Espera creciente y hasta 3 reintentos. Si persiste, los modelos sin lectura se omiten y la corrida queda `parcial`. |
| Cambió el diseño de Frávega (listado sin `<article>` o sin precio legible) | El adaptador rechaza la página con error de formato en lugar de adivinar. La corrida queda `fallida` para esa tienda y el bot avisa. No se usan datos viejos como si fueran nuevos. |
| Un producto sin precio o con precio absurdo (cero, no numérico) | Se descarta esa publicación y se registra. |
| Ningún candidato pasa el umbral | La corrida termina `ok` con lista vacía. El bot avisa "hoy no hay candidatos" (mensaje corto) con la cantidad de modelos comparados. No se baja el umbral automáticamente. |
| Emparejado dudoso | Queda registrado con su motivo y no entra en la lista. |
| El precio cambió entre la lista y la publicación | La revalidación marca el candidato `invalidado`, no se publica y se avisa al propietario. |
| Enlace de afiliado inválido (host distinto de `meli.la`, mensaje de otro chat) | El bot lo rechaza y no lo guarda. |
| El propietario responde después de la hora de publicación | El producto se revalida en la siguiente corrida de revalidación del mismo día (tarea o comando a mano) y se publica solo si sigue pasando. Sin traslado al día siguiente. |
| El propietario no responde en todo el día | No se publica nada ese día. La página muestra el último día con publicaciones y su fecha. |
| Falla Telegram al publicar (incluye `file_id` rechazado) | Un reintento. Si persiste, el candidato queda `validado`, el bot avisa y se puede reintentar sin repetir publicaciones ya registradas en `salidas`; si el `file_id` es inválido, el trabajo local vuelve a subir el PNG. Un `validado` de más de 30 minutos se revalida antes de publicar. |
| Falla la API de X | No bloquea nada. El material para publicar a mano ya está en el mensaje al propietario. |

## 7. Pruebas

Estrictamente primero las pruebas (rojo, verde, refactor). Ninguna prueba hace llamadas reales. Los fixtures se graban una vez con respuestas reales, se les quitan tokens y datos personales, y se versionan en `fixtures/`.

Fixtures:

- `fixtures/ml/`: respuestas JSON de `/products/search`, `/products/{id}`, `/products/{id}/items` (incluye caso con ofertas usadas y caso sin ofertas), y de 403 y 429.
- `fixtures/fravega/`: HTML del listado de aspiradoras robot, uno con vendedor tercero y uno con el diseño roto (sin `<article>`).
- `fixtures/lista-candidatos/`: JSON de ejemplo del contrato, con la reproducción de la corrida del 10/11/2026 y casos límite.

Por componente:

- Recolector: parsea los fixtures de ML y Frávega a `Publicacion`; elige la oferta nueva más barata; descarta usadas; rechaza el HTML roto con error explícito; respeta el presupuesto de consultas; reintenta ante 429 y renueva token ante 401. Se prueba con un cliente HTTP falso inyectado.
- Emparejado: tabla de casos con pares reales, incluidos el caso dudoso de la prueba, variantes Pro/Plus, packs, accesorios y GTIN en conflicto. Verifica la regla aplicada y que solo `alta` pasa.
- Corrida del 10/11: una prueba reproduce esa corrida con el fixture y la fórmula del documento, (otra - ML) / otra. El resultado esperado es 4 de 9 modelos, pero es un valor por confirmar con el fixture, no una aserción fija.
- Filtro: casos límite exactos (14,99; 15,00; 15,01), cálculo contra la otra tienda más barata, truncamiento del porcentaje, umbral configurable.
- Historial: inserta cada observación, incluso repetida; consulta por rango.
- Contrato: el esquema acepta los fixtures válidos y rechaza campos faltantes, precios no enteros y `confianza` distinta de `alta`. Ambos agentes corren esta prueba contra los mismos fixtures; es la prueba de integración entre ellos.
- Lista corta: formato del mensaje con fixtures; el enlace de afiliado se guarda idéntico byte a byte; se rechazan hosts distintos de `meli.la` y chats ajenos.
- Tarjeta: la estructura que genera la función antes de rasterizar coincide con un snapshot; el PNG mide 1200x675; las proporciones de barras salen de los precios; los casos con 1 y con 3 tiendas rivales.
- Publicación: con Telegram falso, revalidación que bloquea un candidato que dejó de pasar, no se publica dos veces el mismo candidato, enlace de afiliado intacto en el mensaje, leyenda de afiliado presente.
- Página única: snapshot del HTML con los fixtures; contiene la leyenda de afiliado, el umbral desde configuración y `rel="sponsored noopener"`; el caso sin publicados del día.
- Corrida completa: una prueba de punta a punta con todos los adaptadores falsos, desde fixtures hasta la página generada.

Reparto local y Worker:

- El código compartido se prueba sin depender de dónde corre. El Worker se prueba con D1 y Telegram falsos; el trabajo local, con la API de Cloudflare y Telegram falsos.
- Worker: el webhook acepta solo el chat del propietario; el cron publica únicamente `validado` recientes; el aviso de las 07:30 solo si falta la corrida; el punto de publicación inmediata rechaza llamadas sin el secreto.
- Local: con la API de D1 caída la corrida queda `fallida` sin `candidatos` parciales; sin conexión, el comando termina con un mensaje claro.
- Presupuesto del Worker: una prueba de humo de cada manejador (webhook, publicación con 10 candidatos, `/`) mide el CPU y falla por encima de un tope menor a 10 ms.

Aparte de las pruebas, un chequeo de salud (no unitario) lee en vivo el listado de Frávega y falla si cambia su formato, para detectarlo antes de la corrida.

## 8. Decisiones del agente pendientes de confirmar

Decisión del propietario (no es del agente): plan gratuito de Cloudflare por ahora y parte del trabajo en su computadora.

Todas las demás llevan la marca "Decisión del agente, pendiente de confirmar".

Las tres acordadas con el agente líder:

1. Worker de Cloudflare (plan gratuito) con D1 y TypeScript para servir la página, el webhook y la publicación; página única generada con los datos del día.
2. Tarjeta renderizada con Satori (o equivalente) desde el diseño, en el trabajo local.
3. Lista corta por mensaje privado de un bot de Telegram; el propietario responde con el enlace de afiliado por producto.

Elecciones adicionales para cubrir vacíos:

4. Diferencia = (otra - ML) / otra, contra la otra tienda más barata; umbral sobre el valor sin redondear; se muestra truncado a un decimal.
5. Precios de lista en pesos enteros, sin envío ni cuotas (resuelve provisoriamente la decisión abierta del `ROADMAP.md`).
6. Frávega define el universo de modelos; ML y las demás tiendas se consultan por modelo.
7. Precio de ML: la oferta nueva más barata del producto de catálogo.
8. Emparejado en dos niveles, `alta` y `dudosa`; solo `alta` pasa; GTIN primero, luego marca, código y variantes; guarda de cociente de precios 0,5 a 2,0.
9. Las dudosas no se envían al propietario; quedan registradas.
10. Solo publicaciones vendidas por Frávega mismo, no por terceros del marketplace; si no se puede determinar el vendedor, se rechaza y se cuenta en el registro de la corrida.
11. Revalidación de ambos precios justo antes de publicar.
12. Publicación a hora fija configurable, en lote, por el Worker; el propietario elige respondiendo; solo se acepta un enlace de host `meli.la`, guardado tal cual y sin resolverlo.
13. Bot de Telegram por webhook, no por consulta periódica.
14. Todo mensaje público lleva la leyenda de afiliado.
15. Página en la tabla `paginas`, servida por el Worker; si no hay publicados hoy, muestra el último día con su fecha.
16. X: se envía siempre al propietario el material listo; la publicación automática solo si la API se verifica.
17. Tarjeta como función pura renderizada en local; no se aloja en Cloudflare: se sube a Telegram y se reutiliza su `file_id` para publicar; hasta 3 tiendas rivales.
18. Zona ART; horarios iniciales 06:00 (local, en cadena), 07:30 (aviso, Worker), 10:45 (revalidación, local) y 11:00 (publicación, Worker); crons en UTC.
19. Autorización inicial de ML con un script local de una sola vez; el refresh token se guarda en D1 y lo renueva el trabajo local.
20. Fase 1 sale con el recuadro de reemplazo en lugar de fotos, salvo que el propietario confirme que los términos del programa permiten usar las del catálogo de ML (ver riesgos).
21. Asociación Frávega a catálogo de ML: reglas de 4.2 sobre los resultados de `/products/search`; cero o más de un `alta` significa sin emparejado.
22. Con menos de 5 candidatos se envía lo que pase, aunque sea uno; con cero, un mensaje corto "hoy no hay candidatos".
23. Respuesta con enlace tras la hora de publicación: se publica tras la siguiente revalidación local del mismo día, con precios releídos; nunca al día siguiente.
24. El propietario puede responder "rechazar" a un candidato; el par queda `rechazado` y no se vuelve a proponer.
25. Encabezado "Los imperdibles del <fecha>" al mostrar un día anterior.
26. Primera categoría aspiradoras robot; presupuesto de consultas conservador en `config`, leyendo cabeceras de límite si existen.
27. La prueba de la corrida del 10/11 usa (otra - ML) / otra; el 4 de 9 es un valor por confirmar con el fixture.
28. Reparto local y Worker: local = recolección, emparejado, filtro, historial, tarjetas, renovación del token de ML, lista corta y revalidación; Worker = página, webhook, publicación y aviso de falta de corrida. Lo que no cabe en los límites gratuitos pasa a local.
29. Revalidación en local, estado `validado` y publicación del Worker solo sobre `validado` de los últimos 30 minutos.
30. Tarea local con `launchd` (o equivalente) y comandos manuales `imperdibles correr` y `imperdibles revalidar`; escribe en D1 por la API de Cloudflare o `wrangler`; aviso de las 07:30 del Worker si falta la corrida.

## 9. Riesgos abiertos y verificaciones previas

No verificado. Cada punto indica qué comprobar y qué cambia según el resultado.

| Riesgo | Qué comprobar | Si falla |
|---|---|---|
| Las ofertas de catálogo no traen precio anterior ni precio de lista | Mirar los campos de `/products/{id}/items` y `/products/{id}`. | El diseño no depende de ello en la Fase 1. Cambiar la leyenda "precio de lista" por "precio actual" (en ML "precio de lista" suele significar el previo al descuento). |
| Límites de la API de ML | Consultas por minuto y por día; cabeceras de límite; efecto de la rotación de categorías. | Bajar el presupuesto de consultas por corrida o la cantidad de modelos. |
| El refresh token de ML es de un solo uso | Comprobar si cada renovación entrega un refresh nuevo. | Guardar el nuevo de forma atómica en `tokens_ml` antes de usar el access token. |
| La oferta más barata no es la que abre el enlace de afiliado | Comparar con el precio visible en la página del producto. | Registrar el `item_id`; el propietario verifica el precio al generar el enlace. |
| Límites y costo de la API de X | Plan gratuito o de pago, publicaciones por día, subida de imágenes. | Publicación manual con el material listo (ya previsto). |
| Términos de uso de las tiendas leídas | Revisar los términos de Frávega y de las próximas tiendas sobre lectura automatizada. | Excluir la tienda o reducir la frecuencia; decisión del propietario. |
| El listado de Frávega no indica el vendedor | Mirar el HTML del `<article>` y la página de producto. | Se rechaza la publicación (no es candidata) y se cuenta en el registro de la corrida; si ninguna es atribuible, Frávega no aporta candidatos hasta resolverlo. |
| GTIN/EAN no disponible en uno de los lados | Atributos del catálogo de ML y HTML de Frávega. | Solo funciona la regla 2; más casos `dudosa`. |
| Uso de fotos del catálogo de ML en el sitio y la tarjeta | Términos de la API y del programa de afiliados; confirmación del propietario. | Por defecto la Fase 1 usa solo el recuadro de reemplazo del diseño; las fotos se activan únicamente con esa confirmación. |
| Límites del Worker gratuito (documentación oficial de Cloudflare, https://developers.cloudflare.com/workers/platform/limits/): 100.000 solicitudes por día, 10 ms de CPU por solicitud y por Cron Trigger, 50 subsolicitudes por solicitud, 5 Cron Triggers por cuenta, 64 MiB de paquete | Medir el CPU real de webhook, publicación con 10 candidatos y `/` (prueba de humo de la sección 7). La documentación consultada no aclara si las consultas a D1 cuentan como subsolicitudes: no verificado. | Mover el paso que no quepa al trabajo local (por ejemplo, generar la página) o pasar al plan de pago. |
| Cuotas de D1 gratuito (https://developers.cloudflare.com/d1/platform/pricing/ y https://developers.cloudflare.com/d1/platform/limits/): 5 millones de filas leídas por día, 100.000 escritas por día, 5 GB en total, 500 MB por base, 10 bases | Contar filas escritas por corrida, incluidos los índices. El historial guarda una fila por precio leído. | Reducir el presupuesto de consultas o los modelos por corrida. |
| Dependencia del Mac del propietario encendido y con conexión cada mañana (recolección, tarjetas, lista corta y revalidación) | Probar el comando a mano y el aviso de las 07:30 con el Mac apagado. | Sin Mac, ese día no hay candidatos (aceptado). Al pasar al plan de pago, bastaría mover el trabajo local a un Worker programado: el código es el mismo, pero hay que cumplir los límites de CPU y tamaño del plan de pago, que no se verificaron aquí. |
| Medios declarados y condición fiscal | Declarar sitio, canal y cuenta de X en el programa; confirmar monotributo o responsable inscripto. | Trámites del propietario hasta el 15/11; sin ellos no hay publicación con comisión. |
| Frecuencia de candidatos | Con 4 de 9 en una categoría y ninguno sobre 20%, algunos días no habrá candidatos. | Es esperable; la rotación y las tiendas adicionales amplían el universo. |

## 10. Qué queda a criterio de quien construye

- Estructura de carpetas, gestor de paquetes, herramienta de pruebas y de migraciones de D1.
- Librería de validación del contrato y de análisis del HTML de Frávega.
- Cómo se detectan y normalizan las palabras de variante y los códigos de modelo, mientras se cumplan los casos de la sección 7.
- Reparto exacto de los términos de búsqueda por categoría y su ubicación en `config`.
- Redacción de los mensajes del bot, siempre con los datos de la sección 4.5 y la leyenda de afiliado.
- Adaptación del diseño de la tarjeta a 2 o 3 tiendas rivales, sin cambiar la plantilla base.
- Orden interno de trabajo dentro de cada semana del calendario del `ROADMAP.md`, que no se altera: hasta el 15/11 recolector y filtro; hasta el 20/11 lista corta, tarjeta y Telegram; hasta el 24/11 dos tiendas más, rotación y página única; 25 al 27/11 solo correcciones.
- Qué tiendas se suman como segunda y tercera (decisión abierta del `ROADMAP.md`; sugeridas Cetrogar y Musimundo), siempre que su listado se pueda leer sin sesión y sus términos lo permitan.
