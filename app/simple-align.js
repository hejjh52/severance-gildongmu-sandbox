const $=id=>document.getElementById(id);
const LOW=[1,2,3,4,5,6],HIGH=[8,9,10,11,12,13,14,15,16,17,18,19,20];
const KEY='severance-simple-floor-align-v1', DBNAME='severance-map-images', IMAGEWIDTH=992;
const canvas=$('stage'),ctx=canvas.getContext('2d');
let db=null,images=new Map(),history=[],drag=null,toastTimer=null,saveTimer=null;
let W=900,H=650,dpr=1,view={cx:496,cy:570,zoom:.55,panX:0,panY:0},lastFocus='move';
let S={area:'low',base:4,move:3,transforms:{},alpha:.50,removeWhite:true,showBase:true,showMove:true,axisLink:true};
const floors=()=>S.area==='low'?LOW:HIGH;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const str=(x,d=1)=>Number(x).toFixed(d);
function toast(txt){$('toast').textContent=txt;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2900);}
function keep(){return{area:S.area,base:S.base,move:S.move,transforms:S.transforms,alpha:S.alpha,removeWhite:S.removeWhite,showBase:S.showBase,showMove:S.showMove,axisLink:S.axisLink};}
function save(){clearTimeout(saveTimer);$('saveStatus').textContent='저장 중…';saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(keep()));$('saveStatus').textContent='브라우저에 저장됨';}catch(e){$('saveStatus').textContent='저장 실패 · 파일 저장 필요';}},300);}
function snapshot(){history.push(JSON.stringify(keep()));if(history.length>45)history.shift();}
function transform(f){
 const t=S.transforms[f]||(S.transforms[f]={x:0,y:0,scale:1,rotation:0});
 // Backward-compatible with alignment JSONs saved before separate X/Y controls.
 const base=Number(t.scale)||1;
 if(!(Number(t.scaleX)>0))t.scaleX=base;
 if(!(Number(t.scaleY)>0))t.scaleY=base;
 if(!Number.isFinite(Number(t.x)))t.x=0;
 if(!Number.isFinite(Number(t.y)))t.y=0;
 if(!Number.isFinite(Number(t.rotation)))t.rotation=0;
 return t;
}
function asset(f){return images.get(Number(f));}
function heightFor(f){return asset(f)?.h||(f<=6?1140:520);}
function localToWorld(f,p){const t=transform(f),r=t.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r),u=p.x*t.scaleX,v=p.y*t.scaleY;return{x:t.x+u*c-v*s,y:t.y+u*s+v*c};}
function setAroundCenter(f,field,value){
 const t=transform(f),c={x:IMAGEWIDTH/2,y:heightFor(f)/2},before=localToWorld(f,c);
 t[field]=value;const after=localToWorld(f,c);t.x+=before.x-after.x;t.y+=before.y-after.y;
}
function centerViewPoint(p){return{x:W/2+view.panX+(p.x-view.cx)*view.zoom,y:H/2+view.panY+(p.y-view.cy)*view.zoom};}
function screenWorld(p){return{x:(p.x-W/2-view.panX)/view.zoom+view.cx,y:(p.y-H/2-view.panY)/view.zoom+view.cy};}
function fitView(){
 const f=S.base,t=transform(f),h=heightFor(f),corners=[{x:0,y:0},{x:IMAGEWIDTH,y:0},{x:IMAGEWIDTH,y:h},{x:0,y:h}].map(p=>localToWorld(f,p));
 const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));
 view.cx=(minX+maxX)/2;view.cy=(minY+maxY)/2;view.zoom=clamp(Math.min((W-68)/Math.max(1,maxX-minX),(H-68)/Math.max(1,maxY-minY)),.08,8);
 view.panX=view.panY=0;render();updateZoom();
}
function updateZoom(){$('zoomLabel').textContent=Math.round(view.zoom*100)+'%';}
function zoomAt(factor,screen={x:W/2,y:H/2}){
 const original=screenWorld(screen);view.zoom=clamp(view.zoom*factor,.08,9);
 view.panX=screen.x-W/2-(original.x-view.cx)*view.zoom;
 view.panY=screen.y-H/2-(original.y-view.cy)*view.zoom;
 updateZoom();render();
}
function cutWhite(img,w,h){
 const off=document.createElement('canvas');off.width=Math.round(w);off.height=Math.round(h);
 const g=off.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,off.width,off.height);
 const p=g.getImageData(0,0,off.width,off.height),a=p.data;
 for(let i=0;i<a.length;i+=4){
  const r=a[i],gg=a[i+1],b=a[i+2],min=Math.min(r,gg,b),max=Math.max(r,gg,b);
  if(min>=249){a[i+3]=0;continue;}
  if(min>=238&&max-min<13)a[i+3]=Math.round(a[i+3]*clamp((249-min)/11,0,1));
 }
 g.putImageData(p,0,0);return off;
}
async function loadImage(f,source,persist=false){
 return new Promise(resolve=>{
  const url=typeof source==='string'?source:URL.createObjectURL(source),img=new Image();
  img.onload=()=>{
   const width=IMAGEWIDTH,h=width*(img.naturalHeight/img.naturalWidth);
   const prev=images.get(f);if(prev?.temporary)URL.revokeObjectURL(prev.url);
   images.set(f,{img,cut:cutWhite(img,width,h),h,temporary:typeof source!=='string',url,kind:typeof source==='string'?'저장소 도면':'업로드 도면'});
   if(persist)storeImage(f,source).catch(()=>toast('이미지가 저장되지 않았어요. 원본 파일을 보관해 주세요.'));
   updateImageStatus();render();resolve(true);
  };
  img.onerror=()=>{if(typeof source!=='string')URL.revokeObjectURL(url);resolve(false);};
  img.src=url;
 });
}
async function openDB(){return new Promise((resolve,reject)=>{
 if(!window.indexedDB)return reject(Error('IndexedDB is unavailable'));
 const request=indexedDB.open(DBNAME,1);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('images'))request.result.createObjectStore('images');};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function storeImage(f,file){if(!db)return;return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(file,String(f));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function storedImages(){if(!db)return[];return new Promise((resolve,reject)=>{
 const tx=db.transaction('images','readonly'),s=tx.objectStore('images'),keys=s.getAllKeys(),data=s.getAll();
 tx.oncomplete=()=>resolve(keys.result.map((k,i)=>[Number(k),data.result[i]]));tx.onerror=()=>reject(tx.error);
});}
function floorFromFilename(filename){
 const s=String(filename),m=s.match(/(?:^|[^0-9])([1-9]|1\d|20)\s*(?:F|층)(?=[^a-z]|$)/i)||s.match(/^([1-9]|1\d|20)(?=\.)/i);
 return m?Number(m[1]):null;
}
async function upload(files,multiple=false,targetFloor=S.move){
 let n=0;for(const file of files){
  if(!file.type.startsWith('image/'))continue;
  const f=multiple?floorFromFilename(file.name):targetFloor;
  if(f==null||!floors().includes(f))continue;
  if(await loadImage(f,file,true))n++;
 }
 sync();toast(n+'개 도면 저장 완료');
}
function resize(){
 const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
 W=rect.width;H=rect.height;dpr=Math.min(2,devicePixelRatio||1);
 canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
 ctx.setTransform(dpr,0,0,dpr,0,0);fitView();
}
function layer(f,opacity,cutout=false){
 const a=asset(f);if(!a)return;
 const t=transform(f),r=t.rotation*Math.PI/180;
 ctx.save();
 ctx.translate(W/2+view.panX-view.cx*view.zoom,H/2+view.panY-view.cy*view.zoom);
 ctx.scale(view.zoom,view.zoom);
 ctx.translate(t.x,t.y);ctx.rotate(r);ctx.scale(t.scaleX,t.scaleY);
 ctx.globalAlpha=opacity;ctx.drawImage(cutout?a.cut:a.img,0,0,IMAGEWIDTH,a.h);
 ctx.restore();
}
function render(){
 ctx.clearRect(0,0,W,H);ctx.fillStyle='#f0f3f6';ctx.fillRect(0,0,W,H);
 if(S.showBase)layer(S.base,1,false);
 if(S.showMove)layer(S.move,S.alpha,S.removeWhite);
 if(!asset(S.base)||!asset(S.move)){
  const missing=[S.base,S.move].filter(f=>!asset(f));
  $('canvasInfo').textContent=missing.map(f=>f+'층').join(', ')+' 도면을 업로드하면 겹쳐 볼 수 있어요.';
 }else $('canvasInfo').textContent='두 도면을 겹친 상태 · 드래그: 조정 도면 이동 · Ctrl+휠: 조정 도면 확대';
}
function updateImageStatus(){
 const missing=[S.base,S.move].filter(f=>!asset(f));
 $('imageInfo').textContent=missing.length?
   missing.join('F, ')+'F 도면이 없습니다. "선택한 층 교체" 또는 "여러 층 등록"에서 이미지 파일을 선택하세요. 8~20층 업로드는 이전 편집기와 공유됩니다.':
   '두 도면 모두 불러왔어요. 이미지 원본은 변경되지 않으며, 정렬값만 저장돼요.';
}
function sync(){
 $('lowBtn').classList.toggle('selected',S.area==='low');$('highBtn').classList.toggle('selected',S.area==='high');
 for(const [id,active] of [['baseFloor',S.base],['moveFloor',S.move]]){
  const select=$(id);select.innerHTML=floors().map(f=>'<option value="'+f+'">'+f+'층'+(!asset(f)?' (업로드 필요)':'')+'</option>').join('');
  select.value=active;
 }
 const t=transform(S.move);
 $('baseTitle').textContent=S.base+'F 기준';$('moveTitle').textContent=S.move+'F 조정';
 const uniform=(t.scaleX+t.scaleY)/2;
 $('scaleValue').textContent=str(uniform*100,1)+'%';$('scaleRange').value=clamp(uniform*100,25,400);$('scaleNumber').value=str(uniform*100,1);
 $('scaleXValue').textContent=str(t.scaleX*100,1)+'%';$('scaleXRange').value=clamp(t.scaleX*100,25,400);$('scaleXNumber').value=str(t.scaleX*100,1);
 $('scaleYValue').textContent=str(t.scaleY*100,1)+'%';$('scaleYRange').value=clamp(t.scaleY*100,25,400);$('scaleYNumber').value=str(t.scaleY*100,1);
 $('axisLink').checked=S.axisLink!==false;
 const delta=Math.abs(t.scaleX-t.scaleY)/Math.max(.0001,(t.scaleX+t.scaleY)/2);
 $('anisotropyTip').textContent=delta>.12?'가로·세로 차이가 '+str(delta*100,1)+'%입니다. 원본이 실제로 왜곡되었는지 확인하고 사용하세요.':'두 도면은 동일한 실제 축척을 보장하지 않습니다. 공통 시설만 맞추고 다른 구조는 억지로 일치시키지 마세요.';
 $('rotateValue').textContent=str(t.rotation,1)+'°';$('rotateRange').value=clamp(t.rotation,-180,180);$('rotateNumber').value=str(t.rotation,1);
 $('opacityValue').textContent=Math.round(S.alpha*100)+'%';$('opacityRange').value=S.alpha*100;
 $('removeWhite').checked=S.removeWhite;$('showBase').checked=S.showBase;$('showMove').checked=S.showMove;
 updateImageStatus();updateZoom();render();
}
function changeScale(scale,record=true){
 scale=Number(scale);if(!Number.isFinite(scale))return;scale=clamp(scale,.1,8);
 if(record)snapshot();
 const t=transform(S.move),current=(t.scaleX+t.scaleY)/2,ratio=current>0?scale/current:1;
 const center={x:IMAGEWIDTH/2,y:heightFor(S.move)/2},before=localToWorld(S.move,center);
 t.scaleX=clamp(t.scaleX*ratio,.1,8);
 t.scaleY=clamp(t.scaleY*ratio,.1,8);
 const after=localToWorld(S.move,center);t.x+=before.x-after.x;t.y+=before.y-after.y;
 t.scale=(t.scaleX+t.scaleY)/2;sync();save();
}
function changeAxis(axis,value,record=true){
 value=Number(value);if(!Number.isFinite(value))return;value=clamp(value,.1,8);
 if(record)snapshot();
 const f=S.move,t=transform(f),p={x:IMAGEWIDTH/2,y:heightFor(f)/2},before=localToWorld(f,p);
 t[axis]=value;
 if(S.axisLink!==false)t[axis==='scaleX'?'scaleY':'scaleX']=value;
 const after=localToWorld(f,p);t.x+=before.x-after.x;t.y+=before.y-after.y;
 t.scale=(t.scaleX+t.scaleY)/2;sync();save();
}
function changeRotation(angle,record=true){
 angle=Number(angle);if(!Number.isFinite(angle))return;
 if(record)snapshot();setAroundCenter(S.move,'rotation',angle);sync();save();
}
function nudge(dx,dy){
 snapshot();transform(S.move).x+=dx;transform(S.move).y+=dy;sync();save();
}
function setArea(area){
 if(area===S.area)return;
 S.area=area;S.base=area==='low'?4:8;S.move=area==='low'?3:9;
 sync();fitView();save();
}
function chooseFloor(which,f){
 if(!floors().includes(f))return;
 S[which]=f;
 if(S.base===S.move)S[which==='base'?'move':'base']=floors().find(x=>x!==f);
 lastFocus=which;sync();fitView();save();
}
function undo(){
 const old=history.pop();if(!old){toast('되돌릴 작업이 없어요.');return;}
 Object.assign(S,JSON.parse(old));sync();fitView();save();toast('이전 정렬값으로 되돌림');
}
function exportJSON(){
 const payload={schema:'severance-simple-floor-align-v1',exportedAt:new Date().toISOString(),
  description:'Original floor plans are not modified. Transforms are on a common XY map-coordinate canvas, with image width normalized to 992 units. Floor 7 is excluded.',...keep(),availableImageFloors:[...images.keys()].sort((a,b)=>a-b),imagesEmbedded:false};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='severance-manual-alignment-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1800);toast('정렬값 JSON 저장 완료. 원본 이미지 파일은 별도로 보관해 주세요.');
}
async function importJSON(file){
 try{
  const v=JSON.parse(await file.text());
  if(v.schema!=='severance-simple-floor-align-v1'||!v.transforms||typeof v.transforms!=='object')throw Error('이 편집기에서 저장한 JSON 파일만 사용할 수 있어요.');
  snapshot();S.area=v.area==='high'?'high':'low';S.base=v.base;S.move=v.move;S.transforms=v.transforms;
  S.alpha=typeof v.alpha==='number'?clamp(v.alpha,0,1):.5;S.removeWhite=v.removeWhite!==false;S.showBase=v.showBase!==false;S.showMove=v.showMove!==false;S.axisLink=v.axisLink!==false;
  if(!floors().includes(S.base))S.base=floors()[0];
  if(!floors().includes(S.move)||S.move===S.base)S.move=floors().find(x=>x!==S.base);
  sync();fitView();save();toast('정렬값 불러오기 완료');
 }catch(e){toast(e.message||'파일을 읽지 못했어요.');}
}
function wire(){
 $('lowBtn').onclick=()=>setArea('low');$('highBtn').onclick=()=>setArea('high');
 $('baseFloor').onchange=e=>chooseFloor('base',Number(e.target.value));
 $('moveFloor').onchange=e=>chooseFloor('move',Number(e.target.value));
 $('baseFloor').onfocus=()=>lastFocus='base';$('moveFloor').onfocus=()=>lastFocus='move';
 $('scaleRange').onpointerdown=snapshot;$('rotateRange').onpointerdown=snapshot;
 $('scaleRange').oninput=e=>changeScale(Number(e.target.value)/100,false);
 $('rotateRange').oninput=e=>changeRotation(Number(e.target.value),false);
 $('scaleNumber').onchange=e=>changeScale(Number(e.target.value)/100);
 $('rotateNumber').onchange=e=>changeRotation(Number(e.target.value));
 $('scaleUp').onclick=()=>changeScale((transform(S.move).scaleX+transform(S.move).scaleY)/2+.01);
 $('scaleDown').onclick=()=>changeScale((transform(S.move).scaleX+transform(S.move).scaleY)/2-.01);
 $('scaleXRange').onpointerdown=snapshot;$('scaleYRange').onpointerdown=snapshot;
 $('scaleXRange').oninput=e=>changeAxis('scaleX',Number(e.target.value)/100,false);
 $('scaleYRange').oninput=e=>changeAxis('scaleY',Number(e.target.value)/100,false);
 $('scaleXNumber').onchange=e=>changeAxis('scaleX',Number(e.target.value)/100);
 $('scaleYNumber').onchange=e=>changeAxis('scaleY',Number(e.target.value)/100);
 $('scaleXDown').onclick=()=>changeAxis('scaleX',transform(S.move).scaleX-.005);
 $('scaleXUp').onclick=()=>changeAxis('scaleX',transform(S.move).scaleX+.005);
 $('scaleYDown').onclick=()=>changeAxis('scaleY',transform(S.move).scaleY-.005);
 $('scaleYUp').onclick=()=>changeAxis('scaleY',transform(S.move).scaleY+.005);
 $('axisLink').onchange=e=>{S.axisLink=e.target.checked;sync();save();};
 $('rotateLeft').onclick=()=>changeRotation(transform(S.move).rotation-.5);
 $('rotateRight').onclick=()=>changeRotation(transform(S.move).rotation+.5);
 $('opacityRange').oninput=e=>{S.alpha=Number(e.target.value)/100;$('opacityValue').textContent=e.target.value+'%';render();save();};
 $('removeWhite').onchange=e=>{S.removeWhite=e.target.checked;render();save();};
 $('showBase').onchange=e=>{S.showBase=e.target.checked;render();save();};
 $('showMove').onchange=e=>{S.showMove=e.target.checked;render();save();};
 for(const button of document.querySelectorAll('button[data-move]'))button.onclick=()=>{
  const [dx,dy]=button.dataset.move.split(',').map(Number);nudge(dx,dy);
 };
 $('centerCurrent').onclick=()=>{snapshot();transform(S.move).x=0;transform(S.move).y=0;sync();save();};
 $('resetFloor').onclick=()=>{if(!confirm(S.move+'층 위치·회전·크기를 초기화할까요? 다른 층의 정렬은 유지됩니다.'))return;snapshot();S.transforms[S.move]={x:0,y:0,scale:1,scaleX:1,scaleY:1,rotation:0};sync();save();};
 $('undoBtn').onclick=undo;
 $('zoomIn').onclick=()=>zoomAt(1.2);$('zoomOut').onclick=()=>zoomAt(1/1.2);$('fitBtn').onclick=fitView;
 $('importBtn').onclick=()=>$('importFile').click();
 $('importFile').onchange=async e=>{if(e.target.files[0])await importJSON(e.target.files[0]);e.target.value='';};
 $('exportBtn').onclick=exportJSON;
 $('baseUploadBtn').onclick=()=>$('baseUploadFile').click();$('uploadBtn').onclick=()=>$('uploadFile').click();$('uploadManyBtn').onclick=()=>$('uploadMany').click();
 $('baseUploadFile').onchange=async e=>{await upload([...e.target.files],false,S.base);e.target.value='';};
 $('uploadFile').onchange=async e=>{await upload([...e.target.files]);e.target.value='';};
 $('uploadMany').onchange=async e=>{await upload([...e.target.files],true);e.target.value='';};
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;const rect=canvas.getBoundingClientRect();canvas.setPointerCapture(e.pointerId);
  const pan=e.shiftKey;if(!pan)snapshot();
  drag={last:{x:e.clientX,y:e.clientY},pan,moved:false,historySaved:!pan};canvas.style.cursor=pan?'grabbing':'move';
 });
 canvas.addEventListener('pointermove',e=>{
  if(!drag)return;
  const dx=e.clientX-drag.last.x,dy=e.clientY-drag.last.y;drag.last={x:e.clientX,y:e.clientY};
  if(Math.hypot(dx,dy)>.1)drag.moved=true;
  if(drag.pan){view.panX+=dx;view.panY+=dy;}else{transform(S.move).x+=dx/view.zoom;transform(S.move).y+=dy/view.zoom;}
  render();
 });
 function drop(){if(!drag)return;const {moved,historySaved}=drag;drag=null;canvas.style.cursor='grab';if(moved){sync();save();}else if(historySaved)history.pop();}
 canvas.addEventListener('pointerup',drop);canvas.addEventListener('pointercancel',drop);
 canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.ctrlKey||e.metaKey)changeScale((transform(S.move).scaleX+transform(S.move).scaleY)/2*(e.deltaY<0?1.025:1/1.025));
  else {const r=canvas.getBoundingClientRect();zoomAt(e.deltaY<0?1.12:1/1.12,{x:e.clientX-r.left,y:e.clientY-r.top});}
 },{passive:false});
 document.addEventListener('keydown',e=>{
  const target=document.activeElement?.tagName||'';if(['INPUT','SELECT','TEXTAREA'].includes(target))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}
  const keymap={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
  if(keymap[e.key]){e.preventDefault();const [dx,dy]=keymap[e.key];nudge(dx*(e.shiftKey?10:1),dy*(e.shiftKey?10:1));}
 });
 window.addEventListener('resize',resize);
}
async function init(){
 wire();try{const data=JSON.parse(localStorage.getItem(KEY)||'null');if(data&&data.transforms&&typeof data.transforms==='object')Object.assign(S,data);}catch(e){}
 if(!['low','high'].includes(S.area))S.area='low';
 if(typeof S.axisLink!=='boolean')S.axisLink=true;
 if(!floors().includes(S.base))S.base=floors()[0];
 if(!floors().includes(S.move)||S.move===S.base)S.move=floors().find(x=>x!==S.base);
 db=await openDB().catch(()=>null);
 const basic=LOW.map(f=>loadImage(f,'/floors/'+f+'F.png'));
 try{for(const [f,blob] of await storedImages())if(LOW.includes(f)||HIGH.includes(f))basic.push(loadImage(f,blob));}
 catch(e){console.warn('Existing floor images could not be read',e);}
 await Promise.all(basic);sync();resize();$('saveStatus').textContent='브라우저에 저장됨';
}
init().catch(e=>{console.error(e);$('saveStatus').textContent='로드 실패';toast('도면을 불러오지 못했어요. 새로고침하거나 이미지를 업로드해 주세요.');});
