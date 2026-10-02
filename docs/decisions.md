# Decisões

Formato: data · decisão · contexto · alternativas · motivo.

## Tomadas

### D001 · 2026-09-29 · Dados mockados até o Fábio entregar o Land Bank
- **Contexto:** planilha, MD de exemplo, KML e formulário ainda não disponíveis.
- **Alternativas:** esperar os dados; construir com seed fictício.
- **Motivo:** não travar a Fase 0. O importador usa um mapeamento de colunas configurável (`scripts/mappings/landbank.json`); quando a planilha real chegar, ajusta-se só o mapeamento.

### D002 · 2026-09-29 · Hospedagem: Supabase Cloud (free, sa-east-1) + Cloudflare Pages (free)
- **Contexto:** o aceite da Fase 0 exige abrir no celular; ambiente local não basta.
- **Alternativas:** Vercel Hobby (termos proíbem uso comercial), Netlify, VPS.
- **Motivo:** custo zero, uso comercial permitido. Dados reais entram só via script de importação local, nunca pelo repositório.

### D003 · 2026-09-29 · Nível de cegueira do dossiê
- Bairro + cidade; metragem arredondada à centena; mapa com círculo de ~500 m com deslocamento estável (determinístico por oportunidade), sem polígono; título cego gerado automaticamente; número do MD visível.
- Tudo parametrizado em `platform_settings`. Calculado **no servidor** (view), nunca só no cliente.

### D004 · 2026-09-29 · Modo demonstração fora do escopo (por ora)
- **Contexto:** o prompt pedia modo demo desde a Fase 0.
- **Decisão do Arthur:** desnecessário e custoso agora. Removido da Fase 0.
- **Mitigação:** dado sensível já é bloqueado por RLS/RPC para quem não tem permissão; a visão padrão é sempre o dossiê cego. Pode ser retomado depois.

### D005 · 2026-09-29 · Acesso na Fase 0
- Apenas usuários criados por script (`create-admin`), e-mail + senha, sem auto-cadastro. Dossiê cego exige login. Links públicos com token ficam para a Fase 4.

### D006 · 2026-09-29 · Histórico legado "oferecida para"
- Fase 0: importador guarda em `opportunities.extra.legacy_offered_to` (lista de nomes de empresas + texto original).
- Fase 1: migration converte em `distributions` com `source='legacy'`, sem canal/data de entrega.

### D007 · 2026-09-29 · Admin da plataforma separado de admin de organização
- Tabela `platform_admins(user_id)`; `is_admin()` consulta só ela. `organization_members.role = 'admin'` administra apenas a própria organização.

### D008 · 2026-09-29 · Repositório GitHub privado
- Criado pelo Arthur e passado por URL; até lá, git local.

### D009 · 2026-09-29 · Técnicas da Fase 0
- **Geometria:** PostGIS (`geometry(Geometry, 4326)`), já disponível no Supabase.
- **Dado sensível:** `opportunity_sensitive` sem política de SELECT; leitura só pela RPC `get_opportunity_sensitive(id)` (SECURITY DEFINER), que exige permissão e grava log. Na Fase 0 só admin da plataforma lê; na Fase 5 entra `has_valid_agreement()`.
- **PDF do dossiê:** CSS de impressão + `window.print()` (sem serviço pago nem headless no servidor). PDF com marca completa na Fase 2.
- **Supabase CLI:** via `npx supabase` (dependência de dev), sem instalação global.
- **Gerenciador de pacotes:** npm.

### D010 · 2026-10-01 · Tiles do mapa: OpenFreeMap
- **Alternativas:** tiles OSM oficiais (política de uso proíbe app em produção), MapTiler/Mapbox (chave e cota).
- **Motivo:** gratuito, sem chave, dados OSM, uso comercial permitido. Estilo `positron` (neutro).
  Provedor isolado em `src/lib/map/` para troca futura.

### D011 · 2026-10-01 · Filtros da listagem no cliente
- Lista carrega todas as áreas visíveis (view cega) e filtra no navegador.
- **Motivo:** dezenas a poucas centenas de áreas; resposta instantânea, inclusive no celular.
- **Reavaliar** acima de ~2 mil áreas (filtro no servidor + paginação). `max_rows` da API = 1000.

### D012 · 2026-10-01 · Frontend em Cloudflare Workers (assets estáticos) em vez de Pages
- **Contexto:** os nomes `holy-leaf-c5c0`/`wandering-credit-edbc` não existiam na conta; worker criado como `permutahub`. A Cloudflare recomenda Workers com
  assets estáticos para sites novos (Pages segue funcionando, sem novidades).
- **Motivo:** mesmo custo (free), deploy por `wrangler deploy`, SPA nativo
  (`not_found_handling`). Ajusta D002 só no produto da Cloudflare.
- Deploy manual (`npm run deploy`) na Fase 0; deploy automático pelo CI quando houver token.

### D013 · 2026-10-01 · Seeds separados: usuários locais × dados de demonstração
- `supabase/seeds/01_local_users.sql` (senhas conhecidas) só local; `02_demo_data.sql`
  (fictício) pode ir para a nuvem da demo. `db push` nunca aplica seeds.
- **Motivo:** demo na nuvem com dados fictícios sem expor usuários de senha conhecida.

## Em aberto

| Tema | Dono | Prazo |
|---|---|---|
| Planilha Land Bank, MD de exemplo, KML, formulário, fotos | Fábio | assim que possível |
| Base legal LGPD para contatos legados (proprietários/compradores sem consentimento) | Jurídico | antes da Fase 4 |
| Provedor de WhatsApp (API oficial paga × infra Zentri) | Matheos / Zentri | Fase 4 |
| Imutabilidade forte (encadeamento de hashes + exportação) além de trigger | Time técnico | Fase 1 |
| `distributions` append-only × colunas de estado: proposta = fatos iniciais + estado derivado de `distribution_events` | Time técnico | Fase 1 |
| Definição geográfica de "região" para o score de proximidade | Fábio + técnico | Fase 3 |
