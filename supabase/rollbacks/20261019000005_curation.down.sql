-- Reverte 20261019000005_curation.sql.
-- ATENÇÃO: apaga o histórico das oportunidades (opportunity_events). Exporte antes.
begin;

drop trigger if exists opportunities_publish_guard on public.opportunities;
drop trigger if exists opportunities_events on public.opportunities;
drop function if exists public.guard_opportunity_publish();
drop function if exists public.log_opportunity_changes();
drop function if exists public.admin_access_log(timestamptz, timestamptz, text, text, integer);
drop function if exists public.admin_list_brokers();
drop function if exists public.convert_lead(uuid);
drop function if exists public.curate_lead(uuid, public.lead_status, text, uuid);
drop function if exists public.add_opportunity_note(uuid, text);
drop function if exists public.curate_opportunity(uuid, public.opportunity_status, public.mandate_status, uuid, boolean, boolean, text);
drop function if exists public.publish_opportunity(uuid, text);
drop function if exists public.opportunity_publish_blockers(uuid);
drop function if exists public.publish_blockers_of(public.opportunities);
drop table if exists public.opportunity_events;
drop type if exists public.opportunity_event_kind;
delete from public.platform_settings where key = 'publishable_required_fields';

commit;
