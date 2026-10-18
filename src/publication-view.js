// Conversão para texto estruturado: o DOM externo nunca é inserido na página.
const blocked=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT','BUTTON','LINK','META','NOSCRIPT','TEMPLATE','HEAD']);
const blocks=new Set(['P','DIV','SECTION','ARTICLE','HEADER','FOOTER','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','ADDRESS']);
export function publicationText(original,doc=document){
 let source=String(original??'');
 for(let i=0;i<6&&/&(?:[a-zA-Z]+|#\d+|#x[\da-f]+);/.test(source);i++){
  const box=doc.createElement('textarea');box.innerHTML=source;const decoded=box.value;if(decoded===source)break;source=decoded;
 }
 if(!/<\/?[a-z][\s\S]*?>/i.test(source))return source.replace(/\u00a0/g,' ');
 const template=doc.createElement('template');template.innerHTML=source;
 function walk(node){
  if(node.nodeType===3)return node.textContent;
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  const tag=node.tagName;if(blocked.has(tag))return '';
  if(tag==='BR')return '\n';if(tag==='HR')return '\n────────\n';
  if(tag==='OL'||tag==='UL')return '\n'+Array.from(node.children).map((child,i)=>(tag==='OL'?(Number(node.getAttribute('start')||1)+i)+'. ':'• ')+Array.from(child.childNodes).map(walk).join('').trim()).join('\n')+'\n';
  if(tag==='TR')return Array.from(node.children).filter(c=>['TD','TH'].includes(c.tagName)).map(c=>Array.from(c.childNodes).map(walk).join('').trim()).join('\t')+'\n';
  const inner=Array.from(node.childNodes).map(walk).join('');return blocks.has(tag)?'\n'+inner+'\n':inner;
 }
 return walk(template.content).replace(/\u00a0/g,' ').replace(/[ ]+\n/g,'\n').replace(/\n[ ]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
