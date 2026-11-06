/**
 * Thin-wall cell detector for raster hospital floor plans.
 * Does not assume room fill color. Finds supported, orthogonal, enclosed
 * rectangles from directional 1px boundary strokes. Works on logical map
 * canvas raster data; returns local coordinates, not physical meters.
 *
 * Deliberately conservative: candidate cells are user-verifiable only.
 */
export function detectRectangularCells(rgba, w, h, scale=1) {
  if (!rgba || w < 20 || h < 20) return [];
  const n=w*h,gray=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4){
    gray[i]=Math.round(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);
  }
  let hor=new Uint8Array(n),ver=new Uint8Array(n);
  for(let y=3;y<h-3;y++)for(let x=3;x<w-3;x++){
    const i=y*w+x,c=gray[i];
    const h2=Math.min(gray[i-2*w],gray[i+2*w])-c;
    const h3=Math.min(gray[i-3*w],gray[i+3*w])-c;
    const v2=Math.min(gray[i-2],gray[i+2])-c;
    const v3=Math.min(gray[i-3],gray[i+3])-c;
    if(Math.max(h2,h3)>7)hor[i]=1;
    if(Math.max(v2,v3)>7)ver[i]=1;
  }
  // Connect 1–2 pixel breaks along each stroke direction.
  for(let y=0;y<h;y++){
    const o=y*w;
    for(let x=1;x<w-2;x++)if(!hor[o+x] && hor[o+x-1] &&
       (hor[o+x+1]||(!hor[o+x+1]&&hor[o+x+2])))hor[o+x]=1;
  }
  for(let x=0;x<w;x++){
    for(let y=1;y<h-2;y++)if(!ver[y*w+x]&&ver[(y-1)*w+x]&&
       (ver[(y+1)*w+x]||(!ver[(y+1)*w+x]&&ver[(y+2)*w+x])))ver[y*w+x]=1;
    // Bridge short gaps along vertical borders even if gray interiors
    // reduce contrast (a frequent issue in elevator-bank grids).
    let last=-100;
    for(let y=0;y<h;y++){
      const i=y*w+x;if(!ver[i])continue;
      if(y-last>1&&y-last<=25)for(let p=last+1;p<y;p++)ver[p*w+x]=1;
      last=y;
    }
  }
  const H=new Uint8Array(n),V=new Uint8Array(n);
  // 3px tolerant stroke support, without shrinking independent compartments.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    H[i]=hor[i]||(y>0&&hor[i-w])||(y+1<h&&hor[i+w])?1:0;
    V[i]=ver[i]||(x>0&&ver[i-1])||(x+1<w&&ver[i+1])?1:0;
  }
  const rows=new Uint32Array(h*(w+1)),cols=new Uint32Array((h+1)*w);
  for(let y=0;y<h;y++){
    let s=0;const i=y*(w+1),p=y*w;
    for(let x=0;x<w;x++){s+=H[p+x];rows[i+x+1]=s;cols[(y+1)*w+x]=cols[y*w+x]+V[p+x];}
  }
  const rowRatio=(y,x1,x2)=>{
    if(y<0||y>=h||x2<=x1)return 0;
    return (rows[y*(w+1)+x2]-rows[y*(w+1)+x1])/(x2-x1);
  };
  const colRatio=(x,y1,y2)=>{
    if(x<0||x>=w||y2<=y1)return 0;
    return (cols[y2*w+x]-cols[y1*w+x])/(y2-y1);
  };
  // Merge repeated 1px horizontal strokes into one segment.
  const horizontal=[];
  for(let y=0;y<h;y++){
    const o=y*w;
    for(let x=0;x<w;){
      if(!hor[o+x]){x++;continue;}
      const x1=x;while(x<w&&hor[o+x])x++;
      const x2=x;if(x2-x1<8)continue;
      let hit=null;
      for(let j=horizontal.length-1;j>=0;j--){
        const line=horizontal[j];if(y-line.last>2)break;
        const overlap=Math.max(0,Math.min(x2,line.x2)-Math.max(x1,line.x1));
        if(overlap>=Math.min(x2-x1,line.x2-line.x1)*.6){hit=line;break;}
      }
      if(hit){hit.last=y;hit.x1=Math.min(x1,hit.x1);hit.x2=Math.max(x2,hit.x2);hit.sum+=y;hit.n++;}
      else horizontal.push({x1,x2,last:y,sum:y,n:1});
    }
  }
  const lines=horizontal.map(g=>({x1:g.x1,x2:g.x2,y:Math.round(g.sum/g.n)}))
       .sort((a,b)=>a.y-b.y);
  const raw=[],seen=new Set(),MAX_CELLS=2500;
  // Each pair of horizontal lines can bound one row of cells.
  for(let i=0;i<lines.length;i++){
    const top=lines[i],ya=top.y;
    for(let j=i+1;j<lines.length;j++){
      const bot=lines[j],yb=bot.y;
      if(yb-ya>270)break;
      if(yb-ya<10)continue;
      const lo=Math.max(2,Math.max(top.x1,bot.x1)-3);
      const hi=Math.min(w-3,Math.min(top.x2,bot.x2)+3);
      if(hi-lo<10)continue;
      // Vertical strokes crossing the proposed band become box boundaries.
      const candidates=[];
      for(let x=lo;x<=hi;x++){
        const score=colRatio(x,ya,yb+1);
        if(score>=.55)candidates.push({x,score});
      }
      const xlines=[];
      for(const p of candidates){
        const last=xlines[xlines.length-1];
        if(last&&p.x-last.end<=3){
          last.end=p.x;if(p.score>last.score){last.x=p.x;last.score=p.score;}
        } else xlines.push({x:p.x,end:p.x,score:p.score});
      }
      for(let k=1;k<xlines.length;k++){
        const x1=xlines[k-1].x,x2=xlines[k].x,d=x2-x1;
        if(d<10||d>440)continue;
        const topSupport=rowRatio(ya,x1,x2+1),bottomSupport=rowRatio(yb,x1,x2+1);
        const leftSupport=colRatio(x1,ya,yb+1),rightSupport=colRatio(x2,ya,yb+1);
        if(Math.min(topSupport,bottomSupport)<.68||Math.min(leftSupport,rightSupport)<.55)continue;
        // Don't treat a stack of small cells as a single large room:
        // reject rectangles with a strong horizontal internal divider.
        let divided=false;
        for(let y=ya+6;y<yb-5;y++){
          if(rowRatio(y,x1+2,x2-1)>.83){divided=true;break;}
        }
        if(divided)continue;
        const key=[x1,ya,x2,yb].join(',');
        if(seen.has(key))continue;
        seen.add(key);
        const confidence=(topSupport+bottomSupport+leftSupport+rightSupport)/4;
        raw.push({kind:'cell',x:x1/scale,y:ya/scale,w:d/scale,h:(yb-ya)/scale,
          cx:(x1+x2)/(2*scale),cy:(ya+yb)/(2*scale),
          confidence:Math.round(confidence*100)/100,rectangularity:confidence});
        if(raw.length>=MAX_CELLS)break;
      }
      if(raw.length>=MAX_CELLS)break;
    }
    if(raw.length>=MAX_CELLS)break;
  }
  // Exclude internal icon pictogram rectangles when a full containing
  // compartment is identified. Keep genuine adjacent small grid cells.
  raw.sort((a,b)=>(b.w*b.h)-(a.w*a.h));
  const clean=raw.filter((r,idx)=>{
    return !raw.slice(0,idx).some(big=>{
      if(big.w*big.h<r.w*r.h*1.6)return false;
      return r.x>=big.x+2/scale&&r.y>=big.y+2/scale&&
             r.x+r.w<=big.x+big.w-2/scale&&r.y+r.h<=big.y+big.h-2/scale;
    });
  });
  return clean.sort((a,b)=>a.y-b.y||a.x-b.x);
}
