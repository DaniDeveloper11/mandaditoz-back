# Mandaditoz Backend — Contexto del Proyecto

## Stack
- **Framework**: Strapi 5.48.1 (Headless CMS)
- **Base de datos**: PostgreSQL (localhost:5432, db: mandaditoz)
- **Node.js**: ^20.0.0
- **Puerto**: 1337

## Descripción
Directorio de negocios locales enfocado en México (Etzatlán). Permite a usuarios registrarse, crear o reclamar negocios, dejar reseñas, subir fotos y moderar contenido.

---

## Colecciones (8)

| Colección | Ruta API | Notas |
|-----------|----------|-------|
| `business` | `/api/businesses` | Draft/publish habilitado |
| `category` | `/api/categories` | Jerarquía padre/hijo |
| `business-hour` | `/api/business-hours` | Horarios por día (mon-sun) |
| `review` | `/api/reviews` | Rating 1-5 estrellas |
| `claim` | `/api/claims` | Reclamación de propiedad |
| `photo` | `/api/photos` | Galería por negocio |
| `report` | `/api/reports` | Moderación de contenido |
| `social-link` | `/api/social-links` | Redes sociales del negocio |

---

## Permisos públicos (sin autenticación)
Configurados en `src/index.js` vía bootstrap automático:
- `find` y `findOne` en: `business`, `category`, `business-hour`, `review`, `photo`, `social-link`
- Todo lo demás requiere usuario autenticado

---

## Usuario extendido
Archivo: `src/extensions/users-permissions/content-types/user/schema.json`

Campos adicionales al usuario base de Strapi:
- `displayName` (string, max 80)
- `avatar` (media/imagen)
- `phone` (string con regex)
- `bio` (text, max 300)
- `emailVerified` (boolean, default false) — ver nota abajo
- `lastLoginAt` (datetime)
- `publishedBusinessLimit` (integer, default 3) — cupo de negocios publicados; ver abajo

Relaciones del usuario:
- `ownedBusinesses` → oneToMany → `business`
- `reviews` → oneToMany → `review`
- `claims` → oneToMany → `claim`
- `reports` → oneToMany → `report`
- `uploadedPhotos` → oneToMany → `photo`

---

## `confirmed` vs `emailVerified`
Son dos cosas distintas y conviene no confundirlas:

| Campo | Qué significa | Quién lo mueve |
|---|---|---|
| `confirmed` | Candado de login de Strapi. Con `email_confirmation` activo, `false` impide entrar. | Strapi, o `register-customer` que lo pone `true` de entrada |
| `emailVerified` | El dato real: ¿este correo existe? | Un lifecycle en `src/index.js` que lo espeja cuando `confirmed` pasa a `true` |

El comensal entra con `confirmed: true` / `emailVerified: false`: puede pedir de
inmediato y se le recuerda verificar el correo después. `emailVerified` es lo que hay
que consultar para saber si se puede confiar en esa dirección.

## Flujos de negocio

### Flujo 1 — Usuario crea su propio negocio
```
POST /api/auth/local/register  →  obtiene JWT
POST /api/businesses           →  owner se asigna automáticamente
                                  status: "draft"
```

### Flujo 2 — Usuario reclama un negocio existente (creado por admin)
```
POST /api/auth/local/register  →  obtiene JWT
POST /api/claims               →  ownershipStatus pasa a "pending_claim"
Admin aprueba                  →  ownershipStatus = "claimed", owner = user
```

El campo `createdByAdmin: boolean` en `business` distingue el origen del negocio.

---

## Lógica de ownership implementada

### Policy de ownership
Archivo: `src/api/business/policies/is-owner.js`

Verifica que el usuario autenticado sea el `owner` del negocio antes de permitir modificarlo. Retorna `false` (403 Forbidden) si no coincide.

### Rutas protegidas
Archivo: `src/api/business/routes/business.js`

La policy `is-owner` se aplica a:
- `PUT /api/businesses/:id` — solo el dueño puede actualizar
- `DELETE /api/businesses/:id` — solo el dueño puede eliminar

### Auto-asignación de owner al crear
Archivo: `src/api/business/controllers/business.js`

El método `create` está sobrescrito para inyectar `owner: ctx.state.user.id` automáticamente, ignorando cualquier `owner` enviado en el body del request (previene suplantación).

---

## Estados del negocio

| Campo | Valores | Default |
|-------|---------|---------|
| `businessStatus` | `draft`, `published`, `pending_review`, `suspended` | `draft` |
| `ownershipStatus` | `unclaimed`, `pending_claim`, `claimed` | `unclaimed` |

> `status` es nombre reservado en Strapi 5 (draft/publish del Document Service). Todos los campos personalizados de estado usan prefijo: `businessStatus`, `claimStatus`.

---

## Cuántos negocios puede tener un dueño

Un usuario puede tener **N negocios** (`owner` es manyToOne → `user.ownedBusinesses`) y
crear **borradores sin límite**. El único tope es cuántos puede tener **publicados a la vez**.

| Pieza | Archivo |
|---|---|
| Default y resolución del cupo | `src/utils/publish-limit.js` → `DEFAULT_PUBLISHED_LIMIT = 3`, `getPublishedLimit(ownerId)` |
| Enforcement | `src/api/business/content-types/business/lifecycles.js` → `assertPublishLimit()` en `beforeCreate` y `beforeUpdate` |
| Lo que ve el frontend | `GET /api/businesses/mine` → `meta.publishedCount` / `meta.publishedLimit` |

**Para darle cupo extra a un dueño:** Content Manager → User → `publishedBusinessLimit`
→ pon el número que le toque. Vacío o `NULL` = 3.

La columna la crea y rellena `database/migrations/003-add-published-business-limit.sql`
(solo toca los `NULL`, nunca le baja el cupo a nadie). El fallback en código sigue siendo
la garantía de que vacío = 3: Strapi no escribe el default del schema como DEFAULT de la
columna.

El conteo solo cuenta negocios con `businessStatus: 'published'` y `archivedAt: null`:
archivar o pasar a borrador libera cupo. Al excederlo, la API responde 400 con
`error.details.code = 'PUBLISH_LIMIT_REACHED'` y un mensaje que ya trae el cupo real
del usuario.

---

## Agregar un campo nuevo: el schema JSON NO basta para producción

Declarar un atributo en un `schema.json` lo crea en la base **solo en `develop`**. Con
`NODE_ENV=production`, `strapi start` no aplica cambios de esquema: no crea la columna,
y aun así reescribe el esquema persistido (`strapi_content_types_schema`) como si
estuviera al día, así que tampoco la crea en arranques posteriores. El resultado es un
campo que funciona perfecto en local y no existe en prod.

**Todo campo nuevo necesita su `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en
`database/migrations/`.** Ver `003-add-published-business-limit.sql` como plantilla.

Otras dos cosas que conviene saber de esas migraciones:

- Corren **dentro** del sync de esquema y **antes** de que Strapi cree o altere
  columnas. Una migración que asume que la columna del schema JSON ya existe revienta
  con `column ... does not exist` justo en el despliegue que la estrena. Escríbelas
  autosuficientes: que creen lo que van a tocar.
- Un `MigrationError` **aborta el arranque de Strapi**. Una migración mal escrita no
  degrada: tira el servicio.
- Se registran en la tabla `strapi_migrations` y corren una sola vez. Para reprobar una
  en local: borra su fila ahí, deshaz su efecto y reinicia.

---

## Componentes reutilizables
- `shared.address` — dirección con 32 estados mexicanos
- `shared.seo` — metaTitle, metaDescription, keywords, ogImage
- `business.response` — respuesta del dueño a una reseña

---

## Cartelera del municipio (`city-post`)

Eventos con fecha, avisos con vigencia y carteles de fiestas patronales, por municipio.
API: `/api/city-posts`. En el panel se llama **Evento o Aviso**.

> ⚠️ **No confundir con `business-event`**, que es analítica de tráfico
> (`profile_view`, `phone_click`, `whatsapp_click`) y no tiene nada que ver con una
> cartelera. De ahí el nombre `city-post`.

- **Autoría exclusiva del panel admin.** Ningún rol tiene `create`/`update`/`delete`:
  `src/index.js` solo concede `find`/`findOne`, y a los tres roles (Public,
  Authenticated y BusinessOwner), porque los permisos en Strapi no se heredan.
- **`postStatus`** (`draft` | `published` | `archived`) — lleva prefijo porque `status`
  es reservado en Strapi 5, igual que `businessStatus`. El controller fuerza
  `postStatus = 'published'` en `find` **sin condición de sesión**, a diferencia de
  `business.find` (que exime al usuario autenticado para que un dueño vea sus propias
  fichas en borrador): un `city-post` no tiene dueño, así que nadie lo lee en borrador
  por la API.
- **`endAt` nunca es nulo.** El lifecycle lo rellena si el admin lo deja vacío
  (`evento`/`cartel` → fin del día local de `startAt`; `aviso` → +30 días), para que
  toda la UI filtre la vigencia con UNA condición indexable (`endAt >= now`) y pegue
  con el índice parcial `idx_city_posts_cartelera`. La zona horaria se calcula con
  `Intl` y `BUSINESS_TIMEZONE`, no con el reloj del proceso — mismo motivo que
  `src/utils/is-open.js`: el servidor corre en UTC y un evento de un día se caería de
  la cartelera 6 horas antes.
- **El error de rango solo salta si el `endAt` inválido viene en el payload.** Si el
  `endAt` guardado quedó antes de un `startAt` nuevo, se recalcula en silencio: ese
  valor lo puso el propio lifecycle y hacer fallar "mover la fecha del aviso" no tiene
  arreglo obvio desde el panel.
- **Las relaciones inversas `business.events` y `city.cityPosts` son `private: true`.**
  No es un descuido: `?populate=events` esquiva el controller de `city-post` — el único
  que fuerza `postStatus = 'published'` — y expondría los borradores del municipio.
  Para leer la cartelera de un negocio:
  `/api/city-posts?filters[businesses][slug][$eq]=...`. En el panel admin siguen visibles.
- **`businesses` es manyToMany, no una sola sede.** Un evento puede llevar varios
  negocios (sede, organizadores, patrocinadores, los puestos que participan) y un negocio
  puede aparecer en varios eventos. El orden lo guarda `business_ord` en
  `city_posts_businesses_lnk`: **el primero se toma como la sede principal**. El campo
  siempre se escribe como array, aunque sea uno solo.
- **`venueName` + `venueAddress` en vez del componente `shared.address`**: ese exige
  `street` y un evento en la plaza principal no tiene calle ni número.
- Demo: `node scripts/seed-city-posts.js` (idempotente por slug; siembra también un
  borrador a propósito, para comprobar que la API pública no lo devuelve).

---

## Rol BusinessOwner
Rol personalizado creado manualmente en el panel: **Settings → Users & Permissions → Roles → BusinessOwner**

Permisos del rol:
- `business`: create, update, delete, find, findOne
- `business-hour`: create, update, delete, find, findOne
- `photo`: create, update, delete, find, findOne
- `social-link`: create, update, delete, find, findOne
- `claim`: create, find, findOne
- `review`: find, findOne

### Lifecycle hooks del modelo `claim`
Archivo: `src/api/claim/content-types/claim/lifecycles.js`

**`afterCreate`** — Se dispara cuando el usuario envía un claim (`POST /api/claims`):
- Hace `findOne` del claim con `business` populado (el `result` no incluye relaciones)
- Actualiza el negocio: `ownershipStatus = "pending_claim"`

**`beforeUpdate`** — Se dispara antes de guardar el claim:
- Si `claimStatus` cambia a `approved`, `rejected` o `cancelled`, asigna `reviewedAt = now` automáticamente

**`afterUpdate`** — Se dispara cuando el admin cambia `claimStatus` a `approved`:
- Hace `findOne` del claim con `user` y `business` populados
- Asigna el rol `BusinessOwner` al usuario del claim
- Actualiza el negocio: `owner = user`, `ownershipStatus = "claimed"`

> Nota: si el claim es rechazado (`claimStatus: "rejected"`) o cancelado, el negocio **no** revierte automáticamente a `"unclaimed"` — pendiente de implementar.

> Nota: el campo se llama `claimStatus` (no `status`) porque `status` es un nombre reservado en Strapi 5 para el sistema draft/publish del Document Service.

---

## Extensiones del plugin users-permissions
Archivo: `src/extensions/users-permissions/strapi-server.js`

### Endpoints personalizados agregados

**`POST /api/auth/register-owner`** — Registro con rol BusinessOwner
- Público (`auth: false`)
- Crea el usuario con `confirmed: false` y rol `BusinessOwner`
- Envía email de confirmación automáticamente via `userService.sendConfirmationEmail()`
- No devuelve JWT — el usuario debe confirmar email antes de poder hacer login
- Handler: `plugin.controllers.user.registerOwner`

**`POST /api/auth/register-customer`** — Registro exprés de comensal
- Público (`auth: false`)
- Campos: `displayName`, `phone`, `email`, `password`. Nada más se lee del body:
  mandar `role`, `confirmed`, `username` o `provider` no tiene efecto.
- Crea el usuario con rol `Authenticated`, **`confirmed: true`** y `emailVerified: false`
- **Devuelve JWT**: el comensal queda con sesión iniciada de inmediato. El registro
  ocurre a medio pedido; mandarlo a su bandeja de entrada antes de continuar mata la venta.
- El correo de confirmación se envía igual, pero como recordatorio, no como candado
  (fire-and-forget: si Resend falla, el registro sigue siendo válido)
- El teléfono se normaliza a E.164 (`+52` + 10 dígitos) con `src/utils/phone.js` y se
  guarda **también como `username`**, sin el `+`. Como `/auth/local` acepta email o
  username en `identifier`, el comensal puede entrar con su número de WhatsApp — su
  identidad real — si tecleó mal el correo.
- Handler: `plugin.controllers.user.registerCustomer`

> Contraste con `register-owner`: el dueño de negocio **sí** confirma correo antes de
> poder entrar (`confirmed: false`, sin JWT). Son dos niveles de fricción distintos a
> propósito: el comensal se registra a media compra, el restaurantero da de alta un
> negocio y puede esperar un correo.

**`GET /api/users/me`** — Sobrescrito para incluir el rol
- El `me` del plugin ignora `?populate`, así que `role` nunca llegaba al cliente.
- Se envuelve el handler original y se adjunta `role: { id, name, type }`.
- El frontend lo necesita para saber si la cuenta ya es de negocio (ver ascenso de rol).

**`PUT /api/users/me`** — Actualizar perfil propio
- Requiere JWT
- Solo permite actualizar: `displayName`, `phone`, `bio`, `avatar`
- Campos sensibles (`password`, `role`, `confirmed`, `blocked`) bloqueados
- Handler: `plugin.controllers.user.updateMe`

**`POST /api/auth/google`** — Alta e inicio de sesión con cuenta de Google
- Público (`auth: false`), con el mismo `rateLimit` que `/auth/local`
- Body: `{ idToken }`. Un solo campo, y es lo único que se lee.
- Devuelve `{ jwt, user }` — el usuario entra de inmediato. No se manda correo de
  confirmación: Google ya verificó la dirección, que es justo lo que ese correo comprueba.
- Handler: `plugin.controllers.user.loginWithGoogle`; verificación en `src/utils/google-auth.js`
- Env: `GOOGLE_CLIENT_IDS` (uno o varios separados por comas). **Vacío = el endpoint
  responde 400**; el frontend tampoco pinta el botón, así que la función simplemente no existe.

### Por qué NO se usa `/api/connect/google` (el flujo nativo de Strapi)
El flujo de `grant` que trae el plugin es una cadena de redirects entre el backend, Google y
el frontend. Eso **no sirve en la app Android**: Google bloquea OAuth dentro de un WebView
(`disallowed_useragent`) y desde `https://localhost` de Capacitor no hay a dónde volver.
Además, `grant` arma la URL de vuelta como `${callback}?${qs}` — siempre con `?`, nunca con
`&` (`node_modules/grant/lib/response.js`), así que el truco de pasar
`?callback=...&redirect=/destino` para conservar a dónde iba el usuario produce una URL rota.

Los dos clientes obtienen un `id_token` por su cuenta (web con Google Identity Services,
Android con `@capgo/capacitor-social-login`, que lo pide con el **mismo client id web**) y lo
mandan a este único endpoint. Un solo camino de verificación en el servidor.

### Vinculación con cuentas locales (decisión deliberada)
Si ya hay un usuario `provider: 'local'` con ese correo, **se entra a esa misma cuenta** en vez
de fallar con "Email is already taken" (que es lo que hace el `providers.connect` del plugin).
Reglas:
- Solo si Google reporta `email_verified: true`. Sin eso, cualquiera que registre
  `victima@dominio.com` en un Workspace sin verificar entraría a la cuenta de la víctima.
- **`provider` no se toca**: sigue siendo `local` y la contraseña sigue sirviendo, porque
  `/auth/local` filtra por `provider = 'local'` y cambiarlo dejaría al usuario sin su forma
  original de entrar.
- De paso pone `confirmed` y `emailVerified` en `true`: el dueño que nunca abrió el correo
  de confirmación queda desbloqueado, porque Google acaba de aportar la misma prueba.

La seguridad es equivalente al "olvidé mi contraseña", que también llega a ese buzón: quien
controla el correo ya podía entrar.

### Alta nueva por Google
- `provider: 'google'`, `confirmed: true`, `emailVerified: true`, sin contraseña.
- Rol **`Authenticated`** aunque venga a publicar un negocio: los roles son niveles
  acumulativos y el `afterCreate` de `business` lo asciende a `BusinessOwner` al publicar el primero.
- `username` se deriva del correo (`usernameDisponible()`) porque nadie lo escribe, y se
  desempata con un sufijo: `juan@gmail.com` y `juan@hotmail.com` chocarían.
- **`phone` queda vacío.** El alta por correo de comensal lo exige (y lo usa como `username`
  para poder entrar con el WhatsApp); por Google no hay de dónde sacarlo. Hoy nada lo
  consume en el frontend, pero tenerlo presente cuando lleguen los pedidos.
- Se crea con `strapi.db.query(...).create()`, no con `userService.add()`: no hay contraseña
  que hashear. El lifecycle `beforeCreate` de `src/index.js` ya contemplaba este caso.

### Sin migración
Este endpoint **no agrega columnas** (`provider`, `confirmed` y `emailVerified` ya existen), así
que no aplica la regla de `ALTER TABLE` para producción.

> En Strapi 5 el controller `auth` del plugin NO es extensible directamente.
> Todos los handlers personalizados deben agregarse a `plugin.controllers.user`.

---

## Email (Resend)
Paquete instalado: `strapi-provider-email-resend`
Configuración: `config/plugins.js`
Credenciales en `.env`: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`

- Se usa Resend (HTTPS API) porque **Railway bloquea todos los puertos SMTP salientes** (25/465/587). Gmail SMTP falla con `ETIMEDOUT` en producción aunque funcione en local.
- `RESEND_API_KEY` se genera en resend.com → API Keys (empieza con `re_`).
- `EMAIL_FROM` debe ser una dirección de un dominio verificado en Resend. Para pruebas iniciales sirve `onboarding@resend.dev` (solo llega a la cuenta del dueño del API key).
- El dominio se verifica en resend.com → Domains agregando 3 registros DNS (TXT, MX, CNAME).

### Flujos de email automáticos (requieren "Enable email confirmation" en el panel)
| Acción | Email enviado |
|--------|--------------|
| `POST /api/auth/local/register` | Confirmación de cuenta |
| `POST /api/auth/register-owner` | Confirmación de cuenta |
| `POST /api/auth/forgot-password` | Reset de contraseña |

Habilitar en panel: **Settings → Users & Permissions → Advanced Settings → Enable email confirmation**

---

## Roles: niveles acumulativos, no tipos excluyentes

```
Public  ⊂  Authenticated (comensal)  ⊂  BusinessOwner (restaurantero)
```

Un restaurantero también puede pedir en otros negocios, así que **no necesita una
segunda cuenta**. Ascender nunca quita permisos.

### Regla crítica de permisos
Los permisos en Strapi son **por rol y no se heredan**. Todo lo que el rol `Public`
puede leer tiene que estar también en `AUTHENTICATED_PERMISSIONS`, o la misma pantalla
que funciona sin sesión devuelve **403 al iniciar sesión**. Este bug estuvo latente
mucho tiempo sin verse porque `register-owner` daba `BusinessOwner` a todo el mundo
y ese rol sí tenía los permisos de lectura.

### Ascenso automático a BusinessOwner
`src/utils/roles.js` → `promoteToBusinessOwner(strapi, userId)`, idempotente. Se dispara en:

| Dónde | Cuándo |
|---|---|
| `src/api/business/content-types/business/lifecycles.js` → `afterCreate` | Un comensal publica su primer negocio |
| `src/api/claim/content-types/claim/lifecycles.js` → `afterUpdate` | El admin aprueba un claim |

> El ascenso en `afterCreate` **debe ser `await`**, no `setImmediate`: el frontend
> dispara la creación de horarios inmediatamente después de esa respuesta y esa ruta
> ya exige el rol nuevo. El JWT no guarda el rol — se resuelve contra la base en cada
> request — así que el ascenso surte efecto con el mismo token, sin re-login.

## Permisos del rol Authenticated (bootstrap automático)
Configurados en `src/index.js` via `setRolePermissions`. Además de las lecturas en
paridad con `Public`, incluye `api::business.business: create` — un comensal puede
publicar su propio negocio y el lifecycle lo asciende en ese momento.

---

## Reglas críticas para crear usuarios programáticamente en Strapi 5

Estas reglas se descubrieron depurando el endpoint `register-owner`. Violarlas rompe el login.

### 1. NO pre-hashear la contraseña
El Document Service (`strapi.documents().create()`) hashea automáticamente los campos de tipo `password` usando `bcrypt.hashSync()`.
Código fuente: `@strapi/core/dist/services/document-service/attributes/transforms.js`

```js
// ✅ Correcto — Document Service hashea solo
userService.add({ password: 'plaintext' });

// ❌ Incorrecto — causa doble hash, login siempre falla
const hashed = await userService.hashPassword({ password });
userService.add({ password: hashed });
```

### 2. Siempre incluir `provider: 'local'`
El login filtra con `WHERE provider = 'local'`. Sin este campo el usuario no se encuentra.

```js
// ✅ Correcto
userService.add({ provider: 'local', ... });
```

### 3. Siempre lowercase el email
El login busca con `email.toLowerCase()`. Guardar el email con mayúsculas impide encontrarlo en PostgreSQL.

```js
// ✅ Correcto
userService.add({ email: email.toLowerCase(), ... });
```

### 4. `userService.add()` usa el Document Service internamente
```js
// Strapi 5 — fuente: plugin-users-permissions/server/services/user.js
async add(values) {
  return strapi.documents(USER_MODEL_UID).create({ data: values, populate: ['role'] });
}
```

### 5. Orden de validaciones en el login (`POST /api/auth/local`)
```
1. Usuario no encontrado por provider+email/username → "Invalid identifier or password"
2. Usuario sin password en DB                        → "Invalid identifier or password"
3. Password no coincide (bcrypt.compare falla)       → "Invalid identifier or password"
4. confirmed=false y email_confirmation habilitado   → "Your account email is not confirmed"
```
Si el error es "Invalid identifier or password", el problema es 1, 2 o 3 — NO confirmación de email.

### 6. `strapi.db.query()` sí retorna el campo `password`
Aunque `password` es `private: true`, la capa de DB devuelve todos los campos incluyendo el hash.

### 7. En el Document Service se acota con `limit`, no con `pagination`
`strapi.documents(uid).findMany({ pagination: { pageSize: 3 } })` **ignora la opción en
silencio y devuelve todo** (440 negocios en local, no 3). La opción válida es `limit` (y
`start`). Ya mordió dos veces: hay una nota igual en `scripts/generate-claim-links.js:206`.
Pasa desapercibido porque el script sigue funcionando — solo trae de más.

---

## Pendiente
- Verificar que `hasPassword=true` en logs de `register-owner` para confirmar que el password se almacena correctamente.
