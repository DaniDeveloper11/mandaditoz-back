-- =============================================================================
-- Mandaditoz — Negocios con dueño que quedaron como "unclaimed"
-- =============================================================================
-- Hasta ahora un negocio dado de alta por su propio dueño (POST /businesses)
-- nacía con owner pero con ownershipStatus = 'unclaimed', así que la ficha le
-- ofrecía "Reclamar este negocio" a cualquier visitante y los scripts/listados
-- de sin-dueño lo contaban. El lifecycle beforeCreate ya lo pone en 'claimed';
-- esto corrige los que ya existían.
--
-- Solo toca 'unclaimed' con dueño: un 'pending_claim' es un reclamo en curso y
-- lo resuelve el admin. No crea columnas (ownership_status y la tabla de enlace
-- ya existen), e idempotente: una segunda pasada no encuentra filas.
-- =============================================================================

UPDATE businesses b
   SET ownership_status = 'claimed'
 WHERE b.ownership_status = 'unclaimed'
   AND EXISTS (
     SELECT 1 FROM businesses_owner_lnk l
      WHERE l.business_id = b.id AND l.user_id IS NOT NULL
   );
