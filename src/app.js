import {decisions,responsible,operationalPending,filterScope,personalBackup} from '../lib/v4-domain.js';
import {publicationText} from './publication-view.js';
import {states,taskOpen,httpsURL,phoneBR,validDocument,folderComplete,suggestDate,dashboardCounts} from '../lib/v3-domain.js';
import {LexBot} from './lexbot.js';
import {connect,checked,all,rpc,save,tables} from './store.js';
import {digits,validCNJ,maskCNJ,today,addDays,esc,safeURL,suggestion,incrementalStart} from '../lib/domain.js';
import {exportLegacy,ownersOf,selectLegacy,prepareLegacy} from '../lib/legacy.js';
const $=id=>document.getElementById(id), val=id=>$(id).value.trim(), set=(id,v)=>{$(id).value=v??'';}, html=(id,v)=>{$(id).innerHTML=v;}, text=(id,v)=>{$(id).textContent=v??'';};
let bot=null,activityTarget=null,activityRequest=null,triageQueue=[],taskScope='';
let db,user=null,data={},generation=0,loading=false,editing={},origin=null,selectedPub=null,syncing=false,stopSync=false,backup=null;
const uuid=()=>crypto.randomUUID(), fmt=d=>d?d.slice(0,10).split('-').reverse().join('/'):'Sem data', stamp=d=>d?new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';
const rows=t=>data[t]||[], process=id=>rows('processos').find(p=>p.id===id)||folderRecords().find(p=>p.id===id), procNum=id=>process(id)?.numero_cnj?maskCNJ(process(id).numero_cnj):process(id)?label(process(id)):'Sem pasta';
const openTasks=()=>rows('compromissos').filter(taskOpen), pending=()=>rows('publicacoes').filter(isPending);
const label=p=>p.payload?.apelido||p.payload?.cliente_nome||p.payload?.parte||(workFolder(p.id)?.titulo!==p.numero_cnj?workFolder(p.id)?.titulo:null)||'Não informado', empty=message=>`<div class="empty-state"><p>${esc(message)}</p></div>`;
const chip=value=>`<span class="chip">${esc(value||'—')}</span>`, button=(name,arg,label,cls='btn btn-ghost btn-sm')=>`<button class="${cls}" data-action="${name}" data-id="${esc(arg??'')}">${esc(label)}</button>`;
function toast(message){text('toastMsg',message);$('toast').classList.add('on');setTimeout(()=>$('toast').classList.remove('on'),4500);}
function error(e){const message=e?.message||String(e);text('connectionState','Operação não confirmada: '+message);toast(message);}
function modal(id){$(id).classList.add('open');}
function closeModal(id){$(id).classList.remove('open');}
function resetMemory(){detailTarget=null;shareTarget=null;delegateTarget=null;bot?.destroy();bot=null;activityTarget=null;triageQueue=[];taskScope='';document.body.classList.remove('lexbot-space');generation++;user=null;data={};origin=null;selectedPub=null;backup=null;editing={};stopSync=true;document.querySelectorAll('.overlay').forEach(e=>e.classList.remove('open'));document.querySelectorAll('input:not([type=button]),textarea').forEach(e=>{if(!e.id.startsWith('login'))e.value='';});['pubList','tbProc','tbAud','tbPraz','advCard','syncHistory','migrationReview','importPreview','triageText','triageOriginal','triageEvents','dProcPubs','dProcHero','dProcGrid','dProcAuds','dProcPrazs','dProcObs','dProcActions','dAudActions','dPrazActions','triageTasks','triageInfo','triageLink','importStatus','syncProgress','dAudHero','dAudGrid','dAudObs','dPrazHero','dPrazGrid','dPrazObs','statsRow','dashAuds','dashPrazos','activityTimeline','folderActivities','decisionFeedback','urgentContents','collaborationPanel','shareTitle','shareMembers','delegateMember'].forEach(id=>{if($(id))html(id,'');});$('appScreen').classList.remove('on');$('loginScreen').style.display='flex';}
async function reload(){
 const epoch=generation,uid=user?.id,ticket=++reloadSeq;if(!uid)return;
 const result=await Promise.all(tables.map(async t=>[t,await all(db,t)]));
 if(epoch!==generation||uid!==user?.id)return;
 const fresh=Object.fromEntries(result);fresh.v4_contexto=await rpc(db,'v4_contexto',{});if(epoch!==generation||uid!==user?.id||ticket!==reloadSeq)return;data=fresh;renderAll();refreshDetail();text('connectionState','Dados confirmados no Supabase · '+stamp(new Date().toISOString()));
}
let enterFlight=null;
async function enter(session){
 if(!session)return enterBase(session);if(enterFlight?.uid===session.user.id)return enterFlight.promise;
 const flight={uid:session.user.id,promise:enterBase(session)};enterFlight=flight;
 try{return await flight.promise;}finally{if(enterFlight===flight)enterFlight=null;}
}
async function enterBase(session){
 if(!session){resetMemory();return;}
 if(user?.id!==session.user.id)resetMemory();
 user=session.user;const epoch=generation;
 try{
  checked(await db.from('profiles').upsert({user_id:user.id,nome:user.user_metadata?.nome||user.email},{onConflict:'user_id',ignoreDuplicates:true}));
  await reload();if(epoch!==generation)return;
  $('loginScreen').style.display='none';$('appScreen').classList.add('on');
  text('sideName',rows('profiles')[0]?.nome||user.email);text('sideAvatar',(rows('profiles')[0]?.nome||user.email)[0]);text('sideRole','Conta pessoal');text('sideDate',fmt(today()));
  for(const id of ['a_owner','p_owner','z_owner'])html(id,`<option value="${user.id}">${esc(rows('profiles')[0]?.nome||user.email)}</option>`);
  navTo('dashboard');setupAssistant();showUrgencies(true);
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
function taskStatus(t){return states[t.status]||t.status;}
function sourceLink(p){const u=safeURL(p?.link_origem);return u?`<a class="btn btn-ghost btn-sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Origem oficial ↗</a>`:'';}
function renderAll(){if(!user)return;renderDash();renderAuds();renderProcs();renderPrazs();renderPubs();renderAdv();renderCollaboration();renderSync();text('navBadge',openTasks().length);$('navBadge').style.display=openTasks().length?'':'none';}
function renderDashBase(){
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
 const list=folderRecords().filter(p=>(!q||((p.numero_cnj||'').includes(num)&&num.length>0)||JSON.stringify(p.payload).toLowerCase().includes(q))&&(!status||(p.payload.status||'ativo')===status)&&(!area||p.payload.area===area));
 html('tbProc',list.map(p=>{const a=rows('audiencias').filter(a=>a.processo_id===p.id&&a.data>=today()&&a.status==='agendada').sort((a,b)=>a.data.localeCompare(b.data))[0];return `<tr><td>${button('openDetProc',p.id,p.numero_cnj?maskCNJ(p.numero_cnj):'Assunto sem CNJ')}</td><td>${esc(label(p))}</td><td>${esc(p.payload.area||'—')}</td><td>${esc(p.payload.juizo||'—')}</td><td>${fmt(p.payload.data)}</td><td>${esc(p.payload.status||'ativo')}</td><td>${fmt(a?.data)}</td><td>${button('openProcModal',p.id,'Editar')}</td></tr>`;}).join('')||'<tr><td colspan="8">Nenhuma pasta</td></tr>');
}
function renderAuds(){
 const q=val('sAud').toLowerCase(),area=val('fAudArea');
 html('tbAud',rows('audiencias').filter(a=>(!q||(procNum(a.processo_id)+' '+JSON.stringify(a.payload)).toLowerCase().includes(q))&&(!area||a.payload.area===area)).sort((a,b)=>(a.data+a.hora).localeCompare(b.data+b.hora)).map(a=>`<tr><td>${fmt(a.data)} ${esc(a.hora.slice(0,5))}</td><td>${button('openDetAud',a.id,procNum(a.processo_id))}</td><td>${esc(a.payload.parte||label(process(a.processo_id)||{}))}</td><td>${esc(a.payload.vara||'—')}</td><td>${esc(a.payload.area||'—')}</td><td>${esc(a.payload.tipo)} ${chip(a.status)}</td><td>${button('openAudModal',a.id,'Editar')}${button('delAud',a.id,'Remover')}</td></tr>`).join('')||'<tr><td colspan="7">Nenhuma audiência</td></tr>');
}
function renderPrazsBase(){
 const q=val('sPraz').toLowerCase(),tipo=val('fPrazTipo'),st=val('fPrazStatus'),urg=val('fPrazUrg');
 const list=rows('compromissos').filter(t=>(!q||(t.descricao+' '+procNum(t.processo_id)).toLowerCase().includes(q))&&(!tipo||t.tipo===tipo)&&(!st||taskStatus(t)===st)&&(!urg||(t.data_fatal_confirmada&&({urgente:days(t.data_fatal_confirmada)<=3,proximo:days(t.data_fatal_confirmada)<=7,futuro:days(t.data_fatal_confirmada)>7}[urg]))));
 html('tbPraz',list.sort((a,b)=>(taskDate(a)||'9999').localeCompare(taskDate(b)||'9999')).map(t=>`<tr><td>${fmt(t.data_fatal_confirmada)}${t.data_interna?'<br>Interna: '+fmt(t.data_interna):''}</td><td>${t.data_fatal_confirmada?days(t.data_fatal_confirmada)+'d':'—'}</td><td>${esc(procNum(t.processo_id))}</td><td>${button('openDetPraz',t.id,t.descricao)}</td><td>${esc(t.tipo)}</td><td>${chip(taskStatus(t))}</td><td>${button((t.status==='concluido'||t.status==='cancelado')?'reabrirPraz':'concluirPraz',t.id,(t.status==='concluido'||t.status==='cancelado')?'Reabrir':'Concluir')}</td></tr>`).join('')||'<tr><td colspan="7">Nenhum compromisso neste filtro</td></tr>');
}
function pubCard(p){
 const capture=rows('publicacao_oabs').filter(o=>o.publicacao_id===p.id).map(o=>rows('oabs_monitoradas').find(a=>a.id===o.oab_id)).filter(Boolean).map(o=>o.numero_oab+'/'+o.uf).join(', ');
 const content=publicationText(p.texto_integral),sug=suggestion(content);
 return `<article class="card publication"><div class="card-head"><h3>${p.processo_id?button('openDetProc',p.processo_id,procNum(p.processo_id)):esc(p.numero_recebido||'Pendente de vínculo')}</h3>${chip(contextPub(p.id).decisao_id&&p.triagem_status!=='classificada'?'Tratada em colaboração':!isPending(p)?(p.exige_providencia===true?'Classificada · com providência':'Classificada'):'A analisar')}</div><div class="pub-body"><p class="pub-meta">${esc(p.tribunal||'')} · ${esc(p.orgao||p.tipo||'Comunicação')} · Disponibilização ${fmt(p.data_disponibilizacao)}<br>Primeira captura ${stamp(p.first_seen_at)} · Acervo de ${esc(person(p.user_id))}${recipients(p)|| (capture?' · OAB '+esc(capture):'')}</p>${sug?`<p class="suggestion">${esc(sug)}</p>`:''}${p.revisao_detectada?'<p class="hint">Fonte alterada — original preservado no histórico.</p>':''}<div class="pub-preview">${esc(content.slice(0,520))}${content.length>520?'…':''}</div>${publicationDecision(p)}${p.classificacao?`<p>${esc(p.classificacao)} · ${esc(p.providencia)}</p>`:''}<div class="actions">${isPending(p)?button('nothingToDo',p.id,'Nada a fazer','btn btn-ghost btn-sm')+button('alreadyDone',p.id,'Já fiz')+button('willDo',p.id,'Vou fazer')+button('forwardPublication',p.id,'Encaminhar'):button('reviewIndividual',p.id,'Revisar individualmente')}${button('openTriage',p.id,content.length>520?'Ler integralmente e classificar':'Ler e classificar','btn btn-navy btn-sm')}${p.processo_id?button('openDetProc',p.processo_id,'Abrir pasta'):''}${button('skipResponsibility',p.id,'Não é minha responsabilidade')}${sourceLink(p)}${button('taskFromPub',p.id,'+ Acompanhamento')}${button('audFromPub',p.id,'+ Audiência')}</div></div></article>`;
}
function renderPubs(){
 text('pubPendingCount',pending().length);text('pubHistoryCount',rows('publicacoes').length);text('pubOldCount',pending().filter(p=>p.first_seen_at.slice(0,10)<today()).length);
 const q=val('sPub').toLowerCase(),trib=val('fPubTrib'),date=val('fPubData'),status=val('fPubStatus'),oab=val('fPubOab');
 html('pubList',rows('publicacoes').filter(p=>(!q||(publicationText(p.texto_integral)+' '+procNum(p.processo_id)+' '+p.numero_recebido+' '+(p.classificacao||'')+' '+(p.providencia||'')).toLowerCase().includes(q)||digits(q).length>4&&digits(procNum(p.processo_id)).includes(digits(q)))&&(!trib||p.tribunal===trib)&&(!date||p.data_disponibilizacao>=date)&&(!val('fPubFim')||p.data_disponibilizacao<=val('fPubFim'))&&(!val('fPubCategory')||p.classificacao===val('fPubCategory'))&&(!status||(status==='sem_vinculo'?!p.processo_id:(status==='pendente_de_analise'?isPending(p):!isPending(p))))&&(!oab||rows('publicacao_oabs').some(o=>o.publicacao_id===p.id&&o.oab_id===oab))).sort((a,b)=>a.first_seen_at.localeCompare(b.first_seen_at)).map(pubCard).join('')||empty('Nenhuma publicação neste filtro'));
}
function openDetProcBase(id){
 const p=process(id);if(!p)return;const group=folderGroup(id),pubs=rows('publicacoes').filter(x=>group.some(f=>f.processo_id===x.processo_id)),tasks=rows('compromissos').filter(x=>group.some(f=>taskFolder(x)?.id===f.id)),auds=rows('audiencias').filter(x=>group.some(f=>f.processo_id===x.processo_id));
 html('dProcHero',`<div class="dh-num">${esc(p.numero_cnj?maskCNJ(p.numero_cnj):'Assunto sem CNJ')}</div><div class="dh-name">${esc(label(p))}</div><p>${pubs.filter(x=>x.triagem_status!=='classificada').length} publicações pendentes · ${tasks.filter(taskOpen).length} tarefas abertas · ${auds.filter(x=>x.status==='agendada'&&x.data>=today()).length} audiências futuras</p>`);
 html('dProcGrid',Object.entries({Área:p.payload.area,Juízo:p.payload.juizo,Distribuição:fmt(p.payload.data),Status:p.payload.status||'ativo'}).map(([k,v])=>`<div class="detail-field"><label>${k}</label><p>${esc(v||'Não informado')}</p></div>`).join(''));
 html('dProcAuds',auds.map(a=>`<div class="detail-list-item">${fmt(a.data)} ${esc(a.hora.slice(0,5))} ${chip(a.status)} ${button('openDetAud',a.id,a.payload.tipo||'Audiência')}</div>`).join('')||empty('Nenhuma audiência'));
 html('dProcPrazs',tasks.map(t=>`<div class="detail-list-item">${button('openDetPraz',t.id,t.descricao)} ${fmt(taskDate(t))} ${chip(taskStatus(t))}</div>`).join('')||empty('Nenhuma tarefa'));
 html('dProcPubs',pubs.map(pubCard).join('')||empty('Nenhuma publicação'));text('dProcObs',p.payload.obs||'');
 html('dProcActions',button('openProcModal',id,'Editar pasta')+button('audFromProc',id,'+ Audiência')+button('taskFromProc',id,'+ Compromisso')+button('delProc',id,'Remover pasta'));
 showView('det-proc');
}
function openDetAud(id){const a=rows('audiencias').find(x=>x.id===id);if(!a)return;html('dAudHero',`<div class="dh-num">${esc(procNum(a.processo_id))}</div><div class="dh-name">${esc(a.payload.tipo)}</div>`);html('dAudGrid',`<p>${fmt(a.data)} ${esc(a.hora.slice(0,5))} · ${esc(a.payload.modalidade||'')} · ${esc(a.payload.vara||'')} · ${esc(a.status)}</p>`);text('dAudObs',a.payload.obs||'');html('dAudActions',button('openAudModal',id,'Editar')+button('openDetProc',a.processo_id,'Abrir pasta')+(a.publicacao_id?button('openTriage',a.publicacao_id,'Publicação de origem'):'')+(safeURL(a.payload.link)?`<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="${esc(safeURL(a.payload.link))}">Link da audiência ↗</a>`:''));showView('det-aud');}
function openDetPrazBase(id){const t=rows('compromissos').find(x=>x.id===id);if(!t)return;html('dPrazHero',`<div class="dh-num">${esc(taskFolder(t)?.titulo||procNum(t.processo_id))}</div><div class="dh-name">${esc(t.descricao)}</div>`);html('dPrazGrid',`<p>Fatal confirmada: ${fmt(t.data_fatal_confirmada)} · Interna: ${fmt(t.data_interna)} · Sugerida: ${fmt(t.data_sugerida)} · ${esc(taskStatus(t))}</p>`);text('dPrazObs',t.payload.obs||'');html('dPrazActions',button('openEditPrazModal',id,'Editar')+button((t.status==='concluido'||t.status==='cancelado')?'reabrirPraz':'concluirPraz',id,(t.status==='concluido'||t.status==='cancelado')?'Reabrir':'Concluir')+(t.processo_id?button('openDetProc',t.processo_id,'Abrir pasta'):'')+(t.publicacao_id?button('openTriage',t.publicacao_id,'Publicação de origem'):'')+button('delPraz',id,'Cancelar'));showView('det-praz');}
async function ensureProc(number){if(!validCNJ(number))throw new Error('Informe um CNJ válido com 20 dígitos e dígito verificador.');return rpc(db,'ensure_processo',{p_numero:digits(number)});}
function openProcModalBase(id){editing.proc=id||uuid();editing.procExisting=!!id;const p=process(id);for(const key of ['num','parte','area','status','juizo','data','obs'])set('p_'+key,key==='num'?maskCNJ(p?.numero_cnj):p?.payload?.[key]||(key==='status'?'ativo':key==='area'?'civel':''));text('procModalTitle',id?'Editar pasta':'Nova pasta');modal('ovProc');}
async function saveProc(){
 const judicial=val('p_mode')==='judicial',n=judicial?digits(val('p_num')):null;
 if(judicial&&!validCNJ(n))throw new Error('CNJ inválido; confira os 20 dígitos e o verificador.');
 const payload={...process(editing.proc)?.payload,...Object.fromEntries(['parte','area','status','juizo','data','obs'].map(k=>[k,val('p_'+k)])),...clientFields()};
 const f=workFolder(editing.proc),fid=f?.id||editing.proc;
 const id=await rpc(db,'v4_salvar_pasta',{p_id:fid,p_titulo:val('p_title')||payload.apelido||payload.cliente_nome||n,p_cnj:n,p_payload:payload,p_restrita:$('p_restrita').checked});
 await reload();closeModal('ovProc');openDetProc(folderViewId(workFolder(id)));toast('Pasta confirmada no banco.');
}

function openAudModal(id){const a=rows('audiencias').find(x=>x.id===id);editing.aud=id||uuid();origin=a?.publicacao_id||null;for(const key of ['data','hora','proc','parte','vara','area','tipo','obs','modalidade','link','status'])set('a_'+key,key==='proc'?procNum(a?.processo_id):a?.[key]??a?.payload?.[key]??({data:today(),area:'civel',tipo:'Instrução e Julgamento',status:'agendada',modalidade:'Presencial'}[key]||''));if(!a)set('a_proc','');text('audModalTitle',a?'Editar audiência':'Nova audiência');html('a_folder','<option value="">Informar CNJ</option>'+rows('v4_pastas').filter(f=>f.processo_id).map(f=>`<option value="${f.id}">${esc(f.titulo)} · ${esc(person(f.user_id))}</option>`).join(''));set('a_folder',workFolder(a?.processo_id)?.id||'');$('a_folder').disabled=!!a;modal('ovAud');}
async function saveAud(){
 if(!val('a_data')||!val('a_hora'))throw new Error('Informe data e hora.');let f=workFolder(val('a_folder'));if(!f){const pid=await ensureProc(val('a_proc'));f=checked(await db.from('v4_pastas').select('*').eq('processo_id',pid).single());}
 const payload={...rows('audiencias').find(a=>a.id===editing.aud)?.payload,...Object.fromEntries(['parte','vara','area','tipo','obs','modalidade','link'].map(k=>[k,val('a_'+k)]))};
 await rpc(db,'v4_salvar_audiencia',{p_id:editing.aud,p_pasta:f.id,p_dados:{publicacao_id:origin,data:val('a_data'),hora:val('a_hora'),status:val('a_status'),payload}});await reload();closeModal('ovAud');toast('Audiência salva no banco.');
}
function openPrazModalBase(id){const t=rows('compromissos').find(x=>x.id===id);editing.task=id||uuid();origin=t?.publicacao_id||null;set('z_proc',t?.processo_id?procNum(t.processo_id):'');set('z_desc',t?.descricao);set('z_tipo',t?.tipo||'Administrativo');set('z_data',t?.data_fatal_confirmada);set('z_interna',t?.data_interna);set('z_sugerida',t?.data_sugerida);set('z_obs',t?.payload.obs);text('taskModalTitle',t?'Editar compromisso':'Novo compromisso');modal('ovPraz');}
const openEditPrazModal=id=>openPrazModal(id);
async function savePraz(){
 if(!val('z_desc'))throw new Error('Descreva o compromisso.');const f=await resolveTaskFolder();
 const t=rows('compromissos').find(x=>x.id===editing.task);
 await rpc(db,'v4_salvar_compromisso',{p_id:editing.task,p_pasta:f?.id||null,p_versao:editing.taskVersion??null,p_dados:{publicacao_id:origin,descricao:val('z_desc'),responsavel:val('z_owner')||null,tipo:val('z_tipo'),data_fatal_confirmada:val('z_data')||null,data_interna:val('z_interna')||null,data_sugerida:val('z_sugerida')||null,data_revisao:val('z_revisao')||null,prioridade:val('z_prioridade')||'normal',payload:{...t?.payload,obs:val('z_obs')}}});
 await reload();closeModal('ovPraz');toast('Compromisso salvo. Visível automaticamente aos membros da pasta.');
}

async function taskState(id,status){
 const before=rows('compromissos').find(t=>t.id===id);
 await rpc(db,'v4_atividade',{p_id:uuid(),p_compromisso:id,p_texto:status==='concluido'?'Compromisso concluído':status==='cancelado'?'Compromisso cancelado':'Compromisso reaberto',p_estado:status});
 await reload();if($('v-det-praz').classList.contains('active'))openDetPraz(id);
 if(status==='concluido'&&before?.status!=='concluido')bot?.notify('Congratulate','Compromisso concluído. O histórico foi preservado.');
}
const concluirPraz=id=>taskState(id,'concluido'),reabrirPraz=id=>taskState(id,'pendente');
async function remove(table,id){if(!confirm('Remover este registro? Registros vinculados impedem a exclusão da pasta.'))return;checked(await db.from(table).delete().eq('id',id).select().single());await reload();navTo(({processos:'processos',audiencias:'audiencias',compromissos:'prazos'})[table]);}
const delAud=id=>remove('audiencias',id);
async function delProc(id){if(!confirm('Remover pasta vazia? Pastas com histórico devem ser encerradas.'))return;await rpc(db,'v4_remover_pasta',{p_id:workFolder(id)?.id});await reload();navTo('processos');}
async function delPraz(id){if(confirm('Cancelar o compromisso preservando seu histórico?'))await taskState(id,'cancelado');}
function taskFromPub(id){const p=rows('publicacoes').find(x=>x.id===id);closeModal('ovTriage');openPrazModal();origin=id;set('z_proc',p.processo_id?procNum(p.processo_id):'');set('z_desc',p.providencia||'');set('z_folder',workFolder(p.processo_id)?.id||'');chooseTaskFolder();}
function audFromPub(id){const p=rows('publicacoes').find(x=>x.id===id);closeModal('ovTriage');openAudModal();origin=id;set('a_proc',p.processo_id?procNum(p.processo_id):'');set('a_folder',workFolder(p.processo_id)?.id||'');}
function taskFromProc(id){openPrazModal();set('z_folder',workFolder(id)?.id||'');chooseTaskFolder();}
function audFromProc(id){if(!workFolder(id)?.processo_id)throw new Error('Vincule um CNJ para audiência judicial. Para reunião use compromisso.');openAudModal();set('a_proc',procNum(id));set('a_folder',workFolder(id)?.id||'');}
function openPubModal(){editing.pub=uuid();for(const k of ['titulo','adv','corpo','proc','link'])set('pub_'+k,'');set('pub_data',today());modal('ovPub');}
async function savePub(){
 if(!val('pub_corpo')||!val('pub_data'))throw new Error('Informe o conteúdo e a data.');
 await rpc(db,'ingest_publicacao',{p_item:{fonte:'MANUAL',id_externo:editing.pub,numero:val('pub_proc'),texto_integral:val('pub_corpo'),data_disponibilizacao:val('pub_data'),tribunal:val('pub_trib'),tipo:val('pub_titulo'),link_origem:val('pub_link'),raw:{advogado:val('pub_adv'),urgente:val('pub_urg')==='1'}}});await reload();closeModal('ovPub');toast('Publicação salva para análise.');
}
function openTriageBase(id){
 selectedPub=id;const p=rows('publicacoes').find(x=>x.id===id);if(!p)return;
 text('triageText',p.texto_integral);text('triageInfo',`${procNum(p.processo_id)} · ${p.tribunal||''} · ${fmt(p.data_disponibilizacao)} · primeira captura ${stamp(p.first_seen_at)}`);
 set('triageCategory',p.classificacao||'Ciência, sem providência');set('triageAction',p.providencia);set('triageObs',p.observacoes);set('triageCNJ',p.processo_id?procNum(p.processo_id):p.numero_recebido);html('triageLink',sourceLink(p));
 const tasks=rows('compromissos').filter(x=>x.publicacao_id===id),auds=rows('audiencias').filter(x=>x.publicacao_id===id);
 html('triageTasks',tasks.map(t=>button('openDetPraz',t.id,t.descricao+' · '+taskStatus(t))).join('')+auds.map(a=>button('openDetAud',a.id,'Audiência '+fmt(a.data))).join('')||'Nenhum acompanhamento');
 html('triageEvents',rows('historico_alteracoes').filter(h=>h.registro_id===id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(h=>`<details><summary>${stamp(h.created_at)} · ${esc(h.acao)}</summary><pre class="source-text">${esc(JSON.stringify(h.detalhes,null,2))}</pre></details>`).join(''));
 $('triageEvents').insertAdjacentHTML('beforeend',publicationDecision(p)+rows('v4_decisoes').filter(d=>d.publicacao_id===id).map(d=>`<p>${stamp(d.created_at)} · ${esc(person(d.user_id))} · ${esc(decisions[d.decisao])}${d.revertida_em?' · Revertida por '+esc(person(d.revertida_por))+' em '+stamp(d.revertida_em):''}</p>`).join(''));modal('ovTriage');
}
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
 html('syncHistory',rows('sincronizacoes').sort((a,b)=>b.started_at.localeCompare(a.started_at)).map(j=>{const o=rows('oabs_monitoradas').find(o=>o.id===j.oab_id);return `<div class="card pub-body"><b>${esc(j.estado==='concluida'?'Concluída':j.estado==='em_andamento'?'Em andamento':j.estado==='parcial'?'Carga parcial — retomar':'Falha — retomar')} · ${esc(o?.numero_oab+'/'+o?.uf)}</b><p>${fmt(j.inicio)}–${fmt(j.fim)} · ${j.paginas} páginas · ${j.itens} itens · ${j.inseridos} novos · ${j.duplicados} conhecidos · ${j.falhas} falhas</p><p>Checkpoint: ${fmt(j.checkpoint_data)} / página ${j.checkpoint_pagina} · início ${stamp(j.started_at)} · fim ${stamp(j.finished_at)} · duração ${Math.round((Date.parse(j.finished_at||new Date().toISOString())-Date.parse(j.started_at))/1000)} s</p>${j.erro?`<p class="hint">${esc(j.erro)}</p>`:''}${j.estado!=='concluida'?button('resumeSync',j.id,'Retomar'):''}</div>`;}).join('')||empty('Nenhuma sincronização executada'));
}
async function sincronizarDJEN(){modal('ovSync');if(!val('syncInicio'))set('syncInicio','2026-10-01');set('syncFim',today());}
function incremental(){set('syncInicio',incrementalStart(rows('sincronizacoes'),val('syncOab')));set('syncFim',today());}
async function startSync(){if(syncing)return;const id=await rpc(db,'iniciar_sync',{p_oab:val('syncOab'),p_inicio:val('syncInicio'),p_fim:val('syncFim')});await reload();await resumeSync(id);}
function syncStage(stage,message){$('syncStages').dataset.stage=stage;$('syncIndeterminate').hidden=!['consultando','processando'].includes(stage);text('syncProgress',message);}
async function resumeSync(id){
 if(syncing)return;syncing=true;stopSync=false;const uid=user?.id;modal('ovSync');$('syncBtn').disabled=true;$('startSyncBtn').disabled=true;let last=rows('sincronizacoes').find(j=>j.id===id);
 try{for(let count=0;count<10000&&!stopSync&&user?.id===uid;count++){
  const o=rows('oabs_monitoradas').find(o=>o.id===last?.oab_id);
  syncStage('consultando',`Consultando OAB ${o?.numero_oab||''}/${o?.uf||''} · De ${fmt(last?.inicio)} até ${fmt(last?.fim)} · dia ${fmt(last?.checkpoint_data)}, página ${last?.checkpoint_pagina||1}. ${last?.paginas||0} páginas confirmadas. Início ${stamp(last?.started_at)}`);
  const {data:sessionData,error:e}=await db.auth.getSession();if(e||!sessionData.session)throw new Error('Sessão expirada. Faça login e retome.');
  const response=await fetch('/api/publicacoes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionData.session.access_token},body:JSON.stringify({sincronizacao_id:id})});
  const result=await response.json();if(!response.ok)throw new Error(result.erro||'Falha na sincronização');if(user?.id!==uid)break;last=result;
  syncStage('processando',`Processando resultado do lote gravado: ${result.paginas} páginas, ${result.itens} encontradas · ${result.inseridos} novas · ${result.duplicados} conhecidas · ${result.falhas} falhas. Checkpoint ${fmt(result.checkpoint_data)}, página ${result.checkpoint_pagina}.`);
  if(result.estado==='concluida'){syncStage('concluido',`Sincronização concluída: ${result.inseridos} novas, ${result.duplicados} conhecidas, ${result.falhas} falhas. ${result.paginas} páginas confirmadas. Início ${stamp(result.started_at)} · Fim ${stamp(result.finished_at)} · ${Math.round((Date.parse(result.finished_at)-Date.parse(result.started_at))/1000)} s.`);toast('Sincronização concluída e persistida.');break;}
  await new Promise(resolve=>setTimeout(resolve,2100));
 }
 if(stopSync&&user?.id===uid){await rpc(db,'v4_pausar_sync',{p_id:id});syncStage('parcial','Carga parcial — retomar pelo histórico. Todos os lotes confirmados foram preservados.');}
 }catch(e){syncStage('parcial','Carga parcial / falha — retomar. '+(e.message||e)+'. Confira o último checkpoint no histórico.');error(e);}finally{syncing=false;$('syncBtn').disabled=false;$('startSyncBtn').disabled=false;if(user?.id===uid)await reload();}
}

function stopSyncRun(){stopSync=true;text('syncProgress','Pausa solicitada; o lote em execução será concluído. Retome pelo histórico.');}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportOld(){download('LEX-legado-'+today()+'.json',exportLegacy(localStorage));}
async function exportOnline(){await reload();download('LEX-backup-'+today()+'.json',ownBackup());}
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
function prefKey(){return 'lex_v3_preferences_'+user.id;}
function preferences(){try{return JSON.parse(localStorage.getItem(prefKey())||'{}');}catch{return {};}}
function writePreferences(p){try{localStorage.setItem(prefKey(),JSON.stringify(p));}catch{}}
function renderPreferences(){const p=preferences();$('botEnabled').checked=p.botEnabled!==false;$('botMessages').checked=p.botMessages!==false;$('botReduced').checked=!!p.botReduced;$('completeContact').checked=p.completeContact!==false;}
function saveBotPrefs(){writePreferences({...preferences(),botEnabled:$('botEnabled').checked,botMessages:$('botMessages').checked,botReduced:$('botReduced').checked,completeContact:$('completeContact').checked});setupAssistant(false);}
function setupAssistant(greeting=true){
 bot?.destroy();bot=null;renderPreferences();const pref=preferences();if(pref.botEnabled===false)return;
 try{bot=new LexBot({userId:user.id,reduced:pref.botReduced,messages:pref.botMessages!==false});
 if(greeting){const c=dashboardCounts(rows('compromissos'),rows('publicacoes').map(p=>({...p,triagem_status:isPending(p)?'pendente_de_analise':'classificada'})),rows('audiencias'),today());bot.daily(c.late||c.today?'Alert':'Greet',`${c.pending} publicações aguardam análise. ${c.late} prazos confirmados vencidos e ${c.today} vencendo hoje.`);}
 }catch{bot?.destroy();bot=null;}
}
function showUrgencies(automatic=false){
 const p=preferences(),c=dashboardCounts(rows('compromissos'),rows('publicacoes').map(p=>({...p,triagem_status:isPending(p)?'pendente_de_analise':'classificada'})),rows('audiencias'),today());
 if(automatic&&(p.hideDailyUrgencies||p.urgencyDay===today()))return;
 if(automatic)writePreferences({...p,urgencyDay:today()});
 if(automatic&&!c.late&&!c.today&&!c.next)return;
 $('hideDailyUrgencies').checked=!!p.hideDailyUrgencies;
 html('urgentContents',`<p>Somente vencimentos confirmados. Aguardar terceiro não suspende prazo.</p><div class="actions">${button('dashFilter','late',c.late+' vencidos')}${button('dashFilter','today',c.today+' vencem hoje')}${button('dashFilter','next',c.next+' nos próximos 2 dias')}</div>`);modal('ovUrgencies');
}
function dismissUrgencies(){writePreferences({...preferences(),urgencyDay:today(),hideDailyUrgencies:$('hideDailyUrgencies').checked});closeModal('ovUrgencies');}
function renderDash(){
 renderDashBase();const c=dashboardCounts(rows('compromissos'),rows('publicacoes').map(p=>({...p,triagem_status:isPending(p)?'pendente_de_analise':'classificada'})),rows('audiencias'),today());
 const labels={pending:'Publicações pendentes',late:'Prazos vencidos',today:'Vencem hoje',next:'Próximos 2 dias',working:'Tarefas em andamento',waiting:'Aguardando terceiro',undated:'Sem vencimento',audiences:'Audiências'};
 html('statsRow',Object.entries(labels).map(([k,label])=>`<button class="stat-card ${k==='late'&&c[k]?'stat-danger':''}" data-action="dashFilter" data-id="${k}"><div class="stat-num">${c[k]}</div><div class="stat-label">${label}</div></button>`).join(''));
}
function dashFilter(scope){closeModal('ovUrgencies');taskScope=scope;if(scope==='pending'){pubTab('pending');navTo('publicacoes');return;}if(scope==='audiences'){navTo('audiencias');return;}
 set('fPrazStatus','abertos');set('fPrazUrg',({late:'vencidos',today:'hoje',next:'dois_dias',undated:'sem_data'})[scope]||'');
 if(scope==='working')set('fPrazStatus','em_andamento');if(scope==='waiting')set('fPrazStatus','aguardando_terceiro');navTo('prazos');
}
function pubTab(which){set('fPubStatus',which==='pending'?'pendente_de_analise':'');renderPubs();$('tabPending').classList.toggle('btn-navy',which==='pending');$('tabHistory').classList.toggle('btn-navy',which!=='pending');}
function nextPending(id){const current=pending().filter(p=>p.id!==id).sort((a,b)=>a.first_seen_at.localeCompare(b.first_seen_at))[0];if(current)openTriage(current.id);else toast('Nenhuma outra publicação pendente.');}
async function undoTriage(id){await rpc(db,'v4_reabrir',{p_id:id,p_individual:false});await reload();toast('Reaberta. Histórico e compromissos preservados.');}
function updateDecision(){
 const requires=val('triageRequires')==='yes';$('triageWork').hidden=!requires;
 const create=requires&&$('triageCreate').checked;for(const id of ['triageTaskTitle','triageInternal'])$(id).closest('.fg').hidden=!create;
}
function openTriage(id){
 openTriageBase(id);const p=rows('publicacoes').find(p=>p.id===id);if(!p)return;
 text('triageText',publicationText(p.texto_integral));text('triageOriginal',p.texto_integral);set('triageRequires',p.exige_providencia===true?'yes':p.exige_providencia===false?'no':'');set('triageTaskTitle',p.providencia||'');set('triageInternal','');set('triageReason','');editing.triageTask=uuid();editing.v4Decision=uuid();html('triageForward','<option value="">Eu vou fazer / sem transferência</option>'+collaborators().map(id=>`<option value="${id}">${esc(person(id))} (aguardar aceite)</option>`).join(''));
 const linked=rows('compromissos').filter(t=>t.publicacao_id===id&&t.processo_id&&t.status!=='cancelado');
 $('triageCreate').checked=!linked.length;$('triageCreate').disabled=!linked.length;text('triageExisting',linked.length?linked.length+' compromisso(s) já persistido(s). Confira antes de criar outro.':'Nenhum compromisso válido persistido; a análise com providência exige salvar um.');updateDecision();
}
function latestActivity(id){return rows('compromisso_atividades').filter(a=>a.compromisso_id===id).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];}
function timeline(list){return list.sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(a=>`<article class="timeline-entry"><time>${stamp(a.created_at)}</time><span> · ${esc(person(a.ator||a.user_id))}</span><p>${esc(a.texto)}</p>${a.estado_novo?chip(states[a.estado_novo]||a.estado_novo):''}${a.proximo_passo?`<p>Próximo: ${esc(a.proximo_passo)}</p>`:''}</article>`).join('')||'<p class="muted">Sem atividade registrada</p>';}
function renderPrazs(){
 const q=val('sPraz').toLowerCase(),tipo=val('fPrazTipo'),status=val('fPrazStatus'),urg=val('fPrazUrg');
 const list=rows('compromissos').filter(t=>{
  const date=t.data_fatal_confirmada,d=days(date);const overdue=taskOpen(t)&&date&&date<today();
  return matchesTaskScope(t)&&(!q||(t.descricao+' '+procNum(t.processo_id)).toLowerCase().includes(q)||digits(q).length>4&&digits(procNum(t.processo_id)).includes(digits(q)))&&(!tipo||t.tipo===tipo)&&(!status||(status==='abertos'?taskOpen(t):status==='atrasado'?overdue:t.status===status))&&(!urg||({sem_data:!date&&!t.data_interna,vencidos:overdue,hoje:date===today(),dois_dias:date&&d>0&&d<=2,urgente:date&&d<=3,proximo:date&&d<=7,futuro:date&&d>7})[urg]);
 });
 html('tbPraz',list.sort((a,b)=>(taskDate(a)||'9999').localeCompare(taskDate(b)||'9999')).map(t=>{const a=latestActivity(t.id);return `<tr><td>${fmt(t.data_fatal_confirmada)}${t.data_interna?'<br>Interna: '+fmt(t.data_interna):''}${t.data_revisao?'<br>Revisão: '+fmt(t.data_revisao):''}</td><td>${t.data_fatal_confirmada?days(t.data_fatal_confirmada)+'d':'—'}</td><td>${taskFolder(t)?button('openDetProc',folderViewId(taskFolder(t)),taskFolder(t).titulo):esc(procNum(null))}</td><td>${button('openDetPraz',t.id,t.descricao)}<p class="last-activity">${a?esc(a.texto.slice(0,120)):'Sem atividade registrada'}</p>${t.payload?.proximo_passo?'<p class="last-activity">Próximo: '+esc(t.payload.proximo_passo)+'</p>':''}<small>${taskPeople(t)}</small></td><td>${esc(t.tipo)}<br>${chip('Prioridade: '+(t.prioridade||t.payload?.prioridade||'normal'))}</td><td>${chip(states[t.status]||t.status)}${taskOpen(t)&&t.data_fatal_confirmada&&days(t.data_fatal_confirmada)<0?'<span class="due-danger">Fatal vencida</span>':''}</td><td><div class="actions">${!responsible(t)&&taskOpen(t)?button('assumeTask',t.id,'Assumir'):''}${button('activityModal',t.id,'+ Andamento')}${button(t.status==='concluido'||t.status==='cancelado'?'reabrirPraz':'concluirPraz',t.id,t.status==='concluido'||t.status==='cancelado'?'Reabrir':'Concluir')}</div></td></tr>`;}).join('')||'<tr><td colspan="7">Nenhum compromisso neste filtro</td></tr>');
}
function openDetPraz(id){
 detailTarget={kind:'task',id};openDetPrazBase(id);const t=rows('compromissos').find(t=>t.id===id);if(!t)return;
 html('dPrazGrid',`<div><label>Situação</label><p>${chip(states[t.status]||t.status)}</p></div><div><label>Fatal confirmada</label><p>${fmt(t.data_fatal_confirmada)}</p></div><div><label>Data interna</label><p>${fmt(t.data_interna)}</p></div><div><label>Revisão</label><p>${fmt(t.data_revisao)}</p></div><div><label>Prioridade jurídica</label><p>${esc(t.prioridade||'normal')}</p></div><div><label>Responsável</label><p>${esc(person(responsible(t)))}</p></div>`);
 $('dPrazActions').insertAdjacentHTML('beforeend',button('delegateTask',id,'Delegar com aceite'));html('dPrazObs',`<p>${taskPeople(t)}</p><p>${esc(t.payload?.obs||'')}</p>${t.concluido_em?'<p>Conclusão: '+stamp(t.concluido_em)+' · '+esc(person(t.concluido_por||t.user_id))+'</p>':''}<div class="detail-sec">Histórico de atividades</div>${button('activityModal',id,'+ Registrar andamento','btn btn-navy')}<div id="activityTimeline">${timeline(rows('compromisso_atividades').filter(a=>a.compromisso_id===id))}</div><details><summary>Alterações do título, datas e vínculo</summary>${rows('historico_alteracoes').filter(a=>a.registro_id===id).map(a=>`<p>${stamp(a.created_at)} · ${esc(a.acao)}</p><pre class="source-text">${esc(JSON.stringify(a.detalhes,null,2))}</pre>`).join('')}</details>`);
}
function activityModal(id){closeModal('ovTriage');activityTarget=id;activityRequest=uuid();const t=rows('compromissos').find(t=>t.id===id);if(!t)return;text('activityTitle',t.descricao);set('activityText','');set('activityState',t.status);set('activityNext',t.payload?.proximo_passo);set('activityReview',t.data_revisao);modal('ovActivity');}
async function saveActivity(){if(!val('activityText'))throw new Error('Descreva a atividade realizada.');const id=activityTarget;
 const state=val('activityState'),previous=rows('compromissos').find(t=>t.id===id)?.status;
 await rpc(db,'v4_atividade',{p_id:activityRequest,p_compromisso:id,p_texto:val('activityText'),p_estado:state,p_proximo:val('activityNext'),p_revisao:val('activityReview')||null});
 await reload();closeModal('ovActivity');if($('v-det-praz').classList.contains('active'))openDetPraz(id);if($('v-det-proc').classList.contains('active')){const pid=rows('compromissos').find(t=>t.id===id)?.processo_id;if(pid)openDetProc(pid);}toast('Andamento confirmado. Título e prazo fatal preservados.');if(state==='concluido'&&previous!=='concluido')bot?.notify('Congratulate','Compromisso concluído.');
}
function openPrazModal(id){openPrazModalBase(id);const t=rows('compromissos').find(t=>t.id===id);set('z_revisao',t?.data_revisao);set('z_prioridade',t?.prioridade||t?.payload?.prioridade||'normal');set('shortcutBase','');set('shortcutCustom','');$('confirmLegalDate').checked=false;text('shortcutResult','');editing.taskVersion=t?.versao??null;html('z_folder','<option value="">Sem pasta / informar CNJ</option>'+rows('v4_pastas').map(f=>`<option value="${f.id}">${esc(f.titulo)} · ${f.user_id===user.id?'minha':esc(person(f.user_id))}</option>`).join(''));set('z_folder',taskFolder(t)?.id||'');$('z_folder').disabled=!!t;html('z_owner',`<option value="${user.id}">${esc(person(user.id))}</option><option value="">Sem responsável</option>`+(t&&responsible(t)&&responsible(t)!==user.id?`<option value="${responsible(t)}">${esc(person(responsible(t)))}</option>`:''));set('z_owner',t?responsible(t):user.id);}
function applyDateShortcut(n){const date=suggestDate(val('shortcutBase'),n||val('shortcutCustom'),val('shortcutRegime')==='uteis');set(val('shortcutTarget')==='interna'?'z_interna':'z_sugerida',date);text('shortcutResult','Sugestão: '+fmt(date)+'. Não altera a data fatal.');$('confirmLegalDate').checked=false;}
function confirmSuggestedDate(){if(!$('confirmLegalDate').checked||!val('z_sugerida')||!val('shortcutBase'))throw new Error('Confira a sugestão e confirme explicitamente os critérios jurídicos.');set('z_data',val('z_sugerida'));}
function openProcModal(id){openProcModalBase(id);const f=workFolder(id);set('p_mode',f&&!f.processo_id?'assunto':'judicial');set('p_title',f?.titulo||'');$('p_restrita').checked=!!f?.restrita;folderMode();const p=process(id)?.payload||{};for(const key of ['apelido','cliente_nome','cpf_cnpj','telefone','cliente_email','documentos_url'])set('p_'+key,p[key]||'');}
function clientFields(){const p=Object.fromEntries(['apelido','cliente_nome','cpf_cnpj','telefone','cliente_email','documentos_url'].map(k=>[k,val('p_'+k)]));
 if(p.cpf_cnpj&&!validDocument(p.cpf_cnpj))throw new Error('CPF/CNPJ inválido. Deixe vazio quando não informado.');
 if(p.telefone&&!phoneBR(p.telefone))throw new Error('Telefone inválido. Informe DDD e número, ou DDI explícito.');
 if(p.cliente_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.cliente_email))throw new Error('E-mail do cliente inválido.');
 if(p.documentos_url&&!httpsURL(p.documentos_url))throw new Error('Use uma URL HTTPS válida para documentos.');
 return {...p,cpf_cnpj:digits(p.cpf_cnpj),telefone:phoneBR(p.telefone),documentos_url:p.documentos_url?httpsURL(p.documentos_url):''};
}
function openDetProc(id){detailTarget={kind:'proc',id};openDetProcBase(id);const p=process(id);if(!p)return;const d=p.payload||{},complete=folderComplete(d,preferences().completeContact===false?['cliente_nome']:undefined),wa=phoneBR(d.telefone),docs=httpsURL(d.documentos_url);
 $('dProcHero').insertAdjacentHTML('beforeend',`<p class="completion-hint">${complete?'Cadastro complementar preenchido':'Cadastro incompleto — completar quando possível'}</p>`);
 $('dProcGrid').insertAdjacentHTML('beforeend',Object.entries({'Nome do cliente':d.cliente_nome,'Descrição amigável':d.apelido,'CPF/CNPJ':d.cpf_cnpj,'Telefone':d.telefone,'E-mail':d.cliente_email}).map(([k,v])=>`<div class="detail-field"><label>${k}</label><p>${esc(v||'Não informado')}</p></div>`).join('')+`<div class="actions">${docs?`<a class="btn btn-ghost" href="${esc(docs)}" target="_blank" rel="noopener noreferrer">Abrir documentos ↗</a>`:''}${wa?`<a class="btn btn-ghost" href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`:''}</div>`);
 const group=folderGroup(id),taskIds=rows('compromissos').filter(t=>group.some(f=>taskFolder(t)?.id===f.id)).map(t=>t.id);$('dProcActions').insertAdjacentHTML('beforeend',workFolder(id)?.user_id===user.id?button('shareFolder',workFolder(id).id,'Compartilhar / revogar'):chip('Compartilhada por '+person(workFolder(id)?.user_id))); html('folderActivities',timeline(rows('compromisso_atividades').filter(a=>taskIds.includes(a.compromisso_id))));
}

// Integração incremental V4.1; dados originais V3 continuam nas mesmas entidades.
let reloadSeq=0,detailTarget=null,shareTarget=null,delegateTarget=null;
const contextPub=id=>(data.v4_contexto?.publicacoes||[]).find(p=>p.id===id)||{};
const isPending=p=>operationalPending(p,contextPub(p.id));
const person=id=>id?(data.v4_contexto?.nomes||[]).find(p=>p.id===id)?.nome||(id===user?.id?rows('profiles')[0]?.nome||user.email:'Colaborador'):'Sem responsável';
const workFolder=id=>rows('v4_pastas').find(f=>f.id===id||f.processo_id===id);
const folderViewId=f=>f?.processo_id||f?.id;
const taskFolder=t=>t?workFolder(t.pasta_id||t.processo_id):null;
function folderRecords(){return rows('v4_pastas').map(f=>{const p=rows('processos').find(p=>p.id===f.processo_id);return p?{...p,work_id:f.id}:{id:f.id,user_id:f.user_id,numero_cnj:'',payload:{...f.payload,apelido:f.titulo},work_id:f.id};});}
function folderGroup(id){const f=workFolder(id);if(!f)return [];const n=rows('processos').find(p=>p.id===f.processo_id)?.numero_cnj;return rows('v4_pastas').filter(x=>x.id===f.id||n&&rows('processos').find(p=>p.id===x.processo_id)?.numero_cnj===n);}
function taskPeople(t){return `Criado por ${esc(person(t.criado_por||t.user_id))} · Responsável: ${esc(person(responsible(t)))}${t.atualizado_por?' · Última atualização por '+esc(person(t.atualizado_por)):''}${t.concluido_por?' · Concluído por '+esc(person(t.concluido_por)):''}`;}
function matchesTaskScope(t){return filterScope(t,val('fTaskScope'),user.id);}
function recipients(p){return (data.v4_contexto?.destinatarios||[]).filter(o=>o.publicacao_id===p.id).map(o=>' · Destinatário original OAB '+esc(o.numero+'/'+o.uf)).join('')+(p.user_id!==user.id?' · Acesso por compartilhamento; não representa intimação à sua OAB':'');}
function publicationDecision(p){const c=contextPub(p.id),d=rows('v4_decisoes').find(d=>d.id===c.decisao_id),legacy=rows('publicacoes').find(x=>x.id===c.legado_id);
 const similar=rows('publicacoes').some(x=>x.user_id!==p.user_id&&x.processo_id&&p.processo_id&&process(x.processo_id)?.numero_cnj===process(p.processo_id)?.numero_cnj&&x.data_disponibilizacao===p.data_disponibilizacao&&contextPub(x.id).chave!==c.chave);
 return `${c.conflito?'<p class="due-danger">Conflito entre análises anteriores — confira os dois históricos. Nenhuma análise foi substituída.</p>'+button('unifyAct',p.id,'Unificar acompanhamento após revisar'):''}${c.nao_me_compete?'<p>Retirada somente da sua fila: não é minha responsabilidade.</p>':''}${d?`<p class="shared-decision">${d.user_id!==user.id?'Tratada em colaboração por ':'Analisada por '}${esc(person(d.user_id))} · ${esc(decisions[d.decisao])} · ${stamp(d.created_at)} ${d.descricao?esc(d.descricao):''}${d.compromisso_id?button('openDetPraz',d.compromisso_id,'Ver obrigação'):''}${button('undoTriage',p.id,'Desfazer / Reabrir')}</p>`:legacy?`<p>Análise V3 preservada de ${esc(person(legacy.analisado_por||legacy.user_id))}: ${esc(legacy.classificacao)} ${button('openTriage',legacy.id,'Ver análise de origem')}</p>`:p.analisado_em?`<p>Analisada por ${esc(person(p.analisado_por||p.user_id))} · ${stamp(p.analisado_em)}</p>`:''}${similar&&!d?'<p class="hint">Correspondência de atos não confirmada. Cada comunicação continua independente.</p>':''}`;
}
function refreshDetail(){
 if(selectedPub&&!rows('publicacoes').some(p=>p.id===selectedPub)){closeModal('ovTriage');selectedPub=null;html('triageText','');html('triageOriginal','');}
 if(editing.task&&$('ovPraz').classList.contains('open')&&editing.taskVersion!==null&&!rows('compromissos').some(t=>t.id===editing.task)){closeModal('ovPraz');set('z_desc','');}
 if(detailTarget&&$('v-det-'+(detailTarget.kind==='proc'?'proc':'praz')).classList.contains('active')){
 const {kind,id}=detailTarget;if(kind==='proc'&&process(id))openDetProc(id);else if(kind==='task'&&rows('compromissos').some(t=>t.id===id))openDetPraz(id);else {navTo('dashboard');['dProcHero','dProcGrid','dProcPubs','dProcPrazs','dProcAuds','dPrazHero','dPrazGrid','dPrazObs','folderActivities'].forEach(x=>html(x,''));}
 }
}
function folderMode(){$('folderCNJ').hidden=val('p_mode')==='assunto';}
function chooseTaskFolder(){const f=workFolder(val('z_folder'));set('z_proc',f?.processo_id?procNum(f.processo_id):'');}
async function resolveTaskFolder(){let f=workFolder(val('z_folder'));const n=digits(val('z_proc'));if(n&&(!f?.processo_id||process(f.processo_id)?.numero_cnj!==n)){
 const pid=await ensureProc(n);f=checked(await db.from('v4_pastas').select('*').eq('processo_id',pid).single());
 }return f;}
const ownBackup=()=>personalBackup(data,user.id);
async function quickDecision(id,decision,description=null){const c=contextPub(id);const result=await rpc(db,'v4_analisar',{p_id:id,p_decisao:decision,p_request:uuid(),p_descricao:description,p_individual:!!c.individual});await reload();
 html('decisionFeedback',`<p>${result.existente?'O ato já estava tratado; acompanhamento existente preservado.':'Decisão confirmada: '+esc(decisions[decision]||decision)}</p>${button('undoTriage',id,'Desfazer / Reabrir')}${button('openTriage',id,'Histórico')}`);$('decisionFeedback').hidden=false;toast('Decisão salva.');}
const nothingToDo=id=>quickDecision(id,'nada_a_fazer');
const alreadyDone=id=>quickDecision(id,'ja_fiz','Providência executada');
async function reviewIndividual(id){await rpc(db,'v4_reabrir',{p_id:id,p_individual:true});await reload();openTriage(id);toast('Revisão individual. A decisão do colega permanece no histórico.');}
async function skipResponsibility(id){await quickDecision(id||selectedPub,'nao_me_compete');closeModal('ovTriage');}
async function analyzeLater(){if(selectedPub)await rpc(db,'v4_analisar',{p_id:selectedPub,p_decisao:'revisar_depois',p_request:uuid()});closeModal('ovTriage');toast('Publicação mantida para análise posterior.');}
function willDo(id){openTriage(id);set('triageRequires','yes');$('triageCreate').checked=true;updateDecision();$('triageTaskTitle').focus();}
async function classify(reopen=false){
 if(reopen){await undoTriage(selectedPub);closeModal('ovTriage');return;}
 if(!selectedPub)return;const id=selectedPub,p=rows('publicacoes').find(p=>p.id===id),requires=val('triageRequires');
 if(!requires)throw new Error('Escolha explicitamente se exige providência ou se é somente ciência.');
 const category=val('triageCategory');if(category==='Outro'&&!val('triageAction'))throw new Error('Descreva a classificação Outro');
 let resolution;
 if(requires==='no'){
 // Mantém categoria/observações V3, por RPC transacional, junto à resolução operacional.
 resolution=await rpc(db,'v4_analisar',{p_id:id,p_decisao:'nada_a_fazer',p_request:editing.v4Decision,p_descricao:val('triageAction')||null,p_individual:!!contextPub(id).individual,p_categoria:category,p_observacoes:val('triageObs')});
 }else{
 let pid=p.processo_id;if(!pid){if(p.user_id!==user.id)throw new Error('Peça ao titular para vincular a publicação à pasta');await rpc(db,'vincular_publicacao',{p_id:id,p_numero:val('triageCNJ')});await reload();pid=rows('publicacoes').find(x=>x.id===id)?.processo_id;}
 const existing=rows('compromissos').find(t=>t.publicacao_id===id&&t.status!=='cancelado'&&t.processo_id);
 const desc=val('triageTaskTitle')||val('triageAction');if(!existing&&!desc)throw new Error('Descreva o compromisso antes de classificar.');
 resolution=await rpc(db,'v4_analisar',{p_id:id,p_decisao:val('triageForward')?'encaminhar':'vou_fazer',p_request:editing.v4Decision,p_descricao:val('triageAction'),p_tarefa:existing?null:{id:editing.triageTask,descricao:desc,destinatario:val('triageForward')||null,data_interna:val('triageInternal')||null,tipo:category==='Prazo processual'?'Outro':'Administrativo'},p_individual:!!contextPub(id).individual,p_categoria:category,p_observacoes:val('triageObs')});
 }
 await reload();closeModal('ovTriage');html('decisionFeedback',`<p>${resolution?.existente?'Ato já tratado; decisão e obrigação existentes preservadas.':'Classificação confirmada no banco.'}</p>${button('openTriage',id,'Ver histórico')}${button('undoTriage',id,'Desfazer / Reabrir')}${button('nextPending',id,'Próxima pendente')}`);$('decisionFeedback').hidden=false;toast(resolution?.existente?'Ato já tratado. Confira a análise existente.':'Classificação confirmada.');if($('triageNext').checked)nextPending(id);
}
function collaborators(){return rows('v4_colaboracoes').filter(c=>c.estado==='ativa').map(c=>c.user_id===user.id?c.convidado:c.user_id);}
function renderCollaboration(){if(document.activeElement?.id==='inviteEmail')return;const form=document.getElementById('inviteEmail'),email=form?.value||'',auto=$('inviteAuto')?.checked||false;
 html('collaborationPanel',`<h2>Colaboração entre contas</h2><p>Convide o e-mail exato combinado com o colega. O aceite autoriza a relação; pastas privadas continuam privadas. Correspondência automática exige CNJ e cliente compatíveis, sem restrição. Cadastros incompletos/conflitantes exigem autorização manual por pasta.</p><div class="form-row"><div class="fg"><label class="flabel" for="inviteEmail">E-mail da conta existente</label><input class="finput" type="email" id="inviteEmail" autocomplete="off"></div></div><label><input type="checkbox" id="inviteAuto"> Compartilhar trabalho de processos coincidentes (recíproco após aceite)</label><div class="actions">${button('inviteCollaboration','','Convidar','btn btn-navy')}</div>${rows('v4_colaboracoes').map(c=>{const other=c.user_id===user.id?c.convidado:c.user_id;return `<article class="collab-row"><b>${esc(person(other))}</b> · ${esc(c.estado)} · ${c.automatico?'CNJ compatível automático':'pastas autorizadas manualmente'}${c.estado==='pendente'&&c.convidado===user.id?button('acceptCollaboration',c.id,'Aceitar')+button('rejectCollaboration',c.id,'Recusar'):''}${['pendente','ativa'].includes(c.estado)?button('revokeCollaboration',c.id,'Revogar'):''}</article>`;}).join('')}${rows('v4_delegacoes').filter(d=>d.estado==='pendente').map(d=>`<p>Transferência: ${esc(rows('compromissos').find(t=>t.id===d.compromisso_id)?.descricao||'Compromisso')} · ${esc(person(d.user_id))} → ${esc(person(d.destinatario))}${d.destinatario===user.id?button('acceptDelegate',d.id,'Aceitar responsabilidade')+button('rejectDelegate',d.id,'Recusar transferência'):chip('Aguardando aceite')}</p>`).join('')}`);
 set('inviteEmail',email);$('inviteAuto').checked=auto;
}
async function inviteCollaboration(){if(!val('inviteEmail'))throw new Error('Informe o e-mail combinado com o colega');const invited=await rpc(db,'v4_convidar',{p_email:val('inviteEmail'),p_automatico:$('inviteAuto').checked});if(!invited)throw new Error('Não foi possível convidar. Confira o e-mail combinado e aguarde um minuto antes de tentar novamente.');set('inviteEmail','');await reload();toast('Convite registrado. O destinatário confere e aceita no próprio perfil.');}
async function respondCollaboration(id,action){if(action==='revogar'&&!confirm('Revogar a colaboração? O acesso compartilhado será encerrado; registros e histórico permanecem.'))return;await rpc(db,'v4_responder_convite',{p_id:id,p_acao:action});await reload();}
const acceptCollaboration=id=>respondCollaboration(id,'aceitar'),rejectCollaboration=id=>respondCollaboration(id,'recusar'),revokeCollaboration=id=>respondCollaboration(id,'revogar');
function shareFolder(id){shareTarget=id;const f=workFolder(id);if(!f||f.user_id!==user.id)return;const cs=collaborators();if(!cs.length){navTo('advogado');toast('Convide e aceite a colaboração antes de compartilhar uma pasta.');return;}
 text('shareTitle',f.titulo);html('shareMember',cs.map(id=>`<option value="${id}">${esc(person(id))}</option>`).join(''));html('shareMembers',rows('v4_membros').filter(m=>m.pasta_id===id&&m.ativo).map(m=>`<p>${esc(person(m.membro))}${button('revokeFolder',m.id,'Revogar nesta pasta')}</p>`).join(''));modal('ovShare');}
async function confirmShare(){await rpc(db,'v4_compartilhar',{p_pasta:shareTarget,p_membro:val('shareMember'),p_ativo:true});await reload();closeModal('ovShare');toast('Pasta compartilhada. Todas as tarefas já ficam visíveis ao colega.');}
async function revokeFolder(id){const m=rows('v4_membros').find(m=>m.id===id);await rpc(db,'v4_compartilhar',{p_pasta:m.pasta_id,p_membro:m.membro,p_ativo:false});await reload();closeModal('ovShare');toast('Acesso à pasta revogado.');}
async function assumeTask(id){await rpc(db,'v4_assumir',{p_id:id});await reload();toast('Responsabilidade assumida.');}
function delegateTask(id){delegateTarget=id;const cs=collaborators();if(!cs.length)throw new Error('Nenhum colaborador ativo.');html('delegateMember',cs.map(id=>`<option value="${id}">${esc(person(id))}</option>`).join(''));modal('ovDelegate');}
async function confirmDelegate(){await rpc(db,'v4_delegar',{p_id:uuid(),p_compromisso:delegateTarget,p_destinatario:val('delegateMember')});await reload();closeModal('ovDelegate');toast('Transferência aguardando aceite no perfil do destinatário.');}
async function respondDelegate(id,accept){await rpc(db,'v4_responder_delegacao',{p_id:id,p_aceitar:accept});await reload();}
const acceptDelegate=id=>respondDelegate(id,true),rejectDelegate=id=>respondDelegate(id,false);
// Reconsulta autorizada a cada 5 s e ao retornar à aba. Sem serviço privilegiado no navegador.
let refreshing=false;
async function refreshCollaboration(){if(!user||enterFlight||loading||syncing||refreshing||busy.size||document.hidden)return;refreshing=true;try{await reload();}catch(e){text('connectionState','Atualização automática pendente: '+(e.message||e));}finally{refreshing=false;}}
setInterval(refreshCollaboration,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCollaboration();});

function forwardPublication(id){willDo(id);if(!collaborators().length)throw new Error('Convide e compartilhe a pasta primeiro');set('triageForward',collaborators()[0]);}
function chooseAudFolder(){const f=workFolder(val('a_folder'));if(f)set('a_proc',procNum(f.processo_id));}
let unifyTarget=null;
function unifyAct(id){unifyTarget=id;const key=contextPub(id).chave;const candidates=rows('publicacoes').filter(p=>p.triagem_status==='classificada'&&contextPub(p.id).chave===key);html('unifyOrigin',candidates.map(p=>`<option value="${p.id}">${esc(person(p.analisado_por||p.user_id))} · ${esc(p.classificacao)} · ${esc(p.providencia||'')}</option>`).join(''));$('unifyConfirm').checked=false;chooseUnifyOrigin();modal('ovUnify');}
function chooseUnifyOrigin(){const id=val('unifyOrigin');html('unifyTask','<option value="">Sem obrigação pendente</option>'+rows('compromissos').filter(t=>t.publicacao_id===id&&t.status!=='cancelado').map(t=>`<option value="${t.id}">${esc(t.descricao)} · ${esc(states[t.status])}</option>`).join(''));}
async function confirmUnify(){await rpc(db,'v4_unificar_ato',{p_id:unifyTarget,p_origem:val('unifyOrigin'),p_compromisso:val('unifyTask')||null,p_confirmar:$('unifyConfirm').checked});await reload();closeModal('ovUnify');toast('Acompanhamento comum escolhido. Análises e tarefas anteriores preservadas.');}
const actions={unifyAct,chooseUnifyOrigin,confirmUnify,forwardPublication,chooseAudFolder,folderMode,chooseTaskFolder,nothingToDo,alreadyDone,willDo,reviewIndividual,skipResponsibility,analyzeLater,inviteCollaboration,acceptCollaboration,rejectCollaboration,revokeCollaboration,shareFolder,confirmShare,revokeFolder,assumeTask,delegateTask,confirmDelegate,acceptDelegate,rejectDelegate,activityModal,saveActivity,applyDateShortcut,confirmSuggestedDate,updateDecision,pubTab,nextPending,undoTriage,showUrgencies,dismissUrgencies,dashFilter,saveBotPrefs,doLogin,doLogout,recover,changePassword,togglePassVis,navTo,backTo,openSidebar,closeSidebar,closeModal,renderAuds,renderProcs,renderPrazs,renderPubs,openProcModal,saveProc,openAudModal,saveAud,openPrazModal,openEditPrazModal,savePraz,concluirPraz,reabrirPraz,delProc,delAud,delPraz,openDetProc,openDetAud,openDetPraz,taskFromPub,audFromPub,taskFromProc,audFromProc,openPubModal,savePub,openTriage,linkPub,openAdvModal,saveAdv,addOAB,toggleOAB,sincronizarDJEN,startSync,resumeSync,stopSyncRun,incremental,exportOld,exportOnline,previewImport,importBackup,resolveReview,reload,
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


