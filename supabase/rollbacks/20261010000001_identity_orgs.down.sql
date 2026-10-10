-- Reverte 20261010000001_identity_orgs.sql (rodar DEPOIS do down da 000002).
-- ATENÇÃO: apaga membros, corretores, convites, consentimentos e caixa de saída. Exporte antes.
-- Uso: psql "$DB_URL" -f supabase/rollbacks/<arquivo>.down.sql
begin;

-- Storage: arquivos de CRECI precisam ser removidos pela API do Storage antes (bucket não vazio falha).
drop policy if exists broker_documents_own on storage.objects;
drop policy if exists broker_documents_admin_select on storage.objects;
-- Bucket vazio pode ser removido direto; o Storage exige liberar explicitamente.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'broker-documents';

-- Oportunidades
drop policy if exists opportunities_broker_insert on public.opportunities;
drop policy if exists opportunities_broker_select on public.opportunities;
drop policy if exists opportunities_broker_update on public.opportunities;
drop trigger if exists opportunities_guard on public.opportunities;
drop trigger if exists opportunities_defaults on public.opportunities;
drop function if exists public.guard_opportunity_write();
drop function if exists public.opportunity_defaults();
drop sequence if exists public.platform_memorial_seq;

-- Convites, revisão, caixa de saída
drop function if exists public.accept_invitation(text);
drop function if exists public.get_invitation_preview(text);
drop function if exists public.create_invitation(uuid, text, public.member_role);
drop table if exists public.invitations;
drop function if exists public.hash_token(text);
drop function if exists public.admin_list_users();
drop function if exists public.review_broker(uuid, boolean, text);
drop function if exists public.review_account(uuid, public.account_status, text);
drop function if exists public.user_email(uuid);
drop function if exists public.enqueue_email(text, text, text, text, jsonb);
drop function if exists public.setting_text_or_null(text);
delete from public.platform_settings where key in ('app_base_url', 'invitation_ttl_days');
drop table if exists public.email_outbox;
drop type if exists public.outbox_status;

-- Consentimentos
drop function if exists public.record_consent(public.consent_purpose, boolean);
drop view if exists public.current_contact_consents;
drop table if exists public.contact_consents;
drop table if exists public.consent_texts;
drop function if exists public.guard_consent_text_update();

-- Corretores
drop function if exists public.is_approved_broker();
drop table if exists public.brokers;
drop function if exists public.guard_broker_write();

-- Organizações e membros
drop function if exists public.create_my_organization(text, public.organization_type, text, text, text);
drop trigger if exists organizations_guard on public.organizations;
drop function if exists public.guard_organization_update();
drop policy if exists organizations_member_select on public.organizations;
drop policy if exists organizations_org_admin_update on public.organizations;
drop policy if exists profiles_select_colleagues on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop table if exists public.organization_members;
drop function if exists public.is_org_admin(uuid);
drop function if exists public.user_org_ids();
drop index if exists public.organizations_normalized_name_idx;
alter table public.organizations drop column if exists normalized_name, drop column if exists created_by;

-- Perfis
drop trigger if exists profiles_guard on public.profiles;
drop function if exists public.guard_profile_update();
drop function if exists public.is_approved();
alter table public.profiles
  drop column if exists account_status, drop column if exists signup_kind, drop column if exists preferred_channel,
  drop column if exists reviewed_by, drop column if exists reviewed_at, drop column if exists review_note;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop function if exists public.is_app_user_call();
drop function if exists public.request_user_agent();
drop function if exists public.request_ip();
drop function if exists public.sha256_hex(text);

drop type if exists public.consent_purpose;
drop type if exists public.contact_channel;
drop type if exists public.verification_status;
drop type if exists public.member_role;
drop type if exists public.signup_kind;
drop type if exists public.account_status;

alter default privileges in schema public grant all on tables to anon;

delete from supabase_migrations.schema_migrations where version = '20261010000001';
commit;
