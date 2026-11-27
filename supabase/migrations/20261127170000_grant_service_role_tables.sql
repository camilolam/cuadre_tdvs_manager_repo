-- La Edge Function admin-users usa service_role para verificar que quien llama es administrador.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles, public.projects, public.tasks to service_role;
