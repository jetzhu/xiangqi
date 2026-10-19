// Creates synthetic players lt-0000 … on staging, ready for rated online play: a confirmed
// email (lt-NNNN@loadtest.invalid), a birth month, 3 long bot games, and ratings at each speed
// spread from 800 to 1800. Also raises staging's sign-in rate limits so they can all sign in.
//
//   node packages/loadtest/seed.mjs --players 400
import { arg, password, patchAuth, sql, username } from "./lib.mjs";

const n = arg("players", 400);
const pw = password(); // base64url: safe inside a SQL string
await patchAuth({ rate_limit_token_refresh: 10000, rate_limit_verify: 10000, rate_limit_anonymous_users: 10000 });

for (let from = 0; from < n; from += 50) {
  const to = Math.min(n, from + 50);
  await sql(`
    do $$
    declare i int; uid uuid;
    begin
      for i in ${from}..${to - 1} loop
        if exists (select 1 from auth.users where email = '${"lt-"}' || lpad(i::text, 4, '0') || '@loadtest.invalid') then continue; end if;
        uid := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'lt-' || lpad(i::text, 4, '0') || '@loadtest.invalid',
                extensions.crypt('${pw}', extensions.gen_salt('bf', 6)), now() - interval '40 days',
                '{"provider": "email", "providers": ["email"]}', jsonb_build_object('username', 'lt-' || lpad(i::text, 4, '0'), 'lang', 'en'),
                now() - interval '40 days', now(), '', '', '', '');
        insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', 'lt-' || lpad(i::text, 4, '0') || '@loadtest.invalid', 'email_verified', true),
                'email', now(), now(), now());
        update public.profiles set birth_month = '1990-01-01', username_chosen = true where user_id = uid;
        insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, helps, rated, started_at)
        select uid, 'laochen', 800, 'red', array_fill('h2e2'::text, array[30]), 'loss', 0, true, now() from generate_series(1, 3);
        insert into public.ratings (user_id, kind, rating, rd, games)
        select uid, k, 800 + (i * 37) % 1000, 80, 20 from unnest(array['lightning', 'blitz', 'rapid']) k;
      end loop;
    end $$;`);
  console.log(`players ${username(from)} … ${username(to - 1)} ready`);
}
const [{ n: total }] = await sql(`select count(*)::int as n from public.profiles where username like 'lt-%'`);
console.log(`${total} synthetic players on staging.`);
