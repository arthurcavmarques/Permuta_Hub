-- Fase 3B — correção. Em 20261110000002 a auto-aprovação foi ligada (match_config) ANTES de o recompute_matches
-- novo existir; a migração dos tipos de ativo disparou o recálculo antigo, que aprovou sozinho áreas com trava de
-- publicação (as legadas). Aqui: o que foi aprovado automaticamente (sem autor) e tem trava volta a "sugerido".
-- Decisões da curadoria (com autor) não são tocadas. Idempotente.
-- Reverter: não há o que reverter (volta ao estado correto da regra D032).

update public.matches m
   set status = 'suggested', decided_at = null, decision_note = null
  from public.opportunities o
 where o.id = m.opportunity_id
   and m.status = 'approved'
   and m.decided_by is null
   and m.decision_note like 'Aprovado automaticamente%'
   and exists (select 1 from public.publish_blockers_core(o));

-- Sugestões que já não combinam somem; o resto é recalculado com a regra atual.
select public.recompute_matches(null, null);
