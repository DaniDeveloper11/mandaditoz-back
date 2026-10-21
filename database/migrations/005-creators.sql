-- =============================================================================
-- Mandaditoz — Voces del municipio (creator): directorio de creadores
-- =============================================================================
-- Crea las tablas del content-type api::creator.creator y sus tablas satélite.
-- Ver src/api/creator/content-types/creator/schema.json.
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE:
-- con NODE_ENV=production, `strapi start` NO aplica cambios de esquema — no
-- crea tablas ni columnas nuevas, y aun así reescribe el esquema persistido
-- como si estuviera al día, así que tampoco lo hará en arranques posteriores.
-- En `develop` sí sincroniza, que es lo que enmascara el problema durante el
-- desarrollo. Declarar el content-type en el schema JSON basta en local y NO
-- basta en prod: sin este archivo la tabla no aparece nunca y cada request a
-- /api/creators revienta. Mismo caso que 004-city-posts.sql.
--
-- El DDL NO está escrito a mano: sale de `pg_dump -s -t creators -t
-- 'creators_*'` contra la base local después de que `strapi develop` creó las
-- tablas, para que los nombres de columna, constraint e índice sean exactamente
-- los que Strapi espera encontrar. Solo se le agregó idempotencia y se le
-- quitaron los `OWNER TO`.
--
-- Ojo con una diferencia real frente a 004: la relación `city` de creator es
-- UNIDIRECCIONAL (no hay inversa en city, a propósito — ver el schema), y por
-- eso creators_city_lnk NO lleva columna de orden `creator_ord` ni su índice
-- `_oifk`, que city_posts_city_lnk sí tiene por ser bidireccional. Inventarlos
-- aquí crearía columnas que Strapi nunca consulta.
--
-- Un MigrationError ABORTA el arranque del servicio, así que el archivo es
-- autosuficiente: no depende de que Strapi haya sincronizado nada antes.
-- Idempotente en los dos entornos: en develop Strapi ya creó las tablas y
-- todos los IF NOT EXISTS lo respetan.
--
-- Las claves primarias se declaran con `serial`, que es exactamente lo que
-- genera knex (`increments()`) y lo que muestra el volcado: así la secuencia
-- creators_id_seq nace junto con la tabla y queda cubierta por el mismo
-- IF NOT EXISTS, sin CREATE SEQUENCE aparte.
-- =============================================================================

-- Tabla principal ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creators (
  id                    serial                         NOT NULL,
  document_id           character varying(255),
  name                  character varying(255),
  slug                  character varying(255),
  handle                character varying(255),
  creator_type          character varying(255),
  tagline               character varying(255),
  bio                   text,
  website               character varying(255),
  contact_email         character varying(255),
  contact_phone         character varying(255),
  audience_text         character varying(255),
  covers_topics         character varying(255),
  region_name           character varying(255),
  visible_in_all_cities boolean,
  creator_status        character varying(255),
  is_featured           boolean,
  featured_order        integer,
  consent_at            timestamp(6) without time zone,
  created_at            timestamp(6) without time zone,
  updated_at            timestamp(6) without time zone,
  published_at          timestamp(6) without time zone,
  created_by_id         integer,
  updated_by_id         integer,
  locale                character varying(255),
  CONSTRAINT creators_pkey PRIMARY KEY (id),
  CONSTRAINT creators_created_by_id_fk FOREIGN KEY (created_by_id)
    REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT creators_updated_by_id_fk FOREIGN KEY (updated_by_id)
    REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS creators_documents_idx
  ON creators (document_id, locale, published_at);
CREATE INDEX IF NOT EXISTS creators_created_by_id_fk ON creators (created_by_id);
CREATE INDEX IF NOT EXISTS creators_updated_by_id_fk ON creators (updated_by_id);

-- Relación city (manyToOne unidireccional, requerida) -------------------------
CREATE TABLE IF NOT EXISTS creators_city_lnk (
  id         serial NOT NULL,
  creator_id integer,
  city_id    integer,
  CONSTRAINT creators_city_lnk_pkey PRIMARY KEY (id),
  CONSTRAINT creators_city_lnk_uq UNIQUE (creator_id, city_id),
  CONSTRAINT creators_city_lnk_fk FOREIGN KEY (creator_id)
    REFERENCES creators(id) ON DELETE CASCADE,
  CONSTRAINT creators_city_lnk_ifk FOREIGN KEY (city_id)
    REFERENCES cities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS creators_city_lnk_fk  ON creators_city_lnk (creator_id);
CREATE INDEX IF NOT EXISTS creators_city_lnk_ifk ON creators_city_lnk (city_id);

-- Componentes (socialLinks repetible y seo) ----------------------------------
-- Los media (avatar, coverImage, gallery) NO necesitan tabla: van por
-- files_related_morphs. socialLinks reusa business.social-link, cuya tabla
-- components_business_social_links ya existe desde el modelo de negocios.
CREATE TABLE IF NOT EXISTS creators_cmps (
  id             serial NOT NULL,
  entity_id      integer,
  cmp_id         integer,
  component_type character varying(255),
  field          character varying(255),
  "order"        double precision,
  CONSTRAINT creators_cmps_pkey PRIMARY KEY (id),
  CONSTRAINT creators_uq UNIQUE (entity_id, cmp_id, field, component_type),
  CONSTRAINT creators_entity_fk FOREIGN KEY (entity_id)
    REFERENCES creators(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS creators_entity_fk          ON creators_cmps (entity_id);
CREATE INDEX IF NOT EXISTS creators_component_type_idx ON creators_cmps (component_type);
CREATE INDEX IF NOT EXISTS creators_field_idx          ON creators_cmps (field);

-- Índice propio del directorio -----------------------------------------------
-- La consulta de la sección es siempre la misma:
--   WHERE creator_status = 'published' ORDER BY is_featured DESC, featured_order, name
--
-- Sin CONCURRENTLY a propósito: Strapi corre cada migración dentro de una
-- transacción y Postgres prohíbe CREATE INDEX CONCURRENTLY ahí. Mismo criterio
-- que 001-indexes.sql, 002-featured-until-index.sql y 004-city-posts.sql.
CREATE INDEX IF NOT EXISTS idx_creators_directorio
  ON creators (is_featured DESC, featured_order, name)
  WHERE creator_status = 'published';
