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

### D014 · 2026-10-10 · Cadastro: auto-cadastro com aprovação (pergunta a da Fase 1, aprovada pelo Arthur)
- Corretor e comprador se cadastram sozinhos; a conta nasce `pending` (`profiles.account_status`) e só vale
  depois que um admin da plataforma aprova. Conta pendente vê apenas o próprio perfil.
- Corretor: além da conta aprovada, precisa de CRECI `approved` (`brokers.verification_status`) para cadastrar área.
  Regra aplicada na RLS de `opportunities` (insert), não só na tela.
- Comprador no cadastro cria a própria organização e vira `admin` dela; demais pessoas da empresa entram por convite.
- **Alternativa descartada:** só convite (trava o crescimento da rede; o ativo é a rede).

### D015 · 2026-10-10 · E-mail sem domínio próprio (pergunta b da Fase 1)
- Mensagens saem por uma **caixa de saída** (`email_outbox`, gravada no banco) e um `EmailProvider` trocável.
  Local: Mailpit do Supabase (`http://127.0.0.1:54324`) para os e-mails do Auth; `LogEmailProvider` para os demais.
- Convites geram **link copiável** (token aleatório, só o hash fica no banco, expira em 7 dias): o admin pode
  mandar por WhatsApp enquanto não há domínio. Resend (free) entra quando houver domínio.
- Auth em produção: "Confirm email" **desligado** — o SMTP padrão do Supabase só entrega para endereços
  do time. A aprovação manual da curadoria (D014) compensa a falta de verificação do e-mail.
  Recuperação de senha por e-mail também não funciona fora do time: até haver domínio, a curadoria
  redefine pelo painel/script. Religar a confirmação quando houver SMTP próprio.

### D016 · 2026-10-10 · `distributions` append-only: fatos iniciais + estado derivado
- `distributions` guarda só o que é verdade no momento do envio (quem, o quê, canal, origem, snapshot da mensagem).
  Tudo que muda (enviado, entregue, aberto, interesse…) é linha nova em `distribution_events`.
  O estado atual é a view `distribution_status` (último evento). Sem colunas `sent_at`/`opened_at` mutáveis.
- Resolve o item "append-only × colunas de estado" que estava em aberto.

### D017 · 2026-10-10 · Imutabilidade forte: encadeamento de hashes
- `access_log`, `distributions` e `distribution_events` ganham `prev_hash`/`row_hash` (SHA-256 do conteúdo + hash
  anterior), calculados por trigger no INSERT. `verify_hash_chain(tabela)` aponta a primeira linha adulterada.
- Não impede o dono do banco de reescrever tudo, mas torna a adulteração **detectável**; exportação periódica
  do último hash para fora do banco (ex.: e-mail aos sócios) fica para a Fase 8.

### D018 · 2026-10-10 · Histórico legado "oferecida para" → `distributions` (executa D006)
- Cada nome de empresa em `opportunities.extra.legacy_offered_to` vira (ou reaproveita, por nome normalizado)
  uma organização e uma `distribution` com `source = 'legacy'`, sem canal/entrega. Função idempotente
  `import_legacy_distributions()`, chamada pela migration e pelo importador.

### D019 · 2026-10-19 · Revisão de requisitos (Continuidade 2.0) incorporada ao plano, numeração original mantida
- **Contexto:** o "Prompt de Continuidade 2.0" (Arthur, 11/10) e o alinhamento com o Fábio (10/10) trouxeram
  novos requisitos e propunham renumerar as fases de 1 a 9. A Bruna (PO) avaliou; o Arthur aprovou em 2026-10-19.
- **Decisão:** manter a numeração original (o roteiro dos sócios continua valendo) e encaixar os itens novos:
  Fase 2 ampliada (duas portas, termos/aceite, CNPJ/CRECI, logs); **Fase 2B** nova (importação real e painel de
  publicáveis); planos e cota na **Fase 7**, depois de match e distribuição. O plano completo foi atualizado
  (revisão 2026-10-19). Perguntas de negócio em `docs/perguntas à fabio.md`, com padrão seguro até a resposta.
- **"Bug crítico" 1.2 do 2.0:** descartado pelo Arthur. O código já bloqueia (só curadoria lê o dado sensível).

### D020 · 2026-10-19 · Aceite de termo do comprador antecipado para a Fase 2
- **Motivo:** é pré-requisito para entrar dado real (Fase 2B) e reaproveita a estrutura de termos versionados
  que a Fase 2 já precisa para corretor e proprietário. A Fase 5 fica com gestão de aceites, linha do tempo e
  assinatura certificada.

### D021 · 2026-10-19 · Proprietário com login (perfil `owner`)
- Altera a seção 3 do plano ("owner_lead não é usuário logado"). O proprietário vê só as próprias áreas; o
  número de destinatários e de interessados chega **agregado** por RPC, sem identificar compradores (regra 3).
  O formulário público sem login continua existindo (lead anônimo).
- **Padrões seguros até o Fábio responder:** área do proprietário retida até a curadoria atribuir corretor;
  autorização anexada **e** mandato exigidos para publicar; CPF do proprietário PF não é coletado.

### D022 · 2026-10-19 · Supabase: manter o plano gratuito
- **Decisão do Arthur e dos sócios:** manter o plano atual; o espaço é suficiente para o projeto.
- **Atenção (não é espaço):** o plano gratuito pausa o projeto após ~7 dias sem uso e não oferece backup
  restaurável. **Mitigação:** antes da importação real (Fase 2B), backup próprio (dump de dados + schema, como
  o feito no deploy da Fase 1, guardado fora do git) e um uso semanal mínimo. Reavaliar quando houver dado real
  em produção.

### D023 · 2026-10-19 · Plano completo e agentes locais fora do repositório
- `PermutaHub_PROMPT_CLAUDE_CODE_COMPLETO.md` e `.claude/` estão no `.gitignore`; o plano foi removido do índice
  do git (continua no disco de quem trabalha e no histórico antigo). Fonte da verdade compartilhada continua sendo
  `CLAUDE.md` + `docs/`. **Consequência:** quem clonar o repositório não recebe o plano; o Arthur repassa o arquivo
  ao Felipe por fora (ex.: pasta `Docs/` compartilhada).

## Em aberto

| Tema | Dono | Prazo |
|---|---|---|
| Planilha Land Bank, MD de exemplo, KML, formulário, fotos | Fábio | assim que possível |
| Base legal LGPD para contatos legados (proprietários/compradores sem consentimento) | Jurídico | antes da Fase 4 |
| Provedor de WhatsApp (API oficial paga × infra Zentri) | Matheos / Zentri | Fase 4 |
| Exportar o último hash da cadeia para fora do banco (complemento de D017) | Time técnico | Fase 8 |
| Definição geográfica de "região" para o score de proximidade | Fábio + técnico | Fase 3 |
| Perguntas de negócio da revisão 2026-10-19 (11 itens) | Fábio | ver `docs/perguntas à fabio.md` |
| Canal institucional com o CRECI-RS para consulta automática | Arthur / Felipe / Fábio | antes de ligar o nível A |
| Termos de uso comercial e limites da BrasilAPI (CNPJ) | Time técnico | antes de produção da Fase 2 |
