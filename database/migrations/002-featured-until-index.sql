-- =============================================================================
-- Mandaditoz — Índice para la nueva semántica de destacados
-- =============================================================================
-- Un negocio sale destacado si is_featured = true (decisión permanente del
-- admin) O si featured_until sigue en el futuro (promoción temporal). La
-- segunda rama consulta filas con is_featured = false, que el índice parcial
-- idx_businesses_featured_active (WHERE is_featured = true) no puede cubrir.
--
-- idx_businesses_featured_active se CONSERVA: sigue sirviendo a la rama del flag.
--
-- Idempotente (IF NOT EXISTS), igual que 001-indexes.sql.
-- Sin CONCURRENTLY a propósito: Strapi corre cada migración dentro de una
-- transacción y Postgres prohíbe CREATE INDEX CONCURRENTLY dentro de una.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_businesses_featured_until
  ON businesses(featured_until)
  WHERE featured_until IS NOT NULL;
