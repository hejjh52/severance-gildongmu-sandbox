const $=id=>document.getElementById(id);
const LOW=[1,2,3,4,5,6],HIGH=[8,9,10,11,12,13,14,15,16,17,18,19,20];
const STORAGE='severance-pair-editor-v1', DBNAME='severance-map-images';
const COLORS={main_elevator:'#e14e51',ward_elevator:'#9658d9',elevator:'#20a9b4',landmark:'#2477b9',stairs:'#2db37d',escalator:'#e5a339'};
const ALIGNABLE=new Set(['main_elevator','ward_elevator','elevator','landmark']);
const IMG_WIDTH=992,LOW_HEIGHT=1140;
let geometry={floorCorr:{}}, assets=new Map(), regionCache=new Map(), hoverRegion={left:null,right:null}, db=null,history=[];
let S={group:'low',left:4,right:3,kind:'main_elevator',name:'MAIN-A',north:{low:0,high:0},pairs:[],transforms:{},pending:null,preview:false,alpha:.5,showRegions:true,regionMode:'room'};
let camera={left:{zoom:1,panX:0,panY:0},right:{zoom:1,panX:0,panY:0}};
let stagePointer=null,lastSide='right',saveTimeout=0,toastTimeout=0;
function floors(){return S.group==='low'?LOW:HIGH;}
function toast(txt){$('toast').textContent=txt;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function editable(){return{group:S.group,left:S.left,right:S.right,kind:S.kind,name:S.name,north:S.north,pairs:S.pairs,transforms:S.transforms,showRegions:S.showRegions,regionMode:S.regionMode};}
function snapshot(){history.push(JSON.stringify(editable()));if(history.length>35)history.shift();}
function save(){clearTimeout(saveTimeout);$('saveStatus').textContent='저장 중';saveTimeout=setTimeout(()=>{try{localStorage.setItem(STORAGE,JSON.stringify(editable()));$('saveStatus').textContent='자동 저장됨';}catch(e){$('saveStatus').textContent='저장 실패 · JSON 저장 필요';}},250);}
function fmt(n,d=1){return Number(n||0).toFixed(d);}
function escapeHtml(x){return String(x??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function uid(){return 'PAIR-'+(crypto.randomUUID?.()||Math.random().toString(36).slice(2));}
function defaults(f){const m=geometry.floorCorr?.[f];if(m){return{x:m.tx||0,y:m.tz||0,rotation:Math.atan2(m.c,m.a)*180/Math.PI,scale:Math.hypot(m.a,m.c)||1};}return{x:0,y:0,rotation:0,scale:1};}
function T(f){return S.transforms[f]||(S.transforms[f]=defaults(f));}
function world(f,p){const t=T(f),r=t.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return{x:t.x+t.scale*(c*p.x-s*p.y),y:t.y+t.scale*(s*p.x+c*p.y)};}
function asset(f){return assets.get(Number(f));}
function dimensions(f){return{x:IMG_WIDTH,y:asset(f)?.height||(f<=6?LOW_HEIGHT:450)};}
function resetCamera(){camera.left={zoom:1,panX:0,panY:0};camera.right={zoom:1,panX:0,panY:0};}
function matchPair(p){if(p.group!==S.group)return null;if(p.leftFloor===S.left&&p.rightFloor===S.right)return{...p,L:p.left,R:p.right};if(p.leftFloor===S.right&&p.rightFloor===S.left)return{...p,L:p.right,R:p.left};return null;}
function matches(){return S.pairs.map(matchPair).filter(Boolean);}
function fitting(){return matches().filter(p=>ALIGNABLE.has(p.kind));}
function imageReady(f){return !!asset(f);}
function loadImage(f,source,persist=false){
 return new Promise(resolve=>{const src=typeof source==='string'?source:URL.createObjectURL(source),img=new Image();
 img.onload=()=>{const height=f<=6?LOW_HEIGHT:IMG_WIDTH*(img.naturalHeight/img.naturalWidth);assets.set(f,{img,height,src,source:typeof source==='string'?'기본 도면':'업로드 도면'});regionCache.delete(f);if(persist)saveAsset(f,source).catch(()=>toast('이미지 저장 실패 · 원본 이미지 별도 보관'));refreshCanvas();resolve(true);};
 img.onerror=()=>{if(typeof source!=='string')URL.revokeObjectURL(src);resolve(false);};
 img.src=src;
 });
}
function openDB(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window))return reject(Error('Storage unavailable'));const request=indexedDB.open(DBNAME,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('images'))request.result.createObjectStore('images');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function saveAsset(f,file){if(!db)return Promise.resolve();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(file,String(f));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function getAssets(){if(!db)return Promise.resolve([]);return new Promise((resolve,reject)=>{const tx=db.transaction('images','readonly'),store=tx.objectStore('images');const keys=store.getAllKeys(),vals=store.getAll();tx.oncomplete=()=>resolve(keys.result.map((k,i)=>[+k,vals.result[i]]));tx.onerror=()=>reject(tx.error);});}
function parseFloor(n){let m=String(n).match(/(?:^|[^0-9])([1-9]|1\d|20)\s*(?:f|층|_F)/i);if(m)return+m[1];m=String(n).match(/^([1-9]|1\d|20)\./);return m?+m[1]:null;}
async function putFiles(files,bulk){
 let n=0;for(const file of files){if(!file.type.startsWith('image/'))continue;const f=bulk?parseFloor(file.name):(lastSide==='left'?S.left:S.right);if(!floors().includes(f))continue;if(await loadImage(f,file,true))n++;}
 update();toast(n+'개 층 도면 등록됨. 저장한 이미지는 기존 워크벤치와 공유해요.');
}

/*
 * Raster region candidates:
 *  1. Contiguous light-grey room fills bounded by thin outlines.
 *  2. Contiguous blue elevator/escalator symbol glyphs.
 *
 * These are heuristic candidates, never certified rooms or elevator cars.
 * Read the image only on demand and cache the detection per floor.
 * Stored coordinates are normalized to the existing 992px local-image width.
 */
function detectRegions(f){
 if(regionCache.has(f))return regionCache.get(f);
 const a=asset(f);if(!a)return{room:[],icon:[]};
 const scale=.78,w=Math.max(1,Math.round(IMG_WIDTH*scale)),h=Math.max(1,Math.round(a.height*scale));
 const off=document.createElement('canvas');off.width=w;off.height=h;
 const oc=off.getContext('2d',{willReadFrequently:true});oc.drawImage(a.img,0,0,w,h);
 const pix=oc.getImageData(0,0,w,h).data,n=w*h;
 const roomMask=new Uint8Array(n),iconMask=new Uint8Array(n);
 for(let i=0,j=0;i<n;i++,j+=4){
  const r=pix[j],g=pix[j+1],b=pix[j+2];
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  // Hospital raster plans use neutral pale grey for room/compartment fills.
  if(r>=218&&r<=248&&g>=220&&g<=250&&b>=221&&b<=251&&max-min<=7)roomMask[i]=1;
  // Dominant dark/bright blue arrows inside elevator icon rectangles.
  if(r<75&&g>=36&&g<193&&b>142&&b>g+25&&b>r+70)iconMask[i]=1;
 }
 const identify=(mask,type)=>{
  const visited=new Uint8Array(n),queue=new Int32Array(n),results=[];
  for(let start=0;start<n;start++){
   if(!mask[start]||visited[start])continue;
   visited[start]=1;queue[0]=start;
   let head=0,tail=1,minx=w,miny=h,maxx=0,maxy=0,area=0;
   while(head<tail){
    const at=queue[head++],x=at%w,y=(at-x)/w;
    area++;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;
    const neighbors=[x>0?at-1:-1,x+1<w?at+1:-1,y>0?at-w:-1,y+1<h?at+w:-1];
    for(let t=0;t<4;t++){const nb=neighbors[t];if(nb>=0&&mask[nb]&&!visited[nb]){visited[nb]=1;queue[tail++]=nb;}}
   }
   const bw=maxx-minx+1,bh=maxy-miny+1,density=area/(bw*bh);
   if(type==='room'){
    if(bw<10||bh<9||bw>w*.78||bh>h*.65||area<125||bw*bh>n*.30||density<.68)continue;
    if(Math.max(bw/bh,bh/bw)>14)continue;
   }else{
    if(bw<5||bh<5||bw>34||bh>34||area<15||density<.11)continue;
    if(Math.max(bw/bh,bh/bw)>1.95)continue;
   }
   const factor=1/scale;
   results.push({kind:type,x:minx*factor,y:miny*factor,w:bw*factor,h:bh*factor,
     cx:(minx+bw/2)*factor,cy:(miny+bh/2)*factor,rectangularity:Math.round(density*100)/100});
  }
  // Avoid overwhelming the UI with tiny irrelevant fragments.
  return results.sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,type==='room'?250:130);
 };
 const regions={room:identify(roomMask,'room'),icon:identify(iconMask,'icon')};
 regionCache.set(f,regions);return regions;
}
function regionAt(side,pt){
 if(S.regionMode==='off'||!S.showRegions)return null;
 const f=S[side],all=detectRegions(f);
 const order=S.regionMode==='icon'?['icon','room']:S.regionMode==='room'?['room','icon']:['icon','room'];
 const hits=[];
 for(const type of order)for(const r of all[type]){
  const pad=type==='room'?3:5;
  if(pt.x>=r.x-pad&&pt.x<=r.x+r.w+pad&&pt.y>=r.y-pad&&pt.y<=r.y+r.h+pad)
   hits.push({...r,priority:order.indexOf(type)});
 }
 hits.sort((a,b)=>a.priority-b.priority||a.w*a.h-b.w*b.h);
 return hits[0]||null;
}
function selectedRegionPoint(side,pt){
 const r=regionAt(side,pt);
 if(!r)return{xy:pt,region:null};
 return{xy:{x:r.cx,y:r.cy},region:{kind:r.kind,x:r.x,y:r.y,w:r.w,h:r.h,rectangularity:r.rectangularity}};
}
function drawDetected(g,p,side){
 if(!S.showRegions||S.regionMode==='off')return;
 const regions=detectRegions(S[side]);
 const types=S.regionMode==='room'?['room']:S.regionMode==='icon'?['icon']:['room','icon'];
 g.save();g.lineWidth=1;
 for(const type of types){
  const color=type==='room'?'#15a181':'#e7a632';
  g.strokeStyle=color;g.globalAlpha=type==='room'?.42:.65;
  for(const r of regions[type])g.strokeRect(p.ox+r.x*p.scale,p.oy+r.y*p.scale,r.w*p.scale,r.h*p.scale);
 }
 g.restore();
 const r=hoverRegion[side];if(r&&types.includes(r.kind)){
  const x=p.ox+r.x*p.scale,y=p.oy+r.y*p.scale;
  g.save();g.strokeStyle='#f18d20';g.lineWidth=3;g.setLineDash([5,3]);g.strokeRect(x,y,r.w*p.scale,r.h*p.scale);
  g.setLineDash([]);g.fillStyle='#fbf8ed';g.fillRect(x,y-20,Math.min(125,r.w*p.scale+55),18);
  g.fillStyle='#9a6013';g.font='bold 10px sans-serif';g.fillText(r.kind==='room'?'네모 구획':'시설 아이콘',x+5,y-7);g.restore();
 }
}

function paneInfo(side){const c=$(side+'Canvas'),r=c.getBoundingClientRect(),D=dimensions(S[side]);const w=Math.max(2,r.width),h=Math.max(2,r.height);const v=camera[side],scale=Math.min((w-32)/D.x,(h-32)/D.y)*v.zoom;return{c,w,h,v,D,scale,ox:(w-D.x*scale)/2+v.panX,oy:(h-D.y*scale)/2+v.panY};}
function screenLocal(side,x,y){const p=paneInfo(side);return{x:(x-p.ox)/p.scale,y:(y-p.oy)/p.scale};}
function localScreen(p,point){return{x:p.ox+point.x*p.scale,y:p.oy+point.y*p.scale};}
function setupCanvas(c){const r=c.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);c.width=Math.max(2,Math.floor(r.width*dpr));c.height=Math.max(2,Math.floor(r.height*dpr));const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);return{g,w:r.width,h:r.height};}
function marker(g,x,y,index,color){
 g.save();g.beginPath();g.arc(x,y,10,0,Math.PI*2);g.fillStyle='#fff';g.fill();g.strokeStyle=color;g.lineWidth=3;g.stroke();g.fillStyle=color;g.font='bold 11px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(index,x,y+0.5);g.restore();
}
function drawPane(side){
 const p=paneInfo(side),{g,w,h}=setupCanvas(p.c);g.fillStyle='#e9f1f8';g.fillRect(0,0,w,h);g.save();
 g.strokeStyle='#d6e2ed';g.lineWidth=1;for(let x=0;x<w;x+=35){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}for(let y=0;y<h;y+=35){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
 const a=asset(S[side]);
 if(a)g.drawImage(a.img,p.ox,p.oy,p.D.x*p.scale,p.D.y*p.scale);
 else{g.fillStyle='#ffffffc9';g.fillRect(16,16,w-32,h-32);g.fillStyle='#607992';g.font='bold 14px system-ui';g.textAlign='center';g.fillText(S[side]+'층 도면을 먼저 업로드하세요',w/2,h/2);}
 g.strokeStyle=side==='left'?'#2c82c8':'#d98740';g.lineWidth=2;g.strokeRect(p.ox,p.oy,p.D.x*p.scale,p.D.y*p.scale);
 if(a)drawDetected(g,p,side);
 matches().forEach((match,i)=>{const v=localScreen(p,side==='left'?match.L:match.R);marker(g,v.x,v.y,i+1,COLORS[match.kind]);});
 if(S.pending&&side==='left'){const v=localScreen(p,S.pending.xy);marker(g,v.x,v.y,matches().length+1,'#139d91');}
 if(!a){g.fillStyle='#607992';g.textAlign='center';g.font='11px system-ui';g.fillText('선택한 층 이미지는 "도면 업로드"로 추가',w/2,h/2+21);}
 g.restore();
}
function overlayDraw(){
 const canvas=$('previewCanvas');const{g,w,h}=setupCanvas(canvas);g.fillStyle='#e7eff6';g.fillRect(0,0,w,h);
 const floors2=[S.left,S.right], corners=[];
 for(const f of floors2){const d=dimensions(f);for(const p of [{x:0,y:0},{x:d.x,y:0},{x:d.x,y:d.y},{x:0,y:d.y}])corners.push(world(f,p));}
 let xmin=Math.min(...corners.map(p=>p.x)),xmax=Math.max(...corners.map(p=>p.x)),ymin=Math.min(...corners.map(p=>p.y)),ymax=Math.max(...corners.map(p=>p.y));
 let sc=Math.min((w-40)/Math.max(1,xmax-xmin),(h-40)/Math.max(1,ymax-ymin)),ox=(w-(xmax-xmin)*sc)/2,oy=(h-(ymax-ymin)*sc)/2;
 const worldScreen=p=>({x:ox+(p.x-xmin)*sc,y:oy+(p.y-ymin)*sc});
 for(const side of ['left','right']){
 const f=S[side],t=T(f),d=dimensions(f),a=asset(f),origin=worldScreen(world(f,{x:0,y:0})),r=t.rotation*Math.PI/180;
 g.save();g.translate(origin.x,origin.y);g.rotate(r);g.scale(sc*t.scale,sc*t.scale);
 g.fillStyle=side==='left'?'#95c8ea50':'#e8ab8d50';g.fillRect(0,0,d.x,d.y);
 if(a){g.globalAlpha=side==='left'?S.alpha:1-S.alpha;g.drawImage(a.img,0,0,d.x,d.y);g.globalAlpha=1;}
 g.strokeStyle=side==='left'?'#156fbb':'#d87b32';g.lineWidth=2/(sc*t.scale);g.strokeRect(0,0,d.x,d.y);g.restore();
 }
 matches().forEach((p,i)=>{const a=worldScreen(world(S.left,p.L)),b=worldScreen(world(S.right,p.R)),color=COLORS[p.kind];
 g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineWidth=2;g.strokeStyle=color;g.stroke();marker(g,a.x,a.y,i+1,color);marker(g,b.x,b.y,i+1,color);});
}
function refreshCanvas(){requestAnimationFrame(()=>{drawPane('left');drawPane('right');if(S.preview)overlayDraw();});}
function updateHint(){
 const pending=!!S.pending;const name=$('pointName').value.trim()||'선택한 시설';const f=S.left,r=S.right;
 const tip=pending?'② '+r+'층 지도에서 '+name+'의 대응 위치를 클릭하세요.':'① '+f+'층 지도에서 '+name+'의 중심 또는 출입구를 클릭하세요.';
 $('stageHint').textContent=tip;$('stageHint').classList.toggle('wait',pending);$('stageHint').classList.toggle('ready',!pending);
 $('rightFoot').textContent=pending?'② 오른쪽에서 대응 위치 선택':'클릭할 준비가 됐어요';
 $('leftFoot').textContent=pending?'왼쪽 점 지정 완료':'① 왼쪽 먼저 선택';
}
function errorFor(m){const a=world(S.left,m.L),b=world(S.right,m.R);return Math.hypot(a.x-b.x,a.y-b.y);}
function update(){
 const groupFloors=floors();$('lowBtn').classList.toggle('active',S.group==='low');$('highBtn').classList.toggle('active',S.group==='high');
 for(const side of ['left','right']){$(side+'Floor').innerHTML=groupFloors.map(f=>'<option value="'+f+'">'+f+'층'+(!asset(f)?' · 도면 없음':'')+'</option>').join('');$(side+'Floor').value=S[side];}
 $('leftTitle').textContent=S.left+'층 · 기준';$('rightTitle').textContent=S.right+'층 · 연결';$('pairTitle').textContent=S.left+'F ↔ '+S.right+'F';
 $('kind').value=S.kind;$('pointName').value=S.name;$('north').value=S.north[S.group]??0;
 $('regionMode').value=S.regionMode||'room';$('regionToggle').textContent=S.showRegions?'▣ 인식 구역 켜짐':'▣ 인식 구역 꺼짐';$('regionToggle').classList.toggle('primary',!!S.showRegions);
 $('previewBtn').textContent=S.preview?'좌우 도면으로 돌아가기':'반투명 겹쳐보기';$('mapRow').hidden=S.preview;$('previewPane').hidden=!S.preview;
 $('typeHelp').textContent=ALIGNABLE.has(S.kind)?'같은 시설의 수평 위치가 일치해야 해요. 자동 정렬의 기준으로 사용합니다.':'계단이나 에스컬레이터는 층별 출발·도착 위치가 달라도 돼요. 서로 연결만 기록하고 정렬 계산에는 쓰지 않습니다.';
 const m=matches(),fit=fitting();$('pairCount').textContent=m.length+'개';$('fitCount').textContent=fit.length+'개';
 $('fitError').textContent=fit.length?fmt(fit.reduce((s,x)=>s+errorFor(x),0)/fit.length)+' 지도 단위':'—';
 $('alignBtn').disabled=!fit.length;
 $('alignHelp').textContent=fit.length===0?'엘리베이터 또는 같은 벽·기둥 구획을 한 쌍 이상 선택하세요.':fit.length===1?'기준 1개: 우선 위치를 맞춥니다. 동일한 실제 네모 구획이라면 변 길이로 배율도 추정할 수 있습니다.':'기준 '+fit.length+'개: 구획 중심 간 거리로 이동·회전·배율을 계산합니다. 멀리 떨어진 두 곳이 좋아요.';
 $('pairList').innerHTML=m.length?m.map((p,i)=>'<div class="item"><div class="count">'+(i+1)+'</div><div class="desc"><b>'+escapeHtml(p.name)+'</b><small>'+escapeHtml(p.kind)+' · '+(p.leftRegion&&p.rightRegion?'양쪽 구역 인식됨':'직접 위치 지정')+' · 오차 '+fmt(errorFor(p))+'</small></div><button data-id="'+escapeHtml(p.id)+'" aria-label="연결점 삭제">삭제</button></div>').join(''):'<div class="empty">아직 찍은 연결점이 없어요.</div>';
 $('pairList').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{snapshot();S.pairs=S.pairs.filter(p=>p.id!==b.dataset.id);update();save();});
 updateHint();refreshCanvas();
}
function pairClick(side,xy){
 lastSide=side;if(S.preview)return;
 if(!asset(S[side])){toast('먼저 이 층의 도면 이미지를 업로드하세요.');return;}
 if(side==='left'){const chosen=selectedRegionPoint('left',xy);S.pending={xy:chosen.xy,region:chosen.region,name:$('pointName').value.trim()||S.kind,kind:S.kind};updateHint();refreshCanvas();return;}
 if(!S.pending){toast('먼저 왼쪽 지도에 위치를 찍어 주세요.');return;}
 const p=S.pending;
 const chosen=selectedRegionPoint('right',xy);
 if(S.pairs.some(x=>{const m=matchPair(x);return m&&m.name===p.name&&m.kind===p.kind;})){toast('이미 같은 이름의 연결점이 있습니다. 목록에서 삭제하거나 이름을 바꿔주세요.');return;}
 snapshot();S.pairs.push({id:uid(),group:S.group,leftFloor:S.left,rightFloor:S.right,kind:p.kind,name:p.name,left:p.xy,right:chosen.xy,leftRegion:p.region||null,rightRegion:chosen.region||null,confirmedByUser:true,createdAt:new Date().toISOString()});S.pending=null;update();save();toast('한 쌍의 연결점 저장 완료');
}
function autoAlign(){
 const pts=fitting();if(!pts.length)return;const f=S.right;const old=T(f),targets=pts.map(p=>world(S.left,p.L)),sources=pts.map(p=>p.R);
 snapshot();
 if(pts.length===1){
  // One real structural rectangle can provide a scale estimate.
  // Blue icon dimensions are screen symbols and must NOT set map scale.
  const pair=pts[0],l=pair.leftRegion,r=pair.rightRegion;
  if(l?.kind==='room'&&r?.kind==='room'&&l.w>8&&l.h>8&&r.w>8&&r.h>8){
    const rl=l.w/r.w,rh=l.h/r.h;
    if(Math.abs(rl-rh)/Math.max(rl,rh)<.17){
      old.scale=T(S.left).scale*Math.sqrt(rl*rh);
      // Keep existing rotation: a single axis-aligned box cannot reliably determine north.
    }
  }
  const current=world(f,sources[0]);
  old.x+=targets[0].x-current.x;old.y+=targets[0].y-current.y;
 }
 else{
 const a={x:sources.reduce((s,p)=>s+p.x,0)/pts.length,y:sources.reduce((s,p)=>s+p.y,0)/pts.length};
 const b={x:targets.reduce((s,p)=>s+p.x,0)/pts.length,y:targets.reduce((s,p)=>s+p.y,0)/pts.length};
 let dot=0,cross=0,den=0;for(let i=0;i<pts.length;i++){const x=sources[i].x-a.x,y=sources[i].y-a.y,X=targets[i].x-b.x,Y=targets[i].y-b.y;dot+=x*X+y*Y;cross+=x*Y-y*X;den+=x*x+y*y;}
 if(den<200){const curr=world(f,sources[0]);old.x+=targets[0].x-curr.x;old.y+=targets[0].y-curr.y;toast('기준점 간 거리가 짧아 위치만 정렬했어요.');}
 else{const r=Math.atan2(cross,dot),sc=Math.hypot(dot,cross)/den;
 if(sc<.35||sc>3.5){history.pop();toast('기준점이 일관되지 않아 배율 계산을 취소했어요.');return;}
 old.rotation=r*180/Math.PI;old.scale=sc;old.x=b.x-sc*(Math.cos(r)*a.x-Math.sin(r)*a.y);old.y=b.y-sc*(Math.sin(r)*a.x+Math.cos(r)*a.y);
 }}
 update();save();toast('오른쪽 '+S.right+'층 정렬 결과 반영 완료. 겹쳐보기에서 확인하세요.');
}
function exportJSON(){
 const payload={schema:'severance-two-floor-pairs-v1',exportedAt:new Date().toISOString(),comment:'1–6F and 8–20F separate. 7F excluded. Coordinates are in logical map image units, not surveyed meters. Elevator/landmark anchors align XY; stairs/escalators record paired endpoints.',...editable(),imageFloors:[...assets.keys()].sort((a,b)=>a-b)};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='severance-floor-pairs-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('JSON 저장 완료 · 지도 이미지 파일은 별도 보관해 주세요.');
}
async function importJSON(file){
 try{const p=JSON.parse(await file.text());
 if(p.schema!=='severance-two-floor-pairs-v1'||!Array.isArray(p.pairs)||!p.transforms)throw Error('지원하지 않는 편집기 JSON입니다.');
 snapshot();S.group=p.group==='high'?'high':'low';S.left=p.left;S.right=p.right;S.north=p.north||{low:0,high:0};S.pairs=p.pairs;S.transforms=p.transforms;
 if(!floors().includes(S.left))S.left=floors()[0];if(!floors().includes(S.right)||S.left===S.right)S.right=floors()[1];
 S.pending=null;S.preview=false;resetCamera();update();save();toast('JSON 불러오기 완료');
 }catch(e){toast('불러오기 실패: '+e.message);}
}
function undo(){const s=history.pop();if(!s)return toast('되돌릴 작업이 없어요.');Object.assign(S,JSON.parse(s));S.pending=null;update();save();toast('마지막 작업 되돌림');}
function setGroup(g){if(g===S.group)return;S.group=g;S.left=g==='low'?4:8;S.right=g==='low'?3:9;S.pending=null;S.preview=false;resetCamera();update();save();}
function setFloor(side,f){if(!floors().includes(f))return;S[side]=f;if(S.left===S.right)S[side==='left'?'right':'left']=floors().find(x=>x!==f);S.pending=null;S.preview=false;resetCamera();update();save();}
function resetPairCamera(){resetCamera();refreshCanvas();}
function wireCanvas(side){
 const c=$(side+'Canvas');
 c.addEventListener('pointerdown',e=>{if(e.button!==0)return;c.setPointerCapture(e.pointerId);stagePointer={side,pointerId:e.pointerId,start:{x:e.offsetX,y:e.offsetY},last:{x:e.clientX,y:e.clientY},move:0,pan:e.shiftKey};lastSide=side;});
 c.addEventListener('pointermove',e=>{
  if(!stagePointer){
    if(S.showRegions&&S.regionMode!=='off'&&!S.preview){
      const r=c.getBoundingClientRect(),pt=screenLocal(side,e.clientX-r.left,e.clientY-r.top);
      const candidate=regionAt(side,pt);
      if(candidate!==hoverRegion[side]){hoverRegion[side]=candidate;refreshCanvas();}
    }
    return;
  }
  const p=stagePointer;if(p.side!==side)return;const dx=e.clientX-p.last.x,dy=e.clientY-p.last.y;p.move+=Math.hypot(dx,dy);p.last={x:e.clientX,y:e.clientY};if(p.pan){camera[side].panX+=dx;camera[side].panY+=dy;refreshCanvas();}});
 c.addEventListener('pointerup',e=>{const p=stagePointer;if(!p||p.side!==side)return;stagePointer=null;if(p.pan||p.move>6)return;const r=c.getBoundingClientRect();pairClick(side,screenLocal(side,e.clientX-r.left,e.clientY-r.top));});
 c.addEventListener('pointercancel',()=>stagePointer=null);
 c.addEventListener('pointerleave',()=>{hoverRegion[side]=null;refreshCanvas();});
 c.addEventListener('wheel',e=>{e.preventDefault();const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
 const local=screenLocal(side,x,y),cam=camera[side];cam.zoom=Math.max(.5,Math.min(9,cam.zoom*(e.deltaY<0?1.15:1/1.15)));
 const p=paneInfo(side);cam.panX+=x-(p.ox+local.x*p.scale);cam.panY+=y-(p.oy+local.y*p.scale);refreshCanvas();},{passive:false});
}
function wire(){
 $('lowBtn').onclick=()=>setGroup('low');$('highBtn').onclick=()=>setGroup('high');
 $('leftFloor').onchange=e=>setFloor('left',Number(e.target.value));$('rightFloor').onchange=e=>setFloor('right',Number(e.target.value));
 $('swapBtn').onclick=()=>{[S.left,S.right]=[S.right,S.left];S.pending=null;hoverRegion={left:null,right:null};resetPairCamera();update();save();};
 $('regionToggle').onclick=()=>{S.showRegions=!S.showRegions;hoverRegion={left:null,right:null};update();save();};
 $('regionMode').onchange=e=>{S.regionMode=e.target.value;S.showRegions=S.regionMode!=='off';hoverRegion={left:null,right:null};update();save();};
 $('kind').onchange=e=>{S.kind=e.target.value;S.pending=null;if(ALIGNABLE.has(S.kind)&&(!S.name||S.name==='STAIR-1'||S.name==='ESC-1'))S.name='MAIN-A';if(S.kind==='stairs'&&S.name==='MAIN-A')S.name='STAIR-1';if(S.kind==='escalator'&&S.name==='MAIN-A')S.name='ESC-1';update();save();};
 $('pointName').oninput=e=>{S.name=e.target.value;save();};$('cancelPending').onclick=()=>{S.pending=null;updateHint();refreshCanvas();};
 $('undoBtn').onclick=undo;$('alignBtn').onclick=autoAlign;
 $('previewBtn').onclick=()=>{S.preview=!S.preview;update();};$('closePreview').onclick=()=>{S.preview=false;update();};
 $('alpha').oninput=e=>{S.alpha=Number(e.target.value)/100;refreshCanvas();};
 $('north').onchange=e=>{S.north[S.group]=Number(e.target.value)||0;save();};
 $('zoomIn').onclick=()=>{for(const c of Object.values(camera))c.zoom=Math.min(9,c.zoom*1.2);refreshCanvas();};
 $('zoomOut').onclick=()=>{for(const c of Object.values(camera))c.zoom=Math.max(.5,c.zoom/1.2);refreshCanvas();};
 $('fitBtn').onclick=resetPairCamera;
 $('uploadBtn').onclick=()=>$('uploadInput').click();$('bulkBtn').onclick=()=>$('bulkInput').click();
 $('uploadInput').onchange=async e=>{await putFiles([...e.target.files],false);e.target.value='';};
 $('bulkInput').onchange=async e=>{await putFiles([...e.target.files],true);e.target.value='';};
 $('exportBtn').onclick=exportJSON;$('importBtn').onclick=()=>$('importFile').click();
 $('importFile').onchange=async e=>{if(e.target.files[0])await importJSON(e.target.files[0]);e.target.value='';};
 wireCanvas('left');wireCanvas('right');
 window.addEventListener('resize',refreshCanvas);
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.pending){S.pending=null;updateHint();refreshCanvas();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}});
}
async function boot(){
 wire();const [g,storage]=await Promise.all([
 fetch('/floor_geometry.json').then(r=>r.ok?r.json():{}).catch(()=>({})),
 openDB().catch(()=>null)
 ]);
 geometry=g||{};db=storage;
 try{const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');if(saved&&Array.isArray(saved.pairs)&&saved.transforms)Object.assign(S,saved);}catch(e){}
 if(!['low','high'].includes(S.group))S.group='low';
 if(!floors().includes(S.left))S.left=floors()[0];if(!floors().includes(S.right)||S.left===S.right)S.right=floors()[1];
 for(const f of LOW.concat(HIGH))T(f);
 const tasks=LOW.map(f=>loadImage(f,'/floors/'+f+'F.png'));
 try{for(const [f,blob] of await getAssets())if(LOW.includes(f)||HIGH.includes(f))tasks.push(loadImage(f,blob));}catch(e){console.warn('Stored image loading failed',e);}
 await Promise.all(tasks);update();$('saveStatus').textContent='자동 저장됨';
}
boot().catch(e=>{console.error(e);toast('편집기 초기화 중 일부 오류가 발생했어요.');$('saveStatus').textContent='데이터 불러오기 실패';});
