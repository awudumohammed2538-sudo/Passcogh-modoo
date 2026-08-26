import {Router} from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const r=Router();
const dir=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(dir,'../../data/curriculum/official-registry.json');
r.get('/',async(_,res,next)=>{try{res.json(JSON.parse(await fs.readFile(file,'utf8')))}catch(e){next(e)}});
r.get('/subject/:slug',async(req,res,next)=>{
 try{
  const data=JSON.parse(await fs.readFile(file,'utf8'));
  const s=data.subjects.find(x=>x.slug===req.params.slug);
  if(!s)return res.status(404).json({error:'Subject not found'});
  res.json({authority:data.authority,source_page:data.source_page,subject:s});
 }catch(e){next(e)}
});
export default r;
