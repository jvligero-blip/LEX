import {digits,addDays,validDate} from './domain.js';
export const states={pendente:'A fazer',em_andamento:'Em andamento',aguardando_terceiro:'Aguardando terceiro',concluido:'Concluído',cancelado:'Cancelado'};
export const taskOpen=t=>!['concluido','cancelado'].includes(t.status);
export function httpsURL(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}}
export function phoneBR(value){const d=digits(value);if(!d)return '';const n=d.length===10||d.length===11?'55'+d:d;return /^55[1-9]\d(?:[2-5]\d{7}|9\d{8})$/.test(n)?n:'';}
export function validDocument(value){
 const d=digits(value);if(!d)return true;if(/^(\d)\1+$/.test(d))return false;
 if(d.length===11){const calc=n=>{let sum=0;for(let i=0;i<n;i++)sum+=Number(d[i])*(n+1-i);const r=sum*10%11;return r===10?0:r;};return calc(9)===Number(d[9])&&calc(10)===Number(d[10]);}
 if(d.length===14){const calc=n=>{let w=n-7,sum=0;for(let i=0;i<n;i++){sum+=Number(d[i])*w;w=w===2?9:w-1;}const r=sum%11;return r<2?0:11-r;};return calc(12)===Number(d[12])&&calc(13)===Number(d[13]);}
 return false;
}
export function folderComplete(payload={},requirements=['cliente_nome','contato']){return requirements.every(k=>k==='contato'?!!(payload.telefone||payload.cliente_email):!!payload[k]);}
export function suggestDate(base,number,business=false){
 const n=Number(number);if(!validDate(base)||!Number.isInteger(n)||n<1||n>3650)throw new Error('Informe data-base e quantidade de 1 a 3650 dias.');
 let d=base,count=0;while(count<n){d=addDays(d,1);const day=new Date(d+'T12:00:00Z').getUTCDay();if(!business||(day!==0&&day!==6))count++;}return d;
}
export function dashboardCounts(tasks,pubs,auds,day){const active=tasks.filter(taskOpen),distance=d=>Math.round((Date.parse(d+'T12:00:00Z')-Date.parse(day+'T12:00:00Z'))/86400000);return {
 pending:pubs.filter(p=>p.triagem_status==='pendente_de_analise').length,late:active.filter(t=>t.data_fatal_confirmada&&t.data_fatal_confirmada<day).length,
 today:active.filter(t=>t.data_fatal_confirmada===day).length,next:active.filter(t=>t.data_fatal_confirmada&&distance(t.data_fatal_confirmada)>0&&distance(t.data_fatal_confirmada)<=2).length,
 working:active.filter(t=>t.status==='em_andamento').length,waiting:active.filter(t=>t.status==='aguardando_terceiro').length,
 undated:active.filter(t=>!t.data_fatal_confirmada&&!t.data_interna).length,audiences:auds.filter(a=>a.status==='agendada'&&a.data>=day).length};}
