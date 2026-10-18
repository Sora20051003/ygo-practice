// サーバー（Supabase）の設定。
// Supabase の管理画面 →「Project Settings」→「API」に出ている
//   Project URL を url に、Project API keys の anon（public）の key を anonKey に貼り付ける。
// （anon key は公開してよい鍵です。読み書きできる範囲は supabase/setup.sql の決まりで守られています）
// null のままだと「ログインなし・この端末のブラウザだけに保存」で動く（今までどおり）。
// Google でのログインも使うときは google: true にする（Supabase 側で Google の設定が必要）
const SUPABASE_CONFIG = null;
// 例：const SUPABASE_CONFIG = { url: 'https://xxxxxxxx.supabase.co', anonKey: 'eyJhbGciOi...', google: false };
