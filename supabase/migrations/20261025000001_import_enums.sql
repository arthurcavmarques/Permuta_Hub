-- Fase 2B — valores novos de enum (arquivo próprio: o Postgres não usa um valor de enum na mesma transação que o cria).
-- Reverter: supabase/rollbacks/20261025000002_import.down.sql (valores de enum não são removidos; ver lá).

-- Mandato desconhecido: área importada sem informação de mandato. Nunca distribui, nem com
-- allow_distribution_without_mandate = true (diferente de 'none', que é "sem mandato" sabido).
alter type public.mandate_status add value if not exists 'unknown';

-- Histórico da área: mudanças feitas pela importação, pelo desfazer e pela resolução de conflito.
alter type public.opportunity_event_kind add value if not exists 'imported';
