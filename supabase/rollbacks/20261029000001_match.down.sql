-- Reverte 20261029000001_match.sql (Fase 3). Apaga teses e matches; distribuições não usam estas colunas ainda.
drop trigger if exists opportunities_recompute_matches on public.opportunities;
drop trigger if exists buyer_theses_recompute_matches on public.buyer_theses;
drop trigger if exists owner_leads_default_broker on public.owner_leads;

alter table public.distributions drop constraint if exists distributions_match_fk;
alter table public.distributions drop constraint if exists distributions_thesis_fk;

drop function if exists public.admin_recompute_matches();
drop function if exists public.admin_list_matches();
drop function if exists public.decide_match(uuid, public.match_status, text, integer);
drop function if exists public.admin_list_buyer_organizations();
drop function if exists public.matches_on_opportunity_change();
drop function if exists public.matches_on_thesis_change();
drop function if exists public.recompute_matches(uuid, uuid);
drop function if exists public.match_evaluate(public.opportunities, public.buyer_theses);
drop function if exists public.fmt_money(numeric);
drop function if exists public.fmt_int(numeric);
drop function if exists public.norm_array(text[]);
drop function if exists public.norm_text(text);
drop table if exists public.matches;
drop type if exists public.match_status;
drop table if exists public.buyer_theses;
drop function if exists public.can_manage_thesis(uuid);
drop function if exists public.set_owner_lead_default_broker(uuid);
drop function if exists public.assign_default_broker_to_lead();
drop function if exists public.owner_lead_default_broker();
delete from public.platform_settings where key in ('match_config', 'owner_lead_default_broker');

-- View volta à definição da Fundação (sem as colunas novas): precisa de drop, porque remove colunas.
drop view public.opportunities_blind;
create view public.opportunities_blind
with (security_barrier = true)
as
select
  o.id,
  o.memorial_number,
  coalesce(
    o.title_blind,
    'Área de ' || replace(to_char(public.round_area(o.area_m2), 'FM999,999,999'), ',', '.') || ' m²'
      || coalesce(' – ' || case when public.setting_text('blind_location_level', 'neighborhood') = 'neighborhood'
                                then o.neighborhood || ', ' || o.city else o.city end, '')
  ) as title,
  o.asset_type, o.status, o.land_type,
  public.round_area(o.area_m2) as area_m2_approx,
  o.city,
  case when public.setting_text('blind_location_level', 'neighborhood') = 'neighborhood'
       then o.neighborhood end as neighborhood,
  o.state, o.region_tags, o.zoning, o.master_plan_notes, o.buildable_potential_notes, o.coefficient,
  o.project_types, o.negotiation_conditions, o.asking_value, o.negotiation_models, o.mandate_status,
  extensions.st_x(public.blind_center(o.id, o.geometry)) as approx_lng,
  extensions.st_y(public.blind_center(o.id, o.geometry)) as approx_lat,
  public.setting_numeric('blind_map_radius_m', 500) as approx_radius_m,
  o.published_at, o.updated_at
from public.opportunities o
where public.can_view_blind(o.id)
  and o.status <> 'archived';

alter table public.opportunities drop column if exists cash_share_pct, drop column if exists estimated_units;
grant select on public.opportunities_blind to authenticated;
