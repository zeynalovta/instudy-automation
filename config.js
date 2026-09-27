// DMA panelinin (admin/*, dma/apply, dma/interview, dma/exam) brauzer tərəfi
// Supabase client-ı bu iki dəyərdən istifadə edir. Instudy-nin öz Supabase
// layihəsindən "publishable" (anon) açarı bura yazılmalıdır -- bu, service
// role açarı deyil, brauzerdə görünməsi təhlükəsiz olan açardır (Supabase
// dashboard -> Project Settings -> API -> "anon public" / "publishable").
const SUPABASE_URL = "https://qxvlyjjzgvghpoflrrqe.supabase.co";
const SUPABASE_KEY = "sb_publishable_SvHGSbF216c0Zq_Tgdfi1g_wNwZCflo";
