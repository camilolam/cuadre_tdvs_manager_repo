import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Gestión de usuarios reservada a administradores activos.
// Acciones: create, delete, set_password.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Sesión no válida" }, 401);

  const { data: me } = await admin.from("profiles").select("role, active").eq("id", who.user.id).single();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Solo un administrador puede gestionar usuarios" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }
  const action = String(body.action || "");
  const str = (k: string, max = 120) => String(body[k] ?? "").trim().slice(0, max);

  if (action === "create") {
    const email = str("email").toLowerCase();
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "colaborador";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Correo no válido" }, 400);
    if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { created_by_admin: true, role },
      user_metadata: { full_name: str("full_name", 80), cargo: str("cargo", 80), area: str("area", 80), phone: str("phone", 40) },
    });
    if (error) return json({ error: /already/i.test(error.message) ? "Ya existe un usuario con ese correo" : error.message }, 400);
    return json({ id: data.user?.id });
  }

  if (action === "delete") {
    const id = str("id", 64);
    if (id === who.user.id) return json({ error: "No puedes eliminar tu propia cuenta" }, 400);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return json({ error: /administrador/i.test(error.message) ? "Debe existir al menos un administrador activo" : error.message }, 400);
    return json({ ok: true });
  }

  if (action === "set_password") {
    const id = str("id", 64);
    const password = String(body.password ?? "");
    if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
});
