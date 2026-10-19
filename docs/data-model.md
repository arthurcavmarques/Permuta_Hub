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
| `20261010000001_identity_orgs.sql` | Fase 1: status de conta (D014), membros, corretores/CRECI, consentimentos, caixa de saída, convites (D015), regras do corretor em `opportunities` |
| `20261010000002_distributions_append_only.sql` | Fase 1: `distributions`/`distribution_events` append-only (D016), cadeia de hashes (D017), legado (D018), `can_view_blind` ampliado, `integration_settings` |
| `20261019000001_agreements.sql` | Fase 2.1: termos versionados, aceites e revogações append-only, regra nova do dado sensível (D020) |

Reversão: `supabase/rollbacks/<migration>.down.sql` (rodar na ordem inversa; ver runbook).

## Tipos (enums)

| Tipo | Valores |
|---|---|
| `organization_type` | developer, builder, urbanizer, land_developer, investor, brokerage, other |
| `opportunity_status` | captured, qualifying, qualified, distributing, negotiating, closed, lost, archived |
| `mandate_status` | exclusive, non_exclusive, being_obtained, none |
| `negotiation_model` | sale, swap, partnership, other |
| `media_kind` | photo, map, aerial, other |
| `account_status` | pending, approved, rejected, suspended |
| `signup_kind` | broker, buyer |
| `member_role` | admin, broker, buyer, viewer |
| `verification_status` | pending, approved, rejected |
| `contact_channel` | whatsapp, email |
| `consent_purpose` | privacy_policy, whatsapp, email |
| `outbox_status` | queued, sent, failed |
| `distribution_source` | platform, legacy |
| `distribution_event_type` | queued, sent, delivered, read, opened, interested, declined, failed, opt_out |

## Tabelas

### `profiles`
Um por usuário do Auth (criado pelo trigger `on_auth_user_created`). Nome, telefone e campos de
opt-in de WhatsApp (`whatsapp_opt_in`, `opt_in_at`, `opt_in_text_version`) — regra 8.
**RLS:** cada um lê/edita o próprio; admin da plataforma lê todos.

### `organizations`
Empresas da rede (incorporadoras, construtoras, loteadoras, imobiliárias…).
**RLS:** admin da plataforma; membros e admin da organização a partir da Fase 1 (abaixo).

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

### Fase 1 — identidade e organizações

**`profiles` (novas colunas):** `account_status` (padrão `pending`, D014), `signup_kind` (do cadastro;
metadado só aceita `broker`/`buyer`, nunca status), `preferred_channel`, `reviewed_by/at`, `review_note`.
Trigger `profiles_guard`: pelo app, o usuário só muda nome, telefone, canal e idioma; status e opt-in
mudam só pela curadoria ou por RPC. Contas existentes antes da Fase 1 foram marcadas `approved`.

**`organizations` (novas colunas):** `created_by`, `normalized_name` (gerada; casa nomes do legado).
Trigger `organizations_guard`: só a curadoria muda `active`. **RLS:** membro lê a sua; admin da
organização edita a sua; criação pela RPC `create_my_organization`.

**`organization_members`** (organization_id, user_id, role, invited_by) — único por (org, usuário).
**RLS:** membros veem a composição da própria organização; admin da organização altera papéis e remove
outros; qualquer um sai da própria; entrada só por convite (ou curadoria).

**`brokers`** (user_id único, creci_number, creci_state, verification_status, document_path,
rejection_reason, verified_by/at). Trigger `brokers_guard`: qualquer gravação do próprio corretor volta
para `pending`. Documento no bucket privado `broker-documents` (`<user_id>/arquivo`, até 10 MB,
PDF/JPG/PNG/WEBP). **RLS:** o próprio e a curadoria.

**`consent_texts`** (purpose, version, body, body_hash gerado, active) — texto publicado é imutável
(nova versão = nova linha); um ativo por finalidade. Visitante lê os ativos (tela de cadastro).
Textos atuais são **MINUTA — DEPENDE DO JURÍDICO**.

**`contact_consents`** — livro-razão **append-only** (regras 7 e 8): cada concessão/revogação é uma
linha com user_id (ou contact), purpose, granted, consent_text_id, text_version, text_hash, ip,
user_agent, at. Escrita só por `record_consent()`. Estado atual: view `current_contact_consents`.

**`email_outbox`** (to_email, template_key, subject, body_text, payload, status, attempts, provider,
provider_ref, last_error, sent_at) — D015. Enfileirada por funções da curadoria/convites; enviada por
`npm run outbox:send` com o `EmailProvider` de `integration_settings`. **RLS:** só curadoria lê.

**`invitations`** (organization_id, email, role, token_hash único, invited_by, expires_at,
accepted_at/by, revoked_at). Só o hash do token fica no banco; o link aparece uma vez para quem
convida. Validade em `platform_settings.invitation_ttl_days` (7). Aceitar exige o mesmo e-mail e
aprova a conta. **RLS:** curadoria e admin da organização; o app só altera `revoked_at`.

**`opportunities` (regras novas):** corretor com conta aprovada + CRECI verificado insere área como
responsável (`is_approved_broker()`); entra `captured`, sem publicação. Sem `memorial_number` recebe
`PH-00001…` (sequência `platform_memorial_seq`). Trigger `opportunities_guard`: pelo app, só a
curadoria muda status, responsável, mandato, publicação e número do MD. Corretor lê/edita as próprias
enquanto `captured`/`qualifying`.

### Fase 1 — registro de apresentações (append-only, regra 2)

**`distributions`** — só os fatos do momento do envio (D016): opportunity_id, recipient_user_id/org_id,
thesis_id/match_id/template_id (FKs nas Fases 3–4), channel, source (`platform`/`legacy`),
message_body_snapshot, link_token_hash, link_expires_at, idempotency_key único, legacy_note, created_by.
**`distribution_events`** — mudanças de estado (queued → sent → delivered → …). Estado atual: view
`distribution_status` (último evento; legado sem evento = `legacy`).
Ambas, mais `access_log`: triggers rejeitam UPDATE/DELETE/TRUNCATE de qualquer papel e **cadeia de
hashes** (D017): `seq` atribuído sob lock, `prev_hash`, `row_hash = sha256(prev_hash || linha)`.
`verify_hash_chain(tabela)` aponta a primeira linha adulterada ou removida.
**RLS:** curadoria lê tudo; destinatário (usuário ou organização) lê o que recebeu. Nenhuma inserção
pelo app (motor de envio na Fase 4).

**`integration_settings`** (capability única, provider, config **não secreta**) — escolhe os adapters
(seção 6.4): email=`log`, messaging=`log`, agreement_signer=`internal_hash`,
broker_verifier=`manual_queue`, map=`maplibre_openfreemap`, billing=`none`. Segredos só no ambiente.

**`platform_settings` (novas chaves):** `app_base_url` (links de e-mail; **atualizar na produção**),
`invitation_ttl_days` (7).

## Views e funções

| Objeto | Descrição |
|---|---|
| `opportunities_blind` (view, `security_barrier`) | Dossiê cego calculado **no servidor**: título cego, metragem arredondada, bairro conforme `blind_location_level`, centro aproximado deslocado de forma determinística (`blind_center`) e raio. Filtra por `can_view_blind()` e esconde `archived`. |
| `is_admin()` | Usuário atual está em `platform_admins`. |
| `can_view_blind(id)` | Curadoria; ou conta aprovada que é o corretor responsável ou destinatária (usuário/organização) de distribuição `platform`. Legado não dá acesso. |
| `is_approved()` / `is_approved_broker()` | Conta aprovada (ou curadoria) / + CRECI verificado. |
| `user_org_ids()` / `is_org_admin(org)` | Organizações do usuário / admin daquela organização (≠ `is_admin()`, D007). |
| `create_my_organization(...)` | Cria organização e torna o usuário admin dela (pendente: no máximo uma). |
| `record_consent(finalidade, concedido)` | Grava consentimento com o texto ativo, IP e user-agent; espelha opt-in no perfil. |
| `review_account(user, status, nota)` / `review_broker(user, aprova, motivo)` | Curadoria; enfileiram e-mail ao usuário. |
| `admin_list_users()` | Curadoria: perfis + e-mail do Auth + CRECI + organizações. |
| `create_invitation(org, email, papel)` / `get_invitation_preview(token)` / `accept_invitation(token)` | Convites (D015); prévia acessível a visitante. |
| `import_legacy_distributions()` | Converte `extra.legacy_offered_to` em distributions `legacy` (D018), idempotente. |
| `verify_hash_chain(tabela)` | Curadoria: integridade de `access_log`, `distributions`, `distribution_events`. |
| `has_valid_agreement(id)` | Placeholder (`false`) até a Fase 5. |
| `get_opportunity_sensitive(id)` | Única leitura do dado sensível; exige permissão, registra log. Fase 5: `has_valid_agreement()`. |
| `set_opportunity_geometry(md, geojson[])` | Só `service_role` (importador KML). União das feições, sem Z. |
| `blind_center(id, geom)` / `round_area(m2)` | Auxiliares do dossiê cego, parametrizados por `platform_settings`. |

## Seeds (`supabase/seeds/`)

| Arquivo | Onde | Conteúdo |
|---|---|---|
| `01_local_users.sql` | **só local** | 2 usuários com senha conhecida (admin e sem permissão) |
| `02_demo_data.sql` | local e demo na nuvem | 4 organizações e 25 áreas **fictícias** com dado sensível fictício; converte o legado |
| `03_local_scenario.sql` | **só local** | Um usuário por perfil (corretor aprovado/pendente, comprador admin, colega, outra organização) e 3 distribuições da plataforma |

## Próximas fases (planejado)
- Fase 2: `owner_leads` (FK `origin_lead_id`).
- Fase 5: termos/aceites e `has_valid_agreement()`.

### Fase 2 — termos e aceite (bloco 2.1, D020)
Migration `20261019000001_agreements.sql`. Tipos: `agreement_type` (non_circumvention, broker_partnership,
broker_area_authorization, owner_terms, platform_terms) e `agreement_scope` (global, opportunity).

**`agreement_templates`** (type, version, title, body_markdown, body_hash gerado, scope, validity_months, active,
created_by) — texto publicado é imutável; nova versão pela RPC `publish_agreement_template` (só curadoria), que
desativa a anterior. Um ativo por tipo. Variáveis `{{...}}` preenchidas no servidor por `render_agreement` (nome,
organização, número do MD, razão social/CNPJ da plataforma e prazo de cauda de `platform_settings`). Rascunhos
`2026-10-v0.1` marcados **MINUTA — DEPENDE DO JURÍDICO**. **RLS:** logado lê os ativos; curadoria lê todos.

**`agreements`** — **append-only** com cadeia de hashes (D017): template, versão, parte (usuário + organização),
escopo/área, **texto renderizado e seu SHA-256**, prazo de cauda, IP, user agent, provedor (`internal_hash`),
signed_at, expires_at (validade do modelo). Escrita só por `accept_agreement(tipo, área, hash_esperado)`, que
recusa se o texto mudou desde a prévia (`get_agreement_preview`) e grava `access_log`.
**`agreement_revocations`** — append-only; revogar = nova linha (`revoke_agreement`, curadoria ou a própria parte).
View `valid_agreements` = não revogado e não expirado. **RLS:** a parte e a curadoria leem.

**Quem pode aceitar** (`can_accept_agreement`): comprador só para área que recebeu pela plataforma; termo-mestre só
quem tem cadastro de corretor; autorização por área só o corretor responsável.

**Dado sensível** (`sensitive_access_state` → `allowed | needs_agreement | denied`):
curadoria; corretor aprovado **responsável** pela área; destinatário da área **com termo válido próprio** (o termo é
pessoal, não da organização). `get_opportunity_sensitive` só devolve com `allowed` e grava o log antes.
`has_valid_agreement()` deixou de ser placeholder.

`platform_settings` novas: `platform_legal_name`, `platform_document_id` (placeholders — DEPENDE DO JURÍDICO).
