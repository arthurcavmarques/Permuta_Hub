# Perguntas à Fábio

Perguntas de negócio em aberto. Cada uma tem uma **sugestão** curta, que é o padrão que o sistema adota
enquanto não houver resposta. Quando o Fábio responder, a resposta é registrada em `docs/decisions.md`
e a pergunta sai daqui. Origem: validação dos requisitos do "Continuidade 2.0" (2026-10-19).

## Para a Fase 2 (em andamento: o sistema segue com a sugestão)

1. **Quem atende a área cadastrada diretamente pelo proprietário?** Um corretor parceiro escolhido pela
   curadoria, a própria plataforma ou você?
   *Sugestão:* a curadoria atribui um corretor parceiro; até isso acontecer, a área fica "aguardando
   corretor responsável" e não é distribuída.

2. **A autorização do proprietário anexada substitui o mandato ou é uma trava a mais?** E com o mandato
   "em obtenção", a área já pode ser publicada?
   *Sugestão:* são duas travas: autorização anexada **e** mandato aceito pela regra "distribuir sem
   mandato?" (hoje: não). Com mandato "em obtenção", não publica.

3. **Precisamos do CPF do proprietário pessoa física já no cadastro?**
   *Sugestão:* não coletar agora (LGPD: coleta mínima); pedir só quando houver contrato.

4. **Quais são os campos mínimos para uma área ser "publicável"?**
   *Sugestão:* cidade e bairro, metragem, zoneamento, modelo de negociação, ao menos uma foto liberada
   para o dossiê cego, autorização do proprietário e mandato.

## Para a Fase 2B (importação do Land Bank)

5. **Como os status da sua planilha equivalem aos status da plataforma?** E a partir de que data a
   plataforma passa a ser a fonte de verdade (a planilha para de ser editada)?
   *Sugestão:* você manda a lista de status usados; propomos a tabela de equivalência; data de corte =
   dia da importação real.

6. **A base de compradores tem algum registro de consentimento (opt-in) para WhatsApp?**
   *Sugestão:* sem prova de opt-in, os compradores importados não recebem mensagem até aceitarem pela
   plataforma (convite manual).

## Para a Fase 7 (planos e cota)

7. **A cota de dossiê completo vale só para áreas que a empresa recebeu, ou o comprador passa a navegar
   um catálogo de áreas?**
   *Sugestão:* só áreas recebidas. Mantém o modelo proativo ("comprador não fica navegando").

8. **O que é o "dossiê completo" sem os dados restritos?** Quais campos ficam atrás do paywall e quais
   atrás do termo?
   *Sugestão:* paywall = fotos completas, polígono exato e documentos técnicos; termo = matrícula,
   endereço exato e proprietário.

9. **Planos e cota entram antes ou depois do match e da distribuição?**
   *Sugestão:* depois. Sem distribuição, não há o que a cota limite.

10. **Quem paga (comprador, corretor ou ambos), a cota é mensal ou acumulada, e o plano gratuito tem 1 ou
    2 áreas?**
    *Sugestão:* só o comprador paga; cota mensal; gratuito com 1 área (seed provisório editável).

## Pendências de canal

11. **Você (ou sua imobiliária com CRECI PJ) tem algum canal institucional com o CRECI-RS para consulta
    automática de corretores?**
    *Sugestão:* até haver canal legítimo, seguimos com a verificação assistida (link da consulta oficial
    + comprovante + confirmação da curadoria). Nada de raspar site ou contornar captcha.
