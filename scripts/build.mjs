import {build} from 'esbuild';
import {mkdir,copyFile,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',target:'es2022',outfile:'dist/app.js',minify:true});
await copyFile('index.html','dist/index.html');
await copyFile('exportar-legado.html','dist/exportar-legado.html');
await copyFile('v3.css','dist/v3.css');
await cp('assets','dist/assets',{recursive:true});
console.log('Build LEX concluído; nenhuma credencial incorporada.');
