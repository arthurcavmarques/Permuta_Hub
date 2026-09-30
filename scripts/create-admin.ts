/**
 * Cria (ou promove) um admin da PLATAFORMA (curadoria). Não é o admin de uma organização (D007).
 * Uso: npm run create-admin -- <email> <senha> ["Nome Completo"]
 */
import { adminClient, fail, parseArgs } from './lib/cli';

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const [email, password, fullName] = positional;
  if (!email || !password) fail('Uso: npm run create-admin -- <email> <senha> ["Nome Completo"]');
  if (password.length < 10) fail('Senha precisa de pelo menos 10 caracteres.');

  const db = adminClient();
  let userId: string | undefined;

  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? email.split('@')[0] },
  });
  if (created?.user) {
    userId = created.user.id;
    console.log(`Usuário criado: ${email}`);
  } else if (error && /already|registered|exists/i.test(error.message)) {
    // Já existe: só promove. Paginação simples basta para o tamanho do time.
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) fail(listErr.message);
    userId = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    console.log(`Usuário já existia: ${email} (senha mantida)`);
  } else {
    fail(error?.message ?? 'falha desconhecida ao criar usuário');
  }
  if (!userId) fail('Usuário não encontrado.');

  const { error: adminErr } = await db.from('platform_admins').upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (adminErr) fail(adminErr.message);
  console.log(`✔ ${email} é admin da plataforma.`);
}

main().catch((e: Error) => fail(e.message));
