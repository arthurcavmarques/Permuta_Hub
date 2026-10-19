-- Fase 2 · Bloco 2.2 — novo tipo de cadastro: proprietário (D021).
-- Separado da migration seguinte porque o Postgres não deixa usar um valor de enum novo na mesma transação.
-- Reverter: valor de enum não se remove; o down de 20261019000003 deixa de usá-lo.
alter type public.signup_kind add value if not exists 'owner';
