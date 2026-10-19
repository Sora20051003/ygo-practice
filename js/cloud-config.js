// サーバー（Supabase）の設定。
// ログインの機能は使わないことにした（2026-10-19）。null なので「ログインなし・この端末のブラウザだけに保存」で動く。
// また使うときは、{ url: 'https://xxxxxxxx.supabase.co', anonKey: 'eyJhbGciOi...', google: false } を入れる
// （サーバー側の準備は supabase/setup.sql）
const SUPABASE_CONFIG = null;
