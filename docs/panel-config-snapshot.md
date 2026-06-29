# Snapshot de configuración del panel Strapi

**Fecha**: 2026-07-01
**Propósito**: Congelar el estado de la configuración manual del panel de Strapi antes del rebuild de la BD. Esta config no está en código; se pierde al hacer DROP DATABASE.
**Fuente**: Consultas directas a la BD `mandaditoz` (tablas `up_roles`, `up_permissions`, `up_users`).

---

## Roles definidos

| ID | Nombre | Type | Descripción |
|----|--------|------|-------------|
| 1 | Authenticated | `authenticated` | Default role given to authenticated user |
| 2 | Public | `public` | Default role given to unauthenticated user |
| 3 | BusinessOwner | `businessowner` | Rol al cual el dueño del negocio se puede registrar |

---

## Permisos por rol

### Rol `Public` (22 permisos)

**API públicas (find/findOne sin auth):**
- `api::business.business.find`
- `api::business.business.findOne`
- `api::business-hour.business-hour.find`
- `api::business-hour.business-hour.findOne`
- `api::category.category.find`
- `api::category.category.findOne`
- `api::photo.photo.find`
- `api::photo.photo.findOne`
- `api::review.review.find`
- `api::review.review.findOne`
- `api::social-link.social-link.find`
- `api::social-link.social-link.findOne`

**Users-permissions plugin (auth):**
- `plugin::users-permissions.auth.callback`
- `plugin::users-permissions.auth.connect`
- `plugin::users-permissions.auth.emailConfirmation`
- `plugin::users-permissions.auth.forgotPassword`
- `plugin::users-permissions.auth.refresh`
- `plugin::users-permissions.auth.register`
- `plugin::users-permissions.auth.resetPassword`
- `plugin::users-permissions.auth.sendEmailConfirmation`
- `plugin::users-permissions.user.create`
- `plugin::users-permissions.user.me`

### Rol `Authenticated` (9 permisos)

- `api::business.business.delete`
- `api::business.business.update`
- `api::claim.claim.create`
- `api::claim.claim.find`
- `api::claim.claim.findOne`
- `plugin::users-permissions.auth.changePassword`
- `plugin::users-permissions.auth.logout`
- `plugin::users-permissions.user.me`
- `plugin::users-permissions.user.updateMe`

### Rol `BusinessOwner` (19 permisos)

**Business:**
- `api::business.business.create`
- `api::business.business.find`
- `api::business.business.findOne`
- `api::business.business.update`
> ⚠️ Falta `api::business.business.delete` (según CLAUDE.md era pendiente).

**Business Hours:**
- `api::business-hour.business-hour.create`
- `api::business-hour.business-hour.delete`
- `api::business-hour.business-hour.find`
- `api::business-hour.business-hour.findOne`
- `api::business-hour.business-hour.update`

**Photos:**
- `api::photo.photo.create`
- `api::photo.photo.delete`
- `api::photo.photo.find`
- `api::photo.photo.findOne`
- `api::photo.photo.update`

**Claims:**
- `api::claim.claim.create`
- `api::claim.claim.find`
- `api::claim.claim.findOne`

**Reviews:**
- `api::review.review.find`
- `api::review.review.findOne`

> ⚠️ En CLAUDE.md se lista también `social-link` CRUD para BusinessOwner, pero no aparece en DB — pendiente verificar si es necesario habilitarlo.

---

## Email confirmation

- **Habilitado en Advanced Settings**: sí (evidencia indirecta: usuario existente tiene `confirmed=true`, hay endpoints `emailConfirmation` en permisos Public)
- **Provider**: Gmail SMTP vía `@strapi/provider-email-nodemailer`
- **Credenciales**: `SMTP_USER=mandaditozapp@gmail.com` (en `.env`)
- **App Password de Google**: 16 chars en `SMTP_PASS`

---

## Usuarios existentes

| Username | Email | Confirmed | Blocked | Provider |
|----------|-------|-----------|---------|----------|
| Daniel | sotib82566@doefy.com | ✅ | ❌ | local |

**1 usuario total** (usuario de prueba, no admin de panel).

---

## Datos en BD (para dimensionar el re-seed)

| Colección | Filas actuales |
|-----------|----------------|
| `businesses` | 333 |
| `categories` | 50 |
| `business_hours` | 2203 |
| `reviews` | 0 |
| `up_users` | 1 |

---

## Recreación programática post-rebuild

Todo lo anterior debe recrearse en `src/index.js` (bootstrap) tras el DROP + CREATE. Estado deseado:

### En bootstrap automático (`src/index.js`)

1. **Aplicar permisos Public** — ya existe la función `setRolePermissions` (verificar que cubre los 12 endpoints de API + 10 de auth)
2. **Aplicar permisos Authenticated** — actualmente solo `updateMe`; ampliar a los 9 actuales
3. **Crear rol BusinessOwner** si no existe (nuevo — actualmente se hace manual en panel)
4. **Aplicar permisos BusinessOwner** — 19 permisos + agregar los pendientes (`business.delete`, `social-link.*`)
5. **Habilitar email confirmation** vía servicio users-permissions

### Habilitar en panel manualmente (si no se automatiza)

- Settings → Users & Permissions → Advanced Settings → **Enable email confirmation** ✅
- Settings → Roles → BusinessOwner (crear si falta) → permisos según lista arriba
- Al menos 1 usuario admin del panel de Strapi (super admin) — no está en `up_users`, está en tabla `admin_users`

---

## Pendientes documentados en CLAUDE.md

- Habilitar permiso `create` en `business` para `BusinessOwner` — **✅ ya habilitado en DB**
- Habilitar `delete` en `business` para `BusinessOwner` — **❌ pendiente**
- Habilitar CRUD de `social-link` para `BusinessOwner` — **❌ pendiente**
- Revertir `ownershipStatus` a `unclaimed` cuando claim es rechazado — pendiente lifecycle

---

## Referencia rápida para restaurar en emergencia

Si el rebuild falla y hay que restaurar:

```bash
docker exec -i mandaditoz-postgres psql -U root -d postgres -c "DROP DATABASE mandaditoz;"
docker exec -i mandaditoz-postgres psql -U root -d postgres -c "CREATE DATABASE mandaditoz OWNER root;"
docker exec -i mandaditoz-postgres psql -U root -d mandaditoz < backups/mandaditoz_pre_rebuild_2026-07-01_2140.sql
```
