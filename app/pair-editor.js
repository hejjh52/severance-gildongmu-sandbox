const $=id=>document.getElementById(id);
const LOW=[1,2,3,4,5,6],HIGH=[8,9,10,11,12,13,14,15,16,17,18,19,20];
const STORAGE='severance-pair-editor-v1', DBNAME='severance-map-images';
const COLORS={main_elevator:'#e14e51',ward_elevator:'#9658d9',elevator:'#20a9b4',landmark:'#2477b9',stairs:'#2db37d',escalator:'#e5a339'};
const ALIGNABLE=new Set(['main_elevator','ward_elevator','elevator','landmark']);
const IMG_WIDTH=992,LOW_HEIGHT=1140;
let geometry={floorCorr:{}}, assets=new Map(), regionCache=new Map(), hoverRegion={left:null,right:null}, manualDraft=null, db=null,history=[];
let S={group:'low',left:4,right:3,kind:'main_elevator',name:'MAIN-A',north:{low:0,high:0},pairs:[],transforms:{},pending:null,preview:false,alpha:.5,showRegions:true,regionMode:'all',manualBoxes:{},migrationV2:false};
let camera={left:{zoom:1,panX:0,panY:0},right:{zoom:1,panX:0,panY:0}};
let stagePointer=null,lastSide='right',saveTimeout=0,toastTimeout=0;
function floors(){return S.group==='low'?LOW:HIGH;}
function toast(txt){$('toast').textContent=txt;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function editable(){return{group:S.group,left:S.left,right:S.right,kind:S.kind,name:S.name,north:S.north,pairs:S.pairs,transforms:S.transforms,showRegions:S.showRegions,regionMode:S.regionMode,manualBoxes:S.manualBoxes,migrationV2:S.migrationV2};}
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
function matchPair(p){if(p.group!==S.group)return null;if(p.leftFloor===S.left&&p.rightFloor===S.right)return{...p,L:p.left,R:p.right};if(p.leftFloor===S.right&&p.rightFloor===S.left)return{...p,L:p.right,R:p.left,leftRegion:p.rightRegion||null,rightRegion:p.leftRegion||null};return null;}
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
 * Multi-source map segmentation:
 * 1. enclosed light / white compartments separated by drawn wall outlines
 * 2. pale gray compartment fills
 * 3. blue icon candidates
 * 4. persistent user-drawn rectangles for missing/open compartments
 * Candidates are provisional selections, NOT verified building geometry.
 */
function detectRegions(f){
 if(regionCache.has(f))return regionCache.get(f);
 const a=asset(f);
 if(!a)return {bounded:[],room:[],icon:[],idMap:null,byId:new Map(),sampleScale:1,w:0,h:0};
 // Retain thin (1-pixel) boundaries; earlier aggressive morphology lost narrow cells.
 const ss=.85,w=Math.max(1,Math.round(IMG_WIDTH*ss)),h=Math.max(1,Math.round(a.height*ss)),N=w*h;
 const off=document.createElement('canvas');off.width=w;off.height=h;
 const c=off.getContext('2d',{willReadFrequently:true});c.drawImage(a.img,0,0,w,h);
 const px=c.getImageData(0,0,w,h).data;
 const wall=new Uint8Array(N),grey=new Uint8Array(N),blue=new Uint8Array(N);
 for(let i=0,j=0;i<N;i++,j+=4){
  const r=px[j],g=px[j+1],b=px[j+2],max=Math.max(r,g,b),min=Math.min(r,g,b),lum=.299*r+.587*g+.114*b;
  // Fine gray structural lines are ~#ccc; light gray room fills are ~#eff1f2.
  if(lum<229 || (max-min>35&&lum<246))wall[i]=1;
  if(r>=216&&r<=249&&g>=216&&g<=251&&b>=218&&b<=253&&max-min<=13)grey[i]=1;
  if(r<90&&g>=36&&g<198&&b>141&&b>g+20&&b>r+65)blue[i]=1;
 }
 const maskComponents=(mask,type)=>{
  const visited=new Uint8Array(N),queue=new Int32Array(N),list=[];
  for(let seed=0;seed<N;seed++){
   if(!mask[seed]||visited[seed])continue;
   let front=0,back=1,area=0,xmin=w,ymin=h,xmax=0,ymax=0;
   queue[0]=seed;visited[seed]=1;
   while(front<back){
    const index=queue[front++],x=index%w,y=(index-x)/w;
    area++;xmin=Math.min(xmin,x);ymin=Math.min(ymin,y);xmax=Math.max(xmax,x);ymax=Math.max(ymax,y);
    const nbs=[x>0?index-1:-1,x+1<w?index+1:-1,y>0?index-w:-1,y+1<h?index+w:-1];
    for(const next of nbs){if(next<0||visited[next]||!mask[next])continue;visited[next]=1;queue[back++]=next;}
   }
   const bw=xmax-xmin+1,bh=ymax-ymin+1,dens=area/(bw*bh);
   if(type==='room'){
    if(bw<6||bh<5||area<50||bw>w*.88||bh>h*.82||dens<.39)continue;
   }else{
    if(bw<4||bh<4||bw>38||bh>38||area<11||dens<.10)continue;
   }
   list.push({kind:type,x:xmin/ss,y:ymin/ss,w:bw/ss,h:bh/ss,cx:(xmin+xmax+1)/(2*ss),cy:(ymin+ymax+1)/(2*ss),rectangularity:dens});
  }
  return list;
 };
 // Connected components of pixels NOT occupied by walls. A single component
 // is one closed internal compartment, whether its interior is white or gray.
 const seen=new Uint8Array(N),labels=new Uint32Array(N),q=new Int32Array(N),bounded=[],byId=new Map();
 let id=0;
 for(let seed=0;seed<N;seed++){
  if(wall[seed]||seen[seed])continue;
  ++id;let front=0,back=1,area=0,xmin=w,ymin=h,xmax=0,ymax=0,sumx=0,sumy=0,touches=false;
  seen[seed]=1;labels[seed]=id;q[0]=seed;
  while(front<back){
   const at=q[front++],x=at%w,y=(at-x)/w;
   ++area;sumx+=x;sumy+=y;
   if(x<xmin)xmin=x;if(x>xmax)xmax=x;if(y<ymin)ymin=y;if(y>ymax)ymax=y;
   if(x===0||y===0||x===w-1||y===h-1)touches=true;
   if(x>0){const k=at-1;if(!wall[k]&&!seen[k]){seen[k]=1;labels[k]=id;q[back++]=k;}}
   if(x+1<w){const k=at+1;if(!wall[k]&&!seen[k]){seen[k]=1;labels[k]=id;q[back++]=k;}}
   if(y>0){const k=at-w;if(!wall[k]&&!seen[k]){seen[k]=1;labels[k]=id;q[back++]=k;}}
   if(y+1<h){const k=at+w;if(!wall[k]&&!seen[k]){seen[k]=1;labels[k]=id;q[back++]=k;}}
  }
  const bw=xmax-xmin+1,bh=ymax-ymin+1;
  if(touches||area<40||bw<5||bh<5||bw>w*.94||bh>h*.88)continue;
  const d=area/(bw*bh);if(d<.12)continue;
  const obj={kind:'bounded',id,x:xmin/ss,y:ymin/ss,w:bw/ss,h:bh/ss,cx:sumx/area/ss,cy:sumy/area/ss,rectangularity:d};
  bounded.push(obj);byId.set(id,obj);
 }
 const result={bounded,room:maskComponents(grey,'room'),icon:maskComponents(blue,'icon'),idMap:labels,byId,sampleScale:ss,w,h};
 regionCache.set(f,result);return result;
}
function customRegions(f){return S.manualBoxes?.[String(f)]||[];}
function allCandidateTypes(){
 if(S.regionMode==='off')return [];
 if(S.regionMode==='icon')return ['manual','icon'];
 if(S.regionMode==='room')return ['manual','room','bounded'];
 if(S.regionMode==='bounded')return ['manual','bounded'];
 return ['manual','bounded','room','icon'];
}
function enclosedAt(regions,pt){
 if(!regions.idMap)return null;
 let px=Math.round(pt.x*regions.sampleScale),py=Math.round(pt.y*regions.sampleScale);
 const scan=(x,y)=>x>=0&&y>=0&&x<regions.w&&y<regions.h?regions.byId.get(regions.idMap[y*regions.w+x]):null;
 let found=scan(px,py);if(found)return found;
 // Clicking right on the thin wall is common: scan nearest pixels.
 for(let radius=1;radius<=4;radius++)for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;found=scan(px+dx,py+dy);if(found)return found;
 }
 return null;
}
function regionAt(side,pt){
 if(!S.showRegions||S.regionMode==='off')return null;
 const f=S[side],regions=detectRegions(f),types=allCandidateTypes(),hits=[];
 for(const type of types){
  if(type==='bounded'){const p=enclosedAt(regions,pt);if(p)hits.push({...p,priority:types.indexOf(type)});continue;}
  const collection=type==='manual'?customRegions(f):regions[type]||[];
  for(const r of collection){
   const padding=type==='icon'?3:1;
   if(pt.x>=r.x-padding&&pt.x<=r.x+r.w+padding&&pt.y>=r.y-padding&&pt.y<=r.y+r.h+padding)
    hits.push({...r,priority:types.indexOf(type)});
  }
 }
 hits.sort((a,b)=>a.priority-b.priority||a.w*a.h-b.w*b.h);
 return hits[0]||null;
}
function selectedRegionPoint(side,pt){
 const r=regionAt(side,pt);
 if(!r)return{xy:pt,region:null};
 return{xy:{x:r.cx,y:r.cy},region:{kind:r.kind,x:r.x,y:r.y,w:r.w,h:r.h,rectangularity:r.rectangularity,source:r.kind==='manual'?'user':'detector'}};
}
function drawDetected(g,p,side){
 if(!S.showRegions||S.regionMode==='off')return;
 const regions=detectRegions(S[side]),types=allCandidateTypes();
 g.save();g.lineWidth=1;
 for(const type of types){
  const arr=type==='manual'?customRegions(S[side]):regions[type]||[];
  g.strokeStyle={manual:'#d85caa',bounded:'#32a07c',room:'#4b81c7',icon:'#dcb238'}[type];
  g.globalAlpha={manual:.85,bounded:.55,room:.38,icon:.65}[type];
  for(const r of arr)g.strokeRect(p.ox+r.x*p.scale,p.oy+r.y*p.scale,r.w*p.scale,r.h*p.scale);
 }
 g.restore();
 const r=hoverRegion[side];if(r){
  const x=p.ox+r.x*p.scale,y=p.oy+r.y*p.scale;
  g.save();g.strokeStyle='#f18d20';g.lineWidth=3;g.setLineDash([5,3]);g.strokeRect(x,y,r.w*p.scale,r.h*p.scale);g.setLineDash([]);
  g.fillStyle='#fbf8ed';g.fillRect(x,y-20,Math.min(125,r.w*p.scale+55),18);
  g.fillStyle='#9a6013';g.font='bold 10px sans-serif';g.fillText(r.kind==='bounded'?'흰색/회색 구획':r.kind==='manual'?'직접 지정한 구획':r.kind==='room'?'채워진 구획':'시설 아이콘',x+5,y-7);g.restore();
 }
 if(manualDraft?.side===side){
  const r=manualDraft.rect;
  g.save();g.strokeStyle='#d45191';g.lineWidth=2.5;g.setLineDash([6,4]);g.strokeRect(p.ox+r.x*p.scale,p.oy+r.y*p.scale,r.w*p.scale,r.h*p.scale);g.restore();
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
 $('cleanupStatus').textContent='이전 저장 연결 정리는 이 브라우저에만 적용됩니다. 목록에서 개별 삭제도 가능해요.';

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
  if(['room','bounded'].includes(l?.kind)&&l?.kind===r?.kind&&l.rectangularity>.7&&r.rectangularity>.7&&l.w>8&&l.h>8&&r.w>8&&r.h>8){
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
 c.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  c.setPointerCapture(e.pointerId);
  const r=c.getBoundingClientRect(),start=screenLocal(side,e.clientX-r.left,e.clientY-r.top);
  const box=S.regionMode==='box'&&!e.shiftKey;
  stagePointer={side,pointerId:e.pointerId,start,last:{x:e.clientX,y:e.clientY},move:0,pan:e.shiftKey,box};
  if(box){manualDraft={side,rect:{x:start.x,y:start.y,w:0,h:0},start};refreshCanvas();}
  lastSide=side;
 });
 c.addEventListener('pointermove',e=>{
  if(!stagePointer){
    if(S.showRegions&&S.regionMode!=='off'&&!S.preview){
      const r=c.getBoundingClientRect(),pt=screenLocal(side,e.clientX-r.left,e.clientY-r.top);
      const candidate=regionAt(side,pt);
      if((candidate?.id??'')!==(hoverRegion[side]?.id??'')||candidate?.kind!==hoverRegion[side]?.kind||candidate?.x!==hoverRegion[side]?.x||candidate?.y!==hoverRegion[side]?.y){hoverRegion[side]=candidate;refreshCanvas();}
    }
    return;
  }
  const p=stagePointer;if(p.side!==side)return;
  const dx=e.clientX-p.last.x,dy=e.clientY-p.last.y;p.move+=Math.hypot(dx,dy);p.last={x:e.clientX,y:e.clientY};
  if(p.pan){camera[side].panX+=dx;camera[side].panY+=dy;refreshCanvas();}
  if(p.box&&manualDraft){
   const b=c.getBoundingClientRect(),point=screenLocal(side,e.clientX-b.left,e.clientY-b.top);
   manualDraft.rect={x:Math.min(p.start.x,point.x),y:Math.min(p.start.y,point.y),w:Math.abs(point.x-p.start.x),h:Math.abs(point.y-p.start.y)};
   refreshCanvas();
  }
 });
 c.addEventListener('pointerup',e=>{
  const p=stagePointer;if(!p||p.side!==side)return;stagePointer=null;
  if(p.box){
   const rect=manualDraft?.rect;manualDraft=null;
   if(rect&&p.move>=7&&rect.w>=6&&rect.h>=6){
    const d=dimensions(S[side]),x=Math.max(0,Math.min(d.x,rect.x)),y=Math.max(0,Math.min(d.y,rect.y));
    const x2=Math.max(0,Math.min(d.x,rect.x+rect.w)),y2=Math.max(0,Math.min(d.y,rect.y+rect.h));
    if(x2-x>=6&&y2-y>=6){
     snapshot();const box={kind:'manual',id:uid(),x,y,w:x2-x,h:y2-y,cx:(x+x2)/2,cy:(y+y2)/2,rectangularity:1};
     (S.manualBoxes[String(S[side])] ||= []).push(box);
     pairClick(side,{x:box.cx,y:box.cy});save();toast('빠진 구역을 직접 지정했어요. '+(S.pending?'오른쪽에서 같은 구역을 지정하세요.':'연결점 기록 완료'));
     return;
    }
   }
   refreshCanvas();return;
  }
  if(p.pan||p.move>6)return;
  const r=c.getBoundingClientRect();pairClick(side,screenLocal(side,e.clientX-r.left,e.clientY-r.top));
 });
 c.addEventListener('pointercancel',()=>{stagePointer=null;manualDraft=null;refreshCanvas();});
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
 $('regionMode').onchange=e=>{S.regionMode=e.target.value;S.showRegions=S.regionMode!=='off';S.pending=null;manualDraft=null;hoverRegion={left:null,right:null};update();save();};
 $('kind').onchange=e=>{S.kind=e.target.value;S.pending=null;if(ALIGNABLE.has(S.kind)&&(!S.name||S.name==='STAIR-1'||S.name==='ESC-1'))S.name='MAIN-A';if(S.kind==='stairs'&&S.name==='MAIN-A')S.name='STAIR-1';if(S.kind==='escalator'&&S.name==='MAIN-A')S.name='ESC-1';update();save();};
 $('pointName').oninput=e=>{S.name=e.target.value;save();};$('cancelPending').onclick=()=>{S.pending=null;updateHint();refreshCanvas();};
 $('undoBtn').onclick=undo;$('alignBtn').onclick=autoAlign;
 $('removeOldEscalators').onclick=()=>{
  const list=matches(),ids=new Set(list.slice(0,2).filter(p=>p.kind==='escalator').map(p=>p.id));
  if(!ids.size){toast('현재 두 층의 1·2번 연결 중 에스컬레이터가 없습니다.');return;}
  snapshot();
  S.pairs=S.pairs.filter(p=>!ids.has(p.id));
  update();save();toast(ids.size+'개 에스컬레이터 연결 삭제 · 다른 항목은 유지');
 };
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
 if(!S.manualBoxes||typeof S.manualBoxes!=='object')S.manualBoxes={};
 if(!S.migrationV2){
  // One-off cleanup requested for previously numbered #1 / #2 escalator
  // matches. Preserve a full backup before removing anything.
  const prior=S.pairs.slice(),groups=new Map(),remove=new Set();
  for(const p of prior){
   const floorsPair=[p.leftFloor,p.rightFloor].sort((a,b)=>a-b).join('-');
   const key=p.group+':'+floorsPair;
   const index=(groups.get(key)||0)+1;groups.set(key,index);
   const named=/^(?:1|2|ESC[-_ ]?[12]|에스컬레이터\s*[12](?:번)?)$/i.test(String(p.name||'').trim());
   if(p.kind==='escalator'&&(index<=2||named))remove.add(p.id);
  }
  if(remove.size){
   try{localStorage.setItem(STORAGE+'-pre-escalator-cleanup',JSON.stringify(prior));}catch(e){}
   S.pairs=prior.filter(p=>!remove.has(p.id));
  }
  S.migrationV2=true;
  if(!S.regionMode||S.regionMode==='room'||S.regionMode==='auto')S.regionMode='all';
  save();
 }
 if(!['low','high'].includes(S.group))S.group='low';
 if(!floors().includes(S.left))S.left=floors()[0];if(!floors().includes(S.right)||S.left===S.right)S.right=floors()[1];
 for(const f of LOW.concat(HIGH))T(f);
 const tasks=LOW.map(f=>loadImage(f,'/floors/'+f+'F.png'));
 try{for(const [f,blob] of await getAssets())if(LOW.includes(f)||HIGH.includes(f))tasks.push(loadImage(f,blob));}catch(e){console.warn('Stored image loading failed',e);}
 await Promise.all(tasks);update();$('saveStatus').textContent='자동 저장됨';
}
boot().catch(e=>{console.error(e);toast('편집기 초기화 중 일부 오류가 발생했어요.');$('saveStatus').textContent='데이터 불러오기 실패';});
