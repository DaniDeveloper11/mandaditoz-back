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
| `status` | `draft`, `published`, `pending_review`, `suspended` | `draft` |
| `ownershipStatus` | `unclaimed`, `pending_claim`, `claimed` | `unclaimed` |

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

### Asignación automática del rol
Archivo: `src/api/claim/content-types/claim/lifecycles.js`

Lifecycle hook `afterUpdate` en el modelo `claim`:
- Se dispara cuando el admin cambia `status` a `approved`
- Asigna el rol `BusinessOwner` al usuario del claim
- Actualiza el negocio: `owner = user`, `ownershipStatus = "claimed"`

## Pendiente
- Habilitar permiso `create` en `business` para el rol `BusinessOwner` en el panel de Strapi (Settings → Roles → BusinessOwner → Business → create).
