const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const on=(selector,event,handler)=>{
  const el=$(selector);
  if(!el){ console.warn(`[MARL v2.1.0] missing optional control ${selector}`); return null; }
  el.addEventListener(event,handler);
  return el;
};
const setText=(selector,text)=>{ const el=$(selector); if(el) el.textContent=text; };
window.addEventListener("error",e=>{
  console.error("[MARL v2.1.0 runtime]", e.error || e.message);
  const hint=$("#audioHint");
  if(hint) hint.textContent="A module reported an error; basic view navigation remains available.";
});
let CORE=null,audioCtx=null,masterGain=null,audioUnlocked=false;
let eventTrain=[],savedTrains=[],transportToken=0,isLooping=false,performanceToken=0,performanceLooping=false;
let liveEnergy=0,scanEnergy=0,lastScanEvent=0,lastScanClass="none";
let captureActive=false,captureEvents=[],captureTrailA=[],captureTrailB=[];
let referenceA={x:.38,y:.50},referenceB={x:.62,y:.50};
let referencePresets=[];
const REFERENCE_SESSION_KEY="marl.referencePresets.v2.1";
let activeRef="A";
let voiceAOn=true,voiceBOn=true,geometryBusOn=true,mercBusOn=true,masterAudible=true;
let referenceMetronomeAudible=true;
let geometryTraces=[];


function loadCore(){
  CORE={version:"2.1.0",canonicalCore:"ROCK · PETRIFIED"};
  const rev=$("#coreRevision"); if(rev) rev.textContent=CORE.canonicalCore;
}
function flashEvent(type){
 const normalized=type==="noBell"?"nobell":type;
 document.querySelectorAll(`[data-incidence-event="${normalized}"],[data-geometry-event="${normalized}"],[data-perform-event="${normalized}"]`).forEach(el=>{
   el.classList.add("active");setTimeout(()=>el.classList.remove("active"),240);
 });
 const idMap={click:"eventClick",ding:"eventDing",bell:"eventBell",noBell:"eventNoBell"};
 const id=idMap[type];
 if(id){const el=$("#"+id);if(el){el.classList.add("active");setTimeout(()=>el.classList.remove("active"),240)}}
 document.querySelectorAll(`[data-event-copy="${type}"]`).forEach(el=>{
   el.classList.add("active");setTimeout(()=>el.classList.remove("active"),240);
 });
}
function log(msg){const d=document.createElement("div");d.className="logline";d.textContent=`${new Date().toLocaleTimeString()}  ${msg}`;$("#log").prepend(d)}
async function ensureAudio(){
 if(!audioCtx){
   audioCtx=new (window.AudioContext||window.webkitAudioContext)();
   masterGain=audioCtx.createGain();masterGain.connect(audioCtx.destination);masterGain.gain.value=1;
 }
 if(audioCtx.state==="suspended")try{await audioCtx.resume()}catch(e){}
 audioUnlocked=audioCtx.state==="running";
 if(audioUnlocked)$("#audioHint").textContent="Sound is live.";
 return audioUnlocked;
}
["pointerdown","keydown","touchstart"].forEach(evt=>window.addEventListener(evt,()=>ensureAudio(),{once:true,capture:true}));

function noiseBurst(t,dur=.025,gain=.25){
 if(!audioCtx||!masterGain)return;
 const len=Math.max(1,Math.floor(audioCtx.sampleRate*dur)),b=audioCtx.createBuffer(1,len,audioCtx.sampleRate),a=b.getChannelData(0);
 for(let i=0;i<len;i++)a[i]=(Math.random()*2-1)*(1-i/len);
 const s=audioCtx.createBufferSource(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();s.buffer=b;f.type="highpass";f.frequency.value=1600;
 g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f).connect(g).connect(masterGain);s.start(t);
}
function tone(freq,t,dur=.35,gain=.16,type="sine",detune=0){
 if(!audioCtx||!masterGain)return;
 const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.detune.setValueAtTime(detune,t);
 g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(masterGain);o.start(t);o.stop(t+dur);
}

function busAllowed(bus){
  if(!masterAudible) return false;
  if(bus==="geometry" && !geometryBusOn) return false;
  if(bus==="merc" && !mercBusOn) return false;
  return true;
}

function click(t=audioCtx.currentTime){flashEvent("click");noiseBurst(t,.018,.18);tone(950,t,.035,.055,"square")}
function noBell(t=audioCtx.currentTime){flashEvent("nobell");tone(92,t,.18,.08,"triangle");noiseBurst(t,.05,.06)}

const PENTA=[0,2,4,7,9];
function pentatonicFromRef(ref,root=220){
 const degree=Math.min(4,Math.max(0,Math.floor(ref.x*5)));
 const octave=Math.min(2,Math.max(-1,Math.floor((1-ref.y)*4)-1));
 const semis=PENTA[degree]+12*octave;
 return {degree,octave,semis,freq:root*Math.pow(2,semis/12)};
}
function intervalLabel(a,b){
 const d=((b.semis-a.semis)%12+12)%12;
 const names={0:"unison",2:"major 2nd",3:"minor 3rd",4:"major 3rd",5:"fourth",7:"fifth",8:"minor 6th",9:"major 6th",10:"minor 7th"};
 return names[d]||`${d} semitones`;
}
function relationState(scoreA,scoreB){
 const diff=Math.abs(scoreA-scoreB);
 const phase=Math.abs(Math.sin((aA-aB)/2));
 const harmonic=(diff<.22 && phase<.58);
 const detune=harmonic?0:Math.min(42,8+phase*34+diff*18);
 return {harmonic,detune,phase,diff};
}
function dingPair(pA,pB,rel,t=audioCtx.currentTime,bus="merc"){
 if(!busAllowed(bus)) return;
 flashEvent("ding");
 if(voiceAOn){
   tone(pA.freq,t,.72,.10,"sine",0);
   tone(pA.freq*2,t,.32,.025,"sine",0);
 }
 if(voiceBOn){
   tone(pB.freq,t,.72,.09,"sine",rel.harmonic?0:(referenceB.x>=referenceA.x?rel.detune:-rel.detune));
   tone(pB.freq*2,t,.28,.018,"sine",rel.harmonic?0:(referenceB.x>=referenceA.x?rel.detune:-rel.detune));
 }
}
function bellChord(pA,pB,rel,t=audioCtx.currentTime,bus="merc"){
 if(!busAllowed(bus)) return;
 flashEvent("bell");
 if(voiceAOn){
   tone(pA.freq,t,2.4,.10,"sine",0);
   tone(pA.freq*2,t,1.9,.05,"sine",0);
   tone(pA.freq*2.72,t,1.45,.03,"sine",0);
 }
 if(voiceBOn){
   const d=rel.harmonic?0:(referenceB.x>=referenceA.x?rel.detune:-rel.detune);
   tone(pB.freq,t,2.4,.09,"sine",d);
   tone(pB.freq*2,t,1.9,.045,"sine",d);
   tone(pB.freq*2.72,t,1.45,.028,"sine",d);
 }
}

function threshold(){return +$("#bellThreshold").value}
function growth(){return +$("#growth").value}
function contribution(type,ordinal){return type==="click"?.55*Math.pow(growth(),ordinal):type==="ding"?.80*Math.pow(growth(),ordinal):0}
function durationFor(type){const beat=60/(+$("#tempo").value||108),rate=type==="click"?+$("#clickRate").value:type==="ding"?+$("#dingRate").value:+$("#noBellRate").value;return beat/Math.max(.01,rate)}
function currentHarmony(){
 const pA=pentatonicFromRef(referenceA),pB=pentatonicFromRef(referenceB);
 const rel=relationState(lastScoreA||0,lastScoreB||0);
 return {pA,pB,rel};
}
async function ringBell(source="closure",bus="merc"){
 await ensureAudio();const {pA,pB,rel}=currentHarmony();bellChord(pA,pB,rel,audioCtx.currentTime,bus);
 $("#bellStatusPad").classList.add("active");setTimeout(()=>$("#bellStatusPad").classList.remove("active"),420);log(`BELL · ${source} · ${intervalLabel(pA,pB)}`);
}
async function soundEvent(type,source="manual",record=true,bus="merc"){
 await ensureAudio();
 if(type==="click")click();
 else if(type==="ding"){const {pA,pB,rel}=currentHarmony();dingPair(pA,pB,rel,audioCtx.currentTime,bus)}
 else if(type==="nobell")noBell();
 if(record){eventTrain.push(type);renderTrain()}
 log(`${type.toUpperCase()} · ${source}`);
}
async function addEvent(type){
 if(type==="bell")return;
 if(type==="nobell"){liveEnergy=0;await soundEvent(type,"manual",true,"merc");return}
 liveEnergy+=contribution(type,eventTrain.length);await soundEvent(type,"manual",true,"merc");
 if(liveEnergy>=threshold()){await ringBell("live threshold");liveEnergy=0}
}
$$(".pad[data-sound]").forEach(b=>b.addEventListener("click",()=>addEvent(b.dataset.sound)));
$$("[data-perf-sound]").forEach(b=>b.addEventListener("click",()=>{if($("#armPads").checked)soundEvent(b.dataset.perfSound,"performance pad",false,"merc")}));


function syncVoiceButtons(){}
function toggleVoice(which){}

function renderTrain(){
 const box=$("#eventTrain");box.innerHTML="";
 if(!eventTrain.length){box.textContent="— empty —";return}
 eventTrain.forEach((type,i)=>{
   const chip=document.createElement("span");chip.className=`event-chip ${type}`;chip.dataset.trainIndex=i;
   chip.innerHTML=`<span>${type==="nobell"?"NO BELL":type}</span><button>←</button><button>→</button><button>×</button>`;
   const [l,r,x]=chip.querySelectorAll("button");
   l.onclick=()=>{if(i>0){[eventTrain[i-1],eventTrain[i]]=[eventTrain[i],eventTrain[i-1]];renderTrain()}};
   r.onclick=()=>{if(i<eventTrain.length-1){[eventTrain[i+1],eventTrain[i]]=[eventTrain[i],eventTrain[i+1]];renderTrain()}};
   x.onclick=()=>{eventTrain.splice(i,1);renderTrain()};
   box.appendChild(chip);
 });
}

function renameMercAt(index,kind="merc"){
  const tr=savedTrains[index]; if(!tr)return;
  const current=kind==="path"?(tr.pathName||`${tr.name} Path`):tr.name;
  const next=prompt(kind==="path"?"Rename captured path:":"Rename Merc:",current);
  if(next===null)return;
  const cleaned=next.trim(); if(!cleaned)return;
  if(kind==="path")tr.pathName=cleaned; else tr.name=cleaned;
  renderSaved();renderPerformTracks();
}

function renderSaved(){
 const box=$("#savedTrains");box.innerHTML="";
 if(!savedTrains.length){box.innerHTML='<span class="caption">No saved Mercs this session.</span>';return}
 savedTrains.forEach((tr,i)=>{
  if(!tr.pathName && (tr.trailA||tr.trailB))tr.pathName=`${tr.name} Path`;
  const row=document.createElement("div");row.className="saved-train";
  const ev=tr.events.map(x=>x==="nobell"?"NO BELL":x.toUpperCase()).join(" · ");
  const path=(tr.trailA||tr.trailB)?`<div><small>Path: <span class="path-name" data-rename-path="${i}">${tr.pathName}</span></small></div>`:"";
  row.innerHTML=`<div><strong class="merc-name" data-rename-merc="${i}">${tr.name}</strong><br><code>${ev}</code>${path}</div>
  <div class="saved-actions"><button>Load</button><button>Duplicate</button><button>Delete</button></div>`;
  const [load,dup,del]=row.querySelectorAll(".saved-actions button");
  load.onclick=()=>{eventTrain=[...tr.events];renderTrain();log(`Loaded ${tr.name}`)};
  dup.onclick=()=>{savedTrains.push({...tr,name:`Merc ${savedTrains.length+1}`,pathName:tr.pathName?`${tr.pathName} Copy`:undefined,events:[...tr.events],trailA:tr.trailA?cloneData(tr.trailA):null,trailB:tr.trailB?cloneData(tr.trailB):null});renderSaved();renderPerformTracks()};
  del.onclick=()=>{savedTrains.splice(i,1);renderSaved();renderPerformTracks()};
  row.querySelector(`[data-rename-merc="${i}"]`).ondblclick=()=>renameMercAt(i,"merc");
  const pn=row.querySelector(`[data-rename-path="${i}"]`);if(pn)pn.ondblclick=()=>renameMercAt(i,"path");
  box.appendChild(row);
 });
}

$("#saveSeq").onclick=()=>{if(!eventTrain.length)return;savedTrains.push({name:`Merc ${savedTrains.length+1}`,events:[...eventTrain],muted:false,solo:false,source:"ocarina"});renderSaved();renderPerformTracks()};
$("#clearSeq").onclick=()=>{stopTransport();eventTrain=[];liveEnergy=0;renderTrain()};
$("#clearLog").onclick=()=>$("#log").innerHTML="";

function clearTrainHighlight(){document.querySelectorAll("[data-train-index]").forEach(el=>el.classList.remove("active-step"))}
function highlightTrainStep(i){document.querySelectorAll("[data-train-index]").forEach(el=>el.classList.toggle("active-step",Number(el.dataset.trainIndex)===i))}
function stopTransport(){transportToken++;clearTrainHighlight();isLooping=false;$("#loopSeq").classList.remove("active");$("#loopStatus").classList.remove("running");$("#loopStatus").textContent="Stopped"}
$("#stopSeq").onclick=stopTransport;
function sleep(ms,token,kind="transport"){return new Promise(resolve=>setTimeout(()=>resolve(kind==="transport"?token===transportToken:token===performanceToken),Math.max(0,ms)))}
async function playTrain(events,token,cycle=0,kind="transport"){
 let e=0,ord=0;if(!events.length)return false;
 for(let i=0;i<events.length;i++){
  const valid=kind==="transport"?token===transportToken:token===performanceToken;if(!valid)return false;
  const type=events[i];if(kind==="transport")highlightTrainStep(i);await ensureAudio();
  if(type==="click"){click();e+=contribution(type,ord++)}
  else if(type==="ding"){const h=currentHarmony();dingPair(h.pA,h.pB,h.rel,audioCtx.currentTime,"merc");e+=contribution(type,ord++)}
  else{noBell();e=0;ord=0}
  if(e>=threshold()){await sleep(65,token,kind);const still=kind==="transport"?token===transportToken:token===performanceToken;if(!still)return false;await ringBell(`${kind} threshold`,"merc");e=0;ord=0}
  if(kind==="transport")$("#loopStatus").textContent=`Cycle ${cycle+1} · energy ${e.toFixed(2)} / ${threshold().toFixed(1)}`;
  if(!(await sleep(durationFor(type)*1000,token,kind)))return false;
 }
 if(kind==="transport")clearTrainHighlight();return true;
}
$("#playSeq").onclick=async()=>{stopTransport();const token=++transportToken;$("#loopStatus").classList.add("running");await playTrain(eventTrain,token,0);if(token===transportToken){$("#loopStatus").classList.remove("running");$("#loopStatus").textContent="Finished"}};
$("#loopSeq").onclick=async()=>{if(isLooping){stopTransport();return}if(!eventTrain.length)return;isLooping=true;let cycle=0;const token=++transportToken;$("#loopSeq").classList.add("active");$("#loopStatus").classList.add("running");while(isLooping&&token===transportToken)if(!(await playTrain(eventTrain,token,cycle++)))break};

function bindOut(id,out,fmt=v=>v){const el=$(id),o=$(out),update=()=>o.textContent=fmt(el.value);el.addEventListener("input",update);update()}
bindOut("#tempo","#tempoOut",v=>v);bindOut("#clickRate","#clickRateOut",v=>(+v).toFixed(2)+"×");bindOut("#dingRate","#dingRateOut",v=>(+v).toFixed(2)+"×");bindOut("#noBellRate","#noBellRateOut",v=>(+v).toFixed(2)+"×");bindOut("#bellThreshold","#bellThresholdOut",v=>(+v).toFixed(1));bindOut("#growth","#growthOut",v=>(+v).toFixed(2)+"×");

bindOut("#speedA","#speedAOut",v=>(+v).toFixed(2));
bindOut("#speedB","#speedBOut",v=>(+v).toFixed(2));
bindOut("#ripple","#rippleOut",v=>(+v).toFixed(3));
bindOut("#scanRate","#scanRateOut",v=>`${v} ms`);


$$(".tab").forEach(b=>b.onclick=()=>{
 const v=b.dataset.view;
 if(window.MARLActivateView) window.MARLActivateView(v);
 else {
   $$(".tab").forEach(x=>x.classList.toggle("active",x===b));
   $$(".panel").forEach(x=>x.classList.remove("active"));
   const target=$("#"+v+"View"); if(target) target.classList.add("active");
 }
 if(v==="perform"){renderPerformTracks();drawPerformIncidence()}
});

// incidence
function incidenceMarkup(){
 const cx=450,cy=310,R=220,pts=[...Array(5)].map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;return[cx+R*Math.cos(a),cy+R*Math.sin(a)]});
 const edges=[];for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)edges.push([i,j]);
 const c5=[...Array(6)].map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/6;return[cx+125*Math.cos(a),cy+125*Math.sin(a)]});
 return `${edges.map(([i,j])=>`<line class="inc-edge inc-edge-${i} inc-edge-${j}" x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}" stroke="#41414e" stroke-width="2"/>`).join("")}
 ${pts.map((p,i)=>`<g class="inc-a4" data-i="${i}"><circle cx="${p[0]}" cy="${p[1]}" r="38" fill="#111117" stroke="#d7b45c" stroke-width="3"/><text x="${p[0]}" y="${p[1]+6}" text-anchor="middle" fill="#f2f0ea">A₄ ${i}</text></g>`).join("")}
 ${c5.map((p,i)=>`<g class="inc-c5" data-i="${i}"><circle cx="${p[0]}" cy="${p[1]}" r="22" fill="#171720" stroke="#8ba7ff" stroke-width="2"/><text x="${p[0]}" y="${p[1]+5}" text-anchor="middle" fill="#f2f0ea" font-size="12">C₅</text></g>`).join("")}
 <g class="inc-c2" tabindex="0" role="button" aria-label="C2 bridge inspection Bell"><circle cx="${cx}" cy="${cy}" r="76" fill="rgba(215,180,92,.05)" stroke="#c26d68" stroke-width="2" stroke-dasharray="8 7"/><text x="${cx}" y="${cy-8}" text-anchor="middle" fill="#f2f0ea">C₂ bridge</text><text x="${cx}" y="${cy+17}" text-anchor="middle" fill="#d7b45c" font-size="13">BELL INSPECTION</text></g>`;
}
function pulseIncidence(svg,node){
 const targets=[node];
 if(node.classList.contains("inc-a4")) svg.querySelectorAll(`.inc-edge-${node.dataset.i}`).forEach(x=>targets.push(x));
 targets.forEach(x=>x.classList.add("incidence-active"));
 setTimeout(()=>targets.forEach(x=>x.classList.remove("incidence-active")),520);
}
function wireIncidence(svg,perform=false){
 svg.querySelectorAll(".inc-a4").forEach(n=>n.onclick=()=>{if(!perform||$("#armIncidence").checked){pulseIncidence(svg,n);soundEvent("click",`A₄ sector ${n.dataset.i}`,!perform)}});
 svg.querySelectorAll(".inc-c5").forEach(n=>n.onclick=()=>{if(!perform||$("#armIncidence").checked){pulseIncidence(svg,n);soundEvent("ding",`C₅ gate ${n.dataset.i}`,!perform)}});
 const bridge=svg.querySelector(".inc-c2");
 const bell=async()=>{if(!perform||$("#armIncidence").checked){pulseIncidence(svg,bridge);await ringBell("C₂ incidence bridge inspection","merc")}};
 if(bridge){bridge.onclick=bell;bridge.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();bell()}}}
}
$("#incidenceSvg").innerHTML=incidenceMarkup();wireIncidence($("#incidenceSvg"),false);
function drawPerformIncidence(){$("#performIncidenceSvg").innerHTML=incidenceMarkup();wireIncidence($("#performIncidenceSvg"),true)}

// geometry
const phi=(1+Math.sqrt(5))/2,inv=1/phi,V=[];[-1,1].forEach(a=>[-1,1].forEach(b=>[-1,1].forEach(c=>V.push([a,b,c]))));[-1,1].forEach(a=>[-1,1].forEach(b=>{V.push([0,a*inv,b*phi],[a*inv,b*phi,0],[a*phi,0,b*inv])}));
let minD=Infinity;for(let i=0;i<V.length;i++)for(let j=i+1;j<V.length;j++){const d=Math.hypot(...V[i].map((x,k)=>x-V[j][k]));if(d>1e-6)minD=Math.min(minD,d)}
const E=[];for(let i=0;i<V.length;i++)for(let j=i+1;j<V.length;j++){const d=Math.hypot(...V[i].map((x,k)=>x-V[j][k]));if(Math.abs(d-minD)<1e-5)E.push([i,j])}
let aA=0,aB=0,last=performance.now(),phase=0,lastScoreA=0,lastScoreB=0;
function proj(v,a,mirror,w,h,scale,rip){let[x,y,z]=v;if(mirror)x=-x;const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(.53),sb=Math.sin(.53);let X=x*ca-z*sa,Z=x*sa+z*ca,Y=y*cb-Z*sb;Z=y*sb+Z*cb;const rr=1+rip*Math.sin(phase+Math.atan2(y,x)*5);X*=rr;Y*=rr;Z*=rr;const f=1/(4.6-Z*.34);return[w/2+X*scale*f,h/2-Y*scale*f,Z]}
function drawGeometry(canvas,ctx,performance=false){
 const rip=+$("#ripple").value,w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
 const P_B=V.map(v=>proj(v,aB,true,w,h,760,rip)),P_A=V.map(v=>proj(v,aA,false,w,h,700,rip));
 [[P_B,"#8ba7ff",.38,1.3],[P_A,"#d7b45c",.9,2.2]].forEach(([P,color,alpha,width])=>{
 E.map(([i,j])=>[i,j,(P[i][2]+P[j][2])/2]).sort((a,b)=>a[2]-b[2]).forEach(([i,j])=>{ctx.beginPath();ctx.moveTo(P[i][0],P[i][1]);ctx.lineTo(P[j][0],P[j][1]);ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=width;ctx.stroke()});ctx.globalAlpha=1;
 });
 if($("#showAxes").checked){ctx.save();ctx.translate(w/2,h/2);ctx.strokeStyle="rgba(242,240,234,.18)";for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(-245*Math.cos(a),-245*Math.sin(a));ctx.lineTo(245*Math.cos(a),245*Math.sin(a));ctx.stroke()}ctx.restore()}
 function drawRef(ref,color,label,trail){
   const x=ref.x*w,y=ref.y*h;
   if(performance&&$("#showTrails").checked&&trail.length>1){ctx.beginPath();trail.forEach((p,i)=>i?ctx.lineTo(p.x*w,p.y*h):ctx.moveTo(p.x*w,p.y*h));ctx.strokeStyle=color;ctx.globalAlpha=.24;ctx.lineWidth=2;ctx.stroke();ctx.globalAlpha=1}
   ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.fillStyle="rgba(9,9,12,.75)";ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();ctx.fillStyle=color;ctx.font="14px ui-monospace";ctx.fillText(label,x+16,y-12);
 }
 drawRef(referenceA,"#d7b45c","A",captureTrailA);drawRef(referenceB,"#8ba7ff","B",captureTrailB);

 if(referencePresets && referencePresets.length){
   referencePresets.filter(p=>p.armed).forEach((p,idx)=>{
     [[p.A,"#d7b45c"],[p.B,"#8ba7ff"]].forEach(([ref,color])=>{
       const x=ref.x*w,y=ref.y*h;
       ctx.save();ctx.globalAlpha=.34;ctx.beginPath();ctx.arc(x,y,7+idx%3,0,Math.PI*2);
       ctx.strokeStyle=color;ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
     });
   });
 }

 const nearest=(P,ref)=>{const rx=ref.x*w,ry=ref.y*h;let n=Infinity,best=null;P.forEach(p=>{const d=Math.hypot(p[0]-rx,p[1]-ry);if(d<n){n=d;best=p}});return {score:Math.max(0,1-n/115),point:best}};
 const na=nearest(P_A,referenceA),nb=nearest(P_B,referenceB);
 const now=performance.now();
 geometryTraces=geometryTraces.filter(t=>now-t.time<t.life);
 geometryTraces.forEach(t=>{
   const alpha=(1-(now-t.time)/t.life)*.72;
   ctx.save();ctx.globalAlpha=alpha;ctx.lineWidth=t.kind==="bell"?5:t.kind==="ding"?3:2;ctx.strokeStyle=t.kind==="bell"?"#d7b45c":t.kind==="ding"?"#f2f0ea":"#aaa";
   ctx.beginPath();ctx.moveTo(referenceA.x*w,referenceA.y*h);ctx.lineTo(na.point[0],na.point[1]);ctx.lineTo(nb.point[0],nb.point[1]);ctx.lineTo(referenceB.x*w,referenceB.y*h);ctx.stroke();
   [na.point,nb.point].forEach(q=>{ctx.beginPath();ctx.arc(q[0],q[1],8+(now-t.time)/80,0,Math.PI*2);ctx.stroke()});
   ctx.restore();
 });
 return {scoreA:na.score,scoreB:nb.score,pointA:na.point,pointB:nb.point};
}


function loadReferencePresets(){
  try{
    const raw=sessionStorage.getItem(REFERENCE_SESSION_KEY);
    referencePresets=raw?JSON.parse(raw):[];
    if(!Array.isArray(referencePresets))referencePresets=[];
  }catch(e){referencePresets=[]}
}
function saveReferencePresets(){
  try{sessionStorage.setItem(REFERENCE_SESSION_KEY,JSON.stringify(referencePresets))}catch(e){}
}
function currentReferenceSnapshot(name){
  return {
    id:`r${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    name:name||`Ref ${referencePresets.length+1}`,
    A:{x:+referenceA.x.toFixed(4),y:+referenceA.y.toFixed(4)},
    B:{x:+referenceB.x.toFixed(4),y:+referenceB.y.toFixed(4)},
    armed:false,
    lastClass:"none",
    lastEvent:0,
    energy:0
  };
}
function recallReferencePreset(p){
  referenceA={...p.A};referenceB={...p.B};
  updateReadouts();syncReferenceInputs();log(`REFERENCE · recalled ${p.name}`);
}
function toggleReferencePreset(id){
  const p=referencePresets.find(x=>x.id===id);if(!p)return;
  p.armed=!p.armed;p.lastClass="none";p.lastEvent=0;p.energy=0;
  saveReferencePresets();renderReferencePresets();
  log(`REFERENCE · ${p.armed?"armed":"disarmed"} ${p.name}`);
}
function deleteReferencePreset(id){
  referencePresets=referencePresets.filter(x=>x.id!==id);
  saveReferencePresets();renderReferencePresets();
}
function renderReferencePresets(){
  const render=(box)=>{
    if(!box)return;box.innerHTML="";
    if(!referencePresets.length){box.innerHTML='<span class="caption">No saved reference pairs this session.</span>';return}
    referencePresets.forEach(p=>{
      const row=document.createElement("div");row.className=`reference-preset ${p.armed?"armed":""}`;
      row.innerHTML=`<div><strong>${p.name}</strong><br><code>A(${p.A.x.toFixed(2)},${p.A.y.toFixed(2)}) · B(${p.B.x.toFixed(2)},${p.B.y.toFixed(2)})</code></div>
        <button data-ref-recall="${p.id}">Recall</button>
        <button data-ref-arm="${p.id}">${p.armed?"Disarm":"Arm"}</button>
        <button data-ref-delete="${p.id}">Delete</button>`;
      box.appendChild(row);
    });
  };
  render($("#referencePresets"));render($("#performReferencePresets"));
}
document.addEventListener("click",ev=>{
  let b=ev.target.closest("[data-ref-recall]");if(b){const p=referencePresets.find(x=>x.id===b.dataset.refRecall);if(p)recallReferencePreset(p);return}
  b=ev.target.closest("[data-ref-arm]");if(b){toggleReferencePreset(b.dataset.refArm);return}
  b=ev.target.closest("[data-ref-delete]");if(b){deleteReferencePreset(b.dataset.refDelete);return}
});
on("#saveReference","click",()=>{
  const name=($("#referenceName")?.value||"").trim();
  referencePresets.push(currentReferenceSnapshot(name));
  if($("#referenceName"))$("#referenceName").value="";
  saveReferencePresets();renderReferencePresets();
});

function clamp01(v){ return Math.max(0,Math.min(1,Number(v))); }

function syncReferenceInputs(){
  const values={
    "#refAX":referenceA.x,"#refAY":referenceA.y,
    "#refBX":referenceB.x,"#refBY":referenceB.y,
    "#performRefAX":referenceA.x,"#performRefAY":referenceA.y,
    "#performRefBX":referenceB.x,"#performRefBY":referenceB.y
  };
  Object.entries(values).forEach(([sel,val])=>{
    const el=$(sel); if(el && document.activeElement!==el) el.value=val.toFixed(2);
  });
}

function setReferenceFromInputs(which,x,y){
  if(which==="A") referenceA={x:clamp01(x),y:clamp01(y)};
  else referenceB={x:clamp01(x),y:clamp01(y)};
  updateReadouts();
  syncReferenceInputs();
}

function bindReferenceInputGroup(prefix,which){
  const x=$("#"+prefix+"X"), y=$("#"+prefix+"Y");
  if(!x||!y)return;
  const update=()=>setReferenceFromInputs(which,x.value,y.value);
  x.addEventListener("change",update); y.addEventListener("change",update);
  x.addEventListener("input",update); y.addEventListener("input",update);
}
bindReferenceInputGroup("refA","A");
bindReferenceInputGroup("refB","B");
bindReferenceInputGroup("performRefA","A");
bindReferenceInputGroup("performRefB","B");


function syncReferenceMetronomeButtons(){
 const text=referenceMetronomeAudible?"Mute Reference Metronome":"Unmute Reference Metronome";
 ["#referenceMetronomeMuteGeometry","#referenceMetronomeMutePerform"].forEach(sel=>{const b=$(sel);if(b){b.textContent=text;b.classList.toggle("muted",!referenceMetronomeAudible)}});
}
on("#referenceMetronomeMuteGeometry","click",()=>{referenceMetronomeAudible=!referenceMetronomeAudible;syncReferenceMetronomeButtons()});
on("#referenceMetronomeMutePerform","click",()=>{referenceMetronomeAudible=!referenceMetronomeAudible;syncReferenceMetronomeButtons()});

function updateReadouts(){
 const pA=pentatonicFromRef(referenceA),pB=pentatonicFromRef(referenceB),rel=relationState(lastScoreA,lastScoreB);
 const iv=intervalLabel(pA,pB),rs=rel.harmonic?"harmonic":"dissonant";
 $("#refAReadout").textContent=`${referenceA.x.toFixed(2)}, ${referenceA.y.toFixed(2)}`;$("#refBReadout").textContent=`${referenceB.x.toFixed(2)}, ${referenceB.y.toFixed(2)}`;
 $("#intervalReadout").textContent=iv;$("#relationReadout").textContent=rs;$("#performInterval").textContent=iv;$("#performRelation").textContent=rs;
}
function setReference(canvas,e){
 const r=canvas.getBoundingClientRect(),nx=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),ny=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
 const dA=Math.hypot(nx-referenceA.x,ny-referenceA.y),dB=Math.hypot(nx-referenceB.x,ny-referenceB.y);
 if(e.type==="pointerdown")activeRef=dA<=dB?"A":"B";
 if(activeRef==="A"){referenceA={x:nx,y:ny};if(captureActive)captureTrailA.push({...referenceA})}
 else{referenceB={x:nx,y:ny};if(captureActive)captureTrailB.push({...referenceB})}
 updateReadouts();
 syncReferenceInputs();
}
[$("#geoCanvas"),$("#performGeoCanvas")].forEach(c=>{
 let drag=false,lastPt=null,mode="reference";
 c.onpointerdown=e=>{
   drag=true;lastPt={x:e.clientX,y:e.clientY};c.setPointerCapture(e.pointerId);
   mode=$("#autoScan").checked?"reference":"rotate";
   if(mode==="reference")setReference(c,e);
 };
 c.onpointermove=e=>{
   if(!drag)return;
   if(mode==="reference")setReference(c,e);
   else{
     const dx=e.clientX-lastPt.x,dy=e.clientY-lastPt.y;lastPt={x:e.clientX,y:e.clientY};
     aA+=dx*.006;aB-=dx*.004+dy*.004;phase+=dy*.006;
   }
 };
 c.onpointerup=c.onpointercancel=()=>{drag=false;lastPt=null};
});
$("#resetReferences").onclick=()=>{referenceA={x:.38,y:.5};referenceB={x:.62,y:.5};updateReadouts();syncReferenceInputs()};


function scoreReferencePair(canvas,refA,refB){
  const w=canvas.width,h=canvas.height,rip=+$("#ripple").value;
  const P_B=V.map(v=>proj(v,aB,true,w,h,760,rip));
  const P_A=V.map(v=>proj(v,aA,false,w,h,700,rip));
  const nearest=(P,ref)=>{
    const rx=ref.x*w,ry=ref.y*h;let n=Infinity;
    P.forEach(p=>n=Math.min(n,Math.hypot(p[0]-rx,p[1]-ry)));
    return Math.max(0,1-n/115);
  };
  return {scoreA:nearest(P_A,refA),scoreB:nearest(P_B,refB)};
}

async function maybeScanEvent(now,performanceVisible){
 const sonify=$("#sonifyScan").checked;
 if(!audioUnlocked)return;
 const rate=+$("#scanRate").value;
 if(now-lastScanEvent<rate)return;
 const combined=(lastScoreA+lastScoreB)/2,rel=relationState(lastScoreA,lastScoreB);
 let cls=combined>.81?"ding":combined>.60?"click":"none";
 if(cls==="none"){lastScanClass="none";return}
 if(cls!==lastScanClass||now-lastScanEvent>rate*2){
   lastScanEvent=now;lastScanClass=cls;
   const inGeometry=$("#geometryView").classList.contains("active");
   const inPerform=$("#performView").classList.contains("active")&&$("#armGeometry").checked;
   if(!(inGeometry||inPerform)||!geometryBusOn)return;
   if(cls==="click"){if(sonify&&referenceMetronomeAudible)click();scanEnergy+=.55;geometryTraces.push({kind:"click",time:performance.now(),life:1400})}
   else{const h=currentHarmony();if(sonify&&referenceMetronomeAudible)dingPair(h.pA,h.pB,h.rel,audioCtx.currentTime,"geometry");scanEnergy+=.85;geometryTraces.push({kind:"ding",time:performance.now(),life:2200})}
   if(inPerform&&captureActive){captureEvents.push(cls);renderCapturePath()}
   if(scanEnergy>=threshold()){if(sonify&&referenceMetronomeAudible)await ringBell("geometry closure","geometry");geometryTraces.push({kind:"bell",time:performance.now(),life:3200});scanEnergy=0;if(inPerform&&captureActive){captureEvents.push("bell");renderCapturePath()}}
 }
}
function renderCapturePath(){
 if(!$("#showEventPath").checked){$("#capturedEventPath").textContent="";return}
 $("#capturedEventPath").textContent=captureEvents.length?captureEvents.map(x=>x==="bell"?"BELL":x.toUpperCase()).join(" · "):"— no captured events yet —";
}


async function maybeScanSavedReferences(now){
  if(!$("#sonifyScan").checked)return;
  if(!audioUnlocked||!geometryBusOn)return;
  const rate=+$("#scanRate").value;
  const inGeometry=$("#geometryView").classList.contains("active");
  const inPerform=$("#performView").classList.contains("active")&&$("#armGeometry").checked;
  if(!(inGeometry||inPerform))return;
  const canvas=inPerform?$("#performGeoCanvas"):$("#geoCanvas");
  for(const p of referencePresets.filter(x=>x.armed)){
    if(now-p.lastEvent<rate)continue;
    const sc=scoreReferencePair(canvas,p.A,p.B);
    const combined=(sc.scoreA+sc.scoreB)/2;
    const cls=combined>.81?"ding":combined>.60?"click":"none";
    if(cls==="none"){p.lastClass="none";continue}
    if(cls!==p.lastClass||now-p.lastEvent>rate*2){
      p.lastEvent=now;p.lastClass=cls;
      if(cls==="click"){click();p.energy+=.55}
      else{
        const oldA=referenceA,oldB=referenceB;
        referenceA=p.A;referenceB=p.B;
        const h=currentHarmony();dingPair(h.pA,h.pB,h.rel,audioCtx.currentTime,"geometry");
        referenceA=oldA;referenceB=oldB;
        p.energy+=.85;
      }
      log(`AUTO ${cls.toUpperCase()} · ${p.name} · alignment ${combined.toFixed(3)}`);
      if(p.energy>=threshold()){
        const oldA=referenceA,oldB=referenceB;
        referenceA=p.A;referenceB=p.B;
        await ringBell(`reference metronome ${p.name}`,"geometry");
        referenceA=oldA;referenceB=oldB;
        p.energy=0;
      }
    }
  }
}

function frame(now){
 const dt=(now-last)/1000;last=now;if($("#autoScan").checked){aA+=dt*+$("#speedA").value;aB+=dt*+$("#speedB").value;phase+=dt*.8}
 const g=drawGeometry($("#geoCanvas"),$("#geoCanvas").getContext("2d"),false);
 const p=drawGeometry($("#performGeoCanvas"),$("#performGeoCanvas").getContext("2d"),true);
 lastScoreA=g.scoreA;lastScoreB=g.scoreB;updateReadouts();maybeScanEvent(now);maybeScanSavedReferences(now);requestAnimationFrame(frame)
}
requestAnimationFrame(frame);

// capture
$("#captureReference").onclick=()=>{captureActive=true;captureEvents=[];captureTrailA=[{...referenceA}];captureTrailB=[{...referenceB}];$("#captureStatus").textContent="recording";$("#captureReference").disabled=true;$("#stopCapture").disabled=false;renderCapturePath();log("Reference capture started")};
$("#stopCapture").onclick=()=>{if(!captureActive)return;captureActive=false;$("#captureStatus").textContent="off";$("#captureReference").disabled=false;$("#stopCapture").disabled=true;
 const musicalEvents=captureEvents.filter(x=>x!=="bell");
 if(musicalEvents.length){savedTrains.push({name:`Merc ${savedTrains.length+1}`,pathName:`Reference Path ${savedTrains.length+1}`,events:musicalEvents,muted:false,solo:false,source:"reference",trailA:[...captureTrailA],trailB:[...captureTrailB]});renderSaved();renderPerformTracks();log("Captured reference became a saved train")}
};

// performance Mercs
function renderPerformTracks(){
 const box=$("#performTracks");box.innerHTML="";
 if(!savedTrains.length){box.innerHTML='<span class="caption">Save Ocarina trains or capture a reference phrase to create Mercs.</span>';return}
 savedTrains.forEach((tr,i)=>{
   if(!tr.pathName && (tr.trailA||tr.trailB))tr.pathName=`${tr.name} Path`;
   const row=document.createElement("div");row.className=`track-row ${tr.muted?"muted":""} ${tr.solo?"solo":""}`;
   const path=(tr.trailA||tr.trailB)?`<br><small>Path: <span class="path-name" data-perf-path="${i}">${tr.pathName}</span></small>`:"";
   row.innerHTML=`<div><strong class="merc-name" data-perf-merc="${i}">${tr.name}</strong> <small>${tr.source||"ocarina"}</small>${path}<br><code>${tr.events.join(" · ")}</code></div>
   <div class="track-controls"><button data-action="mute">${tr.muted?"Unmute":"Mute"}</button><button data-action="solo">${tr.solo?"Unsolo":"Solo"}</button><button data-action="load">Load</button><button data-action="delete">Delete</button></div>`;
   row.querySelector('[data-action="mute"]').onclick=()=>{tr.muted=!tr.muted;renderPerformTracks()};
   row.querySelector('[data-action="solo"]').onclick=()=>{tr.solo=!tr.solo;renderPerformTracks()};
   row.querySelector('[data-action="load"]').onclick=()=>{eventTrain=[...tr.events];renderTrain()};
   row.querySelector('[data-action="delete"]').onclick=()=>{savedTrains.splice(i,1);renderSaved();renderPerformTracks()};
   row.querySelector(`[data-perf-merc="${i}"]`).ondblclick=()=>renameMercAt(i,"merc");
   const pn=row.querySelector(`[data-perf-path="${i}"]`);if(pn)pn.ondblclick=()=>renameMercAt(i,"path");
   box.appendChild(row);
 });
}

function audibleTracks(){const solo=savedTrains.filter(t=>t.solo&&!t.muted);return solo.length?solo:savedTrains.filter(t=>!t.muted)}
function stopPerformance(){performanceToken++;performanceLooping=false;$("#loopSelected").classList.remove("active")}


function syncBusButtons(){
  const g=$("#muteGeometry");
  if(g){g.textContent=geometryBusOn?"Mute Geometry":"Listen Geometry";g.classList.toggle("muted",!geometryBusOn)}
  const m=$("#muteMercs");
  if(m){m.textContent=mercBusOn?"Mute Mercs":"Listen Mercs";m.classList.toggle("muted",!mercBusOn)}
  const all=$("#masterMute");
  if(all){all.textContent=masterAudible?"Mute All":"Listen All";all.classList.toggle("muted",!masterAudible)}
}
on("#muteGeometry","click",()=>{geometryBusOn=!geometryBusOn;syncBusButtons()});
on("#muteMercs","click",()=>{mercBusOn=!mercBusOn;syncBusButtons()});
on("#masterMute","click",async()=>{await ensureAudio();masterAudible=!masterAudible;if(masterGain)masterGain.gain.setTargetAtTime(masterAudible?1:0,audioCtx.currentTime,.015);syncBusButtons()});

async function playStack(loop=false){
 const Mercs=audibleTracks();if(!Mercs.length)return;stopPerformance();performanceLooping=loop;const token=++performanceToken;if(loop)$("#loopSelected").classList.add("active");
 do{await Promise.all(Mercs.map((tr,i)=>new Promise(res=>setTimeout(()=>playTrain(tr.events,token,0,"performance").then(res),i*35))))}while(loop&&performanceLooping&&token===performanceToken)
}
$("#playSelected").onclick=()=>playStack(false);
$("#loopSelected").onclick=()=>{if(performanceLooping)stopPerformance();else playStack(true)};

loadReferencePresets();renderTrain();renderSaved();drawPerformIncidence();updateReadouts();syncReferenceInputs();renderReferencePresets();syncReferenceMetronomeButtons();syncBusButtons();loadCore();


console.info("[MARL] Musical Atlas Relational Lattice v1.6 booted");

document.addEventListener("click",(ev)=>{
  const b=ev.target.closest("[data-merc-mute]");
  if(!b)return;
  const i=Number(b.dataset.mercMute);
  if(Number.isInteger(i) && savedTrains[i]){
    savedTrains[i].muted=!savedTrains[i].muted;
    renderSaved();
    if(typeof drawPerformIncidence==="function")drawPerformIncidence();
  }
});


// ---------------- Portable lattice data: MLD / PMS / WAV ----------------
const MLD_FORMAT="MLD", MLD_VERSION=1, PMS_FORMAT="PMS", PMS_VERSION=1;

function dl(blob,name){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=name; a.style.display="none";
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},600);
}
function cloneData(x){return JSON.parse(JSON.stringify(x))}
function cleanFileName(x,fallback){
  return (x||fallback||"lattice").replace(/[^\w\-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,64)||fallback;
}
function geometrySnapshot(){
  return {speedA:+$("#speedA").value,speedB:+$("#speedB").value,ripple:+$("#ripple").value,
    scanRate:+$("#scanRate").value,autoScan:$("#autoScan").checked,sonifyScan:$("#sonifyScan").checked,showAxes:$("#showAxes").checked};
}
function transportSnapshot(){
  return {tempo:+$("#tempo").value,clickRate:+$("#clickRate").value,dingRate:+$("#dingRate").value,
    noBellRate:+$("#noBellRate").value,bellThreshold:+$("#bellThreshold").value,growth:+$("#growth").value};
}
function makeMLD(){
  return {format:MLD_FORMAT,version:MLD_VERSION,createdAt:new Date().toISOString(),appVersion:"2.1.0",
    title:"Untitled Lattice",geometry:geometrySnapshot(),transport:transportSnapshot(),
    references:{A:cloneData(referenceA),B:cloneData(referenceB),
      presets:referencePresets.map(p=>({id:p.id,name:p.name,A:cloneData(p.A),B:cloneData(p.B),armed:!!p.armed}))},
    eventTrain:[...eventTrain],
    mercs:savedTrains.map(t=>({name:t.name,pathName:t.pathName||null,events:[...(t.events||[])],muted:!!t.muted,solo:!!t.solo,
      source:t.source||"ocarina",trailA:t.trailA?cloneData(t.trailA):null,trailB:t.trailB?cloneData(t.trailB):null})),
    audio:{voiceAOn,voiceBOn,geometryBusOn,mercBusOn,masterAudible}};
}
function applySlider(id,value){
  if(value===undefined||value===null)return;
  const el=$("#"+id);if(!el)return;el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));
}
function applyMLD(d){
  if(!d||d.format!==MLD_FORMAT||d.version!==MLD_VERSION)throw new Error("Unsupported MLD format/version.");
  if(d.geometry){
    applySlider("speedA",d.geometry.speedA);applySlider("speedB",d.geometry.speedB);applySlider("ripple",d.geometry.ripple);applySlider("scanRate",d.geometry.scanRate);
    if(d.geometry.autoScan!==undefined)$("#autoScan").checked=!!d.geometry.autoScan;
    if(d.geometry.sonifyScan!==undefined)$("#sonifyScan").checked=!!d.geometry.sonifyScan;
    if(d.geometry.showAxes!==undefined)$("#showAxes").checked=!!d.geometry.showAxes;
  }
  if(d.transport){
    for(const k of ["tempo","clickRate","dingRate","noBellRate","bellThreshold","growth"])applySlider(k,d.transport[k]);
  }
  if(d.references?.A)referenceA={...d.references.A}; if(d.references?.B)referenceB={...d.references.B};
  referencePresets=(d.references?.presets||[]).map((p,i)=>({id:p.id||`mld_${Date.now()}_${i}`,name:p.name||`Ref ${i+1}`,
    A:{...p.A},B:{...p.B},armed:!!p.armed,lastClass:"none",lastEvent:0,energy:0}));
  saveReferencePresets();
  eventTrain=Array.isArray(d.eventTrain)?[...d.eventTrain]:[];
  savedTrains=(d.mercs||[]).map((m,i)=>({name:m.name||`Merc ${i+1}`,pathName:m.pathName||null,events:[...(m.events||[])],muted:!!m.muted,solo:!!m.solo,
    source:m.source||"mld",trailA:m.trailA||null,trailB:m.trailB||null}));
  if(d.audio){voiceAOn=d.audio.voiceAOn!==false;voiceBOn=d.audio.voiceBOn!==false;geometryBusOn=d.audio.geometryBusOn!==false;mercBusOn=d.audio.mercBusOn!==false;masterAudible=d.audio.masterAudible!==false;}
  updateReadouts();syncReferenceInputs();renderReferencePresets();renderTrain();renderSaved();renderPerformTracks();syncVoiceButtons();syncBusButtons();
  log(`MLD · loaded ${d.title||"untitled"}`);
}
function makePMS(){
  return {format:PMS_FORMAT,version:PMS_VERSION,createdAt:new Date().toISOString(),appVersion:"2.1.0",
    title:"Persistent Merc Songbook",mercs:savedTrains.map(t=>({name:t.name,pathName:t.pathName||null,events:[...(t.events||[])],source:t.source||"ocarina",
      trailA:t.trailA?cloneData(t.trailA):null,trailB:t.trailB?cloneData(t.trailB):null}))};
}
function applyPMS(d){
  if(!d||d.format!==PMS_FORMAT||d.version!==PMS_VERSION)throw new Error("Unsupported PMS format/version.");
  const start=savedTrains.length;
  (d.mercs||[]).forEach((m,i)=>savedTrains.push({name:m.name||`Merc ${start+i+1}`,pathName:m.pathName||null,events:[...(m.events||[])],
    muted:false,solo:false,source:m.source||"pms",trailA:m.trailA||null,trailB:m.trailB||null}));
  renderSaved();renderPerformTracks();log(`PMS · imported ${(d.mercs||[]).length} Mercs`);
}
async function readJSONFile(file){return JSON.parse(await file.text())}

on("#saveMLD","click",()=>{const d=makeMLD();dl(new Blob([JSON.stringify(d,null,2)],{type:"application/json"}),cleanFileName(d.title,"lattice")+".mld")});
on("#openMLD","change",async ev=>{const f=ev.target.files?.[0];if(!f)return;try{applyMLD(await readJSONFile(f))}catch(e){alert("Could not open MLD: "+e.message)}ev.target.value=""});
on("#savePMS","click",()=>{const d=makePMS();dl(new Blob([JSON.stringify(d,null,2)],{type:"application/json"}),cleanFileName(d.title,"songbook")+".pms")});
on("#openPMS","change",async ev=>{const f=ev.target.files?.[0];if(!f)return;try{applyPMS(await readJSONFile(f))}catch(e){alert("Could not open PMS: "+e.message)}ev.target.value=""});

// Lossless 44.1kHz / 16-bit mono PCM WAV rendering of current Ocarina event train.
// WAV is an audio rendering only; MLD remains the reconstructible source.
function wavRender(events){
  const sr=44100,beat=60/(+$("#tempo").value||108);
  const er=e=>e==="click"?+$("#clickRate").value:e==="ding"?+$("#dingRate").value:+$("#noBellRate").value;
  const dur=e=>beat/Math.max(.01,er(e)||1);
  const total=Math.max(.8,events.reduce((s,e)=>s+dur(e),0)+.8), n=Math.ceil(total*sr), samples=new Float32Array(n);
  let at=0,energy=0,ord=0; const h=currentHarmony();
  function sine(start,freq,len,gain,det=0){const f=freq*Math.pow(2,det/1200),i0=Math.floor(start*sr),i1=Math.min(n,i0+Math.floor(len*sr));
    for(let i=i0;i<i1;i++){const t=(i-i0)/sr;samples[i]+=Math.sin(2*Math.PI*f*t)*gain*Math.exp(-4*t/Math.max(.02,len));}}
  function noise(start,len,gain){const i0=Math.floor(start*sr),i1=Math.min(n,i0+Math.floor(len*sr));
    for(let i=i0;i<i1;i++){const t=(i-i0)/sr;samples[i]+=(Math.random()*2-1)*gain*Math.max(0,1-t/len);}}
  for(const e of events){
    if(e==="click"){noise(at,.02,.16);sine(at,950,.04,.05);energy+=contribution("click",ord++)}
    else if(e==="ding"){if(voiceAOn){sine(at,h.pA.freq,.72,.10);sine(at,h.pA.freq*2,.30,.025)}
      if(voiceBOn)sine(at,h.pB.freq,.72,.09,h.rel.harmonic?0:(referenceB.x>=referenceA.x?h.rel.detune:-h.rel.detune));energy+=contribution("ding",ord++)}
    else{sine(at,92,.18,.07);noise(at,.05,.05);energy=0;ord=0}
    if(energy>=threshold()){const bt=at+.06;if(voiceAOn){sine(bt,h.pA.freq,1.8,.11);sine(bt,h.pA.freq*2,1.2,.05)}
      if(voiceBOn)sine(bt,h.pB.freq,1.8,.09,h.rel.harmonic?0:(referenceB.x>=referenceA.x?h.rel.detune:-h.rel.detune));energy=0;ord=0}
    at+=dur(e);
  }
  let peak=0;for(const x of samples)peak=Math.max(peak,Math.abs(x));if(peak>.98){const s=.98/peak;for(let i=0;i<n;i++)samples[i]*=s}
  const b=new ArrayBuffer(44+n*2),v=new DataView(b),ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  ws(0,"RIFF");v.setUint32(4,36+n*2,true);ws(8,"WAVE");ws(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ws(36,"data");v.setUint32(40,n*2,true);
  let o=44;for(const x of samples){v.setInt16(o,Math.max(-1,Math.min(1,x))*32767,true);o+=2}
  return new Blob([b],{type:"audio/wav"});
}
on("#exportWav","click",()=>{if(!eventTrain.length){alert("The current Ocarina event train is empty.");return}dl(wavRender(eventTrain),"merkabarina_render.wav")});
