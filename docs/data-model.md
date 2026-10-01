# Modelo de dados

Fonte da verdade: `supabase/migrations/`. Este documento resume o que existe e **por quê**.
Toda migration nova deve atualizar esta página.

Convenções: tabelas e colunas em inglês; todas com `id uuid`, `created_at`, `updated_at`
(trigger `set_updated_at`); **RLS habilitado em todas** — sem política = acesso negado.

## Migrations

| Arquivo | Conteúdo |
|---|---|
| `20260929000001_foundation.sql` | Tipos, identidade, admins da plataforma, configurações, oportunidades, dado sensível, mídia, `access_log`, view do dossiê cego, RPC do dado sensível, bucket de mídia |
| `20260929000002_geometry_import.sql` | RPC `set_opportunity_geometry` usada pelo importador KML/KMZ |

## Tipos (enums)

| Tipo | Valores |
|---|---|
| `organization_type` | developer, builder, urbanizer, land_developer, investor, brokerage, other |
| `opportunity_status` | captured, qualifying, qualified, distributing, negotiating, closed, lost, archived |
| `mandate_status` | exclusive, non_exclusive, being_obtained, none |
| `negotiation_model` | sale, swap, partnership, other |
| `media_kind` | photo, map, aerial, other |

## Tabelas

### `profiles`
Um por usuário do Auth (criado pelo trigger `on_auth_user_created`). Nome, telefone e campos de
opt-in de WhatsApp (`whatsapp_opt_in`, `opt_in_at`, `opt_in_text_version`) — regra 8.
**RLS:** cada um lê/edita o próprio; admin da plataforma lê todos.

### `organizations`
Empresas da rede (incorporadoras, construtoras, loteadoras, imobiliárias…).
**RLS:** só admin da plataforma (membros entram na Fase 1).

### `platform_admins`
Admins **da plataforma** (curadoria). `is_admin()` consulta só esta tabela (D007).
Não confundir com papel `admin` de organização (Fase 1). Inclusão só via `service_role`
(`npm run create-admin`). **RLS:** o usuário vê a própria linha; admin vê todas.

### `platform_settings`
Chave/valor (`jsonb`). Tudo que é regra de negócio configurável, inclusive o que
**DEPENDE DO JURÍDICO**:

| Chave | Padrão | Uso |
|---|---|---|
| `allow_distribution_without_mandate` | `false` | Regra 4 — jurídico |
| `default_tail_period_months` | `24` | Prazo de cauda — jurídico |
| `quiet_hours` | seg–sex 08:00–19:00 | Janela de envio (Fase 4) |
| `weekly_send_limit_per_recipient` | `5` | Teto de envios (Fase 4) |
| `blind_area_rounding_m2` | `100` | Dossiê cego (D003) |
| `blind_map_radius_m` | `500` | Dossiê cego (D003) |
| `blind_location_level` | `"neighborhood"` | Dossiê cego (D003) |

Leitura tipada por `setting_numeric()` / `setting_text()`.
**RLS:** logado lê; admin altera.

### `opportunities`
A área/terreno. Campos públicos do dossiê (tipo, metragem, cidade/bairro, zoneamento,
coeficiente, tipos de projeto, modelos de negociação, valor pedido), `memorial_number` (único),
`status`, `mandate_status` e responsável (`responsible_party_user_id` / `_org_id`) — regra 3.
`geometry` (PostGIS 4326) é a localização **exata** e por isso só admin lê a tabela.
`extra jsonb` guarda o que ainda não tem coluna (ex.: `legacy_offered_to`, D006).
**RLS:** só admin da plataforma. Demais leem pela view `opportunities_blind`.

### `opportunity_sensitive` (regra 1)
Matrícula, endereço exato, proprietário e contatos. **Sem nenhuma política** e sem privilégio
de tabela para `anon`/`authenticated`: nem admin faz SELECT direto. Leitura só pela RPC
`get_opportunity_sensitive(id)`, que checa permissão e **grava no `access_log` antes de
retornar**. Provado por pgTAP (`supabase/tests/01_sensitive_lock.test.sql`).

### `opportunity_media`
Fotos/mapas da área no bucket privado `opportunity-media`. `is_blind_safe` = curadoria manual
(foto pode identificar o terreno). **RLS:** admin tudo; quem pode ver o dossiê cego vê só mídia
`is_blind_safe`. A mesma regra vale para `storage.objects`.

### `access_log` (regra 2 — append-only)
Quem acessou o quê (ator, ação, recurso, oportunidade, IP, user-agent). Triggers rejeitam
UPDATE/DELETE/TRUNCATE para qualquer papel, inclusive `service_role`. Escrita só por funções
`SECURITY DEFINER`. **RLS:** admin lê.

## Views e funções

| Objeto | Descrição |
|---|---|
| `opportunities_blind` (view, `security_barrier`) | Dossiê cego calculado **no servidor**: título cego, metragem arredondada, bairro conforme `blind_location_level`, centro aproximado deslocado de forma determinística (`blind_center`) e raio. Filtra por `can_view_blind()` e esconde `archived`. |
| `is_admin()` | Usuário atual está em `platform_admins`. |
| `can_view_blind(id)` | Fase 0: `is_admin()`. Fase 4: destinatários de distribuições. |
| `get_opportunity_sensitive(id)` | Única leitura do dado sensível; exige permissão, registra log. Fase 5: `has_valid_agreement()`. |
| `set_opportunity_geometry(md, geojson[])` | Só `service_role` (importador KML). União das feições, sem Z. |
| `blind_center(id, geom)` / `round_area(m2)` | Auxiliares do dossiê cego, parametrizados por `platform_settings`. |

## Seeds (`supabase/seeds/`)

| Arquivo | Onde | Conteúdo |
|---|---|---|
| `01_local_users.sql` | **só local** | 2 usuários com senha conhecida (admin e sem permissão) |
| `02_demo_data.sql` | local e demo na nuvem | 4 organizações e 25 áreas **fictícias** com dado sensível fictício |

## Próximas fases (planejado)
- Fase 1: `organization_members`, `distributions` (append-only) + `distribution_events`
  (estado derivado), migração de `legacy_offered_to`, encadeamento de hashes no log.
- Fase 2: `owner_leads` (FK `origin_lead_id`).
- Fase 5: termos/aceites e `has_valid_agreement()`.
