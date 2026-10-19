-- Fase 2 · Bloco 2.6 — PDF do dossiê cego: cada geração fica no access_log (quem imprimiu o quê, quando).
-- O PDF leva no rodapé o e-mail de quem gerou: se vazar, a origem aparece.
-- Reverter: drop function public.log_dossier_print(uuid);

create or replace function public.log_dossier_print(p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_view_blind(p_opportunity_id) then
    raise exception 'Sem acesso a este dossiê' using errcode = '42501';
  end if;
  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), 'print_dossier', 'opportunities_blind', p_opportunity_id, p_opportunity_id,
          public.request_ip(), public.request_user_agent());
end;
$$;

revoke execute on function public.log_dossier_print(uuid) from public, anon;
grant execute on function public.log_dossier_print(uuid) to authenticated;
