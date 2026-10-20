# Status

**Fase atual:** 2 — Captação pelas duas portas, qualificação, verificação cadastral e aceite de termo:
**mergeada em `main` (`b3ff83d`, 2026-10-20, autorizada pelo Arthur); deploy BLOQUEADO** — o projeto Supabase
de produção não responde (DNS de `eiclbivogbpmllobawzd.supabase.co` não existe: provável pausa do plano gratuito
por inatividade, D022). O site no ar segue com o frontend da Fase 1, sem backend. Para destravar: Arthur
restaura o projeto no painel do Supabase e roda `npx supabase login` (necessário para `functions deploy`).
Escopo ampliado pela revisão de requisitos (D019–D021); plano completo atualizado (revisão 2026-10-19).
**Estimativa:** 90–110 h de trabalho humano. **Realizado:** uma sessão de ~3 h de relógio com o Claude
(ordem de grandeza só; não se compara bem com horas humanas).

## ⚠ Lembrar o Arthur no início de cada sessão
Perguntas sem resposta ("anote"). Ao abrir uma sessão, lembrar o Arthur destas e de
`docs/perguntas à fabio.md` (11 perguntas ao Fábio, cada uma com o padrão que o sistema adota até lá).

| # | Pergunta | Dono | Desde |
|---|---|---|---|
| L1 | Existe canal institucional com o CRECI-RS para consulta automática (nível A)? Até lá: verificação assistida | Arthur / Felipe (e Fábio, pergunta 11) | 2026-10-19 |
| L2 | Respostas do Fábio às 11 perguntas de `docs/perguntas à fabio.md` | Fábio (Arthur cobra) | 2026-10-19 |

## Fase 2 — tarefas

| Bloco | Tarefa | Situação |
|---|---|---|
| 2.1 | Termos versionados editáveis + `agreements` append-only + aceite do comprador antes do dado sensível | feito |
| 2.2 | Proprietário com login, formulário público, "minhas áreas" sem identificar comprador, área retida | feito |
| 2.3 | Editor completo do MD + autorização do proprietário + termo-mestre e aceite por área | feito |
| 2.4 | Fila de leads, pipeline, mandato/publicável, logs de acesso | feito |
| 2.5 | CNPJ automático (BrasilAPI) + CRECI nível B/C | feito |
| 2.6 | PDF do dossiê cego com marca | feito |
| — | Migrations reversíveis | feito: `supabase/rollbacks/2026101900000{1,3,4,5,6}` testados (down → testes da Fase 1 passam → up) |
| — | Testes | pgTAP 318 (9 arquivos), Vitest 117, Playwright 27 (+3 pulados de propósito: fluxos longos só no desktop) |

**Aceite da Fase 2:**
- ✔ (a) sem aceite, dado sensível inacessível pela tela **e** pela API para o comprador; com aceite, acessível e
  logado; revogado/expirado volta a bloquear (`04_agreements`, E2E "comprador só vê o dado restrito…").
- ✔ (b) proprietário se cadastra, aceita o termo, cadastra área retida e vê só o que é dele, com números agregados
  e sem identificar comprador (`05_owner_leads`, E2E do proprietário).
- ✔ (c) corretor tem CNPJ da imobiliária preenchido e travado (ou cai na fila manual) e CRECI conferido; cadastra
  área com autorização anexada e aceite por área (`06_md_editor`, `08_registry`, E2E do editor e do CNPJ).
- ✔ (d) lead entra pelo formulário, é qualificado e vira dossiê publicável sem planilha (`07_curation`, E2E
  "lead vira dossiê publicável").
- ✔ (e) área sem autorização, sem responsável ou sem mandato (regra 4) não publica — nem pela API (`07_curation`).

**Como testar em 5 minutos (local):** `npx supabase db reset` → `npm run dev` →
(1) em `/cadastrar-area` (link "Cadastre aqui" no login), ofereça uma área sem login;
(2) entre como `admin@permutahub.local` / `admin-local-123` → Curadoria → **Leads** → "Converter em oportunidade":
a tela da área lista **o que falta**; atribua "Corretor Aprovado" e mandato "Exclusividade"; "Editar área" →
zoneamento, importe `scripts/fixtures/exemplo.kml`, envie uma foto (marque "versão cega"), anexe uma autorização e
clique "Conferir";
(3) entre como `corretor@permutahub.local` / `corretor-local-123` → abra a área (/areas/<id>/editar) e aceite o
termo da área;
(4) volte como admin → "Publicar"; veja o **Histórico** e a aba **Logs de acesso**;
(5) como `comprador@permutahub.local` / `comprador-local-123`, abra MD-001 → "Revelar dados restritos" pede o termo.

**Ficou de fora (e por quê):**
- Nível A do CRECI (consulta automática): não há fonte legítima (D025, pendência L1).
- Reverificação **automática** mensal do CNPJ: exige pg_cron + pg_net; a curadoria reconsulta (D024).
- ReceitaWS como 2º provedor de CNPJ: implementado, desligado até conferir termos/limites (D024).
- Desenho de polígono com edição de vértices (arrastar): o editor marca pontos e importa KML; ajuste fino pelo
  Google Earth + reimportação.
- Gestão de aceites pela curadoria (lista, revogar pela tela, exportar comprovante) e expiração por cauda: Fase 5
  (a revogação já existe por RPC).
- Fila de leads por WhatsApp/e-mail automático ao proprietário: depende do domínio e do provedor (Fase 4).
- Importação pela tela e painel de publicáveis da base real: Fase 2B.

**Riscos novos:**
- Foto marcada "versão cega" pelo corretor é só proposta; a curadoria precisa revisar antes de publicar (a
  publicação é o portão).
- BrasilAPI é comunitária, sem SLA nem termos publicados; se cair, o cadastro segue manual (fila maior).
- O PDF leva o e-mail de quem gerou: inibe repasse, mas não impede print de tela.
- Proprietário com conta pendente já cadastra área: spam possível (mitigado por honeypot, rate limit e curadoria).
- `opportunities.status` de áreas legadas (seed/importador) pode estar "qualificada" sem passar pela checagem de
  publicável: a trava vale para mudanças feitas pelo app. Rever na Fase 2B (painel de publicáveis).

**O que o humano precisa validar/fornecer:**
- Respostas do Fábio (`docs/perguntas à fabio.md`), sobretudo 1–4 (padrões seguros da Fase 2 já no ar).
- Texto do advogado para os 5 termos (trocar pela aba **Termos**, sem deploy) e razão social/CNPJ da plataforma
  (`platform_settings.platform_legal_name` / `platform_document_id`).
- OK para merge e **deploy**, que agora tem um passo a mais: `supabase db push` + `supabase functions deploy
  registry-lookup` + `npm run deploy` (runbook 6.1.3). Os corretores aprovados em produção passam a ter
  reverificação agendada em 12 meses.

**Sessão 2026-10-19:** validação dos requisitos do Continuidade 2.0 com a Bruna (PO). Respostas do Arthur:
"bug crítico" descartado; vídeos de 14–15/10 ignorados; Supabase segue no plano gratuito (D022); `.claude/` e o
plano completo fora do git (D023); perguntas ao Fábio anotadas; canal CRECI anotado (L1). OK para a Fase 2.
Fase 2 implementada na mesma sessão (blocos 2.1–2.6), testes verdes; **não** mergeada nem publicada.

**Sessão 2026-10-20:** Arthur autorizou merge e deploy. Suíte local verde de novo (pgTAP 318, Vitest 117,
typecheck, lint); merge `b3ff83d` em `main`, `fase-2` enviada ao GitHub. Deploy não feito: banco de produção
inacessível (projeto pausado?) e Supabase CLI sem login. Nada foi aplicado em produção.

## Histórico — Fase 1 (concluída, em produção 2026-10-10)
**Estimativa:** 50–60 h. **Realizado:** uma sessão de ~1 h de relógio (2026-10-10) com o Claude.

### Fase 1 — tarefas

| # | Tarefa | Situação |
|---|---|---|
| 1 | Auth completa, perfis, organizações, membros, convites | feito: auto-cadastro com aprovação (D014), convite por link (D015), troca de senha |
| 2 | Papéis e RLS completa com funções auxiliares | feito: `is_approved`, `is_approved_broker`, `user_org_ids`, `is_org_admin`, `can_view_blind` ampliado, `has_valid_agreement` (placeholder Fase 5) |
| 3 | Corretor com CRECI e fila de verificação | feito: upload no bucket privado, fila na curadoria, e-mail de aprovação/rejeição |
| 4 | Comprador e organização; canal preferido; `contact_consents` | feito: consentimento versionado (texto, versão, hash, IP, user-agent, data) — append-only |
| 5 | Painel admin base | feito: usuários, fila de CRECI, organizações, caixa de saída |
| 6 | `access_log`, `distributions`, `distribution_events` append-only | feito: triggers + cadeia de hashes verificável (D016, D017); legado convertido (D018) |
| 7 | Adapters com fakes e testes | feito: e-mail (log/fake/Resend), WhatsApp (log, opt-out), aceite (hash), CRECI (fila), cobrança (nenhuma) |
| — | Migrations reversíveis | feito: `supabase/rollbacks/` testado (down → teste da Fase 0 → up sobre dados existentes) |
| — | Testes | pgTAP 136 (20 + 69 + 47), Vitest 99, Playwright 15 (+1 pulado de propósito) |

**Aceite da Fase 1:** ✔ suíte de RLS prova, por perfil (anônimo, pendente, corretor aprovado, corretor
sem CRECI, comprador admin, colega, outra organização, curadoria), o que lê e escreve
(`supabase/tests/02_roles_matrix.test.sql`); ✔ UPDATE/DELETE/TRUNCATE nas tabelas append-only falham
com `authenticated`, `service_role` e dono do banco (`03_append_only_chain.test.sql`);
✔ corretor sem aprovação não cadastra área (pgTAP + E2E).

**Como testar em 5 minutos (local):** `npx supabase db reset` → `npm run dev` →
(1) em `/cadastro`, crie um corretor; veja "Conta em análise" e envie um CRECI;
(2) entre como `admin@permutahub.local` / `admin-local-123` → Curadoria → aprove a conta e o CRECI;
(3) volte como o corretor → "Cadastrar área";
(4) entre como `comprador@permutahub.local` / `comprador-local-123`: vê só 3 áreas; em Minha conta →
Gerenciar, gere um convite e abra o link numa janela anônima.

**Ficou de fora (e por quê):**
- Envio automático da caixa de saída (Edge Function + agendamento): sem domínio não há para onde
  enviar; `npm run outbox:send` e a aba "Caixa de saída" cobrem por ora (D015).
- "Esqueci a senha" na tela de login: sem SMTP próprio o e-mail não chega fora do time; a curadoria
  redefine a senha.
- Corretor preencher dado sensível (matrícula, proprietário) e editor completo do MD: Fase 2.
- Admin da organização trocar o papel de um membro pela tela (o banco já permite): baixa prioridade.
- Exportar/anonimizar dados de um titular (regra 7): sem tela ainda — proposta para a Fase 8.

**Riscos novos:**
- Sem confirmação de e-mail em produção (D015), alguém pode se cadastrar com e-mail alheio. Mitigação:
  a conta só vale depois da aprovação manual; a curadoria deve conferir telefone/empresa.
- Os textos de consentimento são minuta: consentimentos colhidos agora apontam para a versão
  `2026-10-v1` (placeholder). Com o texto do advogado, publicar `v2` e pedir novo aceite.
- O link de convite vale para o e-mail convidado; quem tiver acesso à caixa daquele e-mail entra
  aprovado. Convites expiram em 7 dias e podem ser cancelados.

**Sessão 2026-10-10:** ambiente migrado para a máquina do Arthur (Git, Node 22, Docker, 54 GB livres);
perguntas (a) e (b) respondidas (D014, D015); Fase 1 implementada no branch `fase-1`.
**Deploy 2026-10-10:** aprovado pelo Arthur; merge `dcf10bf` em `main`; backup prévio (dados + schema) em
`import-reports/` (local, fora do git); migrations aplicadas; `app_base_url` = site; Auth com cadastro ligado e
confirmação de e-mail desligada; frontend publicado. Verificado: 3 admins aprovados, 11 distribuições legadas,
cadeias de hash íntegras, API anônima só lê textos de consentimento, cadastro carrega no celular.
**Próximo passo:** trocar a senha do banco (exposta no chat) → sócios trocam as senhas temporárias em
Minha conta → aprovação da Fase 2.

## Histórico — Fase 0 (concluída, mergeada em `main` no PR #1)
Protótipo demonstrável no ar em https://permutahub.permutahub.workers.dev (Supabase `eiclbivogbpmllobawzd`,
sa-east-1): catálogo, mapa, dossiê cego, PDF, importadores. Aceite em produção aprovado em 2026-10-02.

### Marcos de demonstração (referência)
- **Fase 0:** vitrine (catálogo, mapa, dossiê cego) — já demonstrável.
- **Fase 2:** captação → dossiê sem planilha (para captadores/corretores).
- **Fase 4:** match → envio → "tenho interesse" rastreado — demo completa para compradores/investidores.

## Pendências humanas

| Pendência | Trava | Dono |
|---|---|---|
| Planilha Land Bank, MD de exemplo, KML, formulário, fotos (Arthur vai cobrar) | Dados reais na demo (não bloqueia a Fase 1) | Fábio |
| Supabase free mantido (D022): rodar backup próprio antes da importação real e usar ao menos 1×/semana (pausa após ~7 dias) | Fase 2B | Arthur + Felipe |
| Canal institucional com o CRECI-RS (consulta automática, nível A) — L1 | Nível A do CRECI | Arthur / Felipe / Fábio |
| Respostas às perguntas de `docs/perguntas à fabio.md` — L2 | Padrões seguros da Fase 2; Fase 2B; Fase 7 | Fábio |
| Repassar `PermutaHub_PROMPT_CLAUDE_CODE_COMPLETO.md` ao Felipe (fora do git, D023) | Felipe ter o plano | Arthur |
| Templates de WhatsApp exigem aprovação da Meta (dias a semanas) — iniciar cedo | Fase 4 | Matheos / Zentri |
| Escalonamento e base de cálculo da comissão | Fase 6 | Fábio + jurídico |
| Estrutura societária/CNPJ | Lançamento | Fábio + advogado |
| Minutas dos termos | Fase 5 | Advogado |
| Gatilho de receita recorrente | Fase 7 | Fábio |
| Provedor de WhatsApp, opt-in, templates | Fase 4 | Matheos / Zentri |
| Assinatura eletrônica | Fase 5 | Time |
| Nome e identidade final | Fase 8 | Time + designer |
| **Rotacionar a secret key do Supabase** (exposta no chat em 2026-10-06 para redefinir senhas) | Segurança — fazer já | Arthur |
| Senhas temporárias dos 3 admins (2026-10-06): trocar em "Minha conta → Trocar senha" após o deploy da Fase 1 | Segurança | Sócios |
| **Trocar a senha do banco de produção** (exposta no chat em 2026-10-10 para o deploy) e atualizar `.env.deploy` | Segurança — fazer já | Arthur |
| Texto definitivo dos consentimentos (privacidade, WhatsApp, e-mail) — hoje minuta `2026-10-v1` | Coleta de consentimento válida | Advogado |
| Domínio próprio (sócios não querem pagar por ora; site segue em `*.workers.dev`) | Não impede (convite por link, D015); necessário para e-mail de verdade, confirmação de e-mail e recuperação de senha | Sócios |

## DEPENDE DO JURÍDICO
- Distribuição sem mandato (`allow_distribution_without_mandate`, padrão `false`).
- Base de cálculo e escalonamento da comissão.
- Remuneração em ativos.
- Redação dos termos (não-circunvenção, parceria, uso da plataforma).
- Prazo de cauda (`default_tail_period_months`, padrão 24).
- Base legal LGPD para importar contatos legados sem consentimento registrado.
- Textos de consentimento (`consent_texts`, hoje minuta `2026-10-v1`).
- Textos dos termos do comprador, do corretor (termo-mestre e por área) e do proprietário (`agreement_templates`, rascunhos).
- Intermediação direta com 50% da comissão e "Modelo 2" (Fase 6, só simulador).
- Razão social e CNPJ da plataforma nos termos (configuração com placeholder).

## Riscos
- Prazo: apresentação início de outubro; sem dados reais, a demo sai com dados fictícios.
- Dossiê cego não garante anonimato (bairro + metragem + foto aérea identificam); fotos exigem curadoria manual.
- Imutabilidade por trigger não resiste ao dono do banco; a cadeia de hashes (D017) torna a adulteração detectável, mas o último hash ainda não é exportado para fora do banco (Fase 8).
