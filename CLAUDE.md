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

## Componentes reutilizables
- `shared.address` — dirección con 32 estados mexicanos
- `shared.seo` — metaTitle, metaDescription, keywords, ogImage
- `business.response` — respuesta del dueño a una reseña

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

## Pedidos (Fase 4)

### Reglas que no se negocian

1. **El precio nunca viene del cliente.** `src/api/order/services/order-pricing.js`
   relee los `menu-item` de la base y arma el total. El body solo aporta QUÉ y CUÁNTOS.
2. **Todo el dinero en centavos enteros.** El `decimal` de Strapi es `double precision`:
   89.90 × 3 en flotante da 269.70000000000005.
3. **Las líneas son un snapshot, no una relación.** Componente `order.line` con el nombre
   y el precio del momento. Si el negocio sube el precio o borra el platillo, el pedido
   histórico no cambia.
4. **`orderStatus`, nunca `status`** (reservado en Strapi 5).
5. **Para pedir hay que tener cuenta.** `POST /orders` exige `ctx.state.user`; el rol
   `Public` no tiene ninguna acción de `order`.

### Rutas

| Ruta | Quién | Nota |
|---|---|---|
| `POST /orders` | comensal con sesión | valida negocio, horario, mínimo, modalidad y disponibilidad |
| `GET /orders` | comensal | solo los suyos; **no usa `super.find`** (ver abajo) |
| `GET /orders/:id` | comensal dueño del pedido, o dueño del negocio | 404 si no, nunca 403 |
| `GET /orders/business/:documentId` | dueño del negocio | panel del día |
| `POST /orders/:id/cancel` | comensal | solo en `new` y dentro de 20 min |
| `POST /orders/:id/status` | dueño con sesión | panel |
| `GET /orders/token/:token` | **sin sesión** | link mágico |
| `POST /orders/token/:token/status` | **sin sesión** | aceptar / rechazar / listo / entregado |

`update` y `delete` **no existen**: el core router usa `only: ['find','findOne','create']`.
Un PUT genérico dejaría al comensal cambiarse el total. Un pedido no se borra, se cancela.

### El link mágico

`ownerToken` = 32 bytes base64url, `private: true` (nunca sale en una respuesta).
Vence a las 24 h **o** al llegar a un estado terminal, lo que ocurra primero. Las rutas
por token llevan `global::rate-limit-submit` con bucket propio.

### Trampas descubiertas construyendo esto

**`select` vs `fields`.** La API de documentos y la content-API usan `fields`; `select` es
del query engine (`strapi.db.query`). Mezclarlos devuelve `Campo inválido: "select at business"`.

**No reasignar `ctx.query` entero.** El setter de Koa serializa el objeto a query string y
aplasta los filtros anidados: el endpoint devuelve lista vacía **sin error**. Mutar
`ctx.query.filters` en su lugar, como hace `business.js`.

**No se puede filtrar por `customer` en la content-API.** Strapi bloquea filtros y populate
sobre relaciones a `plugin::users-permissions.user` → `Campo inválido: "customer"`. Por eso
`find` está armado con el query engine en vez de `super.find`.

**El horario se calcula con zona horaria explícita.** `src/utils/is-open.js` usa
`America/Mexico_City` vía `Intl`, no el reloj del proceso. Railway corre en UTC: copiar el
`computeIsOpen` del frontend rechazaría pedidos ~6 h al día, justo en la franja de la cena.

**`created_at` es `timestamp without time zone` y Strapi guarda hora local.** El `NOW()` de
Postgres devuelve UTC. Ida y vuelta por Strapi es simétrico, así que la app funciona — pero
**SQL crudo contra fechas de pedidos está 6 h desfasado**. Para envejecer un registro en
pruebas: `created_at = created_at - INTERVAL '15 minutes'`, nunca `NOW() - INTERVAL ...`.

**Borrar pedidos por SQL crudo deja líneas huérfanas** en `components_order_lines`: la
cascada de Strapi vive en `orders_cmps`, no en la tabla del componente.

### Correos y recordatorio

`src/api/order/services/order-notify.js`. Todo con `setImmediate` + `try/catch`: cuando se
llama, **el pedido ya está guardado**. Si Resend falla se pierde el aviso, nunca el pedido;
`notifiedAt` queda en `null` para poder detectarlo.

El cron `remindPendingOrders` (cada 5 min) levanta los pedidos en `new` con más de 10 min.
`reminderSentAt` se marca en un `finally`, **salga o no el correo**: significa "ya se
intentó una vez". Si solo se marcara al tener éxito, un proveedor caído dejaría al cron
reintentando los mismos pedidos para siempre.

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

---

## Pendiente
- Verificar que `hasPassword=true` en logs de `register-owner` para confirmar que el password se almacena correctamente.
