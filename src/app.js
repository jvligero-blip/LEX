import {connect,checked,all,rpc,save,tables} from './store.js';
import {digits,validCNJ,maskCNJ,today,addDays,esc,safeURL,suggestion,incrementalStart} from '../lib/domain.js';
import {exportLegacy,ownersOf,selectLegacy,prepareLegacy} from '../lib/legacy.js';
const $=id=>document.getElementById(id), val=id=>$(id).value.trim(), set=(id,v)=>{$(id).value=v??'';}, html=(id,v)=>{$(id).innerHTML=v;}, text=(id,v)=>{$(id).textContent=v??'';};
let db,user=null,data={},generation=0,loading=false,editing={},origin=null,selectedPub=null,syncing=false,stopSync=false,backup=null;
const uuid=()=>crypto.randomUUID(), fmt=d=>d?d.slice(0,10).split('-').reverse().join('/'):'Sem data', stamp=d=>d?new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';
const rows=t=>data[t]||[], process=id=>rows('processos').find(p=>p.id===id), procNum=id=>maskCNJ(process(id)?.numero_cnj)||'Pendente de vínculo';
const openTasks=()=>rows('compromissos').filter(x=>x.status!=='concluido'), pending=()=>rows('publicacoes').filter(x=>x.triagem_status==='pendente_de_analise');
const label=p=>p.payload?.parte||'Não informado', empty=message=>`<div class="empty-state"><p>${esc(message)}</p></div>`;
const chip=value=>`<span class="chip">${esc(value||'—')}</span>`, button=(name,arg,label,cls='btn btn-ghost btn-sm')=>`<button class="${cls}" data-action="${name}" data-id="${esc(arg??'')}">${esc(label)}</button>`;
function toast(message){text('toastMsg',message);$('toast').classList.add('on');setTimeout(()=>$('toast').classList.remove('on'),4500);}
function error(e){const message=e?.message||String(e);text('connectionState','Operação não confirmada: '+message);toast(message);}
function modal(id){$(id).classList.add('open');}
function closeModal(id){$(id).classList.remove('open');}
function resetMemory(){generation++;user=null;data={};origin=null;selectedPub=null;backup=null;editing={};stopSync=true;document.querySelectorAll('.overlay').forEach(e=>e.classList.remove('open'));document.querySelectorAll('input:not([type=button]),textarea').forEach(e=>{if(!e.id.startsWith('login'))e.value='';});['pubList','tbProc','tbAud','tbPraz','advCard','syncHistory','migrationReview','importPreview','triageText','triageEvents','dProcPubs','dProcHero','dProcGrid','dProcAuds','dProcPrazs','dProcObs','dProcActions','dAudActions','dPrazActions','triageTasks','triageInfo','triageLink','importStatus','syncProgress','dAudHero','dAudGrid','dAudObs','dPrazHero','dPrazGrid','dPrazObs','statsRow','dashAuds','dashPrazos'].forEach(id=>{if($(id))html(id,'');});$('appScreen').classList.remove('on');$('loginScreen').style.display='flex';}
async function reload(){
 const epoch=generation,uid=user?.id;if(!uid)return;
 const result=await Promise.all(tables.map(async t=>[t,await all(db,t)]));
 if(epoch!==generation||uid!==user?.id)return;
 data=Object.fromEntries(result);renderAll();text('connectionState','Dados confirmados no Supabase · '+stamp(new Date().toISOString()));
}
async function enter(session){
 if(!session){resetMemory();return;}
 if(user?.id!==session.user.id)resetMemory();
 user=session.user;const epoch=generation;
 try{
  checked(await db.from('profiles').upsert({user_id:user.id,nome:user.user_metadata?.nome||user.email},{onConflict:'user_id',ignoreDuplicates:true}));
  await reload();if(epoch!==generation)return;
  $('loginScreen').style.display='none';$('appScreen').classList.add('on');
  text('sideName',rows('profiles')[0]?.nome||user.email);text('sideAvatar',(rows('profiles')[0]?.nome||user.email)[0]);text('sideRole','Conta pessoal');text('sideDate',fmt(today()));
  for(const id of ['a_owner','p_owner','z_owner'])html(id,`<option value="${user.id}">${esc(rows('profiles')[0]?.nome||user.email)}</option>`);
  navTo('dashboard');
 }catch(e){resetMemory();loginMessage('Não foi possível carregar a conta. '+e.message);}
}
function loginMessage(message){text('loginErr',message);$('loginErr').style.display='block';}
async function doLogin(){
 if(!db)return loginMessage('Configuração do banco pendente. Consulte o guia de implantação.');
 if(loading)return;loading=true;
 $('loginBtn').disabled=true;
 try{const result=checked(await db.auth.signInWithPassword({email:val('loginUser'),password:$('loginPass').value}));set('loginPass','');await enter(result.session);}
 catch(e){loginMessage(e.message);}finally{loading=false;$('loginBtn').disabled=false;}
}
async function doLogout(){resetMemory();if(db){const {error:e}=await db.auth.signOut({scope:'local'});if(e)loginMessage('Sessão local encerrada; confira sua conexão.');}set('loginPass','');}
async function recover(){try{if(!db)throw new Error('Configure o Supabase primeiro.');if(!val('loginUser'))throw new Error('Informe seu e-mail no campo de login.');checked(await db.auth.resetPasswordForEmail(val('loginUser'),{redirectTo:location.origin}));loginMessage('Se a conta existir, você receberá o link de recuperação.');}catch(e){loginMessage(e.message);}}
async function changePassword(){try{if(val('newPassword').length<8)throw new Error('Use pelo menos 8 caracteres.');checked(await db.auth.updateUser({password:$('newPassword').value}));set('newPassword','');closeModal('ovPassword');toast('Senha atualizada.');}catch(e){error(e);}}
function togglePassVis(id='loginPass'){const el=$(id);el.type=el.type==='password'?'text':'password';}
const titles={dashboard:'Painel',audiencias:'Audiências',processos:'Pastas processuais',prazos:'Prazos e tarefas',publicacoes:'Publicações',advogado:'Perfil e dados','det-proc':'Pasta processual','det-aud':'Audiência','det-praz':'Compromisso'};
function showView(id){document.querySelectorAll('.view').forEach(e=>e.classList.toggle('active',e.id==='v-'+id));text('topTitle',titles[id]||'LEX');}
function navTo(id){if(!user)return;showView(id);document.querySelectorAll('.nav-item').forEach(e=>e.classList.toggle('active',e.id==='nav-'+id));closeSidebar();renderAll();}
function backTo(id){navTo(id);}
function openSidebar(){$('sidebar').classList.add('open');$('sidebarOverlay').classList.add('visible');}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebarOverlay').classList.remove('visible');}
function days(d){return d?Math.round((Date.parse(d+'T12:00:00Z')-Date.parse(today()+'T12:00:00Z'))/86400000):null;}
function taskDate(t){return t.data_fatal_confirmada||t.data_interna||'';}
function taskStatus(t){return t.status==='concluido'?'concluido':t.data_fatal_confirmada&&t.data_fatal_confirmada<today()?'atrasado':'pendente';}
function sourceLink(p){const u=safeURL(p?.link_origem);return u?`<a class="btn btn-ghost btn-sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Origem oficial ↗</a>`:'';}
function renderAll(){if(!user)return;renderDash();renderAuds();renderProcs();renderPrazs();renderPubs();renderAdv();renderSync();text('navBadge',openTasks().length);$('navBadge').style.display=openTasks().length?'':'none';}
function renderDash(){
 text('greeting','Olá, '+(rows('profiles')[0]?.nome||user.email));text('greetDate',fmt(today())+' · America/Sao_Paulo');
 const upcoming=rows('audiencias').filter(a=>a.status==='agendada'&&a.data>=today()),due=openTasks().filter(t=>t.data_fatal_confirmada&&days(t.data_fatal_confirmada)<=7);
 html('statsRow',[[pending().length,'Publicações pendentes','publicacoes'],[due.length,'Prazos confirmados até 7 dias','prazos'],[openTasks().length,'Tarefas abertas','prazos'],[upcoming.length,'Audiências futuras','audiencias']].map(([n,label,page])=>`<button class="stat-card" data-action="navTo" data-id="${page}"><div class="stat-num">${n}</div><div class="stat-label">${label}</div></button>`).join(''));
 html('dashAuds',upcoming.sort((a,b)=>(a.data+a.hora).localeCompare(b.data+b.hora)).slice(0,8).map(a=>`<div class="detail-list-item">${esc(fmt(a.data)+' '+a.hora.slice(0,5))} · ${esc(procNum(a.processo_id))}${button('openDetAud',a.id,'Abrir')}</div>`).join('')||empty('Nenhuma audiência futura'));
 html('dashPrazos',openTasks().sort((a,b)=>(taskDate(a)||'9999').localeCompare(taskDate(b)||'9999')).slice(0,10).map(t=>`<div class="detail-list-item">${esc(t.descricao)} · ${esc(fmt(taskDate(t)))} ${chip(taskStatus(t))}${button('openDetPraz',t.id,'Abrir')}</div>`).join('')||empty('Nenhuma tarefa aberta'));
 const last=rows('sincronizacoes').filter(j=>j.estado==='concluida').sort((a,b)=>b.finished_at.localeCompare(a.finished_at))[0];
 text('alertMsg',`DJEN: última carga concluída ${last?stamp(last.finished_at):'ainda não realizada'}. ${pending().length} publicações aguardam análise, inclusive as de dias anteriores.`);$('alertBar').style.display='flex';
}
function renderProcs(){
 const q=val('sProc').toLowerCase(),num=digits(q),status=val('fProcStatus'),area=val('fProcArea');
 const list=rows('processos').filter(p=>(!q||(p.numero_cnj.includes(num)&&num.length>0)||JSON.stringify(p.payload).toLowerCase().includes(q))&&(!status||(p.payload.status||'ativo')===status)&&(!area||p.payload.area===area));
 html('tbProc',list.map(p=>{const a=rows('audiencias').filter(a=>a.processo_id===p.id&&a.data>=today()&&a.status==='agendada').sort((a,b)=>a.data.localeCompare(b.data))[0];return `<tr><td>${button('openDetProc',p.id,maskCNJ(p.numero_cnj))}</td><td>${esc(label(p))}</td><td>${esc(p.payload.area||'—')}</td><td>${esc(p.payload.juizo||'—')}</td><td>${fmt(p.payload.data)}</td><td>${esc(p.payload.status||'ativo')}</td><td>${fmt(a?.data)}</td><td>${button('openProcModal',p.id,'Editar')}</td></tr>`;}).join('')||'<tr><td colspan="8">Nenhuma pasta</td></tr>');
}
function renderAuds(){
 const q=val('sAud').toLowerCase(),area=val('fAudArea');
 html('tbAud',rows('audiencias').filter(a=>(!q||(procNum(a.processo_id)+' '+JSON.stringify(a.payload)).toLowerCase().includes(q))&&(!area||a.payload.area===area)).sort((a,b)=>(a.data+a.hora).localeCompare(b.data+b.hora)).map(a=>`<tr><td>${fmt(a.data)} ${esc(a.hora.slice(0,5))}</td><td>${button('openDetAud',a.id,procNum(a.processo_id))}</td><td>${esc(a.payload.parte||label(process(a.processo_id)||{}))}</td><td>${esc(a.payload.vara||'—')}</td><td>${esc(a.payload.area||'—')}</td><td>${esc(a.payload.tipo)} ${chip(a.status)}</td><td>${button('openAudModal',a.id,'Editar')}${button('delAud',a.id,'Remover')}</td></tr>`).join('')||'<tr><td colspan="7">Nenhuma audiência</td></tr>');
}
function renderPrazs(){
 const q=val('sPraz').toLowerCase(),tipo=val('fPrazTipo'),st=val('fPrazStatus'),urg=val('fPrazUrg');
 const list=rows('compromissos').filter(t=>(!q||(t.descricao+' '+procNum(t.processo_id)).toLowerCase().includes(q))&&(!tipo||t.tipo===tipo)&&(!st||taskStatus(t)===st)&&(!urg||(t.data_fatal_confirmada&&({urgente:days(t.data_fatal_confirmada)<=3,proximo:days(t.data_fatal_confirmada)<=7,futuro:days(t.data_fatal_confirmada)>7}[urg]))));
 html('tbPraz',list.sort((a,b)=>(taskDate(a)||'9999').localeCompare(taskDate(b)||'9999')).map(t=>`<tr><td>${fmt(t.data_fatal_confirmada)}${t.data_interna?'<br>Interna: '+fmt(t.data_interna):''}</td><td>${t.data_fatal_confirmada?days(t.data_fatal_confirmada)+'d':'—'}</td><td>${esc(procNum(t.processo_id))}</td><td>${button('openDetPraz',t.id,t.descricao)}</td><td>${esc(t.tipo)}</td><td>${chip(taskStatus(t))}</td><td>${button(t.status==='concluido'?'reabrirPraz':'concluirPraz',t.id,t.status==='concluido'?'Reabrir':'Concluir')}</td></tr>`).join('')||'<tr><td colspan="7">Nenhum compromisso neste filtro</td></tr>');
}
function pubCard(p){
 const capture=rows('publicacao_oabs').filter(o=>o.publicacao_id===p.id).map(o=>rows('oabs_monitoradas').find(a=>a.id===o.oab_id)).filter(Boolean).map(o=>o.numero_oab+'/'+o.uf).join(', ');
 return `<div class="card publication"><div class="card-head"><h3>${esc(p.tipo||'Comunicação')} · ${esc(p.tribunal||'Tribunal não informado')}</h3>${chip(p.triagem_status==='classificada'?'Classificada':'Pendente de análise')}</div><div class="pub-body">${p.processo_id?button('openDetProc',p.processo_id,procNum(p.processo_id)):chip('Pendente de vínculo: '+(p.numero_recebido||'sem CNJ'))}<p>Disponibilização: ${fmt(p.data_disponibilizacao)} · Captura: ${stamp(p.first_seen_at)}${capture?' · OAB '+esc(capture):''}</p>${suggestion(p.texto_integral)?`<p class="hint">${esc(suggestion(p.texto_integral))}</p>`:''}${p.revisao_detectada?'<p class="hint">A fonte apresentou alteração. Original preservado; consulte o histórico.</p>':''}<details><summary>Conteúdo integral</summary><pre class="source-text">${esc(p.texto_integral)}</pre></details>${p.classificacao?`<p>${esc(p.classificacao)} · ${esc(p.providencia)}<br>Análise: ${stamp(p.analisado_em)}</p>`:''}<div class="actions">${button('openTriage',p.id,'Ler e classificar')}${button('taskFromPub',p.id,'+ Acompanhamento')}${button('audFromPub',p.id,'+ Audiência')}${sourceLink(p)}</div></div></div>`;
}
function renderPubs(){
 const q=val('sPub').toLowerCase(),trib=val('fPubTrib'),date=val('fPubData'),status=val('fPubStatus'),oab=val('fPubOab');
 html('pubList',rows('publicacoes').filter(p=>(!q||(p.texto_integral+' '+procNum(p.processo_id)+' '+p.numero_recebido).toLowerCase().includes(q)||digits(q).length>4&&digits(procNum(p.processo_id)).includes(digits(q)))&&(!trib||p.tribunal===trib)&&(!date||p.data_disponibilizacao===date)&&(!status||(status==='sem_vinculo'?!p.processo_id:p.triagem_status===status))&&(!oab||rows('publicacao_oabs').some(o=>o.publicacao_id===p.id&&o.oab_id===oab))).sort((a,b)=>a.first_seen_at.localeCompare(b.first_seen_at)).map(pubCard).join('')||empty('Nenhuma publicação neste filtro'));
}
function openDetProc(id){
 const p=process(id);if(!p)return;const pubs=rows('publicacoes').filter(x=>x.processo_id===id),tasks=rows('compromissos').filter(x=>x.processo_id===id),auds=rows('audiencias').filter(x=>x.processo_id===id);
 html('dProcHero',`<div class="dh-num">${esc(maskCNJ(p.numero_cnj))}</div><div class="dh-name">${esc(label(p))}</div><p>${pubs.filter(x=>x.triagem_status!=='classificada').length} publicações pendentes · ${tasks.filter(x=>x.status!=='concluido').length} tarefas abertas · ${auds.filter(x=>x.status==='agendada'&&x.data>=today()).length} audiências futuras</p>`);
 html('dProcGrid',Object.entries({Área:p.payload.area,Juízo:p.payload.juizo,Distribuição:fmt(p.payload.data),Status:p.payload.status||'ativo'}).map(([k,v])=>`<div class="detail-field"><label>${k}</label><p>${esc(v||'Não informado')}</p></div>`).join(''));
 html('dProcAuds',auds.map(a=>`<div class="detail-list-item">${fmt(a.data)} ${esc(a.hora.slice(0,5))} ${chip(a.status)} ${button('openDetAud',a.id,a.payload.tipo||'Audiência')}</div>`).join('')||empty('Nenhuma audiência'));
 html('dProcPrazs',tasks.map(t=>`<div class="detail-list-item">${button('openDetPraz',t.id,t.descricao)} ${fmt(taskDate(t))} ${chip(taskStatus(t))}</div>`).join('')||empty('Nenhuma tarefa'));
 html('dProcPubs',pubs.map(pubCard).join('')||empty('Nenhuma publicação'));text('dProcObs',p.payload.obs||'');
 html('dProcActions',button('openProcModal',id,'Editar pasta')+button('audFromProc',id,'+ Audiência')+button('taskFromProc',id,'+ Compromisso')+button('delProc',id,'Remover pasta'));
 showView('det-proc');
}
function openDetAud(id){const a=rows('audiencias').find(x=>x.id===id);if(!a)return;html('dAudHero',`<div class="dh-num">${esc(procNum(a.processo_id))}</div><div class="dh-name">${esc(a.payload.tipo)}</div>`);html('dAudGrid',`<p>${fmt(a.data)} ${esc(a.hora.slice(0,5))} · ${esc(a.payload.modalidade||'')} · ${esc(a.payload.vara||'')} · ${esc(a.status)}</p>`);text('dAudObs',a.payload.obs||'');html('dAudActions',button('openAudModal',id,'Editar')+button('openDetProc',a.processo_id,'Abrir pasta')+(a.publicacao_id?button('openTriage',a.publicacao_id,'Publicação de origem'):'')+(safeURL(a.payload.link)?`<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="${esc(safeURL(a.payload.link))}">Link da audiência ↗</a>`:''));showView('det-aud');}
function openDetPraz(id){const t=rows('compromissos').find(x=>x.id===id);if(!t)return;html('dPrazHero',`<div class="dh-num">${esc(procNum(t.processo_id))}</div><div class="dh-name">${esc(t.descricao)}</div>`);html('dPrazGrid',`<p>Fatal confirmada: ${fmt(t.data_fatal_confirmada)} · Interna: ${fmt(t.data_interna)} · Sugerida: ${fmt(t.data_sugerida)} · ${esc(taskStatus(t))}</p>`);text('dPrazObs',t.payload.obs||'');html('dPrazActions',button('openEditPrazModal',id,'Editar')+button(t.status==='concluido'?'reabrirPraz':'concluirPraz',id,t.status==='concluido'?'Reabrir':'Concluir')+(t.processo_id?button('openDetProc',t.processo_id,'Abrir pasta'):'')+(t.publicacao_id?button('openTriage',t.publicacao_id,'Publicação de origem'):'')+button('delPraz',id,'Remover'));showView('det-praz');}
async function ensureProc(number){if(!validCNJ(number))throw new Error('Informe um CNJ válido com 20 dígitos e dígito verificador.');return rpc(db,'ensure_processo',{p_numero:digits(number)});}
function openProcModal(id){editing.proc=id||uuid();editing.procExisting=!!id;const p=process(id);for(const key of ['num','parte','area','status','juizo','data','obs'])set('p_'+key,key==='num'?maskCNJ(p?.numero_cnj):p?.payload?.[key]||(key==='status'?'ativo':key==='area'?'civel':''));text('procModalTitle',id?'Editar pasta':'Nova pasta');modal('ovProc');}
async function saveProc(){
 const n=digits(val('p_num'));if(!validCNJ(n))throw new Error('CNJ inválido; confira os 20 dígitos e o verificador.');
 const payload=Object.fromEntries(['parte','area','status','juizo','data','obs'].map(k=>[k,val('p_'+k)]));
 let id;if(editing.procExisting){id=editing.proc;await save(db,'processos',{id,user_id:user.id,numero_cnj:n,payload});}else{id=await rpc(db,'ensure_processo',{p_numero:n,p_payload:payload});}
 await reload();closeModal('ovProc');openDetProc(id);toast('Pasta confirmada no banco.');
}
function openAudModal(id){const a=rows('audiencias').find(x=>x.id===id);editing.aud=id||uuid();origin=a?.publicacao_id||null;for(const key of ['data','hora','proc','parte','vara','area','tipo','obs','modalidade','link','status'])set('a_'+key,key==='proc'?procNum(a?.processo_id):a?.[key]??a?.payload?.[key]??({data:today(),area:'civel',tipo:'Instrução e Julgamento',status:'agendada',modalidade:'Presencial'}[key]||''));if(!a)set('a_proc','');text('audModalTitle',a?'Editar audiência':'Nova audiência');modal('ovAud');}
async function saveAud(){
 if(!val('a_data')||!val('a_hora'))throw new Error('Informe data e hora.');const pid=await ensureProc(val('a_proc'));
 const payload=Object.fromEntries(['parte','vara','area','tipo','obs','modalidade','link'].map(k=>[k,val('a_'+k)]));
 await save(db,'audiencias',{id:editing.aud,user_id:user.id,processo_id:pid,publicacao_id:origin,data:val('a_data'),hora:val('a_hora'),status:val('a_status'),payload});await reload();closeModal('ovAud');toast('Audiência salva no banco.');
}
function openPrazModal(id){const t=rows('compromissos').find(x=>x.id===id);editing.task=id||uuid();origin=t?.publicacao_id||null;set('z_proc',t?.processo_id?procNum(t.processo_id):'');set('z_desc',t?.descricao);set('z_tipo',t?.tipo||'Administrativo');set('z_data',t?.data_fatal_confirmada);set('z_interna',t?.data_interna);set('z_sugerida',t?.data_sugerida);set('z_obs',t?.payload.obs);text('taskModalTitle',t?'Editar compromisso':'Novo compromisso');modal('ovPraz');}
const openEditPrazModal=openPrazModal;
async function savePraz(){
 if(!val('z_desc'))throw new Error('Descreva o compromisso.');const pid=val('z_proc')?await ensureProc(val('z_proc')):null;
 const t=rows('compromissos').find(x=>x.id===editing.task);
 await save(db,'compromissos',{id:editing.task,user_id:user.id,processo_id:pid,publicacao_id:origin,descricao:val('z_desc'),tipo:val('z_tipo'),status:t?.status||'pendente',data_fatal_confirmada:val('z_data')||null,data_interna:val('z_interna')||null,data_sugerida:val('z_sugerida')||null,confirmado_em:val('z_data')?new Date().toISOString():null,payload:{...t?.payload,obs:val('z_obs')}});await reload();closeModal('ovPraz');toast('Compromisso salvo no banco.');
}
async function taskState(id,status){checked(await db.from('compromissos').update({status,updated_at:new Date().toISOString()}).eq('id',id).select().single());await reload();if($('v-det-praz').classList.contains('active'))openDetPraz(id);}
const concluirPraz=id=>taskState(id,'concluido'),reabrirPraz=id=>taskState(id,'pendente');
async function remove(table,id){if(!confirm('Remover este registro? Registros vinculados impedem a exclusão da pasta.'))return;checked(await db.from(table).delete().eq('id',id).select().single());await reload();navTo(({processos:'processos',audiencias:'audiencias',compromissos:'prazos'})[table]);}
const delProc=id=>remove('processos',id),delAud=id=>remove('audiencias',id),delPraz=id=>remove('compromissos',id);
function taskFromPub(id){const p=rows('publicacoes').find(x=>x.id===id);closeModal('ovTriage');openPrazModal();origin=id;set('z_proc',p.processo_id?procNum(p.processo_id):'');set('z_desc',p.providencia||'');}
function audFromPub(id){const p=rows('publicacoes').find(x=>x.id===id);closeModal('ovTriage');openAudModal();origin=id;set('a_proc',p.processo_id?procNum(p.processo_id):'');}
function taskFromProc(id){openPrazModal();set('z_proc',procNum(id));}
function audFromProc(id){openAudModal();set('a_proc',procNum(id));}
function openPubModal(){editing.pub=uuid();for(const k of ['titulo','adv','corpo','proc','link'])set('pub_'+k,'');set('pub_data',today());modal('ovPub');}
async function savePub(){
 if(!val('pub_corpo')||!val('pub_data'))throw new Error('Informe o conteúdo e a data.');
 await rpc(db,'ingest_publicacao',{p_item:{fonte:'MANUAL',id_externo:editing.pub,numero:val('pub_proc'),texto_integral:val('pub_corpo'),data_disponibilizacao:val('pub_data'),tribunal:val('pub_trib'),tipo:val('pub_titulo'),link_origem:val('pub_link'),raw:{advogado:val('pub_adv'),urgente:val('pub_urg')==='1'}}});await reload();closeModal('ovPub');toast('Publicação salva para análise.');
}
function openTriage(id){
 selectedPub=id;const p=rows('publicacoes').find(x=>x.id===id);if(!p)return;
 text('triageText',p.texto_integral);text('triageInfo',`${procNum(p.processo_id)} · ${p.tribunal||''} · ${fmt(p.data_disponibilizacao)} · primeira captura ${stamp(p.first_seen_at)}`);
 set('triageCategory',p.classificacao||'Ciência, sem providência');set('triageAction',p.providencia);set('triageObs',p.observacoes);set('triageCNJ',p.processo_id?procNum(p.processo_id):p.numero_recebido);html('triageLink',sourceLink(p));
 const tasks=rows('compromissos').filter(x=>x.publicacao_id===id),auds=rows('audiencias').filter(x=>x.publicacao_id===id);
 html('triageTasks',tasks.map(t=>button('openDetPraz',t.id,t.descricao+' · '+taskStatus(t))).join('')+auds.map(a=>button('openDetAud',a.id,'Audiência '+fmt(a.data))).join('')||'Nenhum acompanhamento');
 html('triageEvents',rows('historico_alteracoes').filter(h=>h.registro_id===id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(h=>`<details><summary>${stamp(h.created_at)} · ${esc(h.acao)}</summary><pre class="source-text">${esc(JSON.stringify(h.detalhes,null,2))}</pre></details>`).join(''));
 modal('ovTriage');
}
async function classify(reopen=false){if(!selectedPub)return;await rpc(db,'classificar_publicacao',{p_id:selectedPub,p_categoria:val('triageCategory'),p_providencia:val('triageAction'),p_obs:val('triageObs'),p_reabrir:reopen});await reload();closeModal('ovTriage');toast(reopen?'Publicação reaberta com o mesmo ID.':'Classificação salva; os acompanhamentos seguem independentes.');}
async function linkPub(){await rpc(db,'vincular_publicacao',{p_id:selectedPub,p_numero:val('triageCNJ')});await reload();openTriage(selectedPub);toast('Vínculo e acompanhamentos derivados atualizados.');}
function renderAdv(){const p=rows('profiles')[0];html('advCard',`<div class="card pub-body"><h2>${esc(p?.nome||user.email)}</h2><p>${esc(user.email)}</p><p>Acervo pessoal · ${rows('processos').length} pastas · ${rows('publicacoes').length} publicações</p><h3>OABs monitoradas</h3>${rows('oabs_monitoradas').map(o=>`<p>${esc(o.numero_oab+'/'+o.uf)} · ${o.ativa?'Ativa':'Inativa'} ${button('toggleOAB',o.id,o.ativa?'Desativar':'Ativar')}</p>`).join('')||'<p>Nenhuma OAB cadastrada</p>'}</div>`);html('migrationReview',rows('migracao_revisao').filter(r=>!r.resolvido).map(r=>`<details><summary>${esc(r.motivo)}</summary><pre class="source-text">${esc(JSON.stringify(r.dados,null,2))}</pre><p>Use os cadastros normais para regularizar o registro, confira os vínculos e depois marque a revisão como resolvida.</p>${button('resolveReview',r.id,'Marcar revisão resolvida')}</details>`).join('')||empty('Nenhuma pendência de migração'));
}
function openAdvModal(){const p=rows('profiles')[0];set('adv_nome',p?.nome);for(const key of ['oab','uf','area','email','tel'])set('adv_'+key,key==='email'?user.email:p?.payload?.[key]||(key==='uf'?'SP':key==='area'?'civel':''));modal('ovAdv');}
async function saveAdv(){const payload=Object.fromEntries(['oab','uf','area','tel'].map(k=>[k,val('adv_'+k)]));await save(db,'profiles',{user_id:user.id,nome:val('adv_nome')||user.email,payload});if(payload.oab)checked(await db.from('oabs_monitoradas').upsert({user_id:user.id,numero_oab:digits(payload.oab),uf:payload.uf,ativa:true},{onConflict:'user_id,numero_oab,uf'}));await reload();closeModal('ovAdv');text('sideName',val('adv_nome'));toast('Perfil confirmado no banco.');}
async function addOAB(){if(!/^\d{1,12}$/.test(val('newOAB'))||Number(val('newOAB'))===0)throw new Error('Informe uma OAB não zerada, somente dígitos.');checked(await db.from('oabs_monitoradas').upsert({user_id:user.id,numero_oab:val('newOAB'),uf:val('newUF').toUpperCase(),ativa:true},{onConflict:'user_id,numero_oab,uf'}));await reload();set('newOAB','');}
async function toggleOAB(id){const o=rows('oabs_monitoradas').find(o=>o.id===id);checked(await db.from('oabs_monitoradas').update({ativa:!o.ativa}).eq('id',id));await reload();}
function renderSync(){
 const opts=rows('oabs_monitoradas').filter(o=>o.ativa).map(o=>`<option value="${o.id}">${esc(o.numero_oab+'/'+o.uf)}</option>`).join('');const selected=$('syncOab').value;html('syncOab',opts);if(selected)set('syncOab',selected);
 const filter=$('fPubOab').value;html('fPubOab','<option value="">Todas as OABs</option>'+rows('oabs_monitoradas').map(o=>`<option value="${o.id}">${esc(o.numero_oab+'/'+o.uf)}</option>`).join(''));set('fPubOab',filter);
 const trib=$('fPubTrib').value;html('fPubTrib','<option value="">Todos os tribunais</option>'+[...new Set(rows('publicacoes').map(p=>p.tribunal).filter(Boolean))].sort().map(t=>`<option>${esc(t)}</option>`).join(''));set('fPubTrib',trib);
 html('syncHistory',rows('sincronizacoes').sort((a,b)=>b.started_at.localeCompare(a.started_at)).map(j=>{const o=rows('oabs_monitoradas').find(o=>o.id===j.oab_id);return `<div class="card pub-body"><b>${esc(j.estado)} · ${esc(o?.numero_oab+'/'+o?.uf)}</b><p>${fmt(j.inicio)}–${fmt(j.fim)} · ${j.paginas} páginas · ${j.itens} itens · ${j.inseridos} novos · ${j.duplicados} conhecidos · ${j.falhas} falhas</p><p>Checkpoint: ${fmt(j.checkpoint_data)} / página ${j.checkpoint_pagina} · início ${stamp(j.started_at)} · fim ${stamp(j.finished_at)}</p>${j.erro?`<p class="hint">${esc(j.erro)}</p>`:''}${j.estado!=='concluida'?button('resumeSync',j.id,'Retomar'):''}</div>`;}).join('')||empty('Nenhuma sincronização executada'));
}
async function sincronizarDJEN(){modal('ovSync');if(!val('syncInicio'))set('syncInicio','2026-10-01');set('syncFim',today());}
function incremental(){set('syncInicio',incrementalStart(rows('sincronizacoes'),val('syncOab')));set('syncFim',today());}
async function startSync(){if(syncing)return;const id=await rpc(db,'iniciar_sync',{p_oab:val('syncOab'),p_inicio:val('syncInicio'),p_fim:val('syncFim')});await reload();await resumeSync(id);}
async function resumeSync(id){
 if(syncing)return;syncing=true;stopSync=false;const uid=user?.id;modal('ovSync');$('syncBtn').disabled=true;
 try{for(let count=0;count<10000&&!stopSync&&user?.id===uid;count++){
  const {data:sessionData,error:e}=await db.auth.getSession();if(e||!sessionData.session)throw new Error('Sessão expirada. Faça login e retome.');
  const response=await fetch('/api/publicacoes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionData.session.access_token},body:JSON.stringify({sincronizacao_id:id})});
  const result=await response.json();if(!response.ok)throw new Error(result.erro||'Falha na sincronização');if(user?.id!==uid)break;
  text('syncProgress',`${result.estado}: ${result.paginas} páginas, ${result.itens} itens, ${result.inseridos} novos, ${result.duplicados} conhecidos. Próximo: ${result.checkpoint_data}, página ${result.checkpoint_pagina}.`);
  if(result.estado==='concluida'){toast('Sincronização concluída e persistida.');break;}
  await new Promise(resolve=>setTimeout(resolve,2100));
 }}catch(e){error(e);}finally{syncing=false;$('syncBtn').disabled=false;if(user?.id===uid)await reload();}
}
function stopSyncRun(){stopSync=true;text('syncProgress','Pausa solicitada; o lote em execução será concluído. Retome pelo histórico.');}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportOld(){download('LEX-legado-'+today()+'.json',exportLegacy(localStorage));}
async function exportOnline(){await reload();download('LEX-backup-'+today()+'.json',{format:'lex-online',version:1,user_id:user.id,exported_at:new Date().toISOString(),data});}
async function previewImport(event){
 const file=event.target.files[0];if(!file)return;if(file.size>50*1024*1024)throw new Error('Divida o backup: limite de 50 MB.');backup=JSON.parse(await file.text());
 if(backup.format==='lex-online'){html('importPreview',`<p>Backup online de ${esc(backup.user_id)}. ${Object.entries(backup.data||{}).map(([t,r])=>esc(t)+': '+r.length).join(' · ')}.</p><p>Restauração somente para a mesma conta, sem sobrescrever o que já existe.</p>`);html('legacyOwner','<option value="online">Mesma conta do backup</option>');}
 else {const owners=ownersOf(backup),names=backup.data?.responsaveis||[];html('legacyOwner','<option value="">Escolha o titular de origem</option>'+owners.map(o=>`<option value="${esc(o)}">${esc(o+' · '+(names.find(n=>String(n.id)===o)?.nome||'Sem identificação'))}</option>`).join(''));html('importPreview',`<p>${owners.length} titular(es) identificado(s). Cada importação inclui somente o titular escolhido; sem titular também exige seleção explícita.</p>`);}
 $('confirmImport').checked=false;set('importAccount','');
}
async function importBackup(){
 if(!backup||!$('confirmImport').checked||val('importAccount')!==user.email)throw new Error('Revise a prévia, selecione a origem, digite o e-mail desta conta e confirme a titularidade.');
 const uid=user.id,report={importado:0,existente:0,revisao:0,itens:[]};
 if(backup.format==='lex-online'){report.importado=await rpc(db,'restaurar_backup',{p_backup:backup});report.existente=Object.values(backup.data||{}).reduce((n,r)=>n+(Array.isArray(r)?r.length:0),0)-report.importado;}
 else {const source=selectLegacy(backup,val('legacyOwner'),true);for(const row of source.map(prepareLegacy)){
  if(user?.id!==uid)throw new Error('Conta alterada durante importação.');
  const result=await rpc(db,'importar_legado',{p_entidade:row.kind,p_chave:row.key,p_dados:row.data,p_original:row.raw});report[result.estado]++;report.itens.push({entidade:row.kind,chave:row.key,...result});text('importStatus',`${report.importado} importados, ${report.existente} existentes, ${report.revisao} para revisão.`);
 }}
 await reload();download('LEX-relatorio-migracao-'+today()+'.json',report);text('importStatus',`Persistência confirmada: ${report.importado} importados, ${report.existente} existentes, ${report.revisao} para revisão. Legado original preservado.`);
}
async function resolveReview(id){checked(await db.from('migracao_revisao').update({resolvido:true}).eq('id',id));await reload();}
const actions={doLogin,doLogout,recover,changePassword,togglePassVis,navTo,backTo,openSidebar,closeSidebar,closeModal,renderAuds,renderProcs,renderPrazs,renderPubs,openProcModal,saveProc,openAudModal,saveAud,openPrazModal,openEditPrazModal,savePraz,concluirPraz,reabrirPraz,delProc,delAud,delPraz,openDetProc,openDetAud,openDetPraz,taskFromPub,audFromPub,taskFromProc,audFromProc,openPubModal,savePub,openTriage,linkPub,openAdvModal,saveAdv,addOAB,toggleOAB,sincronizarDJEN,startSync,resumeSync,stopSyncRun,incremental,exportOld,exportOnline,previewImport,importBackup,resolveReview,reload,
 classify:()=>classify(false),reopenPub:()=>classify(true),triageTask:()=>taskFromPub(selectedPub),triageAud:()=>audFromPub(selectedPub)};
// Toda gravação tem tratamento comum e bloqueio contra clique duplo na mesma ação.
const busy=new Set();
for(const [name,fn] of Object.entries(actions))window[name]=async(...args)=>{if(busy.has(name))return;busy.add(name);try{return await fn(...args);}catch(e){error(e);}finally{busy.delete(name);}};
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target){if(target.closest('#triageTasks'))closeModal('ovTriage');window[target.dataset.action]?.(target.dataset.id||undefined);}});
document.querySelectorAll('.overlay').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)closeModal(el.id);}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.overlay.open').forEach(el=>closeModal(el.id));});
async function init(){
 resetMemory();text('connectionState','Verificando configuração do banco…');set('fPrazStatus','pendente');
 try{const response=await fetch('/api/config');const config=await response.json();if(!response.ok)throw new Error(config.erro);db=connect(config);
  db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT')resetMemory();if(event==='PASSWORD_RECOVERY')setTimeout(()=>modal('ovPassword'),0);if(event==='SIGNED_IN'&&!loading&&session?.user.id!==user?.id)setTimeout(()=>enter(session),0);});
  const {data:s,error:e}=await db.auth.getSession();if(e)throw e;text('connectionState','Supabase configurado. Faça login.');if(s.session)await enter(s.session);
 }catch(e){loginMessage(e.message);text('connectionState','Configuração do banco pendente. Nenhum dado jurídico salvo localmente.');$('loginBtn').disabled=true;}
}
init();


