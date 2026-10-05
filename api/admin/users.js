// Sistem panelinin istifadəçi idarəetməsi (yalnız super admin). Brauzer service-role
// açarını görmür; bu endpoint Bearer token-i yoxlayıb əməliyyatı service-role ilə icra edir.
import { supabase } from "../../lib/supabase.js";

const SCOPES = new Set(["dma", "all"]);

async function requireSuperAdmin(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const meta = data.user.app_metadata || {};
  return meta.role === "admin" && meta.super_admin === true ? data.user : null;
}

function publicUser(u) {
  const m = u.app_metadata || {};
  return {
    id: u.id,
    email: u.email,
    role: m.role || null,
    staff_scope: m.staff_scope || null,
    super_admin: m.super_admin === true,
    banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
    last_sign_in_at: u.last_sign_in_at || null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const me = await requireSuperAdmin(req);
  if (!me) return res.status(403).json({ error: "İcazə yoxdur." });

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      return res.status(200).json({ users: data.users.map(publicUser) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { action } = body;

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const scope = SCOPES.has(body.staff_scope) ? body.staff_scope : "dma";
      if (!email || password.length < 8) return res.status(400).json({ error: "E-poçt və ən azı 8 simvollu parol lazımdır." });
      const { data, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { role: "admin", staff_scope: scope },
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ user: publicUser(data.user) });
    }

    const id = String(body.id || "");
    if (!id) return res.status(400).json({ error: "id lazımdır." });
    if (id === me.id && action !== "set_password") {
      return res.status(400).json({ error: "Öz hesabınızı bu əməliyyatla dəyişə bilməzsiniz." });
    }

    if (action === "set_scope") {
      if (!SCOPES.has(body.staff_scope)) return res.status(400).json({ error: "Yanlış scope." });
      const { data: cur, error: e1 } = await supabase.auth.admin.getUserById(id);
      if (e1) throw e1;
      const { data, error } = await supabase.auth.admin.updateUserById(id, {
        app_metadata: { ...(cur.user.app_metadata || {}), role: "admin", staff_scope: body.staff_scope },
      });
      if (error) throw error;
      return res.status(200).json({ user: publicUser(data.user) });
    }
    if (action === "set_password") {
      const password = String(body.password || "");
      if (password.length < 8) return res.status(400).json({ error: "Parol ən azı 8 simvol olmalıdır." });
      const { error } = await supabase.auth.admin.updateUserById(id, { password });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (action === "set_banned") {
      const { data, error } = await supabase.auth.admin.updateUserById(id, {
        ban_duration: body.banned ? "876000h" : "none",
      });
      if (error) throw error;
      return res.status(200).json({ user: publicUser(data.user) });
    }
    return res.status(400).json({ error: "Naməlum əməliyyat." });
  } catch (e) {
    console.error("admin/users error:", e);
    return res.status(500).json({ error: e.message || "Server xətası" });
  }
}
