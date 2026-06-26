# Mandaditoz API — Documentación

**Base URL:** `http://localhost:1337/api`  
**Autenticación:** Bearer JWT en header `Authorization: Bearer <token>`

---

## Índice

- [Autenticación](#autenticación)
- [Usuario](#usuario)
- [Negocios](#negocios)
- [Categorías](#categorías)
- [Reseñas](#reseñas)
- [Claims](#claims)
- [Fotos](#fotos)
- [Horarios](#horarios)
- [Redes Sociales](#redes-sociales)
- [Reportes](#reportes)

---

## Autenticación

### `POST /auth/local/register`
Registro de usuario estándar. El rol asignado es `Authenticated`.

**Body:**
```json
{
  "username": "juanperez",
  "email": "juan@example.com",
  "password": "Secret123!"
}
```

**Response `200`:**
```json
{
  "jwt": "eyJhbGci...",
  "user": {
    "id": 1,
    "username": "juanperez",
    "email": "juan@example.com",
    "confirmed": false,
    "blocked": false
  }
}
```

**Errores:**
| Código | Motivo |
|--------|--------|
| `400` | Email o username ya registrado |
| `400` | Campos requeridos faltantes |

---

### `POST /auth/register-owner`
Registro de usuario con rol `BusinessOwner` asignado directamente. El usuario queda `confirmed: true`.

**Body:**
```json
{
  "username": "juanperez",
  "email": "juan@example.com",
  "password": "Secret123!",
  "displayName": "Juan Pérez",
  "phone": "+523312345678"
}
```
> `displayName` y `phone` son opcionales.

**Response `200`:**
```json
{
  "jwt": "eyJhbGci...",
  "user": {
    "id": 2,
    "username": "juanperez",
    "email": "juan@example.com",
    "displayName": "Juan Pérez",
    "phone": "+523312345678",
    "confirmed": true,
    "blocked": false,
    "role": {
      "id": 3,
      "name": "BusinessOwner",
      "type": "businessowner"
    }
  }
}
```

**Errores:**
| Código | Motivo |
|--------|--------|
| `400` | username, email o password faltantes |
| `400` | Email ya registrado |
| `500` | Rol BusinessOwner no existe en el panel |

---

### `POST /auth/local`
Login con email o username.

**Body:**
```json
{
  "identifier": "juan@example.com",
  "password": "Secret123!"
}
```
> `identifier` acepta email o username.

**Response `200`:**
```json
{
  "jwt": "eyJhbGci...",
  "user": {
    "id": 1,
    "username": "juanperez",
    "email": "juan@example.com",
    "confirmed": true,
    "blocked": false
  }
}
```

**Errores:**
| Código | Motivo |
|--------|--------|
| `400` | Credenciales incorrectas |
| `400` | Usuario bloqueado |

---

### `POST /auth/forgot-password`
Envía email con enlace para restablecer contraseña.

**Body:**
```json
{
  "email": "juan@example.com"
}
```

**Response `200`:**
```json
{
  "ok": true
}
```

---

### `POST /auth/reset-password`
Restablece la contraseña con el token recibido por email.

**Body:**
```json
{
  "code": "TOKEN_DEL_EMAIL",
  "password": "NuevaPassword123!",
  "passwordConfirmation": "NuevaPassword123!"
}
```

**Response `200`:**
```json
{
  "jwt": "eyJhbGci...",
  "user": { ... }
}
```

---

### `POST /auth/change-password`
Cambia la contraseña del usuario autenticado. 🔒 Requiere JWT.

**Body:**
```json
{
  "currentPassword": "Secret123!",
  "password": "NuevaPassword123!",
  "passwordConfirmation": "NuevaPassword123!"
}
```

**Response `200`:**
```json
{
  "jwt": "eyJhbGci...",
  "user": { ... }
}
```

---

## Usuario

### `GET /users/me`
Retorna el perfil del usuario autenticado. 🔒 Requiere JWT.

**Response `200`:**
```json
{
  "id": 1,
  "username": "juanperez",
  "email": "juan@example.com",
  "displayName": "Juan Pérez",
  "phone": "+523312345678",
  "bio": "Empresario en Etzatlán",
  "emailVerified": false,
  "confirmed": true,
  "blocked": false,
  "avatar": {
    "id": 5,
    "url": "/uploads/avatar_abc123.jpg"
  }
}
```

---

### `PUT /users/me`
Actualiza el perfil del usuario autenticado. 🔒 Requiere JWT.

Solo se permiten los campos: `displayName`, `phone`, `bio`, `avatar`.

**Body:**
```json
{
  "displayName": "Juan Pérez",
  "phone": "+523312345678",
  "bio": "Dueño de negocios en Etzatlán",
  "avatar": 5
}
```
> `avatar` es el ID del archivo subido previamente via `POST /upload`.

**Response `200`:**
```json
{
  "id": 1,
  "username": "juanperez",
  "email": "juan@example.com",
  "displayName": "Juan Pérez",
  "phone": "+523312345678",
  "bio": "Dueño de negocios en Etzatlán",
  "avatar": {
    "id": 5,
    "url": "/uploads/avatar_abc123.jpg"
  },
  "role": {
    "id": 3,
    "name": "BusinessOwner"
  }
}
```

---

### `POST /upload`
Sube un archivo (imagen). 🔒 Requiere JWT.

**Body:** `multipart/form-data`
```
files: <archivo>
```

**Response `200`:**
```json
[
  {
    "id": 5,
    "name": "avatar.jpg",
    "url": "/uploads/avatar_abc123.jpg",
    "mime": "image/jpeg",
    "size": 48.3
  }
]
```

---

## Negocios

### `GET /businesses`
Lista todos los negocios publicados. Público.

**Query params:**
| Param | Ejemplo | Descripción |
|-------|---------|-------------|
| `pagination[page]` | `1` | Página actual |
| `pagination[pageSize]` | `25` | Resultados por página (máx 100) |
| `filters[category][id][$eq]` | `3` | Filtrar por categoría |
| `filters[status][$eq]` | `published` | Filtrar por estado |
| `populate` | `category,logo` | Relaciones a incluir |
| `sort` | `name:asc` | Ordenamiento |

**Response `200`:**
```json
{
  "data": [
    {
      "id": 1,
      "documentId": "abc123",
      "name": "Taquería El Güero",
      "slug": "taqueria-el-guero",
      "shortDescription": "Los mejores tacos de Etzatlán",
      "status": "published",
      "ownershipStatus": "claimed",
      "ratingAverage": 4.5,
      "ratingCount": 12,
      "viewCount": 340,
      "isFeatured": false,
      "address": {
        "street": "Av. Hidalgo",
        "exteriorNumber": "45",
        "city": "Etzatlán",
        "state": "Jalisco",
        "zip": "46500"
      }
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "pageCount": 4,
      "total": 98
    }
  }
}
```

---

### `GET /businesses/:documentId`
Retorna un negocio por su `documentId`. Público.

**Response `200`:**
```json
{
  "data": {
    "id": 1,
    "documentId": "abc123",
    "name": "Taquería El Güero",
    "slug": "taqueria-el-guero",
    "shortDescription": "Los mejores tacos de Etzatlán",
    "description": "<p>Descripción larga...</p>",
    "phone": "+523312345678",
    "whatsapp": "+523312345678",
    "email": "taqueria@example.com",
    "website": "https://taqueria.com",
    "status": "published",
    "ownershipStatus": "claimed",
    "isVerified": true,
    "isFeatured": false,
    "ratingAverage": 4.5,
    "ratingCount": 12,
    "viewCount": 340,
    "lat": 20.7639,
    "lng": -104.0603,
    "address": {
      "street": "Av. Hidalgo",
      "exteriorNumber": "45",
      "city": "Etzatlán",
      "state": "Jalisco",
      "zip": "46500"
    },
    "category": { "id": 2, "name": "Restaurantes" },
    "logo": { "id": 3, "url": "/uploads/logo.jpg" },
    "coverPhoto": { "id": 4, "url": "/uploads/cover.jpg" }
  }
}
```

---

### `POST /businesses`
Crea un nuevo negocio. 🔒 Requiere JWT. El `owner` se asigna automáticamente.

**Body:**
```json
{
  "data": {
    "name": "Taquería El Güero",
    "shortDescription": "Los mejores tacos de Etzatlán",
    "description": "<p>Descripción larga...</p>",
    "phone": "+523312345678",
    "whatsapp": "+523312345678",
    "email": "taqueria@example.com",
    "website": "https://taqueria.com",
    "category": 2,
    "address": {
      "street": "Av. Hidalgo",
      "exteriorNumber": "45",
      "city": "Etzatlán",
      "state": "Jalisco",
      "zip": "46500"
    },
    "lat": 20.7639,
    "lng": -104.0603
  }
}
```

**Response `201`:**
```json
{
  "data": {
    "id": 10,
    "documentId": "xyz789",
    "name": "Taquería El Güero",
    "slug": "taqueria-el-guero",
    "status": "draft",
    "ownershipStatus": "unclaimed"
  }
}
```

---

### `PUT /businesses/:documentId`
Actualiza un negocio. 🔒 Requiere JWT. Solo el dueño puede editar.

**Body:**
```json
{
  "data": {
    "name": "Taquería El Güero (Nuevo nombre)",
    "phone": "+523398765432",
    "shortDescription": "Nueva descripción corta"
  }
}
```

**Response `200`:** retorna el negocio actualizado.

**Errores:**
| Código | Motivo |
|--------|--------|
| `401` | No autenticado |
| `403` | No es el dueño del negocio |
| `404` | Negocio no encontrado |

---

### `DELETE /businesses/:documentId`
Elimina un negocio. 🔒 Requiere JWT. Solo el dueño puede eliminar.

**Response `200`:** retorna el negocio eliminado.

**Errores:**
| Código | Motivo |
|--------|--------|
| `403` | No es el dueño del negocio |

---

## Categorías

### `GET /categories`
Lista todas las categorías activas. Público.

**Response `200`:**
```json
{
  "data": [
    {
      "id": 1,
      "documentId": "cat001",
      "name": "Restaurantes",
      "slug": "restaurantes",
      "description": "Lugares para comer",
      "icon": "utensils",
      "color": "#FF5733",
      "order": 1,
      "isActive": true,
      "parent": null
    }
  ]
}
```

---

### `GET /categories/:documentId`
Retorna una categoría. Público.

---

## Reseñas

### `GET /reviews`
Lista reseñas. Público.

**Query params útiles:**
| Param | Ejemplo |
|-------|---------|
| `filters[business][documentId][$eq]` | `abc123` |
| `filters[status][$eq]` | `published` |
| `populate` | `author,photos` |

---

### `POST /reviews`
Crea una reseña. 🔒 Requiere JWT.

**Body:**
```json
{
  "data": {
    "business": "abc123",
    "rating": 5,
    "title": "Excelente servicio",
    "comment": "La comida estuvo deliciosa y el servicio fue muy amable.",
    "visitDate": "2026-06-15"
  }
}
```
> `rating`: 1 a 5. `comment`: 10 a 1500 caracteres. `title` y `visitDate` opcionales.

**Response `201`:**
```json
{
  "data": {
    "id": 20,
    "documentId": "rev001",
    "rating": 5,
    "title": "Excelente servicio",
    "comment": "La comida estuvo deliciosa...",
    "status": "published"
  }
}
```

---

## Claims

### `POST /claims`
Solicita la propiedad de un negocio. 🔒 Requiere JWT.

**Body:**
```json
{
  "data": {
    "business": "abc123",
    "claimantName": "Juan Pérez",
    "claimantRole": "owner",
    "claimantPhone": "+523312345678",
    "notes": "Soy el dueño desde 2015"
  }
}
```
> `claimantRole`: `owner` | `manager` | `employee` | `other`

**Response `201`:**
```json
{
  "data": {
    "id": 5,
    "documentId": "clm001",
    "claimantName": "Juan Pérez",
    "claimantRole": "owner",
    "status": "pending"
  }
}
```

> Cuando el admin aprueba el claim (`status: approved`), el sistema automáticamente:
> - Asigna el rol `BusinessOwner` al usuario
> - Vincula al usuario como `owner` del negocio
> - Cambia `ownershipStatus` a `claimed`

---

## Fotos

### `GET /photos`
Lista fotos. Público.

**Query params útiles:**
| Param | Ejemplo |
|-------|---------|
| `filters[business][documentId][$eq]` | `abc123` |
| `filters[isApproved][$eq]` | `true` |
| `populate` | `file,uploadedBy` |

---

### `POST /photos`
Sube una foto a un negocio. 🔒 Requiere JWT.

Primero sube el archivo via `POST /upload`, luego registra la foto:

**Body:**
```json
{
  "data": {
    "business": "abc123",
    "file": 7,
    "caption": "Interior del local",
    "order": 1
  }
}
```

**Response `201`:**
```json
{
  "data": {
    "id": 15,
    "documentId": "pht001",
    "caption": "Interior del local",
    "order": 1,
    "isApproved": false
  }
}
```

---

## Horarios

### `GET /business-hours`
Lista horarios. Público.

**Query params útiles:**
| Param | Ejemplo |
|-------|---------|
| `filters[business][documentId][$eq]` | `abc123` |

---

### `POST /business-hours`
Crea un horario. 🔒 Requiere JWT.

**Body:**
```json
{
  "data": {
    "business": "abc123",
    "dayOfWeek": "mon",
    "openTime": "09:00",
    "closeTime": "21:00",
    "isClosed": false,
    "is24Hours": false
  }
}
```
> `dayOfWeek`: `mon` | `tue` | `wed` | `thu` | `fri` | `sat` | `sun`

---

## Redes Sociales

### `POST /social-links`
Agrega una red social a un negocio. 🔒 Requiere JWT.

**Body:**
```json
{
  "data": {
    "business": "abc123",
    "platform": "instagram",
    "url": "https://instagram.com/taqueria_elguero"
  }
}
```
> `platform`: `facebook` | `instagram` | `tiktok` | `twitter` | `youtube` | `linkedin`

---

## Reportes

### `POST /reports`
Reporta contenido inapropiado. 🔒 Requiere JWT.

**Body:**
```json
{
  "data": {
    "targetType": "review",
    "targetId": "rev001",
    "reason": "offensive",
    "details": "Contiene lenguaje inapropiado"
  }
}
```
> `targetType`: `business` | `review` | `photo`  
> `reason`: `spam` | `offensive` | `fake` | `inappropriate` | `other`

**Response `201`:**
```json
{
  "data": {
    "id": 3,
    "documentId": "rpt001",
    "targetType": "review",
    "reason": "offensive",
    "status": "pending"
  }
}
```

---

## Estados y enums de referencia

### Business `status`
| Valor | Descripción |
|-------|-------------|
| `draft` | Borrador (default al crear) |
| `published` | Visible públicamente |
| `pending_review` | En revisión por admin |
| `suspended` | Suspendido |

### Business `ownershipStatus`
| Valor | Descripción |
|-------|-------------|
| `unclaimed` | Sin dueño reclamado |
| `pending_claim` | Claim en revisión |
| `claimed` | Dueño verificado |

### Review `status`
| Valor | Descripción |
|-------|-------------|
| `published` | Visible |
| `pending` | En revisión |
| `hidden` | Oculta |
| `removed` | Eliminada |

### Claim `status`
| Valor | Descripción |
|-------|-------------|
| `pending` | Esperando revisión |
| `approved` | Aprobado (activa el rol BusinessOwner) |
| `rejected` | Rechazado |
| `cancelled` | Cancelado por el usuario |
