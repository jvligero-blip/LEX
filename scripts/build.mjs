import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',target:'es2022',outfile:'dist/app.js',minify:true});
await copyFile('index.html','dist/index.html');
await copyFile('exportar-legado.html','dist/exportar-legado.html');
console.log('Build LEX concluído; nenhuma credencial incorporada.');
