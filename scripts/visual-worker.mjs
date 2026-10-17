import {visualFeatures} from '../netlify/functions/lib/visual-ai.mjs';
process.on('message',async message=>{try{const features=await visualFeatures(Buffer.from(message.bytes,'base64'),message.photo);process.send?.({id:message.id,features});}catch{process.send?.({id:message.id,error:'Visual AI could not analyze this preview.'});}});

process.on('disconnect',()=>process.exit());
