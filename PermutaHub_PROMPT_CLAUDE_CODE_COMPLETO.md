<!-- COMO USAR: crie uma pasta vazia, abra o Claude Code nela, e cole TUDO abaixo da linha como primeira mensagem. Anexe junto: planilha do Land Bank (pode ser anonimizada), um Memorial Descritivo em PDF, o formulário de captação do Fábio e um KML/KMZ de exemplo. -->

---

# MISSÃO

Você é o **engenheiro principal** do **PermutaHub**. Vai construir, fase por fase, uma plataforma que recebe oportunidades de terrenos e áreas para incorporação, qualifica e padroniza cada uma num dossiê, cruza automaticamente com o interesse de compradores e **distribui as oportunidades de forma proativa por WhatsApp e e-mail**, protegendo o ativo do negócio (a rede e a rastreabilidade de quem apresentou o quê a quem).

O time é pequeno. Você é o principal executor. Isso significa: **código simples, testado, documentado e fácil de manter por 2–3 pessoas.** Nada de arquitetura de gente grande sem necessidade.

---

# PROTOCOLO DA PRIMEIRA RESPOSTA (obrigatório)

Não escreva código ainda. Leia tudo e responda **apenas** com:

1. **Seu entendimento do produto** em no máximo 10 linhas.
2. **Perguntas bloqueantes** (máximo 8). Para cada uma, dê a sua **resposta padrão sugerida**, para eu só confirmar com "ok".
3. **Plano detalhado da Fase 0**: lista de tarefas, ordem, o que vou conseguir ver ao final, e o que você precisa de mim (arquivos, contas, chaves).
4. **Riscos que você enxerga** neste prompt (contradições, lacunas, coisas irrealistas). Seja direto.

Só comece a codificar depois do meu "aprovado". Depois de aprovado, primeira ação: criar `CLAUDE.md`, `docs/decisions.md` e `docs/status.md` (detalhes na seção 14).

---

# 1. CONTEXTO DO NEGÓCIO

## 1.1 Quem somos
Quatro sócios: **Felipe Dalpra** e **Arthur Marques** (produto e desenvolvimento), **Matheos Haas** (marketing/growth, com participação crescente no comercial), **Fábio** (mercado imobiliário: rede de proprietários, incorporadoras, investidores, corretores e um Land Bank existente). Execução técnica pela Zentri Tech. Região de partida: **Porto Alegre / RS**.

## 1.2 O problema
Negócios de terreno e área para incorporação circulam por grupos de WhatsApp, planilhas, pastas, PDFs e Google Earth. Não há match estruturado, não há registro confiável de quem apresentou o quê a quem, e quem origina a oportunidade frequentemente é excluído do negócio.

## 1.3 O que a plataforma faz
Fluxo central:

**captação da área → qualificação → organização das informações (dossiê) → matchmaking → envio proativo aos compatíveis → negociação → fechamento e remuneração.**

Ponto decisivo: **compradores não ficam navegando na plataforma.** O sistema é **proativo**: quando uma área é qualificada e há compatibilidade, ele dispara para os contatos certos. **WhatsApp é o canal prioritário** (no mercado imobiliário pesa mais que e-mail, inclusive em empresas grandes); e-mail é complementar.

## 1.4 O ativo real do negócio
Segundo o Fábio: o software é a infraestrutura; o ativo é a **rede** de áreas, proprietários, incorporadores, investidores e relacionamentos. "Contato gera acesso; relacionamento gera negócios." Consequência técnica: o **registro imutável das apresentações** e a **proteção dos dados sensíveis** são funcionalidades centrais, não acessórias.

## 1.5 Ordem de prioridade decidida na reunião
Primeiro a **fundação** (arquitetura, banco, cadastros, organização das informações). Depois o matchmaking. Primeira versão apresentável ao mercado por volta do **início de outubro de 2026**, mesmo que incompleta.

## 1.6 Concorrência (para você não reinventar a roda e para orientar UX)
Já existem plataformas de terreno no Brasil: **Terreno Livre** (grande marketplace de terrenos), **Tierra Landtech** (marketplace de incorporação: corretores, incorporadores, investidores), **Oferta Terreno** (viabilidade e gestão de landbank, com formulário "Oferte seu terreno"), **Compro Terreno/Hiperdados** (software de aquisição e inteligência para incorporadoras). Nosso diferencial não é ter mais funções: é **curadoria + rede + proatividade + rastreabilidade de apresentação**. Portanto: menos "sistema de gestão denso", mais "mesa de negócios inteligente". Priorize a qualidade do dossiê e da mensagem que chega no WhatsApp.

---

# 2. GLOSSÁRIO

| Termo | Significado |
|---|---|
| Land Bank | Carteira/planilha de áreas mapeadas e seu andamento comercial |
| Memorial Descritivo (MD) | Dossiê padrão de uma oportunidade (seção 5) |
| Terrenista / proprietário | Dono da área. Entra só como lead de captação |
| Intermediador autorizado | Quem tem autorização do proprietário para negociar a área |
| Tese de interesse | O que um comprador procura (metragem, região, zoneamento, etc.) |
| Dossiê cego | Versão do MD sem dados que identifiquem a área ou o proprietário |
| Dado sensível | Matrícula, endereço exato, identificação e contato do proprietário |
| Apresentação | Ato registrado de uma oportunidade ser enviada a um destinatário |
| Termo | Documento aceito antes de liberar dados sensíveis (não-circunvenção/confidencialidade) |
| VGV | Valor Geral de Vendas do empreendimento |

---

# 3. PERFIS DE USUÁRIO E PERMISSÕES

| Perfil | Quem é | Acesso |
|---|---|---|
| `admin` | Equipe/curadoria | Tudo; qualifica, edita, aprova matches, distribui, vê logs |
| `broker` | Corretor/intermediador (CRECI) | Cadastra e acompanha **suas** áreas; vê o pipeline delas; não vê áreas de outros além do dossiê cego, se aplicável |
| `buyer` | Incorporadora, construtora, urbanizadora, loteadora, investidor, imobiliária | Gerencia sua(s) tese(s); vê dossiês que recebeu; acessa dado sensível **somente** após aceite de termo |
| `owner_lead` | Proprietário | **Não é usuário logado.** Só preenche o formulário público. Nunca vê catálogo nem compradores |

Usuários pertencem a **organizações** (várias pessoas por empresa). Um usuário pode ter mais de um papel dentro de organizações distintas; modele por `organization_members.role`.

---

# 4. REGRAS DE NEGÓCIO INEGOCIÁVEIS

Estas regras valem acima de qualquer conveniência de implementação. Se algo que eu pedir as violar, avise antes de fazer.

1. **Dados sensíveis bloqueados por padrão.** Ficam em tabela/segmento separado, com RLS que exige termo aceito e válido. O bloqueio tem que valer **na API**, não só na tela.
2. **Registro imutável de apresentações.** `distributions` e `access_log` são **append-only**: revogar UPDATE/DELETE de todos os papéis, incluindo triggers que rejeitam alteração. Nem admin edita.
3. **A plataforma nunca aproxima proprietário e comprador diretamente.** O contato passa por intermediador ou curadoria. Toda oportunidade tem `responsible_party` e `mandate_status` (`exclusive`, `non_exclusive`, `being_obtained`, `none`).
4. **Regra "pode distribuir sem mandato?" é configurável** (`platform_settings`), pois depende de parecer jurídico. Padrão: **não pode** distribuir com `mandate_status = none`.
5. **Nenhum percentual de comissão fixo no código.** Remuneração é modelo configurável (seção 9.7).
6. **Remuneração pode ser em ativos imobiliários.** Modele, não construa a revenda.
7. **LGPD:** consentimento registrado (texto, versão, IP, timestamp) no formulário de captação; coleta mínima; RLS em **todas** as tabelas; capacidade de exportar e excluir/anonimizar dados de um titular.
8. **WhatsApp exige opt-in.** Só enviar a contatos com consentimento registrado; toda mensagem com opção de sair; tratar palavras de opt-out ("sair", "parar") no webhook. Disparo sem consentimento arrisca banimento do número.
9. **Sem segredos no repositório.** `.env.example` completo; segredos só em variáveis de ambiente.
10. **Tudo que depender de parecer jurídico** (mandato, base de comissão, remuneração em ativos, redação dos termos, prazo de cauda) é marcado em `docs/status.md` como **"DEPENDE DO JURÍDICO"** e implementado de forma configurável.

---

# 5. DADOS DE PARTIDA: LAND BANK, MEMORIAL DESCRITIVO E CAPTAÇÃO

## 5.1 Land Bank atual (fonte de verdade do schema)
Campos que o Fábio já controla: **número do memorial descritivo, área, tipo de terreno, contatos, status da negociação, empresas para as quais a oportunidade foi oferecida, andamento comercial.** Também existem áreas mapeadas no **Google Earth** e ~26 contatos de proprietários em uma das pastas. Estrutura de pastas do Fábio: planejamento estratégico, vendas, clientes, empreendimentos, mapas, procedimentos, exclusividades, Land Bank, sistemas, documentos, corretores, parceiros, propostas, proprietários.

**Importe o histórico "oferecida para" como registros em `distributions` com `source = 'legacy'`**, sem canal/entrega, para preservar o histórico de quem já viu o quê.

## 5.2 Memorial Descritivo (dossiê padrão)
Toda oportunidade tem uma página/PDF padronizado com: **localização, tamanho da área, características, contexto urbano, zoneamento, plano diretor, potencial construtivo, tipos de projeto possíveis, fotografias, mapas, condições da negociação.** Este é o formato de apresentação da plataforma. Deve existir em **duas versões**: cega (pública para destinatários) e completa (após termo).

## 5.3 Formulário de captação de áreas (reproduzir)
Perguntas, nesta ordem lógica: **relação do respondente com a área** (proprietário / intermediador autorizado / conhece o proprietário), **localização**, **tamanho aproximado**, **modelo de negociação** (venda, permuta, parceria, etc.), **nome, telefone, e-mail** + consentimento LGPD. Finalidade: filtrar antes do contato humano.

## 5.4 Importadores (obrigatórios)
- **CSV/XLSX do Land Bank:** mapeamento de colunas configurável (um arquivo de mapeamento `scripts/mappings/landbank.json`), tolerante a colunas faltantes, acentos, texto sujo e duplicatas; relatório final com linhas importadas, ignoradas e rejeitadas + motivo. Idempotente (reimportar não duplica: chave = número do MD).
- **KML/KMZ do Google Earth:** extrair polígonos/pontos como GeoJSON e vincular à oportunidade (por nome/número do MD) ou listar não vinculados para vínculo manual.

---

# 6. STACK E ARQUITETURA

## 6.1 Stack
- **Supabase**: Postgres, Auth, Storage, RLS, Edge Functions, agendamento (pg_cron ou Scheduled Functions). Desenvolvimento local com Supabase CLI. **Toda mudança de banco via migration versionada.**
- **Frontend**: React + TypeScript + Vite + Tailwind + shadcn/ui + React Router + TanStack Query + React Hook Form + Zod. Escolhido por ser **compatível com o ecossistema Lovable** (o time poderá abrir o repositório lá, se quiser).
- **Mapas**: MapLibre GL (ou Leaflet) com tiles OpenStreetMap; sem custo. Camada de abstração para poder trocar por Google Maps.
- **Testes**: Vitest (unidade), Playwright (E2E dos fluxos críticos), testes de banco/RLS via SQL (pgTAP ou scripts com roles simulados).
- **Qualidade**: ESLint, Prettier, `tsc --noEmit` no CI; GitHub Actions rodando lint + tipos + testes.
- **Custo mínimo**: preferir gratuito ou já contratado. **Não introduza serviço pago sem me avisar.** A infraestrutura Google do Fábio e a infraestrutura de WhatsApp da Zentri são candidatas a reaproveitamento (decisão futura; por isso as abstrações).

## 6.2 Idioma
UI e documentação em **pt-BR**. Identificadores de código, colunas e tabelas em **inglês**. Textos da interface centralizados (`src/i18n/pt-BR.ts`) para não espalhar strings.

## 6.3 Estrutura do repositório

```
/
├─ CLAUDE.md
├─ docs/
│  ├─ decisions.md        # decisões tomadas e em aberto
│  ├─ status.md           # estado atual por fase; pendências humanas; "DEPENDE DO JURÍDICO"
│  ├─ data-model.md
│  └─ runbook.md          # como subir local, importar, rodar testes, deploy
├─ src/
│  ├─ app/                # rotas e layouts por perfil
│  ├─ features/           # opportunities, matching, distribution, agreements, deals...
│  ├─ components/ui/      # shadcn + componentes da marca
│  ├─ design/tokens.ts    # UNICA fonte das cores/tipografia (ver seção 11)
│  ├─ i18n/pt-BR.ts
│  └─ lib/                # supabase client, utils, providers (adapters)
├─ supabase/
│  ├─ migrations/
│  ├─ functions/          # edge functions
│  ├─ seed.sql
│  └─ tests/              # testes de RLS e regras no banco
├─ scripts/
│  ├─ import-landbank.ts
│  ├─ import-kml.ts
│  └─ mappings/
└─ e2e/
```

## 6.4 Abstrações (adapters) – interface + implementação inicial trocável

| Capacidade | Interface | Implementação inicial | Substituível por |
|---|---|---|---|
| WhatsApp | `MessagingProvider.send(msg)` + webhook de status/entrada | `LogProvider` (grava no console/tabela, sem enviar) | API oficial / infra da Zentri |
| E-mail | `EmailProvider.send()` | SMTP do Supabase ou Resend (free tier) | Qualquer outro |
| Assinatura/aceite | `AgreementSigner.sign()` | Aceite próprio: hash SHA-256 do texto renderizado, IP, user agent, timestamp | D4Sign / Clicksign / Autentique |
| Validação CRECI | `BrokerVerifier.verify()` | Fila manual no admin (upload de documento) | API, se existir |
| Mapas | `MapProvider` | MapLibre + OSM | Google Maps |
| Cobrança | `BillingProvider` | Nenhuma (só planos/feature flags) | Gateway |

Cada adapter escolhido por configuração (`integration_settings`) e coberto por teste com o fake.

---

# 7. MODELO DE DADOS

Use como ponto de partida. Ajuste com critério e **registre cada mudança em `docs/data-model.md`**. Todas as tabelas: `id uuid`, `created_at`, `updated_at`, RLS habilitado. Enums como tipos Postgres ou tabelas de domínio.

**Identidade e organização**
- `profiles` (user_id, full_name, phone, whatsapp_opt_in, opt_in_at, opt_in_text_version, locale)
- `organizations` (name, type: `developer|builder|urbanizer|land_developer|investor|brokerage|other`, document_id, city, state, active)
- `organization_members` (organization_id, user_id, role: `admin|broker|buyer|viewer`)
- `brokers` (user_id, creci_number, creci_state, verification_status: `pending|approved|rejected`, document_path, verified_by, verified_at)

**Captação**
- `owner_leads` (respondent_relation: `owner|authorized_intermediary|knows_owner`, location_text, approx_area_m2, negotiation_model, name, phone, email, consent_text_version, consent_ip, consent_at, status: `new|qualifying|forwarded|discarded|converted`, assigned_to, source, utm jsonb, converted_opportunity_id)

**Oportunidades**
- `opportunities` (asset_type default `terreno`, memorial_number unique, title_blind, status: `captured|qualifying|qualified|distributing|negotiating|closed|lost|archived`, land_type, area_m2, city, neighborhood, state, region_tags[], zoning, master_plan_notes, buildable_potential_notes, coefficient (coef. aproveitamento), project_types[], negotiation_conditions, asking_value, negotiation_models[] (`sale|swap|partnership|other`), geometry (PostGIS `geometry` ou GeoJSON em jsonb), responsible_party (user/org), mandate_status, origin_lead_id, extra jsonb, published_at)
- `opportunity_sensitive` (opportunity_id, registry_number (matrícula), exact_address, owner_name, owner_contacts jsonb, notes) — **RLS restrita (regra 1)**
- `opportunity_media` (opportunity_id, kind: `photo|map|aerial|other`, storage_path, is_blind_safe, order)
- `opportunity_documents` (opportunity_id, kind, storage_path, sensitivity: `blind|restricted`)
- `opportunity_events` (histórico de mudanças de status e andamento comercial, com autor e nota)

**Compradores e matching**
- `buyer_theses` (organization_id, name, active, area_min_m2, area_max_m2, regions[], cities[], zoning_accepted[], min_coefficient, project_types[], ticket_min, ticket_max, deal_formats[], notes, channels_allowed[])
- `matches` (opportunity_id, thesis_id, score, hard_pass bool, reasons jsonb, status: `suggested|approved|rejected|distributed`, reviewed_by, reviewed_at) — unique(opportunity_id, thesis_id)
- `match_config` (pesos e limiar; versionado)

**Distribuição (append-only)**
- `distributions` (opportunity_id, recipient_user_id, recipient_org_id, thesis_id, match_id, channel: `whatsapp|email`, source: `platform|legacy`, template_id, message_body_snapshot, link_token_hash, status, queued_at, sent_at, delivered_at, opened_at, interested_at, declined_at, failed_reason, idempotency_key unique) — como é append-only, mudanças de estado entram em `distribution_events`.
- `distribution_events` (distribution_id, event: `queued|sent|delivered|read|opened|interested|declined|failed|opt_out`, at, meta jsonb)
- `message_templates` (channel, key, version, body, variables[], approved bool)
- `contact_consents` (user_id ou contact, channel, granted, text_version, ip, at, revoked_at)

**Termos e acesso**
- `agreement_templates` (type: `non_circumvention|broker_partnership|platform_terms`, version, body_markdown, body_hash, tail_period_months, active)
- `agreements` (template_id, party_user_id, party_org_id, scope: `global|opportunity`, opportunity_id null, rendered_body_hash, signed_at, ip, user_agent, provider, provider_ref, expires_at, revoked_at) — append-only
- `access_log` (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent, at) — append-only

**Negócios e remuneração**
- `commission_models` (name, basis: `deal_value|broker_fee|fixed`, tiers jsonb [{from,to,percent|fixed}], payment_form: `cash|asset|mixed`, active)
- `deals` (opportunity_id, buyer_org_id, stage: `interest|conversation|proposal|negotiation|closed|lost`, expected_value, closed_value, commission_model_id, notes)
- `deal_events` (histórico de estágios)
- `deal_compensations` (deal_id, party, cash_amount, asset_id, notes)
- `received_assets` (description, estimated_value, status: `received|for_sale|sold`, deal_compensation_id)

**Configuração**
- `platform_settings` (chave/valor tipado: ex. `allow_distribution_without_mandate=false`, `quiet_hours`, `weekly_send_limit_per_recipient`, `default_tail_period_months=24`)
- `integration_settings`, `plans`, `feature_flags`, `organization_plans`

**Funções auxiliares de RLS** (SECURITY DEFINER, `search_path` fixo): `is_admin()`, `user_org_ids()`, `has_valid_agreement(opportunity_id)`, `can_view_blind(opportunity_id)`.

---

# 8. TELAS POR PERFIL

**Público:** home institucional curta; formulário de captação de áreas (mobile-first, multi-etapas); política de privacidade e termos; login/cadastro.

**Comprador (`buyer`)** — mobile-first:
- Minhas teses (criar/editar/pausar), preferências de canal e horário.
- Oportunidades recebidas (lista + mapa) e dossiê cego; botão **"Tenho interesse"** / **"Não tenho interesse"** (com motivo opcional).
- Fluxo de aceite do termo para liberar dado sensível.

**Corretor (`broker`):** cadastro + upload de CRECI; cadastrar área (mesmo editor do MD); minhas áreas e status; termo de parceria.

**Admin (`admin`)** — desktop denso:
- Fila de leads de captação (qualificar, pedir dados, encaminhar a intermediador, converter em oportunidade, descartar).
- Editor de Memorial Descritivo (campos, fotos, documentos, geometria, versão cega × completa com pré-visualização).
- Pipeline de oportunidades (kanban + tabela + mapa).
- Fila de matches (aprovar/rejeitar/ajustar antes do disparo) com motivos explicáveis.
- Central de distribuição (fila, estados, falhas, reenvio).
- Fila de verificação de CRECI.
- Negócios, modelos de comissão e simulador.
- Logs de acesso e apresentações (com filtros e exportação CSV).
- Importadores (upload, prévia, relatório).
- Configurações da plataforma e integrações.

**Modo demonstração:** interruptor global que **oculta todo dado sensível e nomes reais** e usa apenas dossiê cego, para mostrar a plataforma a terceiros sem risco. Deve existir desde a Fase 0.

---

# 9. ESPECIFICAÇÃO DOS MECANISMOS CENTRAIS

## 9.1 Dossiê cego × completo
Campos do dossiê cego: região/bairro **genérico** (nível definido por configuração), metragem (opcionalmente arredondada), zoneamento, plano diretor, potencial construtivo, tipos de projeto, condições resumidas, fotos e mapas marcados `is_blind_safe`, mapa com localização **aproximada** (buffer/deslocamento). Sem matrícula, sem endereço exato, sem proprietário. Gerar também o **PDF do dossiê** (cego) com a identidade da marca.

## 9.2 Matchmaking por regras (sem IA nesta versão)
Duas camadas:
- **Filtros obrigatórios (hard):** `asset_type`; cidade/região dentro da tese; metragem entre min e max; formato de negócio compatível; ticket dentro da faixa **quando ambos definidos**. Reprovou em um → sem match.
- **Pontuação (soft), 0–100, pesos em `match_config`:** zoneamento aceito, coeficiente mínimo, tipos de projeto em comum, proximidade dentro da região, atualidade da oportunidade, histórico de resposta do comprador.
- **Explicabilidade:** `reasons` = lista de `{criterion, result: pass|partial|fail, detail}` legível ("Compatível: metragem 12.400 m² dentro de 8.000–20.000 m²").
- **Execução:** recalcular quando uma oportunidade muda para `qualified` ou quando uma tese é criada/alterada; idempotente; limiar mínimo configurável. Matches nascem `suggested`; admin aprova antes de distribuir (configurável para auto-aprovar acima de um score).
- **Testes:** conjunto de fixtures com casos que devem e que não devem dar match, incluindo bordas (metragem exatamente no limite, tese sem ticket, região vazia).

## 9.3 Motor de distribuição
- **Máquina de estados** registrada em `distribution_events`: `queued → sent → delivered → read/opened → interested | declined`; `failed` com retry e backoff exponencial (máx. configurável).
- **Elegibilidade antes de enfileirar:** opt-in válido no canal, tese ativa, oportunidade com mandato aceito pela regra 4, destinatário não estourou o limite semanal, não é duplicata (`idempotency_key = opportunity+recipient+channel`).
- **Janela de envio:** respeitar horário comercial de `America/Sao_Paulo` (configurável); fora dele, fica na fila.
- **Mensagem:** template aprovado com variáveis (metragem, região, potencial, link). **A primeira linha traz o dado concreto.** Link único por destinatário com token aleatório (armazenar só o hash), expiração configurável, revogável.
- **Retorno:** webhook de status do provedor e resposta do usuário ("tenho interesse", "sair") → atualiza eventos e notifica o admin.
- **Rastreio:** cada abertura do dossiê gera `access_log`.

## 9.4 Termos e liberação de dado sensível
- Termos **versionados**; texto renderizado com os dados do aceitante gera `rendered_body_hash` (SHA-256).
- Aceite grava: usuário, organização, escopo (global ou por oportunidade), versão, hash, IP, user agent, timestamp, prazo de cauda (`tail_period_months`, padrão 24, configurável).
- **Liberação:** `opportunity_sensitive` só é legível se `has_valid_agreement(opportunity_id)` for verdadeiro; o acesso passa por função/endpoint que **registra em `access_log` antes de retornar**.
- Revogação e expiração tratadas. Aceite não pode ser editado.
- **Redação jurídica dos termos: não invente.** Use texto de placeholder claramente marcado `[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]`.

## 9.5 Validação de corretor
Upload do documento → fila do admin → aprova/rejeita com motivo → e-mail ao corretor. Sem CRECI aprovado, o corretor não cadastra áreas para distribuição.

## 9.6 Pipeline de oportunidade e de negócio
Dois funis separados: **oportunidade** (captada → qualificando → qualificada → em distribuição → em negociação → fechada/perdida/arquivada) e **negócio** por comprador (interesse → conversa → proposta → negociação → fechado/perdido). Toda mudança gera evento com autor e nota.

## 9.7 Remuneração parametrizável
- `commission_models` define **base** (valor da operação, honorários do corretor ou valor fixo), **faixas escalonadas** por tamanho de negócio (ex.: percentuais diferentes para R$ 5 mi e R$ 500 mi) e **forma** (dinheiro, ativo, misto).
- **Simulador**: dado um valor de negócio e um modelo, mostra o cálculo por faixa. Compare dois modelos lado a lado.
- **Nenhum número de percentual vem do código**; use apenas dados de exemplo no seed, marcados como fictícios.
- Registrar remuneração em ativo em `received_assets` (descrição, valor estimado, situação).

## 9.8 Receita recorrente (preparação, sem cobrança)
Estrutura de `plans` e `feature_flags` por organização, para podermos ligar recursos pagos depois (ainda não definidos pelo Fábio). Não integrar gateway nesta etapa.

---

# 10. SEGURANÇA E PRIVACIDADE

- RLS habilitado em todas as tabelas, política padrão **negar**; políticas por perfil escritas e **testadas com roles simulados** (teste automatizado tenta ler/escrever fora da permissão e precisa falhar).
- Endpoints públicos (formulário de captação, links de dossiê) com **rate limiting**, validação Zod no servidor, proteção contra spam (honeypot/captcha se necessário).
- Storage: buckets privados; URLs assinadas curtas; separar arquivos `blind` e `restricted`.
- Logs sem dado pessoal desnecessário; segredos nunca no cliente; chave `service_role` só em Edge Functions.
- Backups e restauração documentados no `runbook.md`.
- Política de retenção e anonimização documentada.

---

# 11. IDENTIDADE VISUAL E DESIGN SYSTEM (provisório – o designer entra depois)

**Conceito:** *mesa de negócios inteligente*: sério e discreto como private banking, ágil como ferramenta digital. Pouco elemento por tela, muito espaço, dados em destaque. Público é diretor de novos negócios e corretor experiente, **não** consumidor final: nada de fotos de banco com famílias, nada de linguagem "imóvel dos sonhos". Imagens: vistas aéreas, mapas, contornos de lote, fotos reais das áreas.

**Regra técnica central:** todas as cores, tipografia, raios e sombras vivem **num único arquivo** (`src/design/tokens.ts`, expostos como variáveis CSS e no `tailwind.config`). Nada de cor hard-coded nos componentes. O designer vai substituir esse arquivo e a plataforma inteira muda.

| Token | Valor provisório | Uso |
|---|---|---|
| `primary` | `#0F2A3F` (azul-marinho) | Cabeçalhos, fundos institucionais, títulos |
| `action` | `#0E7C7B` (verde-petróleo) | Botões, links, estados ativos |
| `accent` | `#C9A24B` (dourado) | Selos, linhas finas, destaques **apenas sobre fundo escuro** ou como preenchimento |
| `accent-text-on-light` | `#8A6A1F` | Texto dourado sobre fundo claro |
| `bg` / `border` / `muted` / `ink` | `#F4F6F7` / `#E3E7E9` / `#5B6B75` / `#242A2E` | Estrutura |
| Status | sucesso, alerta, erro, info | Escolher com contraste AA e documentar |

**Contraste (WCAG AA, mínimo 4,5:1 para texto):** marinho sobre branco 14,75; petróleo sobre branco 5,0; cinza `muted` sobre branco 5,5; dourado sobre marinho 6,2; **dourado `#C9A24B` sobre branco 2,4 – proibido para texto.**

**Tipografia:** Inter (ou Manrope) com fallback de sistema; números tabulares em tabelas e métricas.

**UX:**
- Comprador: **mobile-first**, dossiê rápido de ler no celular (o WhatsApp leva ele para lá): dados-chave no topo (metragem, região, potencial), mapa, fotos, botão de interesse fixo.
- Admin: denso, tabelas com filtro/ordenação, atalhos, estados vazios úteis.
- Etiquetas de status coloridas de forma consistente em todo o sistema.
- Acessibilidade: foco visível, navegação por teclado, labels, contraste AA.
- Logo provisório: apenas o nome em texto; o designer entrega o definitivo. **Nome de trabalho "PermutaHub" pode mudar** (o foco agora é terreno/incorporação): mantenha o nome do produto em **uma constante de configuração**, nunca espalhado no código.

---

# 12. FASES DE IMPLEMENTAÇÃO

**Regras para todas as fases**
- Um branch por fase; PR/merge só com meu OK.
- Cada fase termina com: migrations aplicadas e reversíveis, testes passando (unidade + RLS + E2E do fluxo da fase), `docs/status.md` e `docs/data-model.md` atualizados, e uma lista **"o que o humano precisa validar/fornecer"**.
- Ao final de cada fase, entregue: (a) resumo do que foi feito, (b) como eu testo em 5 minutos, (c) o que ficou de fora e por quê, (d) riscos novos.
- Não avance de fase sem meu "aprovado".
- Estimativas: dê uma estimativa em horas **antes** de começar cada fase e compare depois.

---

## FASE 0 — Protótipo demonstrável (meta: 1 semana; apresentação ~início de outubro)
**Objetivo:** algo navegável, com áreas reais do Land Bank, que possa ser mostrado a alguém do mercado sem vergonha e sem risco.

Tarefas:
1. Scaffold do projeto (estrutura da seção 6.3), CI, `.env.example`, Supabase local, `CLAUDE.md`, docs iniciais.
2. `design/tokens.ts` com a identidade provisória (seção 11) e layout base responsivo.
3. Migrations mínimas: `profiles`, `organizations`, `opportunities`, `opportunity_media`, `opportunity_sensitive` (já com RLS), `platform_settings`.
4. Importador do Land Bank (CSV/XLSX) com mapeamento configurável e relatório; importador de KML/KMZ.
5. Login simples (e-mail + senha ou magic link) e usuário admin.
6. Listagem de oportunidades com filtros (região, metragem, tipo, status) + **visão em mapa**.
7. **Página de dossiê no formato do Memorial Descritivo** (versão cega), responsiva, com botão de gerar PDF.
8. **Modo demonstração** (seção 8).
9. Seed com áreas fictícias para desenvolvimento sem dados reais.

**Aceite:** no celular, filtro e abro o dossiê de pelo menos 10 áreas importadas; ative o modo demonstração e nenhum dado sensível aparece em lugar nenhum; teste automatizado prova que usuário sem permissão não lê `opportunity_sensitive` por chamada direta à API.
**Preciso de você:** planilha, MD de exemplo, KML, fotos.

---

## FASE 1 — Fundação
1. Auth completa, perfis, organizações e membros; convites por e-mail.
2. Papéis e **RLS completa** para todas as tabelas existentes, com funções auxiliares (seção 7).
3. Cadastro de corretor com upload de CRECI e **fila de verificação** no admin.
4. Cadastro de comprador e organização; preferências de canal e **consentimento de contato** (`contact_consents`) com registro de texto/versão/IP.
5. Painel admin base (navegação, usuários, organizações).
6. `access_log` e `distributions`/`distribution_events` criados com **triggers append-only**.
7. Camada de adapters (seção 6.4) com fakes e testes.

**Aceite:** suíte de testes de RLS prova, para cada perfil, o que lê/escreve; tentativa de UPDATE/DELETE em tabelas append-only falha inclusive com `service_role` via trigger; corretor sem aprovação não cadastra área.

---

## FASE 2 — Captação e qualificação
1. Formulário público de captação (seção 5.3), multi-etapas, mobile-first, consentimento LGPD, proteção anti-spam, rate limit.
2. Fila de leads no admin: qualificar, pedir dados, encaminhar a intermediador, descartar, **converter em oportunidade** (pré-preenche o MD).
3. **Editor completo do Memorial Descritivo**: todos os campos, upload de fotos/documentos com marcação `blind_safe`, geometria (desenhar polígono ou importar KML), pré-visualização cega × completa.
4. Pipeline de oportunidade (kanban + tabela + mapa) e `opportunity_events`.
5. Regras de mandato (`mandate_status`, `responsible_party`) e a configuração da regra 4.
6. PDF do dossiê cego com identidade da marca.

**Aceite:** um lead entra pelo formulário, é qualificado e vira dossiê publicável sem tocar em planilha; oportunidade sem mandato é impedida de avançar para distribuição conforme a configuração.

---

## FASE 3 — Teses de interesse e matchmaking
1. Cadastro/edição de **tese de interesse** pelo comprador (e pelo admin em nome dele).
2. Motor de match da seção 9.2 (função SQL ou Edge Function), `match_config`, recálculo idempotente.
3. Tela de matches no admin com motivos explicáveis, aprovar/rejeitar/ajustar; opção de auto-aprovação por score.
4. Testes com fixtures (casos positivos, negativos e de borda).

**Aceite:** dado um conjunto de teses e áreas de teste, os matches esperados aparecem e os indevidos não; cada match mostra motivos legíveis; alterar uma tese recalcula corretamente.

---

## FASE 4 — Distribuição proativa
1. Fila de envios e motor da seção 9.3; provedores fake + e-mail real (free tier) + interface WhatsApp pronta para plugar.
2. Templates de mensagem (WhatsApp e e-mail) versionados e aprovados; pré-visualização com dados reais.
3. Link único por destinatário para o dossiê cego; botão de interesse/recusa; tratamento de opt-out.
4. Central de distribuição no admin (fila, estados, falhas, reenvio, pausa global).
5. Webhooks (status e respostas) e atualização de `distribution_events`.
6. Limites: janela de horário, teto semanal por destinatário, deduplicação.

**Aceite:** com provedor simulado, aprovar um match gera mensagens, registro imutável, página do dossiê e o "tenho interesse" volta ao admin; envio a contato sem opt-in é bloqueado por teste; reprocessar a fila não duplica envios.
**Dependência humana:** escolha e credenciais do provedor de WhatsApp; templates aprovados no provedor.

---

## FASE 5 — Confidencialidade e formalização
1. Templates de termos versionados (com **placeholder jurídico**), renderização e hash.
2. Fluxo de aceite (comprador e corretor), com IP/UA/timestamp; `AgreementSigner` com implementação própria e interface para provedor certificado.
3. Liberação de dados sensíveis via função que exige aceite válido e grava `access_log` antes.
4. Área do admin para ver aceites, revogar, exportar comprovantes (PDF/CSV com hash).
5. Relatório de **linha do tempo por oportunidade**: quem recebeu, quando, quem abriu, quem aceitou termo, quem acessou dado sensível (prova de apresentação).
6. Revisão de segurança dedicada desta fase.

**Aceite:** teste E2E: sem aceite → dado sensível inacessível pela UI e pela API; com aceite → acessível e logado; expirado/revogado → volta a bloquear; exportação da linha do tempo funciona.
**Dependência humana:** minutas do advogado (estrutura societária/CNPJ e contratos entre sócios correm em paralelo, fora do código).

---

## FASE 6 — Pipeline de negociação e remuneração
1. Funil de negócios por comprador, histórico e notas.
2. `commission_models` com faixas escalonadas, simulador comparativo de dois modelos.
3. Registro de remuneração em dinheiro, ativo ou misto; `received_assets`.
4. Relatórios: áreas por status, funil de distribuição (enviadas → abertas → interessadas), negócios por estágio, receita prevista sob cada modelo.

**Aceite:** simulo o mesmo negócio (ex.: R$ 5 mi e R$ 500 mi) sob dois modelos sem alterar código; remuneração em ativo é registrada e aparece nos relatórios.
**Dependência humana:** definição do escalonamento (tema de casa do Fábio) e parecer jurídico sobre base de cálculo e ativos.

---

## FASE 7 — Receita recorrente (condicionada)
Só começar quando o time definir o gatilho de cobrança. Reutilizar `plans` e `feature_flags`; integrar gateway via `BillingProvider`; bloquear/liberar recursos por plano; tela de assinatura. Se não houver definição, **pule** e passe à Fase 8.

---

## FASE 8 — QA, segurança e lançamento
1. Auditoria de RLS e de segredos; revisão de dependências; rate limiting revisado; teste de carga leve nos endpoints públicos.
2. E2E dos fluxos críticos: captação → qualificação → match → distribuição → interesse → termo → dado sensível → negócio.
3. LGPD: política de privacidade e termos de uso publicados, exportação/exclusão de dados do titular funcionando, política de retenção.
4. Observabilidade: monitoramento de erros, alertas de falha na fila, painel de saúde das integrações.
5. Backup/restore testados; `runbook.md` completo; plano de reversão de deploy.
6. Checklist de lançamento e documentação de operação para não-desenvolvedores (como qualificar, distribuir, verificar CRECI).

**Aceite:** checklist de lançamento 100% verde; simulação de restauração de backup concluída; nenhum achado crítico em aberto.

---

# 13. O QUE NÃO FAZER (por enquanto)

- IA/ML no matchmaking (regras explicáveis primeiro).
- Cobrança, gateway e faturamento (só preparar estrutura, Fase 7 condicionada).
- Chat interno, app nativo, marketplace público aberto ao consumidor final.
- Operação de revenda de ativos recebidos como comissão.
- Análise de viabilidade financeira de empreendimento (é o território do Oferta Terreno/Compro Terreno).
- Redigir texto jurídico definitivo.
- Otimização prematura, microserviços, monorepo complexo, filas externas sem necessidade.
- Introduzir serviço pago sem aprovação.

---

# 14. PADRÕES DE TRABALHO

**Arquivos de memória do projeto (criar após meu "aprovado"):**
- `CLAUDE.md`: resumo curto do produto, as 10 regras da seção 4, stack, comandos (subir local, testar, migrar, importar), convenções, e a instrução de sempre ler `docs/status.md` e `docs/decisions.md` ao iniciar uma sessão.
- `docs/decisions.md`: cada decisão com data, contexto, alternativas e motivo. Seção "Em aberto" com dono e prazo.
- `docs/status.md`: fase atual, feito, faltando, pendências humanas, itens "DEPENDE DO JURÍDICO", riscos.

**Como trabalhar comigo:**
- Ambiguidade de **negócio**: pergunte. Ambiguidade **técnica**: decida, registre em `decisions.md`, siga em frente.
- Se algo que eu pedir contrariar as regras da seção 4 ou o plano, **avise antes** e proponha alternativa.
- Commits pequenos e descritivos; nada de commit com segredos ou dados pessoais reais.
- Dados reais só em ambiente local/ignorado pelo git; o repositório usa apenas dados fictícios (`seed`).
- Escreva testes junto com o código dos itens críticos: permissões/RLS, bloqueio de dado sensível, matching, distribuição (idempotência, opt-in, janela), cálculo de comissão, importadores.
- Prefira soluções simples e legíveis a soluções "inteligentes". Comente o porquê, não o quê.
- Quando terminar uma tarefa grande, rode lint, tipos e testes antes de dizer que terminou; se algo falhar, diga.

**Pendências humanas conhecidas (acompanhar em `docs/status.md`):**

| Pendência | Trava | Dono sugerido |
|---|---|---|
| Planilha do Land Bank atualizada, MD de exemplo, KML, formulário de captação | Fase 0 | Fábio |
| Escalonamento e base de cálculo da comissão | Fase 6 | Fábio + jurídico |
| Estrutura societária/CNPJ e contrato entre sócios | Lançamento | Fábio + advogado |
| Minutas dos termos (não-circunvenção, parceria) | Fase 5 | Advogado |
| Gatilho de receita recorrente | Fase 7 | Fábio |
| Provedor de WhatsApp, opt-in e templates | Fase 4 | Matheos / Zentri |
| Solução de assinatura eletrônica | Fase 5 | Time |
| Nome definitivo da marca e identidade final | Fase 8 (não bloqueia o código) | Time + designer |
| Reaproveitamento da infra Google do Fábio | Decisão futura | Fábio + Felipe |

---

# COMECE AGORA

Responda seguindo o **PROTOCOLO DA PRIMEIRA RESPOSTA** do início deste documento: entendimento, perguntas bloqueantes com respostas padrão sugeridas, plano da Fase 0 e riscos. Não escreva código até eu aprovar.
