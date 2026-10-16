// Navegador real + SQL real local. Apenas os transportes Auth/PostgREST são simulados.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {database,as,rpc,pub,cnj,A,B} from './db-helper.mjs';
let browser,server,db,context,page;const errors=[];
const url='http://127.0.0.1:3000';
const uidFor=email=>email==='b@lex.test'?B:A;
function token(uid){return Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';}
const user=id=>({id,email:id===B?'b@lex.test':'a@lex.test',aud:'authenticated',role:'authenticated',user_metadata:{nome:id===B?'Pessoa B':'Pessoa A'},app_metadata:{provider:'email'},created_at:'2026-10-15T12:00:00Z'});
const quote=id=>{if(!/^[a-z_]+$/.test(id))throw new Error('Identificador inválido');return '"'+id+'"';};
const normalize=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date?(/^(data|data_fatal_confirmada|data_interna|data_sugerida|data_disponibilizacao|data_publicacao|inicio|fim|checkpoint_data)$/.test(k)?v.toISOString().slice(0,10):v.toISOString()):v]));
async function mock(route){
 const req=route.request(),u=new URL(req.url());let body;try{body=req.postDataJSON();}catch{}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'};
 const reply=(value,status=200)=>route.fulfill({status,headers,body:status===204?'':JSON.stringify(value)});
 if(req.method()==='OPTIONS')return reply({},200);
 const auth=req.headers().authorization||'';let uid=A;try{uid=JSON.parse(Buffer.from(auth.split('.')[1],'base64url')).sub;}catch{}
 if(u.pathname.includes('/auth/v1/')){
  if(u.pathname.endsWith('/token')){const id=uidFor(body.email);return reply({access_token:token(id),refresh_token:'refresh-'+id,expires_in:3600,token_type:'bearer',user:user(id)});}
  if(u.pathname.endsWith('/logout'))return reply(null,204);
  return reply(user(uid));
 }
 try{
 const result=await db.transaction(async tx=>{
  await tx.exec(`set local role authenticated;set local request.jwt.claim.sub='${uid}';`);
  const table=u.pathname.split('/').pop();
  if(u.pathname.includes('/rpc/')){
   const args=Object.entries(body||{});const out=await tx.query(`select public.${quote(table)}(${args.map(([k],i)=>quote(k)+'=> $'+(i+1)).join(',')}) result`,args.map(([,v])=>v));return out.rows[0].result;
  }
  const values=[],clauses=[];for(const [k,v]of u.searchParams)if(v.startsWith('eq.')){values.push(v.slice(3));clauses.push(quote(k)+'=$'+values.length);}
  const where=clauses.length?' where '+clauses.join(' and '):'';
  let sql;
  if(req.method()==='GET'){
   const order=(u.searchParams.get('order')||'id.asc').split(',').map(o=>{const [col,dir]=o.split('.');return quote(col)+(dir==='desc'?' desc':' asc');}).join(',');
   sql=`select * from public.${quote(table)}${where} order by ${order} limit ${Number(u.searchParams.get('limit')||500)} offset ${Number(u.searchParams.get('offset')||0)}`;
  }else if(req.method()==='POST'){
   const row=Array.isArray(body)?body[0]:body,cols=Object.keys(row);values.splice(0,values.length,...Object.values(row));
   const prefer=req.headers().prefer||'';let conflict='';if(prefer.includes('resolution=')){const keys=(u.searchParams.get('on_conflict')||(table==='profiles'?'user_id':'id')).split(',');conflict=' on conflict('+keys.map(quote).join(',')+') '+(prefer.includes('ignore-duplicates')?'do nothing':'do update set '+cols.map(k=>`${quote(k)}=excluded.${quote(k)}`).join(','));}
   sql=`insert into public.${quote(table)}(${cols.map(quote).join(',')}) values(${values.map((_,i)=>'$'+(i+1)).join(',')})${conflict} returning *`;
  }else if(req.method()==='PATCH'){
   const fields=Object.entries(body).map(([k,v])=>{values.push(v);return quote(k)+'=$'+values.length;});sql=`update public.${quote(table)} set ${fields.join(',')}${where} returning *`;
  }else if(req.method()==='DELETE')sql=`delete from public.${quote(table)}${where} returning *`;
  const out=await tx.query(sql,values);const list=out.rows.map(normalize);
  return (req.headers().accept||'').includes('vnd.pgrst.object')?(list[0]||null):list;
 });
 return reply(result);
 }catch(e){return reply({message:e.message,code:e.code},400);}
}
before(async()=>{
 db=await database();await rpc(db,'ingest_publicacao',[pub('ui-source',1,{texto_integral:'<img src=x onerror="window.hacked=true"><script>window.hacked=true</script> Sentença, cinco dias '+ 'íntegra '.repeat(600)})]);
 server=spawn(process.execPath,['scripts/dev.mjs'],{stdio:'pipe'});await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',b=>{out+=b;if(out.includes('LEX em'))resolve();});server.on('exit',()=>resolve());setTimeout(resolve,3000);});
 browser=await chromium.launch({channel:process.env.LEX_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),headless:true});
 context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('https://fonts.**',r=>r.abort());await context.route('https://lex-test.supabase.co/**',mock);
 await context.route(url+'/api/config',r=>r.fulfill({json:{supabaseUrl:'https://lex-test.supabase.co',supabaseKey:'public-test-key'}}));
 page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
});
after(async()=>{await context?.close();await browser?.close();server?.kill();await db?.close();});
async function waitApp(){await page.locator('#appScreen.on').waitFor();await page.locator('#connectionState').filter({hasText:'Dados confirmados'}).waitFor();}
async function login(email){await page.locator('#loginUser').fill(email);await page.locator('#loginPass').fill('test-password');await page.locator('#loginBtn').click();await waitApp();}
test('navegador: login remoto carrega acervo sem erros de inicialização',async()=>{await login('a@lex.test');assert.equal(await page.locator('#sideName').innerText(),'Pessoa A');assert.equal(await page.locator('#tbProc tr').count(),1);assert.deepEqual(errors,[]);});
test('navegador: conteúdo malicioso não executa e texto integral fica disponível',async()=>{await page.locator('#nav-publicacoes').click();assert.equal(await page.locator('#pubList .publication').count(),1);await page.locator('[data-action="openTriage"]').first().click();assert.ok((await page.locator('#triageText').innerText()).length>4000);assert.equal(await page.evaluate(()=>window.hacked),undefined);assert.equal(await page.locator('#triageText img,#triageText script').count(),0);});
test('navegador: triagem cria tarefa administrativa sem data; classifica sem concluir a tarefa',async()=>{
 await page.locator('#triageCategory').selectOption('Providência administrativa');await page.locator('#triageAction').fill('Solicitar comprovante');
 await page.getByRole('button',{name:'Salvar classificação',exact:true}).click();await page.locator('#ovTriage.open').waitFor({state:'hidden'});
 assert.equal(await page.locator('#pubList .publication').count(),0);await page.locator('#fPubStatus').selectOption('classificada');await page.locator('[data-action="openTriage"]').first().click();
 await page.getByRole('button',{name:'+ Acompanhamento',exact:true}).last().click();await page.locator('#ovPraz.open').waitFor();assert.equal(await page.locator('#ovTriage').evaluate(e=>e.classList.contains('open')),false);
 assert.equal(await page.locator('#z_desc').inputValue(),'Solicitar comprovante');await page.locator('#ovPraz').getByRole('button',{name:'Salvar',exact:true}).click();await page.locator('#ovPraz.open').waitFor({state:'hidden'});
 await page.locator('#nav-prazos').click();assert.match(await page.locator('#tbPraz').innerText(),/Solicitar comprovante/);assert.match(await page.locator('#tbPraz').innerText(),/pendente/i);
});
test('navegador: nova pasta exige só CNJ e reabrir mesmo CNJ não duplica',async()=>{
 await page.locator('#nav-processos').click();await page.getByRole('button',{name:'+ Novo',exact:true}).click();await page.locator('#p_num').fill(cnj(2));await page.locator('#p_parte').fill('');await page.locator('#ovProc').getByRole('button',{name:'Salvar',exact:true}).click();await page.locator('#v-det-proc.active').waitFor();assert.match(await page.locator('#dProcHero').innerText(),/Não informado/);
 await page.locator('#nav-processos').click();assert.equal(await page.locator('#tbProc tr').count(),2);await page.getByRole('button',{name:'+ Novo',exact:true}).click();await page.locator('#p_num').fill(cnj(2));await page.locator('#ovProc').getByRole('button',{name:'Salvar',exact:true}).click();await page.locator('#v-det-proc.active').waitFor();await page.locator('#nav-processos').click();assert.equal(await page.locator('#tbProc tr').count(),2);
});
test('navegador: publicação manual, audiência sem cliente e tarefa com data confirmada',async()=>{
 await page.locator('#nav-publicacoes').click();await page.getByRole('button',{name:'+ Manual',exact:true}).click();await page.locator('#pub_titulo').fill('Comunicação manual');await page.locator('#pub_proc').fill(cnj(2));await page.locator('#pub_corpo').fill('Designada audiência. Conferir documento oficial.');await page.locator('#ovPub').getByRole('button',{name:'Salvar Publicação'}).click();await page.locator('#ovPub.open').waitFor({state:'hidden'});
 await page.locator('#fPubStatus').selectOption('pendente_de_analise');await page.locator('#pubList [data-action="audFromPub"]').first().click();await page.locator('#a_hora').fill('14:30');await page.locator('#a_parte').fill('');await page.locator('#ovAud').getByRole('button',{name:'Salvar',exact:true}).click();await page.locator('#ovAud.open').waitFor({state:'hidden'});
 await page.locator('#nav-audiencias').click();assert.match(await page.locator('#tbAud').innerText(),/14:30/);
 await page.locator('#nav-prazos').click();await page.getByRole('button',{name:'+ Novo',exact:true}).click();await page.locator('#z_proc').fill(cnj(2));await page.locator('#z_desc').fill('Prazo confirmado teste');await page.locator('#z_data').fill('2026-10-20');await page.locator('#ovPraz').getByRole('button',{name:'Salvar',exact:true}).click();await page.locator('#ovPraz.open').waitFor({state:'hidden'});assert.match(await page.locator('#tbPraz').innerText(),/20\/10\/2026/);
 const row=page.locator('#tbPraz tr').filter({hasText:'Prazo confirmado teste'});await row.getByRole('button',{name:'Concluir',exact:true}).click();await row.waitFor({state:'hidden'});await page.locator('#fPrazStatus').selectOption('concluido');await page.locator('#tbPraz tr').filter({hasText:'Prazo confirmado teste'}).getByRole('button',{name:'Reabrir'}).click();await page.locator('#fPrazStatus').selectOption('pendente');await row.waitFor({state:'visible'});assert.match(await page.locator('#tbPraz').innerText(),/Prazo confirmado teste/);
});
test('navegador: novo build e recarregamento mantêm dados confirmados',async()=>{assert.equal(spawnSync(process.execPath,['scripts/build.mjs']).status,0);await page.reload({waitUntil:'domcontentloaded'});await waitApp();await page.locator('#nav-prazos').click();assert.match(await page.locator('#tbPraz').innerText(),/Solicitar comprovante/);await mkdir('test-results',{recursive:true});await page.waitForTimeout(400);await page.screenshot({path:'test-results/agenda.png',fullPage:true});});
test('navegador: sessão em contexto independente recupera o acervo A',async()=>{const c=await browser.newContext();await c.route('https://fonts.**',r=>r.abort());await c.route('https://lex-test.supabase.co/**',mock);await c.route(url+'/api/config',r=>r.fulfill({json:{supabaseUrl:'https://lex-test.supabase.co',supabaseKey:'public-test-key'}}));const p=await c.newPage();await p.goto(url,{waitUntil:'domcontentloaded'});await p.locator('#loginUser').fill('a@lex.test');await p.locator('#loginPass').fill('test-password');await p.locator('#loginBtn').click();await p.locator('#appScreen.on').waitFor();await p.locator('#nav-prazos').click();assert.match(await p.locator('#tbPraz').innerText(),/Solicitar comprovante/);await c.close();});
test('navegador: logout A, login B não mostra acervo de A',async()=>{await page.getByRole('button',{name:'🚪 Sair do sistema'}).click();await page.locator('#loginScreen').waitFor({state:'visible'});await login('b@lex.test');await page.locator('#nav-processos').click();assert.equal(await page.locator('#tbProc').innerText(),'Nenhuma pasta');await page.locator('#nav-publicacoes').click();assert.match(await page.locator('#pubList').innerText(),/Nenhuma publicação/);assert.deepEqual(errors,[]);});
test('navegador: tela móvel não extrapola largura',async()=>{await page.setViewportSize({width:390,height:844});await page.locator('.hamburger').click();await page.locator('#nav-dashboard').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.waitForTimeout(400);await page.screenshot({path:'test-results/mobile.png',fullPage:true});});
test('navegador: configuração ausente bloqueia gravações e não semeia dados demo',async()=>{const c=await browser.newContext();await c.route('https://fonts.**',r=>r.abort());const p=await c.newPage();await p.goto(url,{waitUntil:'domcontentloaded'});await p.locator('#loginErr').filter({hasText:'Configuração do banco pendente'}).waitFor();assert.equal(await p.locator('#loginBtn').isDisabled(),true);assert.equal(await p.evaluate(()=>localStorage.getItem('lex7_proc')),null);await p.screenshot({path:'test-results/configuracao-pendente.png',fullPage:true});await c.close();});


