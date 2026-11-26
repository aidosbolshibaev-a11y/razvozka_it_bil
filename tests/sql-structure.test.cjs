const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('migration function bodies have closing dollar delimiters (regression for 0003)',()=>{
 const dir=path.join(__dirname,'../supabase/migrations');
 for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.sql'))){
  const sql=fs.readFileSync(path.join(dir,name),'utf8');const tags=[...sql.matchAll(/\$[a-zA-Z_0-9]*\$/g)].map(m=>m[0]);
  assert.equal(tags.length%2,0,name+': missing dollar delimiter');
  for(let i=0;i<tags.length;i+=2)assert.equal(tags[i],tags[i+1],name+': mismatched dollar delimiters');
 }
});
