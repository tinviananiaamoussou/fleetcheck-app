-- FleetCheck — Lot 6 : comptes, rôles et synchronisation (Supabase / Postgres)
-- À exécuter une fois : Supabase → SQL Editor → coller → Run.
-- Principe : une table générique « records » (un enregistrement = une ligne JSON),
-- protégée par RLS selon le rôle. Pas de suppression physique : tombstones (deleted).

create table orgs (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table members (
  org_id uuid references orgs on delete cascade, user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('gestionnaire','mecanicien','chauffeur','direction')),
  slot int not null, primary key (org_id, user_id), unique (org_id, slot));
create table invites (
  code text primary key, org_id uuid references orgs on delete cascade,
  role text not null check (role in ('mecanicien','chauffeur','direction','gestionnaire')),
  expires_at timestamptz not null default now() + interval '7 days');
create sequence rev_seq;
create table records (
  org_id uuid references orgs on delete cascade, store text not null, rid bigint not null,
  data jsonb not null default '{}', deleted boolean not null default false,
  rev bigint not null default nextval('rev_seq'), primary key (org_id, store, rid));
create index on records (org_id, rev);

create function bump_rev() returns trigger language plpgsql as $$
begin new.rev := nextval('rev_seq'); return new; end $$;
create trigger records_rev before insert or update on records for each row execute function bump_rev();

-- Matrice rôles × magasins (miroir de WRITE dans cloud.js)
create function fc_can(o uuid, s text, w boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case m.role
    when 'gestionnaire' then true
    when 'direction'    then not w
    when 'mecanicien'   then case when w then s in ('maintenances','issues')
                           else s in ('vehicles','maintenances','issues','documents','inspections','garages') end
    when 'chauffeur'    then case when w then s in ('inspections','issues','fuel')
                           else s in ('vehicles','issues','documents','inspections','garages','fuel') end
  end from members m where m.org_id = o and m.user_id = auth.uid() $$;

create function create_org(p_name text) returns table(org_id uuid, role text, slot int)
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  insert into orgs(name) values (p_name) returning id into o;
  insert into members values (o, auth.uid(), 'gestionnaire', 0);
  return query select o, 'gestionnaire'::text, 0;
end $$;

create function create_invite(p_org uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare c text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  if not exists (select 1 from members where org_id = p_org and user_id = auth.uid() and role = 'gestionnaire')
    then raise exception 'Réservé au gestionnaire'; end if;
  insert into invites(code, org_id, role) values (c, p_org, p_role);
  return c;
end $$;

create function join_org(p_code text) returns table(org_id uuid, role text, slot int)
language plpgsql security definer set search_path = public as $$
declare i invites; s int;
begin
  select * into i from invites where code = upper(p_code) and expires_at > now() for update;
  if not found then raise exception 'Code invalide ou expiré'; end if;
  select coalesce(max(m.slot), -1) + 1 into s from members m where m.org_id = i.org_id;
  insert into members values (i.org_id, auth.uid(), i.role, s);
  delete from invites where code = i.code;           -- usage unique
  return query select i.org_id, i.role, s;
end $$;

alter table orgs enable row level security;  alter table members enable row level security;
alter table invites enable row level security; alter table records enable row level security;
create policy own_member on members for select using (user_id = auth.uid());
create policy own_org on orgs for select using (exists (select 1 from members m where m.org_id = id and m.user_id = auth.uid()));
create policy rec_read  on records for select using (fc_can(org_id, store, false));
create policy rec_ins   on records for insert with check (fc_can(org_id, store, true));
create policy rec_upd   on records for update using (fc_can(org_id, store, true)) with check (fc_can(org_id, store, true));
revoke all on invites from anon, authenticated;
revoke execute on all functions in schema public from anon;
