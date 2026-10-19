-- Fase 2 · Bloco 2.3 — Porta do corretor e editor completo do Memorial Descritivo.
-- Termo-mestre antes de cadastrar; corretor responsável edita dossiê, localização exata, dado sensível, fotos
-- e documentos enquanto a área está captada/qualificando; autorização do proprietário anexada (revisada pela
-- curadoria) é exigida para publicar (checagem no bloco 2.4).
-- Reverter: supabase/rollbacks/20261019000004_md_editor.down.sql

-- ---------------------------------------------------------------------------
-- Quem edita uma área
-- ---------------------------------------------------------------------------
-- Curadoria sempre; corretor aprovado responsável enquanto captada/qualificando (depois disso, só a curadoria).
create or replace function public.can_edit_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_approved_broker() and exists (
    select 1 from public.opportunities o
     where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid()
       and o.status in ('captured', 'qualifying')));
$$;

-- Termo-mestre aceito antes de o corretor cadastrar a primeira área.
drop policy opportunities_broker_insert on public.opportunities;
create policy opportunities_broker_insert on public.opportunities for insert to authenticated
  with check (public.is_approved_broker() and responsible_party_user_id = (select auth.uid())
              and public.has_agreement('broker_partnership', null));

-- ---------------------------------------------------------------------------
-- Localização exata (geometria): só por RPC, com validação
-- ---------------------------------------------------------------------------
create or replace function public.set_opportunity_geometry_geojson(p_opportunity_id uuid, p_geojson jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_geom extensions.geometry;
begin
  if not public.can_edit_opportunity(p_opportunity_id) then
    raise exception 'Sem permissão para editar esta área' using errcode = '42501';
  end if;
  if p_geojson is not null and p_geojson <> 'null'::jsonb then
    begin
      v_geom := extensions.st_force2d(extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson), 4326));
    exception when others then
      raise exception 'Geometria inválida' using errcode = '22023';
    end;
    if extensions.st_geometrytype(v_geom) not in ('ST_Polygon', 'ST_MultiPolygon', 'ST_Point') then
      raise exception 'Use um polígono ou um ponto' using errcode = '22023';
    end if;
    if not extensions.st_isvalid(v_geom) then
      v_geom := extensions.st_makevalid(v_geom);
    end if;
    -- Caixa aproximada do Brasil: pega coordenada invertida (lat/lng) e lixo.
    if not extensions.st_within(v_geom, extensions.st_makeenvelope(-74.5, -34.5, -28.0, 5.5, 4326)) then
      raise exception 'Geometria fora do Brasil (coordenadas invertidas?)' using errcode = '22023';
    end if;
  end if;

  update public.opportunities set geometry = v_geom where id = p_opportunity_id;
  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), 'write_geometry', 'opportunities', p_opportunity_id, p_opportunity_id,
          public.request_ip(), public.request_user_agent());
end;
$$;

-- Localização exata para o editor (GeoJSON). Mesma permissão de edição.
create or replace function public.get_opportunity_geometry(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or exists (
      select 1 from public.opportunities o
       where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid() and public.is_approved_broker())) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return (select extensions.st_asgeojson(o.geometry)::jsonb from public.opportunities o where o.id = p_opportunity_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dado sensível: escrita só por RPC, registrada
-- ---------------------------------------------------------------------------
create or replace function public.upsert_opportunity_sensitive(
  p_opportunity_id uuid,
  p_registry_number text,
  p_exact_address text,
  p_owner_name text,
  p_owner_contacts jsonb,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_opportunity(p_opportunity_id) then
    raise exception 'Sem permissão para editar esta área' using errcode = '42501';
  end if;
  insert into public.opportunity_sensitive
    (opportunity_id, registry_number, exact_address, owner_name, owner_contacts, notes)
  values
    (p_opportunity_id, nullif(trim(p_registry_number), ''), nullif(trim(p_exact_address), ''),
     nullif(trim(p_owner_name), ''), coalesce(p_owner_contacts, '{}'), nullif(trim(p_notes), ''))
  on conflict (opportunity_id) do update set
    registry_number = excluded.registry_number,
    exact_address = excluded.exact_address,
    owner_name = excluded.owner_name,
    owner_contacts = excluded.owner_contacts,
    notes = excluded.notes;

  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), 'write_sensitive', 'opportunity_sensitive', p_opportunity_id, p_opportunity_id,
          public.request_ip(), public.request_user_agent());
end;
$$;

-- ---------------------------------------------------------------------------
-- Fotos e mapas: corretor responsável gerencia as da própria área
-- ---------------------------------------------------------------------------
-- is_blind_safe marcado pelo corretor é proposta: nada chega a comprador antes da curadoria publicar
-- (bloco 2.4), e a curadoria revisa as fotos na qualificação.
create policy opportunity_media_broker_select on public.opportunity_media for select to authenticated
  using (public.can_edit_opportunity(opportunity_id) or exists (
    select 1 from public.opportunities o
     where o.id = opportunity_id and o.responsible_party_user_id = (select auth.uid())));
create policy opportunity_media_broker_insert on public.opportunity_media for insert to authenticated
  with check (public.can_edit_opportunity(opportunity_id));
create policy opportunity_media_broker_update on public.opportunity_media for update to authenticated
  using (public.can_edit_opportunity(opportunity_id)) with check (public.can_edit_opportunity(opportunity_id));
create policy opportunity_media_broker_delete on public.opportunity_media for delete to authenticated
  using (public.can_edit_opportunity(opportunity_id));

-- Caminho no bucket: <opportunity_id>/<arquivo>. O texto da pasta é comparado (sem cast que possa falhar).
create or replace function public.storage_opportunity_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$'
              then ((storage.foldername(p_name))[1])::uuid end;
$$;

create policy opportunity_media_objects_broker_select on storage.objects for select to authenticated
  using (bucket_id = 'opportunity-media' and exists (
    select 1 from public.opportunities o
     where o.id = public.storage_opportunity_id(storage.objects.name)
       and o.responsible_party_user_id = (select auth.uid())));
create policy opportunity_media_objects_broker_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'opportunity-media'
              and public.can_edit_opportunity(public.storage_opportunity_id(storage.objects.name)));
create policy opportunity_media_objects_broker_delete on storage.objects for delete to authenticated
  using (bucket_id = 'opportunity-media'
         and public.can_edit_opportunity(public.storage_opportunity_id(storage.objects.name)));

update storage.buckets
   set file_size_limit = 15728640, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'opportunity-media';

-- ---------------------------------------------------------------------------
-- Documentos (inclui a autorização do proprietário)
-- ---------------------------------------------------------------------------
create type public.document_kind as enum ('owner_authorization', 'registry', 'technical', 'other');
create type public.document_sensitivity as enum ('blind', 'restricted');
create type public.review_status as enum ('pending', 'accepted', 'rejected');

create table public.opportunity_documents (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  kind public.document_kind not null,
  sensitivity public.document_sensitivity not null default 'restricted',
  storage_path text not null unique,
  file_name text not null,
  uploaded_by uuid references auth.users (id),
  -- Só para owner_authorization: a curadoria confere o documento (exigido para publicar).
  review_status public.review_status not null default 'pending',
  review_note text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Autorização do proprietário identifica o dono: nunca é "cega".
  check (kind <> 'owner_authorization' or sensitivity = 'restricted')
);

create index opportunity_documents_opp_idx on public.opportunity_documents (opportunity_id, kind);

create trigger opportunity_documents_updated_at before update on public.opportunity_documents
  for each row execute function public.set_updated_at();

-- Pelo app, só a curadoria decide a revisão; o corretor não se autoaprova.
create or replace function public.guard_document_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin() then
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.uploaded_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger opportunity_documents_guard before insert or update on public.opportunity_documents
  for each row execute function public.guard_document_write();

create or replace function public.review_owner_authorization(p_document_id uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria revisa a autorização' using errcode = '42501';
  end if;
  if not p_accept and coalesce(trim(p_note), '') = '' then
    raise exception 'Rejeição exige motivo' using errcode = '22023';
  end if;
  update public.opportunity_documents
     set review_status = case when p_accept then 'accepted' else 'rejected' end::public.review_status,
         review_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_document_id and kind = 'owner_authorization';
  if not found then
    raise exception 'Autorização não encontrada' using errcode = 'P0002';
  end if;
end;
$$;

alter table public.opportunity_documents enable row level security;

create policy opportunity_documents_admin_all on public.opportunity_documents for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy opportunity_documents_broker_select on public.opportunity_documents for select to authenticated
  using (exists (select 1 from public.opportunities o
                  where o.id = opportunity_id and o.responsible_party_user_id = (select auth.uid())
                    and public.is_approved_broker()));
create policy opportunity_documents_broker_insert on public.opportunity_documents for insert to authenticated
  with check (public.can_edit_opportunity(opportunity_id));
create policy opportunity_documents_broker_delete on public.opportunity_documents for delete to authenticated
  using (public.can_edit_opportunity(opportunity_id) and review_status <> 'accepted');
-- Destinatário: documento "cego" com o dossiê; "restrito" só com acesso ao dado sensível. Autorização, nunca.
create policy opportunity_documents_recipient_select on public.opportunity_documents for select to authenticated
  using (kind <> 'owner_authorization' and (
    (sensitivity = 'blind' and public.can_view_blind(opportunity_id))
    or (sensitivity = 'restricted' and public.sensitive_access_state(opportunity_id) = 'allowed')));

revoke all on public.opportunity_documents from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('opportunity-documents', 'opportunity-documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Objetos seguem a linha da tabela: quem lê a linha baixa o arquivo.
create policy opportunity_documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'opportunity-documents' and exists (
    select 1 from public.opportunity_documents d where d.storage_path = storage.objects.name));
create policy opportunity_documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'opportunity-documents'
              and public.can_edit_opportunity(public.storage_opportunity_id(storage.objects.name)));
create policy opportunity_documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'opportunity-documents'
         and public.can_edit_opportunity(public.storage_opportunity_id(storage.objects.name)));

-- ---------------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------------
revoke execute on function
  public.can_edit_opportunity(uuid),
  public.set_opportunity_geometry_geojson(uuid, jsonb),
  public.get_opportunity_geometry(uuid),
  public.upsert_opportunity_sensitive(uuid, text, text, text, jsonb, text),
  public.review_owner_authorization(uuid, boolean, text)
from public, anon;
grant execute on function
  public.can_edit_opportunity(uuid),
  public.set_opportunity_geometry_geojson(uuid, jsonb),
  public.get_opportunity_geometry(uuid),
  public.upsert_opportunity_sensitive(uuid, text, text, text, jsonb, text),
  public.review_owner_authorization(uuid, boolean, text)
to authenticated;
