# Product Requirements Document (PRD): Tracker de Precios Mercado Libre

## 1. Visión del Proyecto

Sistema automatizado diseñado para monetizar mediante el programa de afiliados de Mercado Pago / Mercado Libre. El objetivo es detectar caídas de precio reales (descuentos genuinos) en productos de Mercado Libre, generar una gráfica de historial como prueba social, y publicarla automáticamente en X (Twitter) junto con un enlace de afiliado. También incluirá un frontend web estático para capturar tráfico orgánico (SEO).

El ángulo del producto es ser el "detector de mentiras" de los descuentos (ideal para Hot Sale / Cyber Monday).

## 2. Stack Tecnológico

* **Lenguaje Base:** TypeScript

* **Backend / Orquestador:** Cloudflare Workers (Serverless, Cron Triggers para automatización).

* **Base de Datos:** Cloudflare D1 (SQLite relacional en el Edge) para almacenar productos e historial de precios.

* **Generación de Imágenes:** Satori / `@vercel/og` ejecutándose en el Worker para generar gráficas PNG al vuelo (Open Graph / Adjuntos de Twitter).

* **Frontend web:** Astro (Static Site Generation - SSG) hidratando componentes interactivos (React/Preact para las gráficas) mediante *Islands architecture*.

* **Redes Sociales:** Twitter API v2.

## 3. Estrategia de Ingesta de Datos (Enfoque Híbrido)

Para evitar baneos de IP (WAF de Akamai) y no depender de proxies residenciales:

1. **Historial Profundo (Día 1):** Realizar *scraping* / *fetching* silencioso a APIs no documentadas de trackers de terceros existentes (ej. RadarLibre, PrecioML) interceptando sus endpoints. Esto permite tener data histórica inmediata de meses anteriores.

2. **Tracking Diario y Actualización:** Utilizar la API oficial de Mercado Libre (`/items/{id}`) mediante una App registrada (con Access Token) para leer el precio actual de forma legal, estructurada y sin bloqueos severos, cruzando este dato con nuestra BD.

## 4. Esquema de Base de Datos Propuesto (Cloudflare D1)

Necesitaremos al menos estas tablas principales:

* **`products`**

  * `id` (String, PK) - El ID de Mercado Libre (ej. MLA123456)

  * `title` (String)

  * `url` (String)

  * `image_url` (String)

  * `category_id` (String)

  * `is_active` (Boolean) - Para activar/desactivar tracking.

* **`price_history`**

  * `id` (Integer, PK, AutoIncrement)

  * `product_id` (String, FK -> products.id)

  * `price` (Decimal/Real)

  * `timestamp` (Datetime)

## 5. Plan de Ejecución (Fases para el LLM)

### Fase 1: Proof of Concept Local (Scripts en Node/Bun)

* Crear scripts aislados para probar las llamadas a la API oficial de Mercado Libre (`/items/{id}`).

* Crear script de prueba para interceptar JSONs históricos de trackers de terceros.

* Validar la inyección del `tracking_id` de afiliado en la URL canónica.

### Fase 2: Backend y D1 (Cloudflare Workers)

* Inicializar D1 y crear las migraciones SQL.

* Programar un Worker con un **Cron Trigger** que lea los productos activos de D1.

* Hacer fetch a la API de ML, comparar con el precio anterior, y guardar el nuevo registro en `price_history`.

* *Lógica de Alerta:* Si la caída de precio es > 15% respecto a la media móvil de 30 días, encolar para publicar.

### Fase 3: Generación Visual y Twitter API

* Crear un endpoint en el Worker que use `satori` para renderizar un SVG/PNG con la curva de precios de un producto.

* Integrar Twitter API v2.

* Cuando la Fase 2 detecte la caída, disparar el tweet con: Título + Descuento % + Imagen generada + Link de afiliado.

### Fase 4: Frontend Web (Astro)

* Crear proyecto Astro.

* Página principal con las "Mejores caídas del día".

* Rutas dinámicas `/producto/[id]` generadas estáticamente en el *build time* (SSG).

* Implementar Schema Markup (JSON-LD) para que Google indexe los productos como `Product`.

* Integrar Chart.js o Recharts para la visualización del historial en la web.