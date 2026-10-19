# Status

**Fase atual:** 2 — Captação pelas duas portas, qualificação, verificação cadastral e aceite de termo:
**em andamento** no branch `fase-2` (aprovada pelo Arthur em 2026-10-19). Escopo ampliado pela revisão de
requisitos (D019–D021); plano completo atualizado (revisão 2026-10-19).
**Estimativa da Fase 2:** 90–110 h de trabalho humano (o dobro da original, pelo escopo novo). Comparar no fim.

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
| 2.1 | Termos versionados editáveis + `agreements` append-only + aceite do comprador antes do dado sensível | a fazer |
| 2.2 | Proprietário com login, formulário público, "minhas áreas" sem identificar comprador, área retida | a fazer |
| 2.3 | Editor completo do MD + autorização do proprietário + termo-mestre e aceite por área | a fazer |
| 2.4 | Fila de leads, pipeline, mandato/publicável, logs de acesso | a fazer |
| 2.5 | CNPJ automático (BrasilAPI) + CRECI nível B/C | a fazer |
| 2.6 | PDF do dossiê cego com marca | a fazer |

**Sessão 2026-10-19:** validação dos requisitos do Continuidade 2.0 com a Bruna (PO). Respostas do Arthur:
"bug crítico" descartado; vídeos de 14–15/10 ignorados; Supabase segue no plano gratuito (D022); `.claude/` e o
plano completo fora do git (D023); perguntas ao Fábio anotadas; canal CRECI anotado (L1). OK para a Fase 2.

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
