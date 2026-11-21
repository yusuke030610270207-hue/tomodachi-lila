// スタンプ作成: 落書きを型に当てはめる、または線を整えて、すきな色で染める
// (AIは使わず、端末の中だけで計算します)

/* ===== 計算だけの部分（画面なしで動く） ===== */
const TAU = Math.PI * 2;
function bbox(pts){let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const p of pts){if(p[0]<a)a=p[0];if(p[1]<b)b=p[1];if(p[0]>c)c=p[0];if(p[1]>d)d=p[1];}return {x0:a,y0:b,x1:c,y1:d,w:c-a,h:d-b,cx:(a+c)/2,cy:(b+d)/2};}
function normStrokes(strokes){
  const all=strokes.flat(); const bb=bbox(all); const s=Math.max(bb.w,bb.h)/2||1;
  return {strokes:strokes.map(st=>st.map(p=>[(p[0]-bb.cx)/s,(p[1]-bb.cy)/s])),aspect:(bb.w||1)/(bb.h||1)};
}
function polar(fn,n){const out=[];for(let i=0;i<n;i++){const t=i/n*TAU,r=fn(t);out.push([r*Math.cos(t),r*Math.sin(t)]);}return out;}
function chaikin(pts,closed,iters){
  let p=pts;
  for(let k=0;k<iters;k++){
    const q=[];const n=p.length;
    if(n<3)return p;
    if(!closed)q.push(p[0]);
    const end=closed?n:n-1;
    for(let i=0;i<end;i++){const a=p[i],b=p[(i+1)%n];q.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}
    if(!closed)q.push(p[n-1]);
    p=q;
  }
  return p;
}
function thin(pts,minD){const out=[pts[0]];for(const p of pts){const l=out[out.length-1];if(Math.hypot(p[0]-l[0],p[1]-l[1])>=minD)out.push(p);}if(out.length<2&&pts.length>1)out.push(pts[pts.length-1]);return out;}
function densify(pts,closed,step){
  const out=[];const n=pts.length;const end=closed?n:n-1;
  for(let i=0;i<end;i++){const a=pts[i],b=pts[(i+1)%n];const d=Math.hypot(b[0]-a[0],b[1]-a[1]);const m=Math.max(1,Math.ceil(d/step));for(let j=0;j<m;j++)out.push([a[0]+(b[0]-a[0])*j/m,a[1]+(b[1]-a[1])*j/m]);}
  out.push(pts[closed?0:n-1]);return out;
}
const BINS=40;
function profile(strokes,closed){
  const prof=new Array(BINS).fill(-1);
  for(const st of strokes){for(const p of densify(st,closed,0.02)){const r=Math.hypot(p[0],p[1]);let b=Math.floor(((Math.atan2(p[1],p[0])+TAU)%TAU)/TAU*BINS)%BINS;if(r>prof[b])prof[b]=r;}}
  for(let i=0;i<BINS;i++){if(prof[i]<0){let v=0;for(let d=1;d<BINS;d++){const a=prof[(i+d)%BINS],b=prof[(i-d+BINS)%BINS];if(a>=0||b>=0){v=a>=0&&b>=0?(a+b)/2:Math.max(a,b);break;}}prof[i]=-2-v;}}
  return prof.map(v=>v<=-2?-(v+2):v);
}
function fit(poly){return normStrokes([poly]).strokes[0];}

/* 型（見本は8種類。本番は50〜100種類を想定） */
function makeMoon(){
  const c=[0.42,-0.1],R=0.82,out=[],inn=[];const a0=Math.atan2(c[1],c[0]);
  for(let i=0;i<=120;i++){const t=a0+i/120*TAU,x=Math.cos(t),y=Math.sin(t);if(Math.hypot(x-c[0],y-c[1])>R)out.push([x,y]);}
  for(let i=0;i<=120;i++){const t=a0+i/120*TAU,x=c[0]+R*Math.cos(t),y=c[1]+R*Math.sin(t);if(Math.hypot(x,y)<1)inn.push([x,y]);}
  return out.concat(inn.reverse());
}
function makeCloud(){
  const cs=[[-0.48,0.12,0.5],[0.48,0.12,0.5],[-0.05,-0.22,0.58],[0,0.2,0.5]];
  return polar(t=>{const dx=Math.cos(t),dy=Math.sin(t);let m=0;for(const [x,y,R] of cs){const b=dx*x+dy*y,disc=b*b-(x*x+y*y)+R*R;if(disc>=0)m=Math.max(m,b+Math.sqrt(disc));}return m;},160);
}
function earBump(t,c){let d=Math.abs(((t-c+Math.PI*3)%TAU)-Math.PI);return Math.max(0,1-d/0.32);}
const UP=-Math.PI/2;
const TEMPLATES=[
  {id:'neko',name:'ねこ',poly:chaikin(polar(t=>0.8+0.42*Math.max(earBump(t,UP-0.6),earBump(t,UP+0.6)),160).map(p=>[p[0]*1.05,p[1]*0.92]),true,1),fx:0,fy:0.2,fs:1},
  {id:'heart',name:'ハート',poly:polar(()=>1,120).map((_,i)=>{const t=i/120*TAU;return [16*Math.pow(Math.sin(t),3),-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))];}),fx:0,fy:-0.12,fs:.95},
  {id:'hoshi',name:'ほし',poly:chaikin(Array.from({length:10},(_,i)=>{const r=i%2?0.5:1,t=UP+i/10*TAU;return [r*Math.cos(t),r*Math.sin(t)];}),true,2),fx:0,fy:0.08,fs:.8},
  {id:'hana',name:'はな',poly:polar(t=>0.7+0.3*Math.cos(5*(t-UP)),160),fx:0,fy:0,fs:.62,detail:'center'},
  {id:'kumo',name:'くも',poly:makeCloud(),fx:0,fy:0.02,fs:.9},
  {id:'shizuku',name:'しずく',poly:polar(t=>0.66+0.55*Math.pow(Math.max(0,Math.cos(t-UP)),6),160),fx:0,fy:0.3,fs:.85},
  {id:'tsuki',name:'つき',poly:makeMoon(),fx:-0.5,fy:0.05,fs:.55},
  {id:'maru',name:'まる',poly:polar(()=>1,96),fx:0,fy:0,fs:1.05},
];
for(const t of TEMPLATES){const n=normStrokes([t.poly]);t.poly=n.strokes[0];t.aspect=n.aspect;t.prof=profile([t.poly],true);}

/* 落書きがどの型に近いかを端末の中だけで判断する */
function recognize(strokes){
  if(!strokes.length||strokes.flat().length<4)return TEMPLATES.map(t=>({id:t.id,score:1}));
  const n=normStrokes(strokes);const prof=profile(n.strokes,false);
  return TEMPLATES.map(t=>{let s=0;for(let i=0;i<BINS;i++)s+=Math.abs(prof[i]-t.prof[i]);return {id:t.id,score:s/BINS+0.25*Math.abs(Math.log(n.aspect/t.aspect))};}).sort((a,b)=>a.score-b.score);
}
function pickPalette(hues){
  if(!hues.length)return null;const s=[...hues].sort((a,b)=>a-b);const q=f=>s[Math.min(s.length-1,Math.floor(s.length*f))];
  return [q(1/6),q(1/2),q(5/6)];
}
function hueName(h){h=((h%360)+360)%360;
  if(h<20||h>=335)return 'あかね色';if(h<45)return 'みかん色';if(h<70)return 'ひだまり色';if(h<160)return 'わかば色';
  if(h<200)return 'みずうみ色';if(h<250)return 'そら色';if(h<290)return 'すみれ色';return 'さくら色';}


const UPDIR=-Math.PI/2;
function star4(ctx,x,y,r){ctx.beginPath();for(let i=0;i<8;i++){const rr=i%2?r*0.28:r,t=UPDIR+i/8*TAU;ctx[i?'lineTo':'moveTo'](x+rr*Math.cos(t),y+rr*Math.sin(t));}ctx.closePath();}
function hslStr(h,s,l){return `hsl(${h},${s}%,${l}%)`;}
function hexRgb(hex){const n=parseInt(String(hex).slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];}
function rgbaHex(hex,a){const [r,g,b]=hexRgb(hex);return `rgba(${r},${g},${b},${a})`;}
function isDark(hex){const [r,g,b]=hexRgb(hex);return (0.299*r+0.587*g+0.114*b)/255<0.55;}
const okHex=(c)=>/^#[0-9a-fA-F]{6}$/.test(c||"");
function fill3(colors){const c=(colors||[]).filter(okHex);const base=c.length?c:["#c9a8ff","#ff9ec7","#8fe3ff"];return [base[0],base[1]||base[0],base[2]||base[1]||base[0]];}

function tidyShapes(strokes){ // 線をなめらかにして、閉じた形は色で塗る
  if(!strokes.length)return {shapes:[],face:null};
  const n=normStrokes(strokes).strokes;let best=null;
  const shapes=n.filter(s=>s.length>1).map(s=>{
    const t=thin(s,0.03),bb=bbox(t),gap=Math.hypot(t[0][0]-t[t.length-1][0],t[0][1]-t[t.length-1][1]);
    const closed=t.length>6&&gap<0.3*Math.hypot(bb.w,bb.h);
    if(closed&&(!best||bb.w*bb.h>best.a))best={a:bb.w*bb.h,x:bb.cx,y:bb.cy,s:Math.min(bb.w,bb.h)/2};
    return {pts:chaikin(t,closed,3),closed};
  });
  return {shapes,face:best?{x:best.x,y:best.y+best.s*0.1,s:best.s}:null};
}
function drawFace(ctx,x,y,u,type,isCat,ink='#5a5080'){
  if(type==='none')return;ctx.save();ctx.strokeStyle=ink;ctx.lineCap='round';ctx.lineWidth=u*.26;
  const ex=u*1.55,ey=y-u*.35;
  ctx.fillStyle='rgba(255,140,165,.4)';for(const s of[-1,1]){ctx.beginPath();ctx.ellipse(x+s*u*2.5,y+u*.55,u*.6,u*.4,0,0,TAU);ctx.fill();}
  ctx.fillStyle=ink;
  for(const s of[-1,1]){const cx=x+s*ex;
    if(type==='niko'){ctx.beginPath();ctx.arc(cx,ey+u*.2,u*.55,Math.PI*1.08,Math.PI*1.92);ctx.stroke();}
    else if(type==='suya'){ctx.beginPath();ctx.arc(cx,ey-u*.1,u*.55,Math.PI*.1,Math.PI*.9);ctx.stroke();}
    else if(type==='pacchiri'){ctx.beginPath();ctx.arc(cx,ey,u*.45,0,TAU);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx-u*.14,ey-u*.16,u*.15,0,TAU);ctx.fill();ctx.fillStyle=ink;}
    else if(type==='kira'){star4(ctx,cx,ey,u*.75);ctx.fill();}}
  if(isCat){ctx.beginPath();ctx.moveTo(x-u*.28,y+u*.25);ctx.lineTo(x+u*.28,y+u*.25);ctx.lineTo(x,y+u*.6);ctx.closePath();ctx.fill();
    ctx.lineWidth=u*.15;for(const s of[-1,1])for(const k of[-.25,.25]){ctx.beginPath();ctx.moveTo(x+s*u*3.2,y+u*(.6+k));ctx.lineTo(x+s*u*4.5,y+u*(.6+k*2.4));ctx.stroke();}
    ctx.lineWidth=u*.22;ctx.beginPath();ctx.arc(x-u*.4,y+u*.6,u*.4,0,Math.PI*.9);ctx.stroke();ctx.beginPath();ctx.arc(x+u*.4,y+u*.6,u*.4,Math.PI*.1,Math.PI);ctx.stroke();}
  else if(type==='suya'){ctx.beginPath();ctx.arc(x,y+u*.75,u*.2,0,TAU);ctx.fill();}
  else if(type==='kira'){ctx.beginPath();ctx.arc(x,y+u*.5,u*.6,0,Math.PI);ctx.closePath();ctx.fill();}
  else{ctx.beginPath();ctx.arc(x,y+u*.35,u*.65,Math.PI*.18,Math.PI*.82);ctx.stroke();}
  ctx.restore();
}
function drawStamp(ctx,S,o){
  ctx.clearRect(0,0,S,S);
  const cx=S/2,cy=S*.54,R=S*.27,hs=fill3(o.colors);let shapes,face,tpl=null;
  if(o.mode==='kata'){tpl=TEMPLATES.find(t=>t.id===o.kata);shapes=[{pts:tpl.poly,closed:true}];face={x:tpl.fx,y:tpl.fy,s:tpl.fs};}
  else{const t=tidyShapes(o.strokes||[]);shapes=t.shapes;face=t.face;}
  if(!shapes.length)return;
  const paths=shapes.map(sh=>{const p=new Path2D();sh.pts.forEach((q,i)=>p[i?'lineTo':'moveTo'](cx+q[0]*R,cy+q[1]*R));if(sh.closed)p.closePath();return p;});
  ctx.lineJoin='round';ctx.lineCap='round';
  if(o.deco==='niji'){[350,25,50,140,200,270].forEach((x,i)=>{ctx.beginPath();ctx.strokeStyle=hslStr(x,80,84);ctx.lineWidth=R*.1;ctx.arc(cx,cy+R*.35,R*(1.45-i*.095),Math.PI,TAU);ctx.stroke();});}
  if(o.deco==='hane'){for(const s of[-1,1]){ctx.save();ctx.translate(cx+s*R*.85,cy-R*.1);ctx.scale(s,1);ctx.fillStyle='#fff';ctx.shadowColor=rgbaHex(hs[1],.5);ctx.shadowBlur=S*.035;
    [[.38,-.2,.52,.2,-.5],[.42,.04,.46,.17,-.15],[.34,.26,.36,.14,.2]].forEach(f=>{ctx.beginPath();ctx.ellipse(R*f[0],R*f[1],R*f[2],R*f[3],f[4],0,TAU);ctx.fill();});ctx.restore();}}
  if(o.border!=='none'){ctx.save();
    if(o.border==='white'){ctx.shadowColor='rgba(110,95,170,.26)';ctx.shadowBlur=S*.03;ctx.shadowOffsetY=S*.012;}else{ctx.shadowColor=hs[0];ctx.shadowBlur=S*.09;}
    ctx.strokeStyle='#fff';
    for(let k=0;k<(o.border==='glow'?2:1);k++)paths.forEach((p,i)=>{ctx.lineWidth=R*(shapes[i].closed?(o.border==='white'?.24:.12):(o.border==='white'?.36:.26));ctx.stroke(p);});
    ctx.restore();}
  const g=ctx.createLinearGradient(cx-R,cy-R,cx+R,cy+R);g.addColorStop(0,hs[0]);g.addColorStop(.55,hs[1]);g.addColorStop(1,hs[2]); // すきな色で染める
  ctx.fillStyle=g;ctx.strokeStyle=g;
  paths.forEach((p,i)=>{if(shapes[i].closed)ctx.fill(p);else{ctx.lineWidth=R*.16;ctx.stroke(p);}});
  paths.forEach((p,i)=>{if(!shapes[i].closed)return;ctx.save();ctx.clip(p);const hg=ctx.createRadialGradient(cx-R*.35,cy-R*.5,0,cx-R*.35,cy-R*.5,R*.95);hg.addColorStop(0,'rgba(255,255,255,.6)');hg.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=hg;ctx.fillRect(0,0,S,S);ctx.restore();});
  if(tpl&&tpl.detail==='center'){ctx.fillStyle='rgba(255,255,255,.85)';ctx.beginPath();ctx.arc(cx,cy,R*.36,0,TAU);ctx.fill();}
  if(face)drawFace(ctx,cx+face.x*R,cy+face.y*R,R*.16*face.s,o.face,tpl&&tpl.id==='neko',isDark(hs[1])?'#ffffff':'#5a5080');
  if(o.deco==='kira'){ctx.save();ctx.fillStyle='#fff';ctx.shadowColor=hs[0];ctx.shadowBlur=S*.035;
    [[-1.2,-.9,.24],[1.25,-.65,.17],[1.1,.95,.21],[-1.15,.75,.14],[.2,-1.35,.12]].forEach(k=>{star4(ctx,cx+k[0]*R,cy+k[1]*R,k[2]*R);ctx.fill();ctx.fill();});ctx.restore();}
  if(o.deco==='wa'){ctx.save();ctx.strokeStyle='#ffe08a';ctx.lineWidth=R*.09;ctx.shadowColor='#ffd766';ctx.shadowBlur=S*.04;ctx.beginPath();ctx.ellipse(cx,cy-R*1.22,R*.5,R*.14,0,0,TAU);ctx.stroke();ctx.restore();}
}

export const FACES=[["niko","にこ"],["pacchiri","ぱっちり"],["suya","すやすや"],["kira","きらきら"],["none","なし"]];
export const DECOS=[["hane","はね"],["kira","キラキラ"],["niji","にじ"],["wa","てんしのわ"],["none","なし"]];
export const BORDERS=[["white","白ふち"],["glow","ひかるふち"],["none","なし"]];
export { TEMPLATES, recognize, drawStamp };
