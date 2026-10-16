import {config,fail} from '../lib/server.js';
export default function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({erro:'Método inválido'});try{const {url,key}=config();return res.status(200).json({supabaseUrl:url,supabaseKey:key});}catch(e){return fail(res,e);}}
