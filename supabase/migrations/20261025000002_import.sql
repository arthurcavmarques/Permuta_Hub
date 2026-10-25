-- Fase 2B — Importação real (Land Bank e compradores) pela tela, com prévia obrigatória, mesclagem a três vias,
-- conflitos, desfazer o lote, e painel de áreas publicáveis. Tipo de ativo vira campo exigido para publicar (D026).
-- Reverter: supabase/rollbacks/20261025000002_import.down.sql

-- ---------------------------------------------------------------------------
-- Tipo de ativo/uso (D026): exigido para publicar e para o match. Sem padrão silencioso.
-- ---------------------------------------------------------------------------
alter table public.opportunities alter column asset_type drop not null, alter column asset_type drop default;

insert into public.platform_settings (key, value, description) values
  ('asset_types',
   '[{"value": "terreno", "label": "Terreno urbano"}, {"value": "gleba", "label": "Gleba"},
     {"value": "area_rural", "label": "Área rural"}, {"value": "galpao", "label": "Galpão / área industrial"},
     {"value": "imovel_retrofit", "label": "Imóvel para retrofit ou demolição"}, {"value": "outro", "label": "Outro"}]',
   'Tipos de ativo/uso aceitos (proposta do time; DEPENDE DO FÁBIO, pergunta 4b). O match filtra por este campo.')
on conflict (key) do nothing;

update public.platform_settings
   set value = value || '["asset_type"]'::jsonb,
       description = 'Campos mínimos para publicar (D026). Itens possíveis: city, neighborhood, area_m2, zoning, '
                     || 'coefficient, negotiation_models, blind_photo, geometry, asking_value, asset_type.'
 where key = 'publishable_required_fields' and not value ? 'asset_type';

create or replace function public.is_valid_asset_type(p_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_value is null or exists (
    select 1 from jsonb_array_elements(coalesce((select value from public.platform_settings where key = 'asset_types'), '[]')) e
     where e ->> 'value' = p_value);
$$;

create or replace function public.check_asset_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.asset_type is distinct from old.asset_type) and not public.is_valid_asset_type(new.asset_type) then
    raise exception 'Tipo de ativo desconhecido: %', new.asset_type using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger opportunities_asset_type before insert or update of asset_type on public.opportunities
  for each row execute function public.check_asset_type();

-- "Publicável": + tipo de ativo; mandato desconhecido nunca publica (nem com a regra 4 liberada).
create or replace function public.publish_blockers_of(o public.opportunities)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required jsonb := coalesce((select value from public.platform_settings where key = 'publishable_required_fields'), '[]');
  v_allow_no_mandate boolean := coalesce(public.setting_text('allow_distribution_without_mandate', 'false')::boolean, false);
begin
  if not (public.is_admin() or public.can_edit_opportunity(o.id)) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_required ? 'city' and coalesce(trim(o.city), '') = '' then return next 'missing_city'; end if;
  if v_required ? 'neighborhood' and coalesce(trim(o.neighborhood), '') = '' then return next 'missing_neighborhood'; end if;
  if v_required ? 'area_m2' and o.area_m2 is null then return next 'missing_area'; end if;
  if v_required ? 'asset_type' and o.asset_type is null then return next 'missing_asset_type'; end if;
  if v_required ? 'zoning' and coalesce(trim(o.zoning), '') = '' then return next 'missing_zoning'; end if;
  if v_required ? 'coefficient' and o.coefficient is null then return next 'missing_coefficient'; end if;
  if v_required ? 'asking_value' and o.asking_value is null then return next 'missing_asking_value'; end if;
  if v_required ? 'negotiation_models' and cardinality(o.negotiation_models) = 0 then return next 'missing_models'; end if;
  if v_required ? 'geometry' and o.geometry is null then return next 'missing_geometry'; end if;
  if v_required ? 'blind_photo' and not exists (
       select 1 from public.opportunity_media m where m.opportunity_id = o.id and m.is_blind_safe) then
    return next 'missing_blind_photo';
  end if;
  if o.responsible_party_user_id is null and o.responsible_party_org_id is null then
    return next 'no_responsible';
  elsif o.responsible_party_user_id is not null and exists (
          select 1 from public.brokers b where b.user_id = o.responsible_party_user_id) then
    if not exists (select 1 from public.brokers b
                    where b.user_id = o.responsible_party_user_id and b.verification_status = 'approved'
                      and b.creci_status = 'active') then
      return next 'responsible_creci_not_verified';
    end if;
    if not exists (select 1 from public.valid_agreements a
                    where a.party_user_id = o.responsible_party_user_id and a.type = 'broker_area_authorization'
                      and a.opportunity_id = o.id) then
      return next 'no_area_term';
    end if;
  end if;
  if not exists (select 1 from public.opportunity_documents d
                  where d.opportunity_id = o.id and d.kind = 'owner_authorization' and d.review_status = 'accepted') then
    return next 'no_owner_authorization';
  end if;
  if o.mandate_status = 'unknown' then
    return next 'mandate_unknown';
  elsif not v_allow_no_mandate and o.mandate_status not in ('exclusive', 'non_exclusive') then
    return next 'no_mandate';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Compradores importados: sem login e SEM opt-in (regra 8). Não recebem mensagem até aceitarem pela plataforma.
-- ---------------------------------------------------------------------------
create table public.buyer_prospects (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  organization_name text not null,
  cnpj text check (cnpj is null or cnpj ~ '^\d{14}$'),
  contact_name text,
  phone text,
  email text,
  notes text,
  -- Sem prova de opt-in. A Fase 4 só envia a quem aceitou pela plataforma (contact_consents).
  consent_status text not null default 'none' check (consent_status = 'none'),
  source_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger buyer_prospects_updated_at before update on public.buyer_prospects
  for each row execute function public.set_updated_at();

alter table public.buyer_prospects enable row level security;
create policy buyer_prospects_admin_select on public.buyer_prospects for select to authenticated
  using ((select public.is_admin()));
revoke all on public.buyer_prospects from anon;
revoke insert, update, delete, truncate on public.buyer_prospects from authenticated;

-- ---------------------------------------------------------------------------
-- Mapeamentos reutilizáveis (colunas, equivalência de status etc.), editáveis pela curadoria
-- ---------------------------------------------------------------------------
create type public.import_kind as enum ('landbank', 'buyers', 'kml');

create table public.import_mappings (
  kind public.import_kind primary key,
  mapping jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger import_mappings_updated_at before update on public.import_mappings
  for each row execute function public.set_updated_at();

alter table public.import_mappings enable row level security;
create policy import_mappings_admin on public.import_mappings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.import_mappings from anon;

-- Padrões: os mesmos de scripts/mappings/*.json (a planilha real do Fábio ainda não chegou).
insert into public.import_mappings (kind, mapping) values
('landbank', $json${
  "memorial_prefix": "MD-",
  "memorial_pad": 3,
  "header_search_rows": 15,
  "columns": {
    "memorial_number": ["numero do memorial descritivo", "numero do memorial", "memorial descritivo", "memorial", "n md", "no md", "numero md", "md"],
    "area_m2": ["area m2", "area", "metragem", "tamanho", "area total", "area aproximada"],
    "asset_type": ["tipo de ativo", "uso", "tipo de imovel", "tipo de uso"],
    "land_type": ["tipo de terreno", "tipo terreno", "tipo"],
    "status": ["status da negociacao", "status negociacao", "status"],
    "commercial_progress": ["andamento comercial", "andamento", "observacoes comerciais"],
    "offered_to": ["empresas para as quais foi oferecida", "oferecida para", "ofertado para", "empresas ofertadas", "empresas"],
    "city": ["cidade", "municipio"],
    "neighborhood": ["bairro"],
    "zoning": ["zoneamento"],
    "coefficient": ["coeficiente de aproveitamento", "coeficiente", "ca", "indice"],
    "asking_value": ["valor pedido", "valor", "preco"],
    "negotiation_models": ["modelo de negociacao", "negociacao", "modalidade"],
    "contacts": ["contatos", "contato", "telefone", "telefones"],
    "owner_name": ["proprietario", "dono", "nome do proprietario"],
    "exact_address": ["endereco", "localizacao exata", "endereco completo"],
    "registry_number": ["matricula", "numero da matricula"]
  },
  "sensitive_fields": ["contacts", "owner_name", "exact_address", "registry_number"],
  "status_map": {
    "novo": "captured", "captado": "captured", "captada": "captured",
    "em qualificacao": "qualifying", "qualificando": "qualifying",
    "qualificada": "qualified", "qualificado": "qualified", "disponivel": "qualified", "ativo": "qualified", "ativa": "qualified",
    "em distribuicao": "distributing", "ofertada": "distributing", "ofertado": "distributing",
    "em negociacao": "negotiating", "negociando": "negotiating", "proposta": "negotiating",
    "fechado": "closed", "fechada": "closed", "vendido": "closed", "vendida": "closed",
    "perdido": "lost", "perdida": "lost", "cancelado": "lost",
    "arquivado": "archived", "arquivada": "archived"
  },
  "asset_type_map": {
    "terreno": "terreno", "urbano": "terreno", "lote": "terreno",
    "gleba": "gleba", "rural": "area_rural", "fazenda": "area_rural", "sitio": "area_rural",
    "galpao": "galpao", "industrial": "galpao", "pavilhao": "galpao",
    "predio": "imovel_retrofit", "casa": "imovel_retrofit", "retrofit": "imovel_retrofit"
  },
  "negotiation_model_map": {
    "venda": "sale", "compra": "sale", "permuta": "swap", "parceria": "partnership", "joint venture": "partnership", "outro": "other"
  },
  "defaults": { "city": "Porto Alegre", "state": "RS", "status": "captured" }
}$json$),
('buyers', $json${
  "header_search_rows": 15,
  "columns": {
    "organization_name": ["empresa", "nome da empresa", "razao social", "incorporadora", "construtora", "cliente", "comprador"],
    "cnpj": ["cnpj"],
    "contact_name": ["nome do contato", "contato", "responsavel", "nome"],
    "phone": ["telefone", "celular", "whatsapp", "fone", "telefones"],
    "email": ["e mail", "email"],
    "notes": ["observacoes", "observacao", "obs", "notas"]
  }
}$json$);

-- ---------------------------------------------------------------------------
-- Lotes de importação: append-only com cadeia de hashes (regra 2, D017).
-- Desfazer = novo lote que aponta o desfeito (undoes_batch_id); o original nunca muda.
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  kind public.import_kind not null,
  file_name text,
  file_sha256 text,
  mapping jsonb,
  counts jsonb not null default '{}',
  report jsonb not null default '{}',
  -- Hash das linhas de import_batch_items deste lote (ficam cobertas pela cadeia).
  items_hash text not null,
  undoes_batch_id uuid unique references public.import_batches (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  prev_hash text not null,
  row_hash text not null
);

create unique index import_batches_seq_idx on public.import_batches (seq);
create index import_batches_kind_idx on public.import_batches (kind, created_at desc);
create index import_batches_file_idx on public.import_batches (file_sha256);

create trigger import_batches_chain before insert on public.import_batches
  for each row execute function public.chain_hash();
create trigger import_batches_append_only before update or delete on public.import_batches
  for each row execute function public.reject_mutation();
create trigger import_batches_no_truncate before truncate on public.import_batches
  for each statement execute function public.reject_mutation();

-- Uma linha por linha da planilha (ou por área/comprador revertido no desfazer). Nunca guarda dado sensível.
create table public.import_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) deferrable initially deferred,
  line integer,
  target_id uuid,
  memorial_number text,
  -- inserted | updated | unchanged | duplicate | archived | restored | deleted | skipped
  action text not null,
  -- [{field, from, to}] (dado sensível: só {field, sensitive: true}; comprador: {field, to_hash})
  changes jsonb not null default '[]',
  -- [{field, platform, sheet}] (dado sensível e comprador: só {field, sensitive: true})
  conflicts jsonb not null default '[]',
  warnings jsonb not null default '[]',
  -- Estado anterior da importação desta área (para o desfazer)
  state_before jsonb,
  created_at timestamptz not null default now()
);

create index import_batch_items_batch_idx on public.import_batch_items (batch_id);
create index import_batch_items_target_idx on public.import_batch_items (target_id);

create trigger import_batch_items_append_only before update or delete on public.import_batch_items
  for each row execute function public.reject_mutation();
create trigger import_batch_items_no_truncate before truncate on public.import_batch_items
  for each statement execute function public.reject_mutation();

-- Antes/depois do dado sensível por lote (para o desfazer e para resolver conflito). Sem política: ninguém lê
-- direto (regra 1); só as funções de importação.
create table public.import_sensitive_snapshots (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) deferrable initially deferred,
  opportunity_id uuid not null references public.opportunities (id),
  before jsonb,
  after jsonb,
  -- Valores da planilha que ficaram em conflito (não aplicados)
  pending jsonb,
  created_at timestamptz not null default now()
);

create index import_sensitive_snapshots_idx on public.import_sensitive_snapshots (opportunity_id, created_at desc);

create trigger import_sensitive_snapshots_append_only before update or delete on public.import_sensitive_snapshots
  for each row execute function public.reject_mutation();
create trigger import_sensitive_snapshots_no_truncate before truncate on public.import_sensitive_snapshots
  for each statement execute function public.reject_mutation();

-- Estado da mesclagem por área: o último valor que veio da planilha (base), conflitos em aberto.
create table public.opportunity_import_state (
  opportunity_id uuid primary key references public.opportunities (id) on delete cascade,
  base jsonb not null default '{}',
  -- Hash (SHA-256) do último valor sensível importado, por campo; nunca o valor.
  sensitive_base jsonb not null default '{}',
  -- {field: {platform, sheet, batch_id}}; sensível: {field: {sensitive: true, batch_id}}
  conflicts jsonb not null default '{}',
  last_batch_id uuid not null,
  updated_at timestamptz not null default now()
);

create trigger opportunity_import_state_updated_at before update on public.opportunity_import_state
  for each row execute function public.set_updated_at();

alter table public.import_batches enable row level security;
alter table public.import_batch_items enable row level security;
alter table public.import_sensitive_snapshots enable row level security;
alter table public.opportunity_import_state enable row level security;

create policy import_batches_admin_select on public.import_batches for select to authenticated
  using ((select public.is_admin()));
create policy import_batch_items_admin_select on public.import_batch_items for select to authenticated
  using ((select public.is_admin()));
create policy opportunity_import_state_admin_select on public.opportunity_import_state for select to authenticated
  using ((select public.is_admin()));

revoke all on public.import_batches, public.import_batch_items, public.import_sensitive_snapshots,
  public.opportunity_import_state from anon;
revoke insert, update, delete, truncate on public.import_batches, public.import_batch_items,
  public.import_sensitive_snapshots, public.opportunity_import_state from authenticated, service_role;
revoke select on public.import_sensitive_snapshots from authenticated, service_role;

alter table public.buyer_prospects
  add constraint buyer_prospects_batch_fk foreign key (source_batch_id) references public.import_batches (id)
  deferrable initially deferred;

-- Cadeia verificável também para os lotes
create or replace function public.verify_hash_chain(p_table text)
returns table (broken_seq bigint, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_prev text := '';
begin
  if not public.is_admin_or_backend() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if p_table not in ('access_log', 'distributions', 'distribution_events', 'agreements', 'agreement_revocations',
                     'import_batches') then
    raise exception 'Tabela sem cadeia de hashes: %', p_table using errcode = '22023';
  end if;
  for r in execute format('select seq, prev_hash, row_hash, to_jsonb(t) as j from public.%I t order by seq', p_table) loop
    if r.prev_hash is distinct from v_prev then
      return query select r.seq, 'prev_hash não confere (linha removida ou reordenada)'::text;
      return;
    end if;
    if r.row_hash is distinct from public.sha256_hex(r.prev_hash || public.chain_row_payload(r.j)) then
      return query select r.seq, 'conteúdo alterado'::text;
      return;
    end if;
    v_prev := r.row_hash;
  end loop;
end;
$$;

-- Itens do lote cobertos pela cadeia: a função de verificação recalcula e compara.
create or replace function public.import_items_hash(p_batch_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.sha256_hex(coalesce(string_agg(
           (to_jsonb(i) - 'created_at')::text, '|' order by i.line nulls last, i.id), ''))
    from public.import_batch_items i where i.batch_id = p_batch_id;
$$;

create or replace function public.verify_import_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_or_backend()
     and (select b.items_hash from public.import_batches b where b.id = p_batch_id) = public.import_items_hash(p_batch_id);
$$;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
-- jsonb "vazio" (ausente, null ou texto em branco) = sem informação: nunca apaga valor da plataforma.
create or replace function public.import_blank(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or p = 'null'::jsonb or (jsonb_typeof(p) = 'string' and trim(p #>> '{}') = '')
      or (jsonb_typeof(p) = 'array' and jsonb_array_length(p) = 0)
      or (jsonb_typeof(p) = 'object' and p = '{}'::jsonb);
$$;

create or replace function public.import_value_hash(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when public.import_blank(p) then null else public.sha256_hex(p::text) end;
$$;

-- Lote é desfazível se não foi desfeito, não é um desfazer e não há lote posterior do mesmo tipo em vigor.
create or replace function public.import_batch_undoable(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.import_batches b
     where b.id = p_batch_id and b.undoes_batch_id is null
       and not exists (select 1 from public.import_batches u where u.undoes_batch_id = b.id)
       and not exists (
         select 1 from public.import_batches later
          where later.kind = b.kind and later.seq > b.seq and later.undoes_batch_id is null
            and not exists (select 1 from public.import_batches u2 where u2.undoes_batch_id = later.id)));
$$;

-- ---------------------------------------------------------------------------
-- Importação do Land Bank (prévia e gravação pela mesma função)
-- p_rows: [{line, warnings, opportunity: {memorial_number, campos..., extra}, sensitive: {...} | null}] (parser do app)
-- Regras por campo (mesclagem a três vias, base = último valor importado):
--   planilha = base → mantém a plataforma | plataforma = base → aplica a planilha | ambos mudaram → CONFLITO
--   célula vazia nunca apaga; campo nunca importado: preenche se a plataforma está vazia, senão conflito.
-- Área nova: mandato "desconhecido" (não distribui); status acima de "em qualificação" só se publicável.
-- ---------------------------------------------------------------------------
create or replace function public.import_landbank(
  p_file_name text,
  p_file_sha256 text,
  p_mapping jsonb,
  p_rows jsonb,
  p_parse_report jsonb default '{}',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array['asset_type', 'land_type', 'area_m2', 'city', 'neighborhood', 'state', 'zoning',
                                    'coefficient', 'asking_value', 'negotiation_models', 'status'];
  c_sfields constant text[] := array['registry_number', 'exact_address', 'owner_name', 'owner_contacts'];
  v_batch uuid := gen_random_uuid();
  v_note text := 'Importação do Land Bank (' || coalesce(p_file_name, 'arquivo') || ')';
  r jsonb;
  f text;
  o public.opportunities;
  v_probe public.opportunities;
  v_found boolean;
  v_revive boolean;
  st public.opportunity_import_state;
  v_sheet jsonb;
  v_cur jsonb;
  v_base jsonb;
  v_conf jsonb;
  v_patch jsonb;
  v_changes jsonb;
  v_conflicts jsonb;
  v_warnings jsonb;
  sv jsonb;
  cv jsonb;
  bv jsonb;
  v_action text;
  v_new_status text;
  v_blockers text[];
  v_id uuid;
  v_extra jsonb;
  v_state_before jsonb;
  -- sensível
  v_ssheet jsonb;
  v_scur jsonb;
  v_sbase jsonb;
  v_spatch jsonb;
  v_spending jsonb;
  v_sbefore jsonb;
  v_shash text;
  -- saída
  v_rows_out jsonb := '[]';
  v_counts jsonb;
  n_inserted int := 0;
  n_updated int := 0;
  n_unchanged int := 0;
  n_conflict_rows int := 0;
  n_capped int := 0;
  n_legacy int := 0;
  v_seen text[] := '{}';
  v_prev_batch uuid;
begin
  if not public.is_admin_or_backend() then
    raise exception 'Somente a curadoria importa' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Linhas inválidas' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.import_landbank'));

  select b.id into v_prev_batch from public.import_batches b
   where b.kind = 'landbank' and b.file_sha256 = p_file_sha256 and b.undoes_batch_id is null
     and not exists (select 1 from public.import_batches u where u.undoes_batch_id = b.id)
   order by b.seq desc limit 1;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_sheet := coalesce(r -> 'opportunity', '{}');
    v_warnings := coalesce(r -> 'warnings', '[]');
    v_changes := '[]';
    v_conflicts := '[]';
    v_patch := '{}';
    v_spatch := '{}';
    v_spending := '{}';
    v_sbefore := null;
    v_state_before := null;

    if coalesce(trim(v_sheet ->> 'memorial_number'), '') = '' then
      continue; -- o parser já rejeita; defesa
    end if;
    if (v_sheet ->> 'memorial_number') = any (v_seen) then
      v_rows_out := v_rows_out || jsonb_build_object('line', r -> 'line', 'memorial_number', v_sheet ->> 'memorial_number',
        'action', 'duplicate', 'changes', '[]'::jsonb, 'conflicts', '[]'::jsonb, 'warnings', '["duplicado no arquivo"]'::jsonb);
      continue;
    end if;
    v_seen := v_seen || (v_sheet ->> 'memorial_number');

    -- Tipo de ativo fora da lista: não aplica (aviso)
    if not public.import_blank(v_sheet -> 'asset_type') and not public.is_valid_asset_type(v_sheet ->> 'asset_type') then
      v_warnings := v_warnings || to_jsonb('tipo de ativo "' || (v_sheet ->> 'asset_type') || '" fora da lista; ignorado');
      v_sheet := v_sheet - 'asset_type';
    end if;

    select * into o from public.opportunities where memorial_number = v_sheet ->> 'memorial_number';
    v_found := found;
    st := null;
    if v_found then
      select * into st from public.opportunity_import_state where opportunity_id = o.id;
    end if;
    v_revive := v_found and st.opportunity_id is null and coalesce((o.extra ->> 'import_undone')::boolean, false);

    if not v_found or v_revive then
      -- ------------------------------------------------ área nova (ou reimportada depois de desfeita)
      v_action := 'inserted';
      v_id := case when v_found then o.id else gen_random_uuid() end;
      if v_found then
        v_state_before := jsonb_build_object('revived', true, 'opportunity', jsonb_build_object(
          'status', o.status, 'extra', o.extra));
      end if;
      foreach f in array c_fields loop
        if not public.import_blank(v_sheet -> f) then
          v_patch := v_patch || jsonb_build_object(f, v_sheet -> f);
        end if;
      end loop;
      v_patch := jsonb_build_object(
          'city', coalesce(p_mapping #> '{defaults,city}', '"Porto Alegre"'),
          'state', coalesce(p_mapping #> '{defaults,state}', '"RS"'),
          'status', coalesce(p_mapping #> '{defaults,status}', '"captured"'))
        || v_patch;
      -- status acima de "em qualificação" exige publicável (a importação não pula a checagem)
      v_new_status := v_patch ->> 'status';
      if v_new_status in ('qualified', 'distributing', 'negotiating') then
        v_probe := jsonb_populate_record(null::public.opportunities,
               v_patch || jsonb_build_object('id', v_id, 'mandate_status', 'unknown'));
        v_blockers := array(select public.publish_blockers_of(v_probe));
        if cardinality(v_blockers) > 0 then
          v_patch := v_patch || '{"status": "qualifying"}';
          v_warnings := v_warnings || to_jsonb('status "' || v_new_status || '" rebaixado para "em qualificação": falta '
                                               || array_to_string(v_blockers, ', '));
          n_capped := n_capped + 1;
        end if;
      end if;
      select jsonb_agg(jsonb_build_object('field', k, 'from', null, 'to', v)) into v_changes from jsonb_each(v_patch) as e(k, v);
      v_changes := coalesce(v_changes, '[]');
      v_base := v_patch;
      v_conf := '{}';

      if r -> 'sensitive' is not null and jsonb_typeof(r -> 'sensitive') = 'object' then
        v_ssheet := r -> 'sensitive';
        v_sbase := '{}';
        foreach f in array c_sfields loop
          if not public.import_blank(v_ssheet -> f) then
            v_spatch := v_spatch || jsonb_build_object(f, v_ssheet -> f);
            v_sbase := v_sbase || jsonb_build_object(f, public.import_value_hash(v_ssheet -> f));
            v_changes := v_changes || jsonb_build_object('field', f, 'sensitive', true);
          end if;
        end loop;
      else
        v_sbase := '{}';
      end if;

      if not p_dry_run then
        v_extra := coalesce(case when v_found then o.extra - 'import_undone' end, '{}')
                   || jsonb_build_object('landbank', coalesce(v_sheet #> '{extra,landbank}', '{}')
                        || jsonb_build_object('batch_id', v_batch, 'line', r -> 'line'));
        if v_sheet #> '{extra,legacy_offered_to}' is not null then
          v_extra := v_extra || jsonb_build_object('legacy_offered_to', v_sheet #> '{extra,legacy_offered_to}');
        end if;
        perform set_config('app.event_note', v_note, true);
        if v_found then
          update public.opportunities t set
            asset_type = p.asset_type, land_type = p.land_type, area_m2 = p.area_m2, city = p.city,
            neighborhood = p.neighborhood, state = p.state, zoning = p.zoning, coefficient = p.coefficient,
            asking_value = p.asking_value, negotiation_models = coalesce(p.negotiation_models, '{}'),
            status = p.status, mandate_status = 'unknown', published_at = null, extra = v_extra
          from jsonb_populate_record(null::public.opportunities, v_patch) p
          where t.id = v_id;
        else
          insert into public.opportunities (id, memorial_number, asset_type, land_type, area_m2, city, neighborhood,
            state, zoning, coefficient, asking_value, negotiation_models, status, mandate_status, extra)
          select v_id, v_sheet ->> 'memorial_number', p.asset_type, p.land_type, p.area_m2, p.city, p.neighborhood,
            p.state, p.zoning, p.coefficient, p.asking_value, coalesce(p.negotiation_models, '{}'), p.status,
            'unknown', v_extra
          from jsonb_populate_record(null::public.opportunities, v_patch) p;
        end if;
        if v_spatch <> '{}' then
          insert into public.opportunity_sensitive (opportunity_id, registry_number, exact_address, owner_name, owner_contacts)
          select v_id, p.registry_number, p.exact_address, p.owner_name, coalesce(p.owner_contacts, '{}')
            from jsonb_populate_record(null::public.opportunity_sensitive, v_spatch) p
          on conflict (opportunity_id) do update set
            registry_number = excluded.registry_number, exact_address = excluded.exact_address,
            owner_name = excluded.owner_name, owner_contacts = excluded.owner_contacts, updated_at = now();
          insert into public.import_sensitive_snapshots (batch_id, opportunity_id, before, after)
          values (v_batch, v_id, null, v_spatch);
        end if;
        insert into public.opportunity_import_state (opportunity_id, base, sensitive_base, conflicts, last_batch_id)
        values (v_id, v_base, v_sbase, '{}', v_batch);
      end if;
      n_inserted := n_inserted + 1;
    else
      -- ------------------------------------------------ área existente: mesclagem a três vias
      v_cur := to_jsonb(o);
      v_base := coalesce(st.base, '{}');
      v_conf := coalesce(st.conflicts, '{}');
      v_state_before := case when st.opportunity_id is null then null else jsonb_build_object(
        'base', st.base, 'sensitive_base', st.sensitive_base, 'conflicts', st.conflicts, 'last_batch_id', st.last_batch_id) end;

      foreach f in array c_fields loop
        sv := v_sheet -> f;
        continue when public.import_blank(sv);
        cv := coalesce(v_cur -> f, 'null');
        bv := v_base -> f;
        if public.import_blank(cv) then cv := 'null'; end if;
        if bv is null then
          if cv = 'null' then
            v_patch := v_patch || jsonb_build_object(f, sv);
          elsif cv = sv then
            v_base := v_base || jsonb_build_object(f, sv);
            v_conf := v_conf - f;
          else
            v_conflicts := v_conflicts || jsonb_build_object('field', f, 'platform', cv, 'sheet', sv);
            v_conf := v_conf || jsonb_build_object(f, jsonb_build_object('platform', cv, 'sheet', sv, 'batch_id', v_batch));
          end if;
        elsif sv = bv then
          null; -- planilha não mudou: vale a plataforma (inclusive edição manual)
        elsif cv = bv then
          v_patch := v_patch || jsonb_build_object(f, sv);
        elsif cv = sv then
          v_base := v_base || jsonb_build_object(f, sv);
          v_conf := v_conf - f;
        else
          v_conflicts := v_conflicts || jsonb_build_object('field', f, 'platform', cv, 'sheet', sv);
          v_conf := v_conf || jsonb_build_object(f, jsonb_build_object('platform', cv, 'sheet', sv, 'batch_id', v_batch));
        end if;
      end loop;

      -- status: subir para qualificada/distribuição/negociação só se publicável
      if v_patch ? 'status' and (v_patch ->> 'status') in ('qualified', 'distributing', 'negotiating')
         and o.status in ('captured', 'qualifying') then
        v_blockers := array(select public.publish_blockers_of(
          jsonb_populate_record(o, v_patch - 'status')));
        if cardinality(v_blockers) > 0 then
          v_warnings := v_warnings || to_jsonb('status "' || (v_patch ->> 'status') || '" rebaixado para "em qualificação": falta '
                                               || array_to_string(v_blockers, ', '));
          v_patch := v_patch || '{"status": "qualifying"}';
          n_capped := n_capped + 1;
        end if;
      end if;
      -- aplicado vira base; mudança sem efeito sai do patch
      for f, sv in select k, v from jsonb_each(v_patch) as e(k, v) loop
        v_base := v_base || jsonb_build_object(f, sv);
        v_conf := v_conf - f;
        if coalesce(v_cur -> f, 'null') = sv then
          v_patch := v_patch - f;
        else
          v_changes := v_changes || jsonb_build_object('field', f, 'from', coalesce(v_cur -> f, 'null'), 'to', sv);
        end if;
      end loop;

      -- sensível: mesma regra, comparando hashes (o valor nunca sai da tabela restrita)
      v_sbase := coalesce(st.sensitive_base, '{}');
      if r -> 'sensitive' is not null and jsonb_typeof(r -> 'sensitive') = 'object' then
        v_ssheet := r -> 'sensitive';
        select to_jsonb(s) into v_scur from public.opportunity_sensitive s where s.opportunity_id = o.id;
        v_scur := coalesce(v_scur, '{}');
        foreach f in array c_sfields loop
          sv := v_ssheet -> f;
          continue when public.import_blank(sv);
          v_shash := public.import_value_hash(v_scur -> f);
          if v_sbase ->> f is null then
            if v_shash is null then
              v_spatch := v_spatch || jsonb_build_object(f, sv);
            elsif v_shash = public.import_value_hash(sv) then
              v_sbase := v_sbase || jsonb_build_object(f, v_shash);
              v_conf := v_conf - f;
            else
              v_spending := v_spending || jsonb_build_object(f, sv);
            end if;
          elsif public.import_value_hash(sv) = v_sbase ->> f then
            null;
          elsif v_shash is not distinct from v_sbase ->> f then
            v_spatch := v_spatch || jsonb_build_object(f, sv);
          elsif v_shash = public.import_value_hash(sv) then
            v_sbase := v_sbase || jsonb_build_object(f, v_shash);
            v_conf := v_conf - f;
          else
            v_spending := v_spending || jsonb_build_object(f, sv);
          end if;
        end loop;
        for f in select jsonb_object_keys(v_spatch) loop
          v_sbase := v_sbase || jsonb_build_object(f, public.import_value_hash(v_spatch -> f));
          v_conf := v_conf - f;
          v_changes := v_changes || jsonb_build_object('field', f, 'sensitive', true);
        end loop;
        for f in select jsonb_object_keys(v_spending) loop
          v_conflicts := v_conflicts || jsonb_build_object('field', f, 'sensitive', true);
          v_conf := v_conf || jsonb_build_object(f, jsonb_build_object('sensitive', true, 'batch_id', v_batch));
        end loop;
        if v_spatch <> '{}' or v_spending <> '{}' then
          v_sbefore := (select jsonb_object_agg(k, v_scur -> k) from jsonb_object_keys(v_spatch) as k);
        end if;
      end if;

      v_action := case when jsonb_array_length(v_changes) > 0 then 'updated' else 'unchanged' end;

      if not p_dry_run then
        v_extra := o.extra || jsonb_build_object('landbank', coalesce(v_sheet #> '{extra,landbank}', '{}')
                     || jsonb_build_object('batch_id', v_batch, 'line', r -> 'line'));
        if v_sheet #> '{extra,legacy_offered_to}' is not null then
          v_extra := v_extra || jsonb_build_object('legacy_offered_to', v_sheet #> '{extra,legacy_offered_to}');
        end if;
        v_state_before := coalesce(v_state_before, '{}') || jsonb_build_object('extra', jsonb_build_object(
          'landbank', o.extra -> 'landbank', 'legacy_offered_to', o.extra -> 'legacy_offered_to'));
        perform set_config('app.event_note', v_note, true);
        update public.opportunities t set
          asset_type = case when v_patch ? 'asset_type' then p.asset_type else t.asset_type end,
          land_type = case when v_patch ? 'land_type' then p.land_type else t.land_type end,
          area_m2 = case when v_patch ? 'area_m2' then p.area_m2 else t.area_m2 end,
          city = case when v_patch ? 'city' then p.city else t.city end,
          neighborhood = case when v_patch ? 'neighborhood' then p.neighborhood else t.neighborhood end,
          state = case when v_patch ? 'state' then p.state else t.state end,
          zoning = case when v_patch ? 'zoning' then p.zoning else t.zoning end,
          coefficient = case when v_patch ? 'coefficient' then p.coefficient else t.coefficient end,
          asking_value = case when v_patch ? 'asking_value' then p.asking_value else t.asking_value end,
          negotiation_models = case when v_patch ? 'negotiation_models' then p.negotiation_models else t.negotiation_models end,
          status = case when v_patch ? 'status' then p.status else t.status end,
          extra = v_extra
        from jsonb_populate_record(null::public.opportunities, v_patch) p
        where t.id = o.id;
        if v_spatch <> '{}' then
          insert into public.opportunity_sensitive (opportunity_id) values (o.id) on conflict (opportunity_id) do nothing;
          update public.opportunity_sensitive t set
            registry_number = case when v_spatch ? 'registry_number' then p.registry_number else t.registry_number end,
            exact_address = case when v_spatch ? 'exact_address' then p.exact_address else t.exact_address end,
            owner_name = case when v_spatch ? 'owner_name' then p.owner_name else t.owner_name end,
            owner_contacts = case when v_spatch ? 'owner_contacts' then p.owner_contacts else t.owner_contacts end,
            updated_at = now()
          from jsonb_populate_record(null::public.opportunity_sensitive, v_spatch) p
          where t.opportunity_id = o.id;
        end if;
        if v_spatch <> '{}' or v_spending <> '{}' then
          insert into public.import_sensitive_snapshots (batch_id, opportunity_id, before, after, pending)
          values (v_batch, o.id, v_sbefore, nullif(v_spatch, '{}'), nullif(v_spending, '{}'));
        end if;
        insert into public.opportunity_import_state (opportunity_id, base, sensitive_base, conflicts, last_batch_id)
        values (o.id, v_base, v_sbase, v_conf, v_batch)
        on conflict (opportunity_id) do update set
          base = excluded.base, sensitive_base = excluded.sensitive_base, conflicts = excluded.conflicts,
          last_batch_id = excluded.last_batch_id;
        if jsonb_array_length(v_changes) > 0 or jsonb_array_length(v_conflicts) > 0 then
          insert into public.opportunity_events (opportunity_id, kind, note, actor_id)
          values (o.id, 'imported', v_note || ': '
                  || coalesce((select 'atualizou ' || string_agg(c ->> 'field', ', ') from jsonb_array_elements(v_changes) c), 'nada atualizado')
                  || coalesce((select '; conflito em ' || string_agg(c ->> 'field', ', ') from jsonb_array_elements(v_conflicts) c), ''),
                  auth.uid());
        end if;
      end if;
      v_id := o.id;
      if v_action = 'updated' then n_updated := n_updated + 1; else n_unchanged := n_unchanged + 1; end if;
    end if;

    if jsonb_array_length(v_conflicts) > 0 then
      n_conflict_rows := n_conflict_rows + 1;
    end if;

    if not p_dry_run then
      insert into public.import_batch_items (batch_id, line, target_id, memorial_number, action, changes, conflicts,
                                             warnings, state_before)
      values (v_batch, (r ->> 'line')::int, v_id, v_sheet ->> 'memorial_number', v_action, v_changes, v_conflicts,
              v_warnings, v_state_before);
    end if;
    v_rows_out := v_rows_out || jsonb_build_object('line', r -> 'line', 'memorial_number', v_sheet ->> 'memorial_number',
      'action', v_action, 'changes', v_changes, 'conflicts', v_conflicts, 'warnings', v_warnings);
  end loop;

  if not p_dry_run then
    n_legacy := public.import_legacy_distributions();
  end if;

  v_counts := jsonb_build_object('inserted', n_inserted, 'updated', n_updated, 'unchanged', n_unchanged,
    'conflict_rows', n_conflict_rows, 'status_capped', n_capped, 'legacy_distributions', n_legacy,
    'rejected', coalesce(jsonb_array_length(p_parse_report -> 'rejected'), 0),
    'ignored', coalesce(jsonb_array_length(p_parse_report -> 'ignored'), 0));

  if not p_dry_run then
    insert into public.import_batches (id, kind, file_name, file_sha256, mapping, counts, report, items_hash, created_by)
    values (v_batch, 'landbank', p_file_name, p_file_sha256, p_mapping, v_counts,
            jsonb_build_object('rows', v_rows_out, 'parse', p_parse_report),
            public.import_items_hash(v_batch), auth.uid());
  end if;

  return jsonb_build_object('batch_id', case when p_dry_run then null else v_batch end, 'dry_run', p_dry_run,
    'counts', v_counts, 'rows', v_rows_out, 'already_imported_batch_id', v_prev_batch);
end;
$$;

-- ---------------------------------------------------------------------------
-- Importação de compradores (buyer_prospects). Chave: CNPJ, senão e-mail, senão empresa + telefone.
-- Existente: só preenche campo vazio; valor diferente vira conflito (nunca sobrescreve). Sem dado pessoal no relatório.
-- ---------------------------------------------------------------------------
create or replace function public.buyer_dedupe_key(p_org text, p_cnpj text, p_email text, p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')) = 14
      then 'cnpj:' || regexp_replace(p_cnpj, '\D', '', 'g')
    when coalesce(trim(p_email), '') <> '' then 'email:' || lower(trim(p_email))
    when coalesce(trim(p_org), '') <> ''
      then 'org:' || lower(regexp_replace(trim(p_org), '\s+', ' ', 'g')) || ':' || regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
  end;
$$;

create or replace function public.import_buyers(
  p_file_name text,
  p_file_sha256 text,
  p_mapping jsonb,
  p_rows jsonb,
  p_parse_report jsonb default '{}',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array['organization_name', 'cnpj', 'contact_name', 'phone', 'email', 'notes'];
  v_batch uuid := gen_random_uuid();
  r jsonb;
  f text;
  v_key text;
  v_seen text[] := '{}';
  p public.buyer_prospects;
  v_cur jsonb;
  sv jsonb;
  v_patch jsonb;
  v_changes jsonb;
  v_conflicts jsonb;
  v_action text;
  v_id uuid;
  v_rows_out jsonb := '[]';
  v_counts jsonb;
  n_inserted int := 0;
  n_updated int := 0;
  n_unchanged int := 0;
  n_dup int := 0;
  n_conflict_rows int := 0;
  v_prev_batch uuid;
begin
  if not public.is_admin_or_backend() then
    raise exception 'Somente a curadoria importa' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Linhas inválidas' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.import_buyers'));

  select b.id into v_prev_batch from public.import_batches b
   where b.kind = 'buyers' and b.file_sha256 = p_file_sha256 and b.undoes_batch_id is null
     and not exists (select 1 from public.import_batches u where u.undoes_batch_id = b.id)
   order by b.seq desc limit 1;

  for r in select value from jsonb_array_elements(p_rows) loop
    -- CNPJ só com dígitos; inválido fica de fora (aviso vem do parser)
    if not public.import_blank(r -> 'cnpj') then
      r := r || jsonb_build_object('cnpj', nullif(regexp_replace(r ->> 'cnpj', '\D', '', 'g'), ''));
      if length(r ->> 'cnpj') <> 14 then r := r - 'cnpj'; end if;
    end if;
    v_key := public.buyer_dedupe_key(r ->> 'organization_name', r ->> 'cnpj', r ->> 'email', r ->> 'phone');
    v_changes := '[]';
    v_conflicts := '[]';
    v_patch := '{}';
    v_id := null;
    if v_key is null or public.import_blank(r -> 'organization_name') then
      v_action := 'skipped';
    elsif v_key = any (v_seen) then
      v_action := 'duplicate';
      n_dup := n_dup + 1;
    else
      v_seen := v_seen || v_key;
      select * into p from public.buyer_prospects where dedupe_key = v_key;
      if not found then
        v_action := 'inserted';
        v_id := gen_random_uuid();
        foreach f in array c_fields loop
          if not public.import_blank(r -> f) then
            v_patch := v_patch || jsonb_build_object(f, r -> f);
            v_changes := v_changes || jsonb_build_object('field', f, 'to_hash', public.import_value_hash(r -> f));
          end if;
        end loop;
        if not p_dry_run then
          insert into public.buyer_prospects (id, dedupe_key, organization_name, cnpj, contact_name, phone, email, notes,
                                              source_batch_id)
          select v_id, v_key, x.organization_name, x.cnpj, x.contact_name, x.phone, x.email, x.notes, v_batch
            from jsonb_populate_record(null::public.buyer_prospects, v_patch) x;
        end if;
        n_inserted := n_inserted + 1;
      else
        v_id := p.id;
        v_cur := to_jsonb(p);
        foreach f in array c_fields loop
          sv := r -> f;
          continue when public.import_blank(sv);
          if public.import_blank(v_cur -> f) then
            v_patch := v_patch || jsonb_build_object(f, sv);
            v_changes := v_changes || jsonb_build_object('field', f, 'to_hash', public.import_value_hash(sv));
          elsif public.import_value_hash(v_cur -> f) <> public.import_value_hash(sv) then
            v_conflicts := v_conflicts || jsonb_build_object('field', f, 'sensitive', true);
          end if;
        end loop;
        v_action := case when v_patch <> '{}' then 'updated' else 'unchanged' end;
        if v_patch <> '{}' and not p_dry_run then
          update public.buyer_prospects t set
            contact_name = coalesce(t.contact_name, x.contact_name), phone = coalesce(t.phone, x.phone),
            email = coalesce(t.email, x.email), notes = coalesce(t.notes, x.notes), cnpj = coalesce(t.cnpj, x.cnpj)
          from jsonb_populate_record(null::public.buyer_prospects, v_patch) x
          where t.id = p.id;
        end if;
        if v_action = 'updated' then n_updated := n_updated + 1; else n_unchanged := n_unchanged + 1; end if;
      end if;
    end if;
    if jsonb_array_length(v_conflicts) > 0 then n_conflict_rows := n_conflict_rows + 1; end if;

    if not p_dry_run then
      insert into public.import_batch_items (batch_id, line, target_id, action, changes, conflicts, warnings)
      values (v_batch, (r ->> 'line')::int, v_id, v_action, v_changes, v_conflicts, coalesce(r -> 'warnings', '[]'));
    end if;
    -- Relatório sem dado pessoal: linha, ação e nomes dos campos.
    v_rows_out := v_rows_out || jsonb_build_object('line', r -> 'line', 'action', v_action,
      'changes', (select coalesce(jsonb_agg(c ->> 'field'), '[]') from jsonb_array_elements(v_changes) c),
      'conflicts', (select coalesce(jsonb_agg(c ->> 'field'), '[]') from jsonb_array_elements(v_conflicts) c),
      'warnings', coalesce(r -> 'warnings', '[]'));
  end loop;

  v_counts := jsonb_build_object('inserted', n_inserted, 'updated', n_updated, 'unchanged', n_unchanged,
    'duplicates', n_dup, 'conflict_rows', n_conflict_rows,
    'rejected', coalesce(jsonb_array_length(p_parse_report -> 'rejected'), 0),
    'ignored', coalesce(jsonb_array_length(p_parse_report -> 'ignored'), 0));

  if not p_dry_run then
    insert into public.import_batches (id, kind, file_name, file_sha256, mapping, counts, report, items_hash, created_by)
    values (v_batch, 'buyers', p_file_name, p_file_sha256, p_mapping, v_counts,
            jsonb_build_object('rows', v_rows_out, 'parse', p_parse_report),
            public.import_items_hash(v_batch), auth.uid());
  end if;

  return jsonb_build_object('batch_id', case when p_dry_run then null else v_batch end, 'dry_run', p_dry_run,
    'counts', v_counts, 'rows', v_rows_out, 'already_imported_batch_id', v_prev_batch);
end;
$$;

-- ---------------------------------------------------------------------------
-- Desfazer o lote mais recente de um tipo.
-- Área criada pelo lote: arquivada e marcada (o histórico append-only — eventos, distribuições legadas — impede
-- apagar; arquivada sai do catálogo e reimportar a revive). Área atualizada: cada campo volta ao valor anterior
-- se ninguém o mudou depois; senão fica e entra no relatório. Comprador criado: apagado.
-- ---------------------------------------------------------------------------
create or replace function public.undo_import_batch(p_batch_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.import_batches;
  it public.import_batch_items;
  ch jsonb;
  f text;
  o public.opportunities;
  v_cur jsonb;
  v_restore jsonb;
  v_skipped jsonb;
  v_undo uuid := gen_random_uuid();
  v_note text := 'Desfeita a importação ' || coalesce(nullif(trim(p_note), ''), '');
  v_rows_out jsonb := '[]';
  v_action text;
  snap public.import_sensitive_snapshots;
  v_scur jsonb;
  v_srestore jsonb;
  n_archived int := 0;
  n_restored int := 0;
  n_deleted int := 0;
  n_skipped_fields int := 0;
  v_counts jsonb;
begin
  if not public.is_admin_or_backend() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.import_undo'));
  select * into b from public.import_batches where id = p_batch_id;
  if not found then
    raise exception 'Lote não encontrado' using errcode = 'P0002';
  end if;
  if not public.import_batch_undoable(p_batch_id) then
    raise exception 'Só dá para desfazer o lote mais recente de cada tipo, uma vez' using errcode = '22023';
  end if;
  v_note := 'Desfeita a importação de ' || coalesce(b.file_name, 'arquivo')
            || coalesce(' — ' || nullif(trim(p_note), ''), '');

  for it in select * from public.import_batch_items where batch_id = p_batch_id and target_id is not null order by line loop
    v_skipped := '[]';
    v_restore := '{}';
    if b.kind = 'buyers' then
      if it.action = 'inserted' then
        delete from public.buyer_prospects where id = it.target_id;
        v_action := 'deleted';
        n_deleted := n_deleted + 1;
      elsif it.action = 'updated' then
        select to_jsonb(x) into v_cur from public.buyer_prospects x where x.id = it.target_id;
        for ch in select value from jsonb_array_elements(it.changes) loop
          f := ch ->> 'field';
          if public.import_value_hash(v_cur -> f) is not distinct from ch ->> 'to_hash' then
            v_restore := v_restore || jsonb_build_object(f, null);
          else
            v_skipped := v_skipped || to_jsonb(f);
          end if;
        end loop;
        update public.buyer_prospects t set
          contact_name = case when v_restore ? 'contact_name' then null else t.contact_name end,
          phone = case when v_restore ? 'phone' then null else t.phone end,
          email = case when v_restore ? 'email' then null else t.email end,
          notes = case when v_restore ? 'notes' then null else t.notes end,
          cnpj = case when v_restore ? 'cnpj' then null else t.cnpj end
        where t.id = it.target_id;
        v_action := 'restored';
        n_restored := n_restored + 1;
      else
        continue;
      end if;
    else
      select * into o from public.opportunities where id = it.target_id;
      continue when not found;
      if it.action = 'inserted' then
        perform set_config('app.event_note', v_note, true);
        if coalesce((it.state_before ->> 'revived')::boolean, false) then
          update public.opportunities set
            status = (it.state_before #>> '{opportunity,status}')::public.opportunity_status,
            extra = it.state_before #> '{opportunity,extra}', published_at = null
          where id = o.id;
        else
          update public.opportunities set
            status = 'archived', published_at = null,
            extra = extra || jsonb_build_object('import_undone', true, 'import_undone_batch_id', v_undo)
          where id = o.id;
        end if;
        delete from public.opportunity_sensitive where opportunity_id = o.id
          and exists (select 1 from public.import_sensitive_snapshots s
                       where s.batch_id = p_batch_id and s.opportunity_id = o.id and s.before is null);
        delete from public.opportunity_import_state where opportunity_id = o.id;
        v_action := 'archived';
        n_archived := n_archived + 1;
      elsif it.action = 'updated' then
        v_cur := to_jsonb(o);
        for ch in select value from jsonb_array_elements(it.changes) where not (value ? 'sensitive') loop
          f := ch ->> 'field';
          if coalesce(v_cur -> f, 'null') = ch -> 'to' then
            v_restore := v_restore || jsonb_build_object(f, ch -> 'from');
          else
            v_skipped := v_skipped || to_jsonb(f);
          end if;
        end loop;
        perform set_config('app.event_note', v_note, true);
        update public.opportunities t set
          asset_type = case when v_restore ? 'asset_type' then p.asset_type else t.asset_type end,
          land_type = case when v_restore ? 'land_type' then p.land_type else t.land_type end,
          area_m2 = case when v_restore ? 'area_m2' then p.area_m2 else t.area_m2 end,
          city = case when v_restore ? 'city' then p.city else t.city end,
          neighborhood = case when v_restore ? 'neighborhood' then p.neighborhood else t.neighborhood end,
          state = case when v_restore ? 'state' then p.state else t.state end,
          zoning = case when v_restore ? 'zoning' then p.zoning else t.zoning end,
          coefficient = case when v_restore ? 'coefficient' then p.coefficient else t.coefficient end,
          asking_value = case when v_restore ? 'asking_value' then p.asking_value else t.asking_value end,
          negotiation_models = case when v_restore ? 'negotiation_models' then coalesce(p.negotiation_models, '{}') else t.negotiation_models end,
          status = case when v_restore ? 'status' then p.status else t.status end,
          extra = t.extra - 'landbank' - 'legacy_offered_to'
                  || jsonb_strip_nulls(jsonb_build_object(
                       'landbank', it.state_before #> '{extra,landbank}',
                       'legacy_offered_to', it.state_before #> '{extra,legacy_offered_to}'))
        from jsonb_populate_record(null::public.opportunities, v_restore) p
        where t.id = o.id;
        -- sensível
        select * into snap from public.import_sensitive_snapshots
         where batch_id = p_batch_id and opportunity_id = o.id;
        if found and snap.after is not null then
          select to_jsonb(s) into v_scur from public.opportunity_sensitive s where s.opportunity_id = o.id;
          v_srestore := '{}';
          for f in select jsonb_object_keys(snap.after) loop
            if public.import_value_hash(v_scur -> f) is not distinct from public.import_value_hash(snap.after -> f) then
              v_srestore := v_srestore || jsonb_build_object(f, coalesce(snap.before -> f, 'null'));
            else
              v_skipped := v_skipped || to_jsonb(f);
            end if;
          end loop;
          update public.opportunity_sensitive t set
            registry_number = case when v_srestore ? 'registry_number' then p.registry_number else t.registry_number end,
            exact_address = case when v_srestore ? 'exact_address' then p.exact_address else t.exact_address end,
            owner_name = case when v_srestore ? 'owner_name' then p.owner_name else t.owner_name end,
            owner_contacts = case when v_srestore ? 'owner_contacts' then coalesce(p.owner_contacts, '{}') else t.owner_contacts end,
            updated_at = now()
          from jsonb_populate_record(null::public.opportunity_sensitive, v_srestore) p
          where t.opportunity_id = o.id;
        end if;
        v_action := 'restored';
        n_restored := n_restored + 1;
      else
        v_action := 'restored'; -- "unchanged": só o estado da mesclagem volta
      end if;
      -- estado da mesclagem volta ao anterior ao lote
      if it.action <> 'inserted' then
        if it.state_before ? 'base' then
          update public.opportunity_import_state set
            base = it.state_before -> 'base', sensitive_base = it.state_before -> 'sensitive_base',
            conflicts = it.state_before -> 'conflicts', last_batch_id = (it.state_before ->> 'last_batch_id')::uuid
          where opportunity_id = o.id;
        else
          delete from public.opportunity_import_state where opportunity_id = o.id;
        end if;
      end if;
    end if;
    n_skipped_fields := n_skipped_fields + jsonb_array_length(v_skipped);
    insert into public.import_batch_items (batch_id, line, target_id, memorial_number, action, changes, warnings)
    values (v_undo, it.line, it.target_id, it.memorial_number, v_action,
            (select coalesce(jsonb_agg(jsonb_build_object('field', k)), '[]') from jsonb_object_keys(v_restore) k),
            case when jsonb_array_length(v_skipped) > 0
                 then jsonb_build_array('editado depois do lote; mantido: ' ||
                        (select string_agg(x, ', ') from jsonb_array_elements_text(v_skipped) x))
                 else '[]' end);
    v_rows_out := v_rows_out || jsonb_build_object('line', it.line, 'memorial_number', it.memorial_number,
      'action', v_action, 'kept_fields', v_skipped);
  end loop;

  v_counts := jsonb_build_object('archived', n_archived, 'restored', n_restored, 'deleted', n_deleted,
    'kept_fields', n_skipped_fields,
    'legacy_distributions_kept', coalesce((b.counts ->> 'legacy_distributions')::int, 0));
  insert into public.import_batches (id, kind, file_name, file_sha256, counts, report, items_hash, undoes_batch_id, created_by)
  values (v_undo, b.kind, b.file_name, b.file_sha256, v_counts,
          jsonb_build_object('rows', v_rows_out, 'note', nullif(trim(p_note), '')),
          public.import_items_hash(v_undo), p_batch_id, auth.uid());
  return jsonb_build_object('batch_id', v_undo, 'counts', v_counts, 'rows', v_rows_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- Conflitos em aberto e resolução (curadoria escolhe: fica a plataforma ou vale a planilha)
-- ---------------------------------------------------------------------------
create or replace function public.admin_import_conflicts()
returns table (opportunity_id uuid, memorial_number text, field text, sensitive boolean, platform jsonb, sheet jsonb,
               batch_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.opportunity_id, o.memorial_number, c.key, coalesce((c.value ->> 'sensitive')::boolean, false),
         c.value -> 'platform', c.value -> 'sheet', (c.value ->> 'batch_id')::uuid
    from public.opportunity_import_state s
    join public.opportunities o on o.id = s.opportunity_id
    cross join lateral jsonb_each(s.conflicts) c
   where public.is_admin()
   order by o.memorial_number, c.key;
$$;

create or replace function public.resolve_import_conflict(p_opportunity_id uuid, p_field text, p_use_sheet boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.opportunity_import_state;
  c jsonb;
  v_pending jsonb;
  v_patch jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  select * into st from public.opportunity_import_state where opportunity_id = p_opportunity_id for update;
  c := st.conflicts -> p_field;
  if c is null then
    raise exception 'Conflito não encontrado' using errcode = 'P0002';
  end if;
  if coalesce((c ->> 'sensitive')::boolean, false) then
    select s.pending -> p_field into v_pending from public.import_sensitive_snapshots s
     where s.opportunity_id = p_opportunity_id and s.batch_id = (c ->> 'batch_id')::uuid;
    if p_use_sheet and v_pending is not null then
      v_patch := jsonb_build_object(p_field, v_pending);
      update public.opportunity_sensitive t set
        registry_number = case when v_patch ? 'registry_number' then p.registry_number else t.registry_number end,
        exact_address = case when v_patch ? 'exact_address' then p.exact_address else t.exact_address end,
        owner_name = case when v_patch ? 'owner_name' then p.owner_name else t.owner_name end,
        owner_contacts = case when v_patch ? 'owner_contacts' then coalesce(p.owner_contacts, '{}') else t.owner_contacts end,
        updated_at = now()
      from jsonb_populate_record(null::public.opportunity_sensitive, v_patch) p
      where t.opportunity_id = p_opportunity_id;
    end if;
    update public.opportunity_import_state set
      sensitive_base = sensitive_base || jsonb_build_object(p_field, public.import_value_hash(v_pending)),
      conflicts = conflicts - p_field
    where opportunity_id = p_opportunity_id;
  else
    if p_use_sheet then
      if p_field = 'status' then
        raise exception 'Status muda pela curadoria (Publicar / Controles), não pelo conflito' using errcode = '22023';
      end if;
      v_patch := jsonb_build_object(p_field, c -> 'sheet');
      perform set_config('app.event_note', 'Conflito da importação resolvido: vale a planilha (' || p_field || ')', true);
      update public.opportunities t set
        asset_type = case when v_patch ? 'asset_type' then p.asset_type else t.asset_type end,
        land_type = case when v_patch ? 'land_type' then p.land_type else t.land_type end,
        area_m2 = case when v_patch ? 'area_m2' then p.area_m2 else t.area_m2 end,
        city = case when v_patch ? 'city' then p.city else t.city end,
        neighborhood = case when v_patch ? 'neighborhood' then p.neighborhood else t.neighborhood end,
        state = case when v_patch ? 'state' then p.state else t.state end,
        zoning = case when v_patch ? 'zoning' then p.zoning else t.zoning end,
        coefficient = case when v_patch ? 'coefficient' then p.coefficient else t.coefficient end,
        asking_value = case when v_patch ? 'asking_value' then p.asking_value else t.asking_value end,
        negotiation_models = case when v_patch ? 'negotiation_models' then coalesce(p.negotiation_models, '{}') else t.negotiation_models end
      from jsonb_populate_record(null::public.opportunities, v_patch) p
      where t.id = p_opportunity_id;
    end if;
    update public.opportunity_import_state set
      base = base || jsonb_build_object(p_field, c -> 'sheet'),
      conflicts = conflicts - p_field
    where opportunity_id = p_opportunity_id;
  end if;
  insert into public.opportunity_events (opportunity_id, kind, note, actor_id)
  values (p_opportunity_id, 'imported',
          'Conflito da importação (' || p_field || '): ' || case when p_use_sheet then 'vale a planilha' else 'fica a plataforma' end,
          auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Painel de áreas publicáveis: o que falta por área ("dá para lançar com ~60 áreas?")
-- ---------------------------------------------------------------------------
create or replace function public.admin_publishable_overview()
returns table (id uuid, memorial_number text, status public.opportunity_status, mandate_status public.mandate_status,
               city text, neighborhood text, area_m2 numeric, published_at timestamptz, imported boolean,
               open_conflicts integer, blockers text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  return query
    select o.id, o.memorial_number, o.status, o.mandate_status, o.city, o.neighborhood, o.area_m2, o.published_at,
           (o.extra ? 'landbank'), coalesce((select count(*)::int from jsonb_object_keys(s.conflicts)), 0),
           array(select public.publish_blockers_of(o))
      from public.opportunities o
      left join public.opportunity_import_state s on s.opportunity_id = o.id
     where o.status not in ('archived', 'closed', 'lost')
     order by o.memorial_number;
end;
$$;

create or replace function public.admin_import_batches()
returns table (id uuid, kind public.import_kind, file_name text, counts jsonb, undoes_batch_id uuid,
               undone_by uuid, undoable boolean, created_by_name text, created_at timestamptz, chain_ok boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.kind, b.file_name, b.counts, b.undoes_batch_id,
         (select u.id from public.import_batches u where u.undoes_batch_id = b.id),
         public.import_batch_undoable(b.id),
         (select p.full_name from public.profiles p where p.user_id = b.created_by),
         b.created_at, b.items_hash = public.import_items_hash(b.id)
    from public.import_batches b
   where public.is_admin()
   order by b.seq desc;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke execute on function
  public.import_landbank(text, text, jsonb, jsonb, jsonb, boolean),
  public.import_buyers(text, text, jsonb, jsonb, jsonb, boolean),
  public.undo_import_batch(uuid, text),
  public.admin_import_conflicts(),
  public.resolve_import_conflict(uuid, text, boolean),
  public.admin_publishable_overview(),
  public.admin_import_batches(),
  public.import_items_hash(uuid),
  public.verify_import_batch(uuid),
  public.import_batch_undoable(uuid),
  public.is_valid_asset_type(text)
from public, anon;
grant execute on function
  public.import_landbank(text, text, jsonb, jsonb, jsonb, boolean),
  public.import_buyers(text, text, jsonb, jsonb, jsonb, boolean),
  public.undo_import_batch(uuid, text),
  public.admin_import_conflicts(),
  public.resolve_import_conflict(uuid, text, boolean),
  public.admin_publishable_overview(),
  public.admin_import_batches(),
  public.verify_import_batch(uuid),
  public.import_batch_undoable(uuid),
  public.is_valid_asset_type(text)
to authenticated;
grant execute on function
  public.import_landbank(text, text, jsonb, jsonb, jsonb, boolean),
  public.import_buyers(text, text, jsonb, jsonb, jsonb, boolean),
  public.undo_import_batch(uuid, text)
to service_role;
