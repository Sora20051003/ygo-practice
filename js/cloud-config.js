// サーバー（Supabase）の設定。
// Supabase の管理画面 →「Project Settings」→「API」に出ている
//   Project URL を url に、Project API keys の anon（public）の key を anonKey に貼り付ける。
// （anon key は公開してよい鍵です。読み書きできる範囲は supabase/setup.sql の決まりで守られています）
// null のままだと「ログインなし・この端末のブラウザだけに保存」で動く（今までどおり）。
// Google でのログインも使うときは google: true にする（Supabase 側で Google の設定が必要）
// supabase/setup.sql は実行済み（2026-10-19）。この設定でログインが有効
const SUPABASE_CONFIG = {
  url: 'https://ydicseimticpmykqtugx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkaWNzZWltdGljcG15a3F0dWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNTE5MTMsImV4cCI6MjEwNzkyNzkxM30.yzAmGhCy2FqbCiId635M-c0pzqWczIiHeymc8oh5YZ4',
  google: false,
};
// 例：const SUPABASE_CONFIG = { url: 'https://xxxxxxxx.supabase.co', anonKey: 'eyJhbGciOi...', google: false };
