# PermutaHub — guia para o Claude Code

> **Ao iniciar qualquer sessão:** leia `docs/status.md` e `docs/decisions.md` antes de fazer qualquer coisa.
> A especificação completa está em `PermutaHub_PROMPT_CLAUDE_CODE_COMPLETO.md` (referência; decisões posteriores em `docs/decisions.md` prevalecem).

## Produto (resumo)
Mesa de negócios para terrenos/áreas de incorporação (início: Porto Alegre/RS). Fluxo:
captação → qualificação → dossiê (Memorial Descritivo, versões cega e completa) → matchmaking por regras →
envio proativo (WhatsApp prioritário, e-mail complementar) → negociação → fechamento/remuneração.
O ativo é a **rede** e a **rastreabilidade de quem apresentou o quê a quem**. Nome "PermutaHub" é provisório
(constante `PRODUCT_NAME` em `src/config/product.ts`).

## As 10 regras inegociáveis
1. Dado sensível (matrícula, endereço exato, proprietário e contatos) bloqueado por padrão, em tabela separada, com RLS; bloqueio vale **na API**.
2. `distributions` e `access_log` são **append-only** (sem UPDATE/DELETE para ninguém, com trigger).
3. A plataforma nunca aproxima proprietário e comprador diretamente. Toda oportunidade tem `responsible_party` e `mandate_status`.
4. "Pode distribuir sem mandato?" é configurável (`platform_settings`); padrão **não**.
5. Nenhum percentual de comissão no código.
6. Remuneração pode ser em ativos: modelar, não construir revenda.
7. LGPD: consentimento registrado (texto, versão, IP, timestamp), coleta mínima, RLS em todas as tabelas, exportar/anonimizar titular.
8. WhatsApp só com opt-in; toda mensagem com opção de sair; tratar "sair"/"parar".
9. Sem segredos no repositório (`.env.example` completo).
10. O que depender de jurídico → marcado **"DEPENDE DO JURÍDICO"** em `docs/status.md` e implementado configurável.

## Stack
Supabase (Postgres + PostGIS, Auth, Storage, RLS, Edge Functions) · React + TypeScript + Vite + Tailwind + shadcn/ui ·
React Router · TanStack Query · React Hook Form + Zod · MapLibre GL + OSM · Vitest · Playwright · pgTAP.
Deploy: Supabase Cloud (free, região São Paulo) + Cloudflare Pages (free).

## Comandos
```bash
npm install                    # dependências
npx supabase start             # banco local (requer Docker Desktop rodando)
npx supabase db reset          # recria banco local: migrations + supabase/seeds/*.sql
npm run dev                    # frontend em http://localhost:5173
npm run lint                   # ESLint
npm run typecheck              # tsc --noEmit
npm test                       # Vitest (unidade)
npm run test:db                # pgTAP (supabase/tests) — requer banco local
npm run test:e2e               # Playwright
npm run import:landbank -- <arquivo.csv|xlsx>   # importa Land Bank
npm run import:kml -- <arquivo.kml|kmz>         # importa geometrias
npm run create-admin -- <email> <senha>         # cria admin da plataforma
```
Detalhes em `docs/runbook.md`.

## Convenções
- UI e docs em **pt-BR**; identificadores, tabelas e colunas em **inglês**.
- Textos da interface só em `src/i18n/pt-BR.ts`.
- Cores/tipografia/raios/sombras só em `src/design/tokens.ts`. **Nunca** cor hard-coded em componente.
- Toda mudança de banco via migration em `supabase/migrations/`; registrar em `docs/data-model.md`.
- Admin da plataforma (`platform_admins`, `is_admin()`) ≠ papel `admin` dentro de uma organização. Nunca confundir.
- Dados reais só local/ignorados pelo git; repositório usa apenas dados fictícios.
- Ambiguidade de negócio: perguntar. Ambiguidade técnica: decidir, registrar em `docs/decisions.md`, seguir.
- Commits pequenos e descritivos. Antes de dizer "terminei": lint + tipos + testes.
- Um branch por fase; merge só com OK do Arthur/Felipe.
