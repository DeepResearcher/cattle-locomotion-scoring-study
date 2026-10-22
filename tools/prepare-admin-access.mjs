import fs from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const secrets=JSON.parse(await fs.readFile(new URL('private/server_credentials.local.json',root),'utf8'));
await fs.writeFile(new URL('private/Admin_Access.local.json',root),JSON.stringify({
  website:'https://deepresearcher.github.io/cattle-locomotion-scoring-study/admin.html',
  administrator_key:secrets.ADMIN_SECRET,
  note:'Private owner access only. Do not share this key with raters. The results page uses a one-hour read-only session kept in browser memory. Reloading or signing out requires this key again. Research exports exclude test data unless explicitly included.'
},null,2)+'\n');
console.log('Administrator access details saved to ../private/Admin_Access.local.json. No credentials were printed.');
