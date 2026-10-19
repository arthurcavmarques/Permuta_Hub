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

Usuários locais (só existem no banco local, `supabase/seeds/01_local_users.sql` e `03_local_scenario.sql`):
- `admin@permutahub.local` / `admin-local-123` — admin da plataforma (curadoria)
- `usuario@permutahub.local` / `usuario-local-123` — conta pendente
- `corretor@permutahub.local` / `corretor-local-123` — corretor aprovado (CRECI verificado), responsável por MD-006 e MD-013
- `corretor.pendente@permutahub.local` / `corretor-local-123` — conta aprovada, CRECI na fila
- `comprador@permutahub.local` / `comprador-local-123` — admin da "Incorporadora Exemplo Beta"; recebeu MD-001, MD-003, MD-005
- `colega@permutahub.local` / `colega-local-123` — membro da mesma incorporadora
- `outro@permutahub.local` / `outro-local-123` — admin de outra organização, sem distribuições

E-mails do Auth local (recuperação de senha etc.) caem no Mailpit: http://127.0.0.1:54324.
Mudou `supabase/config.toml`? Reinicie: `npx supabase stop && npx supabase start` (dados preservados).

Caixa de saída (convites, aprovações — D015):
```bash
npm run outbox:send             # provedor de integration_settings (padrão "log": só imprime)
```

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
só promove (senha mantida). Corretores e compradores se cadastram em `/cadastro` e esperam a
aprovação da curadoria (D014); colegas de uma organização entram por convite.

## 6. Produção (demo da Fase 0)

| Peça | Onde |
|---|---|
| Banco/Auth/Storage | Supabase Cloud, região São Paulo (sa-east-1), plano free |
| Frontend | Cloudflare Workers (assets estáticos), worker `permutahub` (D012) |

### 6.1 Banco (Supabase Cloud)

Projeto: `eiclbivogbpmllobawzd` (sa-east-1). A conexão direta (`db.<ref>.supabase.co`) só tem
IPv6; use o **Session pooler** (IPv4), em *Connect → Session pooler*:
`postgresql://postgres.<ref>:<senha>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`.
Guarde a URL numa variável de ambiente do terminal (`DB_URL`), nunca em arquivo versionado.

A cada mudança de schema:
```bash
npx supabase db push --dry-run --db-url "$DB_URL"   # confere o que vai aplicar
npx supabase db push --db-url "$DB_URL"             # aplica migrations pendentes (NÃO aplica seeds)
```

Dados fictícios de demonstração (apenas uma vez, banco vazio). **Nunca** aplicar
`01_local_users.sql` na nuvem (senhas conhecidas). `db query` aceita **um comando por vez**:
rode cada `insert` do `02_demo_data.sql` separadamente com
`npx supabase db query --db-url "$DB_URL" -f <arquivo-com-um-comando.sql>`.

Usuários na nuvem: `npm run create-admin` com `SUPABASE_URL` e a secret key do projeto
(seção 5).

Configurações do Auth no painel do Supabase (não versionadas):
- *Authentication → Sign In / Providers*: **ligar** "Allow new users to sign up" (Fase 1, D014) e
  **desligar** "Confirm email" (sem domínio/SMTP próprio o Supabase não entrega e-mail para
  endereços de fora do time; a aprovação da curadoria compensa — D015).
- *Authentication → URL Configuration*: Site URL = URL pública do frontend.
- Depois do `db push` da Fase 1, apontar os links de e-mail para a produção:
  `update platform_settings set value = '"https://permutahub.permutahub.workers.dev"' where key = 'app_base_url';`

### 6.1.1 Reverter uma migration
Scripts em `supabase/rollbacks/`, na ordem **inversa** (ex.: 000002 antes de 000001). Apagam dados
das tabelas da migration — exporte antes. Arquivos de CRECI no Storage precisam ser removidos pela
API antes de remover o bucket.
```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261010000002_distributions_append_only.down.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261010000001_identity_orgs.down.sql
```
Local (sem psql instalado): `docker exec -i supabase_db_permutahub psql -v ON_ERROR_STOP=1 -U postgres -d postgres < arquivo.sql`.

### 6.1.2 Integridade do registro de apresentações (D017)
Na curadoria (SQL Editor ou `db query`): `select * from verify_hash_chain('distributions');`
(também `distribution_events`, `access_log`, `agreements` e `agreement_revocations`). Sem linhas = íntegro.

### 6.1.3 Edge Functions (Fase 2.5)
`registry-lookup` faz a consulta de CNPJ pelo servidor. Deploy a cada mudança em `supabase/functions/`:
```bash
npx supabase functions deploy registry-lookup --project-ref <ref>
```
Usa só `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, que o Supabase injeta sozinho (nenhum segredo extra).
Local, sobe junto com `npx supabase start`. Provedores em `integration_settings` (capability `cnpj`).
Sem a função publicada, o cadastro segue funcionando: o CNPJ fica manual e vai para a curadoria (regra 11).

### 6.1.4 Antes da importação real (Fase 2B, D022)
Plano gratuito: rodar o backup próprio (dados + schema, fora do git, como no deploy da Fase 1) antes de
qualquer carga real e usar o sistema ao menos uma vez por semana (pausa após ~7 dias sem uso).

### 6.2 Frontend (Cloudflare)

Crie `.env.production.local` (ignorado pelo git) com os valores **públicos** do projeto:
```
VITE_SUPABASE_URL=https://<ref-do-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Uma vez por máquina: `npx wrangler login` (ou `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). Depois, a cada publicação:
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
- Cadastro falha com "Signups not allowed": o Auth ainda está com cadastro desligado (local:
  reinicie o Supabase; nuvem: painel, seção 6.1).
- Login falha na nuvem com usuário recém-criado: confira se foi criado com `create-admin`
  apontando para a URL da nuvem, não a local.

## 8. Aceite/smoke em produção

```bash
ACEITE_EMAIL=... ACEITE_PASSWORD=... npx playwright test -c playwright.prod.config.ts
```
Celular emulado contra a URL de produção (`PROD_URL` para outra): login, filtro e 10 dossiês
cegos. Só leitura — não revela dado sensível (o que gravaria no `access_log`).
