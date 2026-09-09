-- =============================================================================
-- Mandaditoz — Backfill del cupo de negocios publicados
-- =============================================================================
-- `published_business_limit` se agregó al usuario después de que ya existían
-- filas, y esas quedaron en NULL: Strapi declara el default en el schema JSON
-- (lo aplica el Document Service al crear un usuario), pero NO lo escribe como
-- DEFAULT de la columna, así que el ADD COLUMN no rellenó nada.
--
-- Esto no cambia comportamiento — src/utils/publish-limit.js ya trata NULL
-- como 3. Es para que el admin vea el 3 explícito en Content Manager en vez de
-- un campo en blanco que se lee como "sin cupo".
--
-- Solo toca los NULL a propósito: un usuario al que ya se le amplió el cupo a
-- mano conserva su número. Este script nunca baja a nadie.
--
-- NO intentes fijar el default en la columna desde aquí (ALTER COLUMN ... SET
-- DEFAULT). Se probó: Strapi corre las migraciones ANTES de sincronizar el
-- esquema, y el sync recrea la columna y se lleva el default por delante — la
-- sentencia se ejecuta sin error y aun así el default queda vacío. La única
-- garantía real de que NULL signifique 3 es el fallback en código.
-- =============================================================================

UPDATE up_users
   SET published_business_limit = 3
 WHERE published_business_limit IS NULL;
