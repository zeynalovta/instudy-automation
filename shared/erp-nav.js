// Super admin üçün yan menyuya "Sistem" linki əlavə edir (digər istifadəçilər üçün heç nə etmir).
(function () {
  try {
    if (!window.supabase || typeof SUPABASE_URL === "undefined") return;
    const c = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    c.auth.getSession().then(({ data }) => {
      const m = data?.session?.user?.app_metadata;
      if (!m || m.role !== "admin" || m.super_admin !== true) return;
      const nav = document.querySelector("aside nav");
      if (!nav || nav.querySelector('[href="/admin/system/index.html"]')) return;
      const a = document.createElement("a");
      a.href = "/admin/system/index.html";
      a.textContent = "Sistem";
      nav.appendChild(a);
    }).catch(() => {});
  } catch (e) {}
})();
