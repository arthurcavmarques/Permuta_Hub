# Status

**Fase atual:** 0 — Protótipo demonstrável (branch `fase-0`)
**Estimativa:** 38–46 h (original 40–48 h; −2 h pela remoção do modo demo, D004)

## Fase 0 — tarefas

| # | Tarefa | Situação |
|---|---|---|
| 0 | Arquivos de memória (`CLAUDE.md`, `decisions.md`, `status.md`) | feito |
| 1 | Scaffold, `.env.example`, Supabase local | feito (+ CI no GitHub Actions, `docs/runbook.md`) |
| 2 | Tokens de design + layout base | feito |
| 3 | Migrations mínimas + RLS | feito (+ `access_log` append-only antecipado, `docs/data-model.md`) |
| 4 | Seed fictício | feito (25 áreas, 2 usuários locais) |
| 5 | Login + script de admin | feito |
| 6 | Importadores Land Bank e KML/KMZ | feito (com `--dry-run`) |
| 7 | Listagem com filtros + mapa | feito |
| 8 | Dossiê cego + PDF | feito (controles do mapa ocultos na impressão) |
| 9 | Testes | feito: pgTAP 20, Vitest 65, Playwright 9 (+ aceite em produção) |
| 10 | Deploy | feito: https://permutahub.permutahub.workers.dev (Supabase `eiclbivogbpmllobawzd`, sa-east-1) |

**Última sessão (2026-10-02):** deploy da Fase 0 no ar. Banco na nuvem com migrations, 25 áreas
fictícias e 3 admins da plataforma (Arthur, Matheos, Felipe). Aceite em produção aprovado
(`e2e-prod/aceite.spec.ts`, celular: filtro + 10 dossiês cegos; RLS verificado na API).
Corrigido: worker do MapLibre não ia para o build de produção (mapa em branco).
**Sessão 2026-10-05 (planejamento, sem código):** Fase 0 mergeada em `main` (PR #1). Arthur trocou a senha
do banco de produção e configurou a Site URL no Supabase.
**Próximo passo:** migrar o ambiente de dev para a máquina do Arthur → Arthur autoriza a Fase 1 em nova sessão
→ responder perguntas (a) e (b) abaixo → criar branch `fase-1` (estimativa 50–60 h).

### Perguntas abertas para iniciar a Fase 1
| # | Pergunta | Sugestão padrão |
|---|---|---|
| a | Corretor e comprador se cadastram sozinhos ou só por convite? | Auto-cadastro com conta **pendente** até aprovação do admin; só corretor aprovado cadastra área |
| b | Há domínio próprio para e-mail (convites)? | Dev com e-mail simulado local; provedor gratuito (ex.: Resend) quando houver domínio |

### Marcos de demonstração (referência)
- **Fase 0:** vitrine (catálogo, mapa, dossiê cego) — já demonstrável.
- **Fase 2:** captação → dossiê sem planilha (para captadores/corretores).
- **Fase 4:** match → envio → "tenho interesse" rastreado — demo completa para compradores/investidores.

**Aceite (revisado, sem modo demo):** no celular, filtro e abro o dossiê cego de ≥10 áreas; teste automatizado prova que usuário sem permissão não lê `opportunity_sensitive` por chamada direta à API.

## Pendências humanas

| Pendência | Trava | Dono |
|---|---|---|
| Planilha Land Bank, MD de exemplo, KML, formulário, fotos (Arthur vai cobrar) | Dados reais na demo (não bloqueia a Fase 1) | Fábio |
| Migrar ambiente de dev para a máquina do Arthur (máquina atual: 5,6 GB livres no C:) | Dev local (Docker/pgTAP da Fase 1) | Arthur (com o Claude) |
| Supabase free: pausa após ~7 dias sem uso e sem backup restaurável — decidir Pro ou backup próprio | Antes de entrar dado real | Arthur + Felipe |
| Templates de WhatsApp exigem aprovação da Meta (dias a semanas) — iniciar cedo | Fase 4 | Matheos / Zentri |
| Escalonamento e base de cálculo da comissão | Fase 6 | Fábio + jurídico |
| Estrutura societária/CNPJ | Lançamento | Fábio + advogado |
| Minutas dos termos | Fase 5 | Advogado |
| Gatilho de receita recorrente | Fase 7 | Fábio |
| Provedor de WhatsApp, opt-in, templates | Fase 4 | Matheos / Zentri |
| Assinatura eletrônica | Fase 5 | Time |
| Nome e identidade final | Fase 8 | Time + designer |
| **Rotacionar a secret key do Supabase** (exposta no chat em 2026-10-06 para redefinir senhas) | Segurança — fazer já | Arthur |
| Senhas temporárias dos 3 admins (2026-10-06): trocar quando houver tela de troca de senha (incluir na Fase 1) | Segurança | Sócios |
| Domínio próprio (sócios não querem pagar por ora; site segue em `*.workers.dev`) | Não impede; necessário para e-mail de convites (pergunta b) e lançamento | Sócios |

## DEPENDE DO JURÍDICO
- Distribuição sem mandato (`allow_distribution_without_mandate`, padrão `false`).
- Base de cálculo e escalonamento da comissão.
- Remuneração em ativos.
- Redação dos termos (não-circunvenção, parceria, uso da plataforma).
- Prazo de cauda (`default_tail_period_months`, padrão 24).
- Base legal LGPD para importar contatos legados sem consentimento registrado.

## Riscos
- Prazo: apresentação início de outubro; sem dados reais, a demo sai com dados fictícios.
- Dossiê cego não garante anonimato (bairro + metragem + foto aérea identificam); fotos exigem curadoria manual.
- Imutabilidade por trigger não resiste ao dono do banco (ver "Em aberto" em decisions.md).
