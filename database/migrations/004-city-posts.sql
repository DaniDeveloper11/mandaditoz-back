-- =============================================================================
-- Mandaditoz — Cartelera del municipio (city-post): eventos, avisos y carteles
-- =============================================================================
-- Crea las tablas del content-type api::city-post.city-post y sus tablas
-- satélite. Ver src/api/city-post/content-types/city-post/schema.json.
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE:
-- con NODE_ENV=production, `strapi start` NO aplica cambios de esquema — no
-- crea tablas ni columnas nuevas, y aun así reescribe el esquema persistido
-- como si estuviera al día, así que tampoco lo hará en arranques posteriores.
-- En `develop` sí sincroniza, que es lo que enmascara el problema durante el
-- desarrollo. Declarar el content-type en el schema JSON basta en local y NO
-- basta en prod: sin este archivo, la tabla no aparece nunca y cada request a
-- /api/city-posts revienta. Mismo caso que 003-add-published-business-limit.sql.
--
-- El DDL NO está escrito a mano: sale de `pg_dump -s -t city_posts -t
-- 'city_posts_*'` contra la base local después de que `strapi develop` creó
-- las tablas, para que los nombres de columna, constraint e índice sean
-- exactamente los que Strapi espera encontrar. Solo se le agregó idempotencia
-- y se le quitaron los `OWNER TO`.
--
-- Un MigrationError ABORTA el arranque del servicio, así que el archivo es
-- autosuficiente: no depende de que Strapi haya sincronizado nada antes.
-- Idempotente en los dos entornos: en develop Strapi ya creó las tablas y
-- todos los IF NOT EXISTS lo respetan.
--
-- Las claves primarias se declaran con `serial`, que es exactamente lo que
-- genera knex (`increments()`) y lo que muestra el volcado: así la secuencia
-- city_posts_id_seq nace junto con la tabla y queda cubierta por el mismo
-- IF NOT EXISTS, sin CREATE SEQUENCE aparte.
-- =============================================================================

-- Tabla principal ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS city_posts (
  id                    serial                         NOT NULL,
  document_id           character varying(255),
  title                 character varying(255),
  slug                  character varying(255),
  kind                  character varying(255),
  event_category        character varying(255),
  summary               character varying(255),
  description           text,
  start_at              timestamp(6) without time zone,
  end_at                timestamp(6) without time zone,
  all_day               boolean,
  venue_name            character varying(255),
  venue_address         character varying(255),
  map_embed_url         text,
  organizer_name        character varying(255),
  contact_phone         character varying(255),
  external_url          character varying(255),
  ticket_url            character varying(255),
  price_text            character varying(255),
  visible_in_all_cities boolean,
  post_status           character varying(255),
  is_featured           boolean,
  featured_order        integer,
  created_at            timestamp(6) without time zone,
  updated_at            timestamp(6) without time zone,
  published_at          timestamp(6) without time zone,
  created_by_id         integer,
  updated_by_id         integer,
  locale                character varying(255),
  CONSTRAINT city_posts_pkey PRIMARY KEY (id),
  CONSTRAINT city_posts_created_by_id_fk FOREIGN KEY (created_by_id)
    REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT city_posts_updated_by_id_fk FOREIGN KEY (updated_by_id)
    REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS city_posts_documents_idx
  ON city_posts (document_id, locale, published_at);
CREATE INDEX IF NOT EXISTS city_posts_created_by_id_fk ON city_posts (created_by_id);
CREATE INDEX IF NOT EXISTS city_posts_updated_by_id_fk ON city_posts (updated_by_id);

-- Relación city (manyToOne, requerida) ---------------------------------------
CREATE TABLE IF NOT EXISTS city_posts_city_lnk (
  id            serial NOT NULL,
  city_post_id  integer,
  city_id       integer,
  city_post_ord double precision,
  CONSTRAINT city_posts_city_lnk_pkey PRIMARY KEY (id),
  CONSTRAINT city_posts_city_lnk_uq UNIQUE (city_post_id, city_id),
  CONSTRAINT city_posts_city_lnk_fk FOREIGN KEY (city_post_id)
    REFERENCES city_posts(id) ON DELETE CASCADE,
  CONSTRAINT city_posts_city_lnk_ifk FOREIGN KEY (city_id)
    REFERENCES cities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS city_posts_city_lnk_fk   ON city_posts_city_lnk (city_post_id);
CREATE INDEX IF NOT EXISTS city_posts_city_lnk_ifk  ON city_posts_city_lnk (city_id);
CREATE INDEX IF NOT EXISTS city_posts_city_lnk_oifk ON city_posts_city_lnk (city_post_ord);

-- Relación businesses (manyToMany, opcional) ---------------------------------
-- Un evento puede llevar varios negocios (sede, organizadores, patrocinadores,
-- los puestos que participan) y un negocio puede tener varios eventos, así que
-- la tabla lleva las DOS columnas de orden, igual que businesses_tags_lnk.
CREATE TABLE IF NOT EXISTS city_posts_businesses_lnk (
  id            serial NOT NULL,
  city_post_id  integer,
  business_id   integer,
  business_ord  double precision,
  city_post_ord double precision,
  CONSTRAINT city_posts_businesses_lnk_pkey PRIMARY KEY (id),
  CONSTRAINT city_posts_businesses_lnk_uq UNIQUE (city_post_id, business_id),
  CONSTRAINT city_posts_businesses_lnk_fk FOREIGN KEY (city_post_id)
    REFERENCES city_posts(id) ON DELETE CASCADE,
  CONSTRAINT city_posts_businesses_lnk_ifk FOREIGN KEY (business_id)
    REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS city_posts_businesses_lnk_fk   ON city_posts_businesses_lnk (city_post_id);
CREATE INDEX IF NOT EXISTS city_posts_businesses_lnk_ifk  ON city_posts_businesses_lnk (business_id);
CREATE INDEX IF NOT EXISTS city_posts_businesses_lnk_ofk  ON city_posts_businesses_lnk (business_ord);
CREATE INDEX IF NOT EXISTS city_posts_businesses_lnk_oifk ON city_posts_businesses_lnk (city_post_ord);

-- Componentes (geo y seo) ----------------------------------------------------
-- Los media (coverImage, gallery) NO necesitan tabla: van por files_related_morphs.
CREATE TABLE IF NOT EXISTS city_posts_cmps (
  id             serial NOT NULL,
  entity_id      integer,
  cmp_id         integer,
  component_type character varying(255),
  field          character varying(255),
  "order"        double precision,
  CONSTRAINT city_posts_cmps_pkey PRIMARY KEY (id),
  CONSTRAINT city_posts_uq UNIQUE (entity_id, cmp_id, field, component_type),
  CONSTRAINT city_posts_entity_fk FOREIGN KEY (entity_id)
    REFERENCES city_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS city_posts_entity_fk         ON city_posts_cmps (entity_id);
CREATE INDEX IF NOT EXISTS city_posts_component_type_idx ON city_posts_cmps (component_type);
CREATE INDEX IF NOT EXISTS city_posts_field_idx          ON city_posts_cmps (field);

-- Índice propio de la cartelera ----------------------------------------------
-- La consulta de la cartelera es siempre la misma:
--   WHERE post_status = 'published' AND end_at >= now() ORDER BY start_at
-- `end_at` nunca es nulo: el lifecycle lo rellena si el admin lo deja vacío
-- (evento/cartel = fin del día de start_at; aviso = +30 días). Por eso la
-- vigencia es UNA condición indexable y no un $or de fechas.
--
-- Sin CONCURRENTLY a propósito: Strapi corre cada migración dentro de una
-- transacción y Postgres prohíbe CREATE INDEX CONCURRENTLY ahí. Mismo criterio
-- que 001-indexes.sql y 002-featured-until-index.sql.
CREATE INDEX IF NOT EXISTS idx_city_posts_cartelera
  ON city_posts (end_at, start_at)
  WHERE post_status = 'published';
