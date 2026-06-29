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
- `emailVerified` (boolean, default false)
- `lastLoginAt` (datetime)

Relaciones del usuario:
- `ownedBusinesses` → oneToMany → `business`
- `reviews` → oneToMany → `review`
- `claims` → oneToMany → `claim`
- `reports` → oneToMany → `report`
- `uploadedPhotos` → oneToMany → `photo`

---

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

**`PUT /api/users/me`** — Actualizar perfil propio
- Requiere JWT
- Solo permite actualizar: `displayName`, `phone`, `bio`, `avatar`
- Campos sensibles (`password`, `role`, `confirmed`, `blocked`) bloqueados
- Handler: `plugin.controllers.user.updateMe`

> En Strapi 5 el controller `auth` del plugin NO es extensible directamente.
> Todos los handlers personalizados deben agregarse a `plugin.controllers.user`.

---

## Email (Gmail SMTP)
Paquete instalado: `@strapi/provider-email-nodemailer`
Configuración: `config/plugins.js`
Credenciales en `.env`: `SMTP_USER`, `SMTP_PASS`

- `SMTP_PASS` es un **App Password de Google** (16 caracteres), NO la contraseña de Gmail
- Se genera en: Google Account → Security → 2-Step Verification → App Passwords

### Flujos de email automáticos (requieren "Enable email confirmation" en el panel)
| Acción | Email enviado |
|--------|--------------|
| `POST /api/auth/local/register` | Confirmación de cuenta |
| `POST /api/auth/register-owner` | Confirmación de cuenta |
| `POST /api/auth/forgot-password` | Reset de contraseña |

Habilitar en panel: **Settings → Users & Permissions → Advanced Settings → Enable email confirmation**

---

## Permisos del rol Authenticated (bootstrap automático)
Configurados en `src/index.js` via `setRolePermissions`:
- `plugin::users-permissions.user`: `updateMe`

---

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
- Habilitar permiso `create` en `business` para el rol `BusinessOwner` en el panel de Strapi (Settings → Roles → BusinessOwner → Business → create).
- Verificar que `hasPassword=true` en logs de `register-owner` para confirmar que el password se almacena correctamente.
