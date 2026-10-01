# Runbook

Como rodar, testar, importar dados e publicar. Comandos para Windows (PowerShell ou Git Bash).

## 1. Pré-requisitos
- Node 22+ e npm.
- Docker Desktop **rodando** (banco local e testes de banco).
- Acesso ao repositório `github.com/arthurcavmarques/Permuta_Hub`.

## 2. Ambiente local

```bash
npm install
npx supabase start              # sobe Postgres+PostGIS, Auth, Storage, API (Docker)
npx supabase db reset           # migrations + supabase/seeds/*.sql (dados fictícios)
npx supabase status -o env      # mostra URL e chaves locais
```

Crie os arquivos de ambiente a partir de `.env.example` (nunca commitar):
- `.env.local` → `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (use `ANON_KEY` ou `PUBLISHABLE_KEY`).
- `.env` → `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (use `SERVICE_ROLE_KEY` ou `SECRET_KEY`).

```bash
npm run dev                     # http://localhost:5173
```

Usuários locais (só existem no banco local, `supabase/seeds/01_local_users.sql`):
- `admin@permutahub.local` / `admin-local-123` — admin da plataforma
- `usuario@permutahub.local` / `usuario-local-123` — logado, sem permissão

Studio local: http://127.0.0.1:54323

## 3. Testes

```bash
npm run lint && npm run typecheck   # estático
npm test                            # Vitest (unidade)
npm run test:db                     # pgTAP — exige banco local com db reset
npm run test:e2e                    # Playwright (celular + desktop) — exige banco local e seed
```

O CI (`.github/workflows/ci.yml`) roda tudo isso em cada push para `main` e `fase-*` e em PRs.
Falhas de E2E publicam `playwright-report` como artefato.

## 4. Importação de dados reais

Dados reais **nunca** entram no git (`data/` e `import-reports/` são ignorados).
Sempre rode primeiro com `--dry-run` e confira o relatório em `import-reports/`.

```bash
npm run import:landbank -- data/landbank.xlsx --dry-run
npm run import:landbank -- data/landbank.xlsx
npm run import:kml -- data/areas.kmz --dry-run
npm run import:kml -- data/areas.kmz
```

O mapeamento de colunas da planilha fica em `scripts/mappings/landbank.json` (D001).
O destino é o banco apontado por `SUPABASE_URL` no `.env` — para importar na nuvem, troque
temporariamente para a URL e a chave secreta do projeto na nuvem (ver seção 6).

## 5. Admins da plataforma

```bash
npm run create-admin -- pessoa@empresa.com.br "senha-com-10+-caracteres" "Nome Completo"
```

Cria o usuário (e-mail já confirmado) e o inclui em `platform_admins`. Se o e-mail já existe,
só promove (senha mantida). Não há auto-cadastro (D005).

## 6. Produção (demo da Fase 0)

| Peça | Onde |
|---|---|
| Banco/Auth/Storage | Supabase Cloud, região São Paulo (sa-east-1), plano free |
| Frontend | Cloudflare Workers (assets estáticos), worker `holy-leaf-c5c0` (D012) |

### 6.1 Banco (Supabase Cloud)

Uma vez por máquina:
```bash
npx supabase login                                      # abre o navegador
npx supabase link --project-ref <ref-do-projeto>        # pede a senha do banco
```

A cada mudança de schema:
```bash
npx supabase db push --dry-run    # confere o que vai aplicar
npx supabase db push              # aplica migrations pendentes (NÃO aplica seeds)
```

Dados fictícios de demonstração (apenas uma vez, banco vazio). **Nunca** aplicar
`01_local_users.sql` na nuvem (senhas conhecidas):
```bash
npx supabase db query --linked -f supabase/seeds/02_demo_data.sql
```

Configurações do Auth no painel do Supabase (não versionadas):
- *Authentication → Sign In / Providers*: **desligar** "Allow new users to sign up" (D005).
- *Authentication → URL Configuration*: Site URL = URL pública do frontend.

### 6.2 Frontend (Cloudflare)

Crie `.env.production.local` (ignorado pelo git) com os valores **públicos** do projeto:
```
VITE_SUPABASE_URL=https://<ref-do-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Uma vez por máquina: `npx wrangler login`. Depois, a cada publicação:
```bash
npm run deploy                     # build (tsc + vite) + wrangler deploy
```

`wrangler.jsonc` serve `dist/` como SPA (rotas desconhecidas caem no `index.html`);
`public/_headers` define cabeçalhos de segurança.

### 6.3 Chaves
- **Publishable/anon**: pública por design (vai no navegador); o que protege os dados é RLS.
- **Secret/service_role**: só em `.env` local para scripts. Se vazar (chat, print, commit),
  gere outra no painel (*Project Settings → API Keys*) e revogue a antiga.

## 7. Problemas comuns
- `error during connect ... dockerDesktopLinuxEngine`: o Docker Desktop não está aberto.
- Página em branco com erro "Defina VITE_SUPABASE_URL": falta `.env.local` (dev) ou
  `.env.production.local` (deploy).
- Login falha na nuvem com usuário recém-criado: confira se foi criado com `create-admin`
  apontando para a URL da nuvem, não a local.
