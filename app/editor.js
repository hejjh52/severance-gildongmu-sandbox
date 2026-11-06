
const $ = (id) => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d');
const W = 992, BASEH = 1140, STORE = 'severance-map-workbench-v1';
const COLORS = {main_elevator:'#e74d50',ward_elevator:'#8f50d5',elevator:'#26a5ae',stairs:'#2fb079',escalator:'#e9a439'};
const NAMES = {main_elevator:'본관 E/V',ward_elevator:'병동 E/V',elevator:'엘리베이터',stairs:'계단',escalator:'에스컬레이터'};
const groups = {low:[1,2,3,4,5,6], high:[8,9,10,11,12,13,14,15,16,17,18,19,20]};
let geometry = {}, campus = null, db = null;
let assets = new Map(), history = [], pointer = null, routePending = [];
let view = {cx:500,cy:560,zoom:.53,panX:0,panY:0,yaw:-.55};
let state = {
 group:'low', floor:4, ref:3, mode:'align', view:'2d',
 opacityRef:.40, opacityWork:.85, north:{low:0,high:0},
 transforms:{}, connectors:[], routes:[], doors:[], selected:null
};
let saveTimer=0, toastTimer=0, width=1000, height=640;
function floors(){return groups[state.group];}
function isElev(kind){return ['main_elevator','ward_elevator','elevator'].includes(kind);}
function fmt(n,d=1){return Number(n||0).toFixed(d);}
function uid(prefix){return prefix + '-' + (crypto.randomUUID ? crypto.randomUUID().slice(0,8) : Math.random().toString(36).slice(2,10));}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function notify(s){$('toast').textContent=s;$('toast').classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('on'),3000);}
function snapshot(){history.push(JSON.stringify(editable()));if(history.length>45)history.shift();}
function editable(){return {group:state.group,floor:state.floor,ref:state.ref,north:state.north,opacityRef:state.opacityRef,opacityWork:state.opacityWork,transforms:state.transforms,connectors:state.connectors,routes:state.routes,doors:state.doors};}
function save(){clearTimeout(saveTimer);$('saveStatus').textContent='저장 중…';saveTimer=setTimeout(()=>{try{localStorage.setItem(STORE,JSON.stringify(editable()));$('saveStatus').textContent='이 브라우저에 자동 저장됨';}catch(e){$('saveStatus').textContent='저장 실패 · JSON 내보내기 권장';}},300);}
function defaultTransform(f){const m=geometry?.floorCorr?.[String(f)];if(m){return{x:Number(m.tx)||0,y:Number(m.tz)||0,rot:Math.atan2(m.c,m.a)*180/Math.PI,scale:Math.hypot(m.a,m.c)};}return {x:0,y:f<=6?0:350,rot:0,scale:1};}
function tform(f){return state.transforms[f]||(state.transforms[f]=defaultTransform(f));}
function localToWorld(f,p){const t=tform(f),r=t.rot*Math.PI/180,s=t.scale||1,c=Math.cos(r),si=Math.sin(r);return{x:t.x+s*(p.x*c-p.y*si),y:t.y+s*(p.x*si+p.y*c)};}
function worldToLocal(f,p){const t=tform(f),r=t.rot*Math.PI/180,s=t.scale||1,c=Math.cos(r),si=Math.sin(r),x=(p.x-t.x)/s,y=(p.y-t.y)/s;return{x:x*c+y*si,y:-x*si+y*c};}
function worldToScreen(p){return{x:width*.5+(p.x-view.cx)*view.zoom+view.panX,y:height*.5+(p.y-view.cy)*view.zoom+view.panY};}
function screenToWorld(p){return{x:(p.x-width*.5-view.panX)/view.zoom+view.cx,y:(p.y-height*.5-view.panY)/view.zoom+view.cy};}
function screenToLocal(f,p){return worldToLocal(f,screenToWorld(p));}
function getAsset(f){return assets.get(Number(f));}
function imageH(f){return assets.get(Number(f))?.h || (f<=6?BASEH:350);}
function openDB(){return new Promise((res,rej)=>{if(!indexedDB)return rej(Error('No indexedDB'));const q=indexedDB.open('severance-map-images',1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('images'))q.result.createObjectStore('images');};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}
function putImage(f,blob){if(!db)return Promise.resolve();return new Promise((res,rej)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(blob,String(f));tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
function listStoredImages(){if(!db)return Promise.resolve([]);return new Promise((res,rej)=>{const tx=db.transaction('images','readonly'),q=tx.objectStore('images').getAllKeys(),r=tx.objectStore('images').getAll();tx.oncomplete=()=>res(q.result.map((key,i)=>[Number(key),r.result[i]]));tx.onerror=()=>rej(tx.error);});}
function loadImage(f,source,persist=false){
 return new Promise((resolve)=>{const img=new Image();let src=typeof source==='string'?source:URL.createObjectURL(source);
 img.onload=()=>{let h=f<=6?BASEH:Math.min(1550,Math.max(150,W*img.naturalHeight/img.naturalWidth));assets.set(Number(f),{img,h,src,name:typeof source==='string'?'기본 도면':'업로드 이미지'});if(persist)putImage(f,source).catch(()=>{});draw();updateImageHint();resolve(true);};
 img.onerror=()=>{resolve(false);};
 img.src=src;
 });
}
function updateImageHint(){let count=floors().filter(f=>assets.has(f)).length;
 $('imageHint').textContent=String(count)+'/'+String(floors().length)+'개 층의 도면이 로드됨. 8~20층은 파일명을 8F.png, 9F.png…처럼 지정해서 한 번에 불러올 수 있어요. 이미지 자체는 JSON 내보내기에 포함되지 않습니다.';
}
function parseFloorName(n){let m=String(n).match(/(?:^|[^0-9])([1-9]|1\d|20)\s*(?:f|F|층|_F)/);if(m)return Number(m[1]);m=String(n).match(/^([1-9]|1\d|20)(?=\.)/);return m?Number(m[1]):null;}
async function importImages(files,bulk){
 const allowed=floors();let n=0;
 for(const file of files){if(!file.type.startsWith('image/'))continue;let f=bulk?parseFloorName(file.name):state.floor;
 if(!allowed.includes(f)){if(bulk)continue;f=state.floor;}
 if(await loadImage(f,file,true))n++;
 }
 updatePanels();notify(String(n)+'개 층 이미지 등록 완료 · 브라우저에 저장됨');
}
function resetView(){view.cx=state.group==='low'?500:500;view.cy=state.group==='low'?560:560;view.zoom=state.group==='low'?.53:.52;view.panX=0;view.panY=0;view.yaw=-.55;draw();}
function groupSet(g){if(!groups[g])return;state.group=g;state.floor=g==='low'?4:8;state.ref=g==='low'?3:9;state.selected=null;routePending=[];resetView();updateAll();save();}
function floorSet(f){if(!floors().includes(f))return;state.floor=f;state.selected=null;routePending=[];if(state.ref===f)state.ref=floors().find(z=>z!==f)||f;updateAll();save();}
function refSet(f){if(!floors().includes(f)||f===state.floor)return;state.ref=f;updateAll();save();}
function setMode(mode){if(routePending.length&&state.mode==='route'&&mode!=='route')finishRoute();state.mode=mode;state.selected=null;updateAll();}
function setView(v){state.view=v;updateAll();}
function updateAll(){
 $('lowBtn').classList.toggle('active',state.group==='low');$('highBtn').classList.toggle('active',state.group==='high');
 const arr=floors();
 $('floorButtons').innerHTML=arr.map(f=>'<button data-floor="'+f+'" class="'+(f===state.floor?'active':'')+'">'+f+'F</button>').join('');
 $('floorButtons').querySelectorAll('button').forEach(b=>b.onclick=()=>floorSet(Number(b.dataset.floor)));
 for(const el of [$('refFloor'),$('workFloor')])el.innerHTML=arr.map(f=>'<option value="'+f+'">'+f+'층'+(!assets.has(f)?' · 도면 없음':'')+'</option>').join('');
 $('workFloor').value=state.floor;$('refFloor').value=state.ref;
 $('refOpacity').value=state.opacityRef*100;$('workOpacity').value=state.opacityWork*100;
 $('refOpText').textContent=Math.round(state.opacityRef*100)+'%';$('workOpText').textContent=Math.round(state.opacityWork*100)+'%';
 const t=tform(state.floor);$('tx').value=fmt(t.x,1);$('ty').value=fmt(t.y,1);$('rot').value=fmt(t.rot,2);$('scale').value=fmt(t.scale,3);
 $('northDeg').value=state.north[state.group]||0;
 for(const m of ['Align','Connector','Route','Door']){$('mode'+m).classList.toggle('active',state.mode===m.toLowerCase());$('panel'+m).classList.toggle('show',state.mode===m.toLowerCase());}
 $('view2d').classList.toggle('active',state.view==='2d');$('view3d').classList.toggle('active',state.view==='3d');
 $('hudTitle').textContent=state.view==='2d'?(state.ref+'F (기준)  ↔  '+state.floor+'F (작업)'):(arr[0]+'–'+arr.at(-1)+'F 입체 검증');
 $('hudSub').textContent=state.view==='2d'?'지도 방향: 북쪽 '+(state.north[state.group]||0)+'° (현장 기준 확인 필요)':'회전: 드래그 / 확대: 휠 · 7F 제외';
 const hint={
 align:'도면 정렬: 작업 층의 도면을 드래그. Shift+드래그로 화면 이동. 두 층에서 동일 엘리베이터 ID를 찍으면 자동 정렬할 수 있어요.',
 connector:'연결시설: 종류와 ID를 입력한 후 실제 시설 중심을 클릭. 이미 찍은 점은 드래그하여 수정할 수 있어요.',
 route:'보행 동선: 복도의 중심을 따라 연속 클릭. 완료 버튼 또는 Enter로 저장, Esc로 취소.',
 door:'장소 입구: 실제 출입문 위치를 클릭하세요. 기존 점은 드래그로 수정할 수 있어요.'
 };
 $('modeHint').textContent=state.view==='3d'?'3D 검증 화면: 드래그로 시점을 회전하고 스크롤로 확대하세요. 편집은 2D에서만 가능합니다.':hint[state.mode];
 renderLists();updateImageHint();draw();
}
function pointColor(kind){return COLORS[kind]||'#4a7da0';}
function listItem(x,selected,detail){return '<div class="item '+(selected?'sel':'')+'" data-id="'+esc(x.id)+'"><strong>'+esc(x.label||x.name||x.key||'지점')+'</strong><small>'+esc(detail||'')+'</small></div>';}
function activeEntries(type){return state[type].filter(x=>x.floor===state.floor);}
function renderLists(){
 const con=activeEntries('connectors'),routes=activeEntries('routes'),doors=activeEntries('doors');
 $('connectorCount').textContent=con.length;$('routeCount').textContent=routes.length;$('doorCount').textContent=doors.length;
 $('connectorList').innerHTML=con.length?con.map(c=>listItem(c,state.selected?.id===c.id,NAMES[c.kind]+' · ID '+c.key+' · '+fmt(c.x)+', '+fmt(c.y))).join(''):'<p class="muted">이 층에 등록된 시설이 없어요.</p>';
 $('routeList').innerHTML=routes.length?routes.map(p=>listItem(p,state.selected?.id===p.id,p.pts.length+'개 점 · '+p.floor+'F')).join(''):'<p class="muted">복도를 따라 점을 찍어주세요.</p>';
 $('doorList').innerHTML=doors.length?doors.map(p=>listItem(p,state.selected?.id===p.id,p.type+' · '+fmt(p.x)+', '+fmt(p.y))).join(''):'<p class="muted">출입구 위치를 클릭해 주세요.</p>';
 for(const [id,typ] of [['connectorList','connectors'],['routeList','routes'],['doorList','doors']]){
 $(''+id).querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>{const x=state[typ].find(y=>y.id===el.dataset.id);state.selected={type:typ,id:x.id};if(typ==='connectors'){$('connectorKey').value=x.key;$('connectorName').value=x.label||'';$('connectorKind').value=x.kind;}else if(typ==='doors'){$('doorName').value=x.label||'';$('doorType').value=x.type;}renderLists();draw();});
 }
 $('deleteConnector').disabled=state.selected?.type!=='connectors';$('deleteRoute').disabled=state.selected?.type!=='routes';$('deleteDoor').disabled=state.selected?.type!=='doors';
 updateMatchInfo();
}
function groupByKey(f){return state.connectors.filter(c=>c.floor===f);}
function matches(){
 const a=groupByKey(state.floor),b=groupByKey(state.ref);
 return a.filter(c=>isElev(c.kind)).map(c=>{let other=b.find(x=>x.key===c.key&&isElev(x.kind));if(!other)return null;let p=localToWorld(c.floor,c),q=localToWorld(other.floor,other);return {c,other,p,q,d:Math.hypot(p.x-q.x,p.y-q.y)};}).filter(Boolean);
}
function updateMatchInfo(){
 let m=matches();$('matchInfo').textContent=m.length?'공통 엘리베이터 '+m.length+'개 · 평균 오차 '+fmt(m.reduce((s,x)=>s+x.d,0)/m.length,1)+' (도면 단위). 두 지점 이상이면 회전·배율까지 자동 정렬됩니다.':'두 층에 동일한 엘리베이터 ID가 있어야 자동 정렬할 수 있습니다.';
 const by=new Map();for(const c of state.connectors.filter(c=>floors().includes(c.floor))){if(!by.has(c.key))by.set(c.key,[]);by.get(c.key).push(c);}
 let lines=[];for(const [key,a] of by){if(a.length<2)continue;const sorted=a.sort((x,y)=>x.floor-y.floor);let ds=[];
 for(let i=1;i<sorted.length;i++){if(!isElev(sorted[i].kind))continue;let p=localToWorld(sorted[i].floor,sorted[i]),q=localToWorld(sorted[i-1].floor,sorted[i-1]);ds.push(Math.hypot(p.x-q.x,p.y-q.y));}
 if(ds.length)lines.push({key,err:Math.max(...ds),floors:sorted.map(x=>x.floor)});
 }
 lines.sort((a,b)=>b.err-a.err);
 $('errorList').innerHTML=lines.length?lines.slice(0,22).map(x=>'<div class="'+(x.err<10?'checked':'bad')+'">'+esc(x.key)+' · 최대 편차 '+fmt(x.err,1)+' · '+esc(x.floors.join('/'))+'F</div>').join(''):'같은 ID의 시설을 두 층 이상에 찍으면 위치 오차가 표시됩니다.';
}
function autoAlign(){
 const m=matches();if(!m.length)return notify('같은 엘리베이터 ID가 기준 층과 작업 층에 필요해요.');
 snapshot();const t=tform(state.floor);
 if(m.length===1){t.x+=m[0].q.x-m[0].p.x;t.y+=m[0].q.y-m[0].p.y;}
 else{
  let sx=0,sy=0,dx=0,dy=0;for(const a of m){sx+=a.c.x;sy+=a.c.y;dx+=a.q.x;dy+=a.q.y;}
  sx/=m.length;sy/=m.length;dx/=m.length;dy/=m.length;let dot=0,cross=0,den=0;
  for(const a of m){let x=a.c.x-sx,y=a.c.y-sy,X=a.q.x-dx,Y=a.q.y-dy;dot+=x*X+y*Y;cross+=x*Y-y*X;den+=x*x+y*y;}
  if(den>1){let r=Math.atan2(cross,dot),s=Math.hypot(dot,cross)/den;
   if(s>=.15 && s<=6){t.scale=s;t.rot=r*180/Math.PI;t.x=dx-s*(Math.cos(r)*sx-Math.sin(r)*sy);t.y=dy-s*(Math.sin(r)*sx+Math.cos(r)*sy);}
   else{t.x+=m[0].q.x-m[0].p.x;t.y+=m[0].q.y-m[0].p.y;}
  }else{t.x+=m[0].q.x-m[0].p.x;t.y+=m[0].q.y-m[0].p.y;}
 }
 updateAll();save();notify(m.length>1?'공통 시설 '+m.length+'개로 이동·회전·배율 정렬':'공통 시설 1개로 위치 이동 정렬');
}
function addConnector(local){
 let key=$('connectorKey').value.trim(),kind=$('connectorKind').value,label=$('connectorName').value.trim();
 if(!key){notify('먼저 시설 ID를 입력해 주세요.');$('connectorKey').focus();return;}
 snapshot();const p={id:uid('c'),floor:state.floor,key,kind,label:label||NAMES[kind]+' '+key,x:local.x,y:local.y,verified:false,source:'editor'};
 state.connectors.push(p);state.selected={type:'connectors',id:p.id};renderLists();save();draw();
}
function addDoor(local){
 const label=$('doorName').value.trim();if(!label){notify('장소·입구 이름을 입력해 주세요.');$('doorName').focus();return;}
 snapshot();const p={id:uid('d'),floor:state.floor,label,type:$('doorType').value,x:local.x,y:local.y,source:'editor'};
 state.doors.push(p);state.selected={type:'doors',id:p.id};renderLists();save();draw();
}
function addRoutePoint(local){if(!routePending.length)snapshot();routePending.push({x:local.x,y:local.y});draw();}
function finishRoute(){
 if(routePending.length<2){routePending=[];draw();return;}
 state.routes.push({id:uid('r'),floor:state.floor,label:$('routeName').value.trim()||'보행 동선',pts:routePending.slice(),walkable:true,source:'editor'});
 routePending=[];renderLists();save();draw();notify('보행 동선이 저장됐어요.');
}
function eraseSelected(type){const s=state.selected;if(s?.type!==type)return;snapshot();state[type]=state[type].filter(x=>x.id!==s.id);state.selected=null;renderLists();save();draw();}
function cloneShaft(){
 const s=state.selected;if(s?.type!=='connectors')return notify('먼저 엘리베이터 점을 선택하세요.');
 const c=state.connectors.find(x=>x.id===s.id);if(!c||!isElev(c.kind))return notify('엘리베이터 시설만 수직으로 복제할 수 있어요.');
 const w=localToWorld(c.floor,c),arr=floors();let n=0;snapshot();
 for(const f of arr){if(f===c.floor||state.connectors.some(x=>x.floor===f&&x.key===c.key))continue;
 const p=worldToLocal(f,w);state.connectors.push({...c,id:uid('c'),floor:f,x:p.x,y:p.y,verified:false,source:'auto_vertical_copy'});n++;}
 renderLists();save();draw();notify(n+'개 층에 수직 복제 완료. 각 층 실제 도면에서 확인하세요.');
}
function drawGrid(){
 ctx.fillStyle='#e8f0f7';ctx.fillRect(0,0,width,height);
 const step=100,minx=screenToWorld({x:0,y:0}),maxx=screenToWorld({x:width,y:height});ctx.strokeStyle='#d1deea';ctx.lineWidth=1;
 for(let x=Math.floor(minx.x/step)*step;x<=maxx.x;x+=step){const p=worldToScreen({x,y:0});ctx.beginPath();ctx.moveTo(p.x,0);ctx.lineTo(p.x,height);ctx.stroke();}
 for(let y=Math.floor(minx.y/step)*step;y<=maxx.y;y+=step){const p=worldToScreen({x:0,y});ctx.beginPath();ctx.moveTo(0,p.y);ctx.lineTo(width,p.y);ctx.stroke();}
}
function drawFloor2d(f,alpha,outlineColor){
 const t=tform(f),asset=getAsset(f),origin=worldToScreen({x:t.x,y:t.y});
 ctx.save();ctx.translate(origin.x,origin.y);ctx.rotate(t.rot*Math.PI/180);ctx.scale(t.scale*view.zoom,t.scale*view.zoom);
 if(asset){ctx.globalAlpha=alpha;ctx.drawImage(asset.img,0,0,W,asset.h);}
 else{ctx.globalAlpha=Math.min(.7,alpha);ctx.fillStyle=f<=6?'#d5dfed':'#e6ddec';ctx.fillRect(0,0,W,imageH(f));ctx.fillStyle='#657a93';ctx.font='bold 38px Arial';ctx.fillText(f+'F · 도면 업로드 필요',42,70);}
 ctx.globalAlpha=1;ctx.strokeStyle=outlineColor;ctx.lineWidth=2/(t.scale*view.zoom);ctx.strokeRect(0,0,W,imageH(f));ctx.restore();
}
function circle(p,color,r=6,sel=false){
 ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=sel?3:1.8;ctx.stroke();
 if(sel){ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();}
}
function drawAnnotations2d(f,ghost=false){
 const alpha=ghost?.38:1;ctx.save();ctx.globalAlpha=alpha;
 for(const r of state.routes.filter(x=>x.floor===f)){
  if(r.pts.length<2)continue;ctx.beginPath();r.pts.forEach((p,i)=>{const o=worldToScreen(localToWorld(f,p));i?ctx.lineTo(o.x,o.y):ctx.moveTo(o.x,o.y);});
  ctx.strokeStyle='#138ccc';ctx.lineWidth=4;ctx.lineCap='round';ctx.stroke();
  if(!ghost&&state.selected?.id===r.id)for(const p of r.pts)circle(worldToScreen(localToWorld(f,p)),'#0787bd',4);
 }
 if(!ghost&&f===state.floor&&routePending.length){ctx.beginPath();routePending.forEach((p,i)=>{const a=worldToScreen(localToWorld(f,p));i?ctx.lineTo(a.x,a.y):ctx.moveTo(a.x,a.y);});
 ctx.strokeStyle='#0089cf';ctx.lineWidth=4;ctx.setLineDash([7,4]);ctx.stroke();ctx.setLineDash([]);routePending.forEach(p=>circle(worldToScreen(localToWorld(f,p)),'#0089cf',4));}
 for(const c of state.connectors.filter(x=>x.floor===f)){
  const p=worldToScreen(localToWorld(f,c));circle(p,pointColor(c.kind),6,state.selected?.id===c.id&&!ghost);
  if(!ghost){ctx.font='bold 11px sans-serif';ctx.fillStyle='#153a56';ctx.fillText(c.key,p.x+10,p.y-9);}
 }
 for(const d of state.doors.filter(x=>x.floor===f)){
  const p=worldToScreen(localToWorld(f,d));circle(p,'#168ac6',5,state.selected?.id===d.id&&!ghost);
  if(!ghost){ctx.font='11px sans-serif';ctx.fillStyle='#164a73';ctx.fillText(d.label,p.x+8,p.y+16);}
 }
 ctx.restore();
}
function drawMatched(){
 if(state.ref===state.floor)return;
 ctx.save();for(const m of matches()){
 const p=worldToScreen(m.p),q=worldToScreen(m.q);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);
 ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.strokeStyle=m.d<10?'#14a477':'#d76a46';ctx.stroke();ctx.setLineDash([]);
 ctx.font='bold 11px sans-serif';ctx.fillStyle=m.d<10?'#117d61':'#a95334';ctx.fillText(fmt(m.d,1),(p.x+q.x)/2+6,(p.y+q.y)/2-7);
 }ctx.restore();
}
function drawCompass(){
 const north=Number(state.north[state.group]||0)*Math.PI/180;
 ctx.save();ctx.translate(width-54,52);ctx.rotate(north);ctx.strokeStyle='#245d8f';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,15);ctx.lineTo(0,-21);ctx.stroke();ctx.fillStyle='#155da2';ctx.beginPath();ctx.moveTo(0,-26);ctx.lineTo(-7,-13);ctx.lineTo(7,-13);ctx.fill();ctx.fillStyle='#174669';ctx.textAlign='center';ctx.font='bold 11px sans-serif';ctx.fillText('N',0,-31);ctx.restore();
 ctx.textAlign='right';ctx.font='10px sans-serif';ctx.fillStyle='#58748c';ctx.fillText('북쪽: '+(state.north[state.group]||0)+'° · 현장 미확정',width-17,108);
}
function draw2d(){drawGrid();if(state.ref!==state.floor){drawFloor2d(state.ref,state.opacityRef,'#8199b6');drawAnnotations2d(state.ref,true);}
 drawFloor2d(state.floor,state.opacityWork,'#105ba6');drawMatched();drawAnnotations2d(state.floor);drawCompass();
 const a=getAsset(state.floor);if(!a){ctx.fillStyle='#ffffffd9';ctx.fillRect(width/2-150,height-74,300,34);ctx.fillStyle='#345d7d';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText('오른쪽에서 '+state.floor+'F 이미지 업로드',width/2,height-53);}
}
function project3(p,f){
 let yaw=view.yaw,c=Math.cos(yaw),s=Math.sin(yaw);
 const dx=p.x-500,dy=p.y-550,u=c*dx-s*dy,v=s*dx+c*dy;
 const k=(view.zoom/.53)*Math.min(width/950,height/780)*.68;
 const steps=floors(),gap=Math.min(47,Math.max(27,(height-160)/Math.max(1,steps.length-1)));
 return {x:width*.51+u*k+view.panX,y:height*.68+v*k*.43-(f-steps[0])*gap+view.panY};
}
function draw3dFloor(f){
 const t=tform(f),asset=getAsset(f),imh=imageH(f),o=localToWorld(f,{x:0,y:0}),x=localToWorld(f,{x:W,y:0}),y=localToWorld(f,{x:0,y:imh}),z=localToWorld(f,{x:W,y:imh});
 const a=project3(o,f),b=project3(x,f),c=project3(y,f),d=project3(z,f);
 ctx.save();ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(d.x,d.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.fillStyle='#ffffffa8';ctx.fill();ctx.strokeStyle=f===state.floor?'#1970b8':'#8ea7bc';ctx.lineWidth=f===state.floor?2.2:1;ctx.stroke();
 if(asset){ctx.save();ctx.globalAlpha=f===state.floor?.42:.17;ctx.transform((b.x-a.x)/W,(b.y-a.y)/W,(c.x-a.x)/imh,(c.y-a.y)/imh,a.x,a.y);ctx.drawImage(asset.img,0,0,W,imh);ctx.restore();}
 ctx.fillStyle=f===state.floor?'#0d5b9c':'#3a607c';ctx.font='bold 12px sans-serif';ctx.fillText(f+'F',a.x-32,a.y+6);ctx.restore();
}
function draw3d(){
 ctx.fillStyle='#ebf2f8';ctx.fillRect(0,0,width,height);const arr=floors();
 for(const f of arr)draw3dFloor(f);
 const byKey=new Map();
 for(const c of state.connectors.filter(x=>arr.includes(x.floor))){if(!byKey.has(c.key))byKey.set(c.key,[]);byKey.get(c.key).push(c);}
 for(const [key,pts] of byKey){pts.sort((a,b)=>a.floor-b.floor);const col=pointColor(pts[0].kind);
 for(let i=1;i<pts.length;i++){const a=project3(localToWorld(pts[i-1].floor,pts[i-1]),pts[i-1].floor),b=project3(localToWorld(pts[i].floor,pts[i]),pts[i].floor);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle=col;ctx.lineWidth=3;ctx.stroke();}
 for(const p of pts){circle(project3(localToWorld(p.floor,p),p.floor),col,3.5);}
 }
 for(const p of state.doors.filter(x=>arr.includes(x.floor))){circle(project3(localToWorld(p.floor,p),p.floor),'#168ac6',3);}
 drawCompass();
}
function draw(){if(!ctx||!canvas)return;ctx.clearRect(0,0,width,height);if(state.view==='3d')draw3d();else draw2d();}
function resize(){const r=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);width=Math.max(100,r.width);height=Math.max(100,r.height);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
function posOf(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function nearPoint(p){
 const candidates=state.mode==='connector'?activeEntries('connectors'):state.mode==='door'?activeEntries('doors'):[];
 let best=null,d=15;for(const c of candidates){const v=worldToScreen(localToWorld(c.floor,c)),dd=Math.hypot(v.x-p.x,v.y-p.y);if(dd<d){d=dd;best=c;}}
 return best;
}
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0)return;const p=posOf(e);canvas.setPointerCapture(e.pointerId);
 if(state.view==='3d'){pointer={type:'camera',p};return;}
 if(e.shiftKey){pointer={type:'pan',p};return;}
 if(state.mode==='align'){snapshot();pointer={type:'align',p};return;}
 if(state.mode==='connector'||state.mode==='door'){
 const x=nearPoint(p);if(x){state.selected={type:state.mode==='connector'?'connectors':'doors',id:x.id};snapshot();pointer={type:'point',p,obj:x};renderLists();draw();return;}
 const loc=screenToLocal(state.floor,p);if(state.mode==='connector')addConnector(loc);else addDoor(loc);pointer=null;return;
 }
 if(state.mode==='route'){const loc=screenToLocal(state.floor,p);addRoutePoint(loc);pointer=null;}
});
canvas.addEventListener('pointermove',e=>{
 if(!pointer)return;const p=posOf(e),dx=p.x-pointer.p.x,dy=p.y-pointer.p.y;pointer.p=p;
 if(pointer.type==='pan'){view.panX+=dx;view.panY+=dy;}
 if(pointer.type==='camera'){view.yaw+=dx*.005;view.panY+=dy*.55;}
 if(pointer.type==='align'){const t=tform(state.floor);t.x+=dx/view.zoom;t.y+=dy/view.zoom;}
 if(pointer.type==='point'){const loc=screenToLocal(pointer.obj.floor,p);pointer.obj.x=loc.x;pointer.obj.y=loc.y;}
 draw();
});
function stopDrag(){if(pointer){const typ=pointer.type;pointer=null;if(typ==='align'||typ==='point'){updateAll();save();}}}
canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);
canvas.addEventListener('wheel',e=>{e.preventDefault();const scale=e.deltaY<0?1.12:1/1.12;view.zoom=Math.min(2.5,Math.max(.12,view.zoom*scale));draw();},{passive:false});
canvas.addEventListener('dblclick',e=>{if(state.mode==='route'&&state.view==='2d'){e.preventDefault();finishRoute();}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}
 else if(e.key==='Escape'&&routePending.length){routePending=[];draw();}
 else if(e.key==='Enter'&&state.mode==='route'&&routePending.length&&document.activeElement.tagName!=='INPUT'){finishRoute();}});
function undo(){const a=history.pop();if(!a)return notify('되돌릴 작업이 없어요.');const x=JSON.parse(a);Object.assign(state,x);state.selected=null;routePending=[];updateAll();save();notify('이전 상태로 되돌림');}
function exportJSON(){
 const payload={schema:'severance-map-alignment-v1',exportedAt:new Date().toISOString(),notice:'Images are not embedded. Keep original map image files separately. Connector and waypoint coordinates are local floor-image coordinates.',...editable(),imageFloors:[...assets.keys()].sort((a,b)=>a-b)};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download='severance-map-editor-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);notify('JSON 파일 저장 완료 · 지도 이미지는 별도 보관');
}
async function importJSON(file){
 try{const data=JSON.parse(await file.text());if(data.schema!=='severance-map-alignment-v1'||!data.transforms||!Array.isArray(data.connectors)||!Array.isArray(data.routes)||!Array.isArray(data.doors))throw Error('지원하지 않는 작업 파일');
 snapshot();state.transforms=data.transforms;state.connectors=data.connectors;state.routes=data.routes;state.doors=data.doors;state.north=data.north||{low:0,high:0};
 state.group=groups[data.group]?data.group:'low';state.floor=floors().includes(data.floor)?data.floor:groups[state.group][0];state.ref=floors().includes(data.ref)?data.ref:groups[state.group][1];
 state.selected=null;routePending=[];updateAll();save();notify('JSON 작업 파일 불러오기 완료');
 }catch(e){notify('JSON 읽기 실패: '+e.message);}
}
function wire(){
 $('lowBtn').onclick=()=>groupSet('low');$('highBtn').onclick=()=>groupSet('high');
 $('refFloor').onchange=e=>refSet(Number(e.target.value));$('workFloor').onchange=e=>floorSet(Number(e.target.value));
 $('refOpacity').oninput=e=>{state.opacityRef=Number(e.target.value)/100;$('refOpText').textContent=e.target.value+'%';draw();save();};
 $('workOpacity').oninput=e=>{state.opacityWork=Number(e.target.value)/100;$('workOpText').textContent=e.target.value+'%';draw();save();};
 for(const field of ['tx','ty','rot','scale']){const el=$(field);el.addEventListener('focus',snapshot);el.onchange=()=>{let n=Number(el.value);if(!Number.isFinite(n))return;if(field==='scale')n=Math.min(6,Math.max(.15,n));tform(state.floor)[field==='tx'?'x':field==='ty'?'y':field]=n;updateAll();save();};}
 for(const x of ['Align','Connector','Route','Door'])$('mode'+x).onclick=()=>setMode(x.toLowerCase());
 $('view2d').onclick=()=>setView('2d');$('view3d').onclick=()=>setView('3d');
 $('rotL').onclick=()=>{snapshot();tform(state.floor).rot-=1;updateAll();save();};$('rotR').onclick=()=>{snapshot();tform(state.floor).rot+=1;updateAll();save();};
 $('scaleReset').onclick=()=>{snapshot();tform(state.floor).scale=1;updateAll();save();};
 $('resetTransform').onclick=()=>{if(!confirm(state.floor+'F의 도면 이동·회전·배율만 초기화할까요?'))return;snapshot();state.transforms[state.floor]=defaultTransform(state.floor);updateAll();save();};
 $('alignAuto').onclick=autoAlign;
 $('northDeg').addEventListener('focus',snapshot);$('northDeg').onchange=e=>{state.north[state.group]=Number(e.target.value)||0;updateAll();save();};
 $('connectorKey').onchange=e=>{const o=state.connectors.find(x=>x.id===state.selected?.id);if(o){snapshot();o.key=e.target.value.trim()||o.key;renderLists();save();draw();}};
 $('connectorName').onchange=e=>{const o=state.connectors.find(x=>x.id===state.selected?.id);if(o){snapshot();o.label=e.target.value.trim()||o.label;renderLists();save();draw();}};
 $('connectorKind').onchange=e=>{const o=state.connectors.find(x=>x.id===state.selected?.id);if(o){snapshot();o.kind=e.target.value;renderLists();save();draw();}};
 $('doorName').onchange=e=>{const o=state.doors.find(x=>x.id===state.selected?.id);if(o){snapshot();o.label=e.target.value;renderLists();save();draw();}};
 $('doorType').onchange=e=>{const o=state.doors.find(x=>x.id===state.selected?.id);if(o){snapshot();o.type=e.target.value;renderLists();save();draw();}};
 $('copyShaft').onclick=cloneShaft;
 $('finishRoute').onclick=finishRoute;$('cancelRoute').onclick=()=>{routePending=[];draw();};
 $('deleteConnector').onclick=()=>eraseSelected('connectors');$('deleteRoute').onclick=()=>eraseSelected('routes');$('deleteDoor').onclick=()=>eraseSelected('doors');
 $('zoomIn').onclick=()=>{view.zoom=Math.min(2.5,view.zoom*1.2);draw();};$('zoomOut').onclick=()=>{view.zoom=Math.max(.12,view.zoom/1.2);draw();};$('fit').onclick=resetView;
 $('uploadFloor').onclick=()=>$('floorImage').click();$('uploadMany').onclick=()=>$('manyImages').click();
 $('floorImage').onchange=async e=>{await importImages([...e.target.files],false);e.target.value='';};
 $('manyImages').onchange=async e=>{await importImages([...e.target.files],true);e.target.value='';};
 $('exportBtn').onclick=exportJSON;$('importBtn').onclick=()=>$('importFile').click();
 $('importFile').onchange=async e=>{if(e.target.files[0])await importJSON(e.target.files[0]);e.target.value='';};
 $('undoBtn').onclick=undo;
 $('resetProject').onclick=()=>{if(!confirm('정렬·시설·보행동선·입구 지정을 모두 초기화할까요? 업로드 이미지 자체는 그대로 유지됩니다.'))return;snapshot();localStorage.removeItem(STORE);state.transforms={};state.connectors=[];state.routes=[];state.doors=[];state.north={low:0,high:0};state.selected=null;seedInitial();updateAll();save();};
}
function seedInitial(){
 for(const f of [...groups.low,...groups.high])tform(f);
 if(campus?.nodes?.length)for(const n of campus.nodes){if(n.type!=='vertical_connector'||!groups.low.includes(n.floor))continue;
 let kind=n.connectorType||'elevator';
 if(kind==='elevator_bank')kind='main_elevator';else if(kind==='stair')kind='stairs';else if(kind==='escalator')kind='escalator';else kind='elevator';
 const key=String(n.id).replace(/^F\d+C_/,'');
 state.connectors.push({id:uid('seed'),floor:n.floor,key,kind,label:n.connectorName||NAMES[kind],x:n.localX,y:n.localY,verified:false,source:'existing_prototype_unverified'});
 }
}
async function init(){
 wire();
 const promises=[
 fetch('/floor_geometry.json').then(x=>x.ok?x.json():null).catch(()=>null),
 fetch('/api/campus').then(x=>x.ok?x.json():null).catch(()=>null),
 openDB().catch(()=>null)
 ];
 const [g,c,d]=await Promise.all(promises);geometry=g||{};campus=c;db=d;
 let previous=null;try{previous=JSON.parse(localStorage.getItem(STORE)||'null');}catch(e){}
 if(previous?.transforms&&Array.isArray(previous.connectors)){Object.assign(state,previous);state.selected=null;}else seedInitial();
 for(const f of [...groups.low,...groups.high])tform(f);
 if(!groups[state.group])state.group='low';if(!floors().includes(state.floor))state.floor=4;if(!floors().includes(state.ref)||state.floor===state.ref)state.ref=3;
 const imageTasks=groups.low.map(f=>loadImage(f,'/floors/'+f+'F.png'));
 try{for(const [f,blob] of await listStoredImages())imageTasks.push(loadImage(f,blob));}catch(e){}
 updateAll();resize();await Promise.all(imageTasks);updateAll();$('saveStatus').textContent='이 브라우저에 자동 저장됨';
}
window.addEventListener('resize',resize);
init().catch(e=>{console.error(e);$('saveStatus').textContent='일부 데이터 로드 실패';notify('기본 도면을 불러오지 못했어요. 다시 새로고침해 주세요.');});
