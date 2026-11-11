-- Fase 3B — valores de enum em arquivo próprio (ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação).
alter type public.opportunity_event_kind add value if not exists 'suspended';
alter type public.opportunity_event_kind add value if not exists 'reinstated';
