-- =============================================================================
-- Mandaditoz — pg_trgm para la búsqueda de negocios
-- =============================================================================
-- src/utils/business-search.js usa word_similarity() de pg_trgm como respaldo
-- cuando una búsqueda no da resultados ("panadreia" → Panadería). Es opcional:
-- sin la extensión la búsqueda sigue funcionando, solo sin ese respaldo, y el
-- código lo detecta solo.
--
-- Por eso el CREATE va dentro de un bloque que atrapa cualquier error: un
-- MigrationError aborta el arranque de Strapi, y no vale tumbar el servicio
-- por una mejora opcional. pg_trgm es "trusted" desde Postgres 13, así que
-- basta con que el rol tenga CREATE sobre la base, sin ser superusuario.
--
-- Los acentos NO dependen de la extensión unaccent: se quitan con translate().
-- =============================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_trgm no disponible (%): la búsqueda sigue sin tolerancia a errores de dedo', SQLERRM;
END
$$;
