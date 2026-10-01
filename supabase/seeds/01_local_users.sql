-- Seed LOCAL: usuários de desenvolvimento. NUNCA aplicar na nuvem (senhas conhecidas).
-- Usuários locais (só existem no banco local):
--   admin@permutahub.local   / admin-local-123   (admin da plataforma)
--   usuario@permutahub.local / usuario-local-123 (logado, sem permissão)

-- ---------------------------------------------------------------------------
-- Usuários locais
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-0000-0000-00000000a001'::uuid, 'admin@permutahub.local', 'admin-local-123', 'Admin Local'),
      ('00000000-0000-0000-0000-00000000a002'::uuid, 'usuario@permutahub.local', 'usuario-local-123', 'Usuário Sem Permissão')
    ) as t(id, email, pwd, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt(u.pwd, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end;
$$;

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000a001');
