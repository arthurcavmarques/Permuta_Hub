# Status

**Fase atual:** 0 — Protótipo demonstrável (branch `fase-0`)
**Estimativa:** 38–46 h (original 40–48 h; −2 h pela remoção do modo demo, D004)

## Fase 0 — tarefas

| # | Tarefa | Situação |
|---|---|---|
| 0 | Arquivos de memória (`CLAUDE.md`, `decisions.md`, `status.md`) | feito |
| 1 | Scaffold, CI, `.env.example`, Supabase local, runbook | a fazer |
| 2 | Tokens de design + layout base | a fazer |
| 3 | Migrations mínimas + RLS | a fazer |
| 4 | Seed fictício | a fazer |
| 5 | Login + script de admin | a fazer |
| 6 | Importadores Land Bank e KML/KMZ | a fazer |
| 7 | Listagem com filtros + mapa | a fazer |
| 8 | Dossiê cego + PDF | a fazer |
| 9 | Testes (pgTAP, Vitest, Playwright smoke) | a fazer |
| 10 | Deploy | a fazer |

**Aceite (revisado, sem modo demo):** no celular, filtro e abro o dossiê cego de ≥10 áreas; teste automatizado prova que usuário sem permissão não lê `opportunity_sensitive` por chamada direta à API.

## Pendências humanas

| Pendência | Trava | Dono |
|---|---|---|
| Planilha Land Bank, MD de exemplo, KML, formulário, fotos | Dados reais na Fase 0 (não bloqueia código) | Fábio |
| URL do repositório GitHub | Push/CI | Arthur |
| Conta Supabase + Cloudflare | Deploy da Fase 0 | Arthur |
| Docker Desktop rodando na máquina de dev | Banco local e testes de banco | Arthur |
| E-mails dos sócios para usuários da demo | Deploy | Arthur |
| Escalonamento e base de cálculo da comissão | Fase 6 | Fábio + jurídico |
| Estrutura societária/CNPJ | Lançamento | Fábio + advogado |
| Minutas dos termos | Fase 5 | Advogado |
| Gatilho de receita recorrente | Fase 7 | Fábio |
| Provedor de WhatsApp, opt-in, templates | Fase 4 | Matheos / Zentri |
| Assinatura eletrônica | Fase 5 | Time |
| Nome e identidade final | Fase 8 | Time + designer |

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
