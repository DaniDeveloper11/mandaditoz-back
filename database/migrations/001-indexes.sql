-- =============================================================================
-- Mandaditoz — Índices post-rebuild
-- =============================================================================
-- Nota: Strapi 5 crea automáticamente PKs, FKs y UNIQUEs en las link tables.
-- Este script solo agrega índices para columnas NO indexadas por Strapi que
-- serán consultadas con frecuencia por el frontend/API.
--
-- Todos los índices usan IF NOT EXISTS para idempotencia (re-ejecutable).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- businesses — filtros más comunes
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_slug
  ON businesses(slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_status_published
  ON businesses(business_status)
  WHERE business_status = 'published';

CREATE INDEX IF NOT EXISTS idx_businesses_featured_active
  ON businesses(is_featured, featured_until)
  WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_businesses_not_archived
  ON businesses(id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_ownership
  ON businesses(ownership_status);

CREATE INDEX IF NOT EXISTS idx_businesses_price_level
  ON businesses(price_level)
  WHERE price_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_rating
  ON businesses(rating_average DESC, rating_count DESC);

CREATE INDEX IF NOT EXISTS idx_businesses_view_count
  ON businesses(view_count DESC);

-- -----------------------------------------------------------------------------
-- business_hours — query "abierto ahora"
-- -----------------------------------------------------------------------------
-- Nota: la relación business → business_hours pasa por business_hours_business_lnk;
-- Strapi ya creó FKs. Solo añadimos day_of_week para filtrar por día tras el JOIN.
CREATE INDEX IF NOT EXISTS idx_business_hours_day
  ON business_hours(day_of_week);

-- -----------------------------------------------------------------------------
-- business_hour_exceptions — lookup por fecha
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_business_hour_exceptions_date
  ON business_hour_exceptions(date);

-- -----------------------------------------------------------------------------
-- categories — slug, path (materialized), featured
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug
  ON categories(slug)
  WHERE slug IS NOT NULL;

-- Búsqueda prefix en path (ej. 'comida/mexicana%' encuentra toda la subtree)
CREATE INDEX IF NOT EXISTS idx_categories_path
  ON categories(path text_pattern_ops)
  WHERE path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_depth
  ON categories(depth);

CREATE INDEX IF NOT EXISTS idx_categories_featured
  ON categories(is_featured, "order")
  WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_categories_active_order
  ON categories(is_active, "order")
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- tags — slug único
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug
  ON tags(slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tags_active
  ON tags(is_active)
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- Geografía — slugs para URL lookup
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_states_slug
  ON states(slug)
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_slug
  ON cities(slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cities_active
  ON cities(is_active)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_neighborhoods_slug
  ON neighborhoods(slug)
  WHERE slug IS NOT NULL;

-- -----------------------------------------------------------------------------
-- reviews — filtros de moderación
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reviews_status_published
  ON reviews(review_status)
  WHERE review_status = 'published';

CREATE INDEX IF NOT EXISTS idx_reviews_reported
  ON reviews(is_reported)
  WHERE is_reported = true;

-- -----------------------------------------------------------------------------
-- claims — filtros de moderación
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_claims_status
  ON claims(claim_status);

CREATE INDEX IF NOT EXISTS idx_claims_pending
  ON claims(claim_status, created_at)
  WHERE claim_status = 'pending';

-- -----------------------------------------------------------------------------
-- reports — filtros de moderación
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reports_status
  ON reports(report_status);

CREATE INDEX IF NOT EXISTS idx_reports_target
  ON reports(target_type, target_id);

-- -----------------------------------------------------------------------------
-- photos — filtros de moderación
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_photos_status_approved
  ON photos(photo_status)
  WHERE photo_status = 'approved';

-- =============================================================================
-- PostGIS (pendiente)
-- =============================================================================
-- Cuando se instale PostGIS en el servidor, descomentar:
--
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- CREATE INDEX idx_geos_point
--   ON components_shared_geos USING GIST(ST_MakePoint(lng, lat));
--
-- Requiere que la extensión esté disponible en la imagen de Postgres.
-- La imagen actual (postgres:16-alpine) NO la incluye por defecto.
