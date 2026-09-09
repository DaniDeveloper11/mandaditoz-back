-- =============================================================================
-- Mandaditoz — Cupo de negocios publicados por dueño
-- =============================================================================
-- Agrega `published_business_limit` a los usuarios y rellena a los que ya
-- existían. Ver src/utils/publish-limit.js y la sección "Cuántos negocios puede
-- tener un dueño" en CLAUDE.md.
--
-- POR QUÉ ESTA MIGRACIÓN TIENE QUE CREAR LA COLUMNA (y no solo rellenarla):
-- con NODE_ENV=production, `strapi start` NO aplica cambios de esquema — no
-- crea columnas nuevas, y aun así reescribe el esquema persistido como si
-- estuviera al día, así que tampoco lo hará en arranques posteriores. En
-- `develop` sí sincroniza, que es lo que enmascara el problema durante el
-- desarrollo. Declarar el campo en el schema JSON basta en local y NO basta en
-- prod: sin este ALTER, la columna no aparece nunca.
--
-- Las migraciones internas corren DENTRO del sync y antes de cualquier cambio
-- de esquema, así que este archivo es autosuficiente a propósito: crea la
-- columna y la rellena en la misma pasada, sin depender de Strapi.
--
-- Idempotente en los dos entornos: en develop Strapi pudo haber creado ya la
-- columna (IF NOT EXISTS la respeta) y el UPDATE solo toca los NULL.
-- =============================================================================

ALTER TABLE up_users
  ADD COLUMN IF NOT EXISTS published_business_limit INTEGER;

-- Los usuarios que ya existían quedan con el cupo por defecto explícito, para
-- que en Content Manager se vea el número en vez de un campo en blanco que se
-- lee como "sin cupo". Solo toca los NULL: a quien ya se le amplió el cupo a
-- mano conserva su número — esto nunca baja a nadie.
UPDATE up_users
   SET published_business_limit = 3
 WHERE published_business_limit IS NULL;
