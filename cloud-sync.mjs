import { validOperation } from './photo-state.mjs';
export function sameOperation(a,b){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>key!=='at').map(key=>[key,canonical(value[key])])):value;
  return validOperation(a)&&validOperation(b)&&JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
export async function syncRecords({data,read,write,persist,current=()=>true,onPhase=()=>{},onPage=()=>{}}){
  let writeError=null;let readError=null;const skipped=new Set();
  const guard=()=>{if(!current())throw new Error('Account changed during sync.');};
  const flush=async()=>{
    for(const op of [...data.pending]){
      guard();onPhase('saving');
      try{const result=await write(op);guard();if(!sameOperation(result.operation,op))throw new Error('pCloud did not confirm the saved record.');data.operations=data.operations.filter(old=>old.id!==op.id);data.operations.push(result.operation);data.pending=data.pending.filter(old=>old.id!==op.id);await persist();}
      catch(error){writeError=error;break;}
    }
  };
  await flush();guard();
  try{
    let more;
    do{onPhase('restoring');const known=[...new Set([...data.operations.map(op=>op.id),...skipped])];const result=await read(known);guard();if(result.error)readError=new Error(result.error);if(!Array.isArray(result.operations))throw new Error('pCloud returned unreadable app records.');const valid=result.operations.filter(validOperation);if(valid.length!==result.operations.length){readError=new Error('Some pCloud records were unreadable. Valid records were restored; incomplete records will retry.');for(const op of result.operations)if(!validOperation(op)&&typeof op?.id==='string')skipped.add(op.id);}data.operations=[...new Map([...data.operations,...valid].map(op=>[op.id,op])).values()];for(const id of result.skipped||[])skipped.add(id);more=result.more;await persist();guard();await onPage();if(more&&known.length===[...new Set([...data.operations.map(op=>op.id),...skipped])].length)throw new Error('pCloud restore made no progress. Completed records are kept; sync will retry.');}while(more);
  }catch(error){readError=error;}
  guard();if(!writeError&&data.pending.length)await flush();
  return {writeError,readError,skipped:[...skipped],saved:data.pending.length===0};
}
