-- Reverte 20261019000003_owner_leads.sql (o valor 'owner' de signup_kind fica: enum não remove valor).
-- ATENÇÃO: apaga os leads de captação (dados pessoais). Exporte antes.
begin;

drop function if exists public.owner_my_areas();
drop function if exists public.submit_owner_lead(public.respondent_relation, text, text, text, text, numeric,
  public.negotiation_model[], text, text, text, text, boolean, text, jsonb);
drop function if exists public.record_contact_consent(text, public.consent_purpose);
alter table public.opportunities drop constraint if exists opportunities_origin_lead_fk;
drop table if exists public.owner_leads;
drop type if exists public.lead_source;
drop type if exists public.lead_status;
drop type if exists public.respondent_relation;
delete from public.platform_settings where key in ('lead_rate_limit_per_hour', 'lead_rate_limit_per_contact_day');

-- Termo do proprietário volta a exigir conta aprovada (regra do bloco 2.1).
create or replace function public.can_accept_agreement(p_type public.agreement_type, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and public.is_approved() and case p_type
    when 'non_circumvention' then exists (
      select 1 from public.distributions d
       where d.opportunity_id = p_opportunity_id and d.source = 'platform'
         and (d.recipient_user_id = auth.uid() or d.recipient_org_id in (select public.user_org_ids())))
    when 'broker_partnership' then exists (select 1 from public.brokers b where b.user_id = auth.uid())
    when 'broker_area_authorization' then exists (
      select 1 from public.opportunities o
       where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid())
    else true
  end;
$$;
drop function if exists public.is_owner_account();

-- Cadastro volta a aceitar só corretor e comprador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, phone, signup_kind)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    case when new.raw_user_meta_data ->> 'signup_kind' in ('broker', 'buyer')
         then (new.raw_user_meta_data ->> 'signup_kind')::public.signup_kind end
  );
  return new;
end;
$$;

commit;
