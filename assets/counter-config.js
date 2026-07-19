/* School Stock アクセスカウンター設定
 * ────────────────────────────────────────────────────────
 * ここに Supabase の2つの値を貼るだけで、計測が始まります。
 * （anon public キーは公開して大丈夫な種類のキーです。RLSで守ります）
 *
 * 手順は _setup/counter-setup.md を見てください。
 *   1) Supabaseで新しいプロジェクトを作る（無料）
 *   2) _setup/counter-setup.sql の中身を SQL Editor に貼って実行
 *   3) Project Settings → API から下の2つをコピーして貼る
 *      - Project URL      → url に
 *      - anon public key  → key に
 *   4) このファイルを commit & push（数分でサイトに反映）
 *
 * 貼るまでは "__SUPABASE...__" のままにしておけば、計測は動きません（安全）。
 */
window.SS_COUNTER = {
  url: "__SUPABASE_URL__",       // 例: https://abcdefgh.supabase.co
  key: "__SUPABASE_ANON_KEY__"   // anon public キー（eyJ... で始まる長い文字列）
};
