import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
if(spawnSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'}).status)process.exit(1);
const root=path.resolve('dist');
const handlers={config:(await import('../api/config.js')).default,publicacoes:(await import('../api/publicacoes.js')).default,andamentos:(await import('../api/andamentos.js')).default};
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');const name=u.pathname.split('/')[2];
 if(u.pathname.startsWith('/api/')&&handlers[name]){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw new Error('Requisição muito grande');}
  req.body=body?JSON.parse(body):{};req.query=Object.fromEntries(u.searchParams);
  res.status=n=>{res.statusCode=n;return res;};res.json=data=>res.end(JSON.stringify(data));res.setHeader('Content-Type','application/json');return await handlers[name](req,res);
 }
 const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(!(await stat(file)).isFile())throw new Error('Arquivo não encontrado');
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404).end('Não encontrado');}}).listen(3000,'127.0.0.1',()=>console.log('LEX em http://127.0.0.1:3000'));
