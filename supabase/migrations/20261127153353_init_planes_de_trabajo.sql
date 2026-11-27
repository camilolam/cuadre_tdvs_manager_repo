-- Roles y perfiles
create type public.app_role as enum ('admin', 'colaborador');
create type public.task_status as enum ('pendiente', 'ejecucion', 'detenida', 'finalizada');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  role public.app_role not null default 'colaborador',
  cargo text not null default '',
  area text not null default '',
  phone text not null default '',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  owner_name text not null default '',
  client text not null default '',
  description text not null default '',
  start_date date not null,
  end_date date not null,
  color text not null default '#0f6b5c',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates check (end_date >= start_date)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  assignee_id uuid references public.profiles(id) on delete set null,
  start_date date not null,
  end_date date not null,
  status public.task_status not null default 'pendiente',
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_dates check (end_date >= start_date)
);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_assignee_idx on public.tasks(assignee_id);
create index projects_created_by_idx on public.projects(created_by);
create index tasks_created_by_idx on public.tasks(created_by);

-- Funciones auxiliares
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

-- Perfil automático al crear usuario.
-- El primer usuario del sistema queda como administrador activo.
-- Los usuarios creados por un administrador (app_metadata.created_by_admin) quedan activos con el rol indicado.
-- Cualquier otro registro queda inactivo hasta que un administrador lo apruebe.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  first_user boolean;
  by_admin boolean := coalesce((new.raw_app_meta_data->>'created_by_admin')::boolean, false);
  r public.app_role;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into first_user;
  if first_user then r := 'admin';
  elsif by_admin and new.raw_app_meta_data->>'role' = 'admin' then r := 'admin';
  else r := 'colaborador';
  end if;
  insert into public.profiles (id, email, full_name, role, cargo, area, phone, active)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    r,
    coalesce(new.raw_user_meta_data->>'cargo', ''),
    coalesce(new.raw_user_meta_data->>'area', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    first_user or by_admin
  );
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Evitar quedarse sin administradores activos
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)) then
    if not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
      raise exception 'Debe existir al menos un administrador activo.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
create trigger profiles_keep_admin before update or delete on public.profiles for each row execute function public.keep_one_admin();

-- RLS
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;

-- Perfiles: todo usuario activo ve el equipo; cada uno ve el suyo; solo el admin modifica.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active_user()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Proyectos: activos leen y crean; solo admin edita y elimina.
create policy projects_select on public.projects for select to authenticated
  using ((select public.is_active_user()));
create policy projects_insert on public.projects for insert to authenticated
  with check ((select public.is_admin()) or ((select public.is_active_user()) and created_by = (select auth.uid())));
create policy projects_update_admin on public.projects for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy projects_delete_admin on public.projects for delete to authenticated
  using ((select public.is_admin()));

-- Tareas: activos leen; colaborador crea y modifica solo tareas asignadas a sí mismo; admin todo.
create policy tasks_select on public.tasks for select to authenticated
  using ((select public.is_active_user()));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select public.is_admin()) or ((select public.is_active_user()) and assignee_id = (select auth.uid())));
create policy tasks_update on public.tasks for update to authenticated
  using ((select public.is_admin()) or ((select public.is_active_user()) and assignee_id = (select auth.uid())))
  with check ((select public.is_admin()) or ((select public.is_active_user()) and assignee_id = (select auth.uid())));
create policy tasks_delete_admin on public.tasks for delete to authenticated
  using ((select public.is_admin()));

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.keep_one_admin() from public, anon, authenticated;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_active_user() from anon;

-- Tiempo real
alter publication supabase_realtime add table public.projects, public.tasks, public.profiles;
