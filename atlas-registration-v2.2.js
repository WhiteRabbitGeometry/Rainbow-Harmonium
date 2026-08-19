/*
  MARL v2.2 registration extension
  - Display CLICK as AH (CLICK) without breaking existing MLD/PMS "click" events.
  - Add LING as a sustained registration sound/event.
  - Overlay the Ah-zeroed dual-triangle registration kernel on 2D incidence and 3D geometry.
  - Preserve Bell / No Bell semantics. LING contributes no Bell energy in this revision.
*/
(function(){
  const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];

  function labelAh(el){
    if(!el) return;
    el.innerHTML='AH<br><small>(CLICK)</small>';
    el.setAttribute('aria-label','Ah, click');
  }
  qa('[data-incidence-event="click"],[data-geometry-event="click"],[data-perform-event="click"],[data-sound="click"],[data-perf-sound="click"]')
    .forEach(labelAh);

  function addLingIndicator(parentSelector, attr){
    qa(parentSelector).forEach(box=>{
      if(box.querySelector(`[${attr}="ling"]`)) return;
      const s=document.createElement('span');
      s.setAttribute(attr,'ling');
      s.textContent='LING';
      box.insertBefore(s, box.querySelector(`[${attr}="nobell"]`) || null);
    });
  }
  addLingIndicator('.incidence-events','data-incidence-event');
  addLingIndicator('.geometry-events','data-geometry-event');
  addLingIndicator('.perform-events','data-perform-event');

  click=function(t=audioCtx.currentTime){
    flashEvent("click");
    noiseBurst(t,.018,.12);
    tone(220,t,.34,.05,"sine");
    tone(330,t,.28,.032,"sine");
    tone(440,t,.20,.018,"sine");
  };

  function lingPair(pA,pB,rel,t=audioCtx.currentTime,bus="merc"){
    if(!busAllowed(bus)) return;
    flashEvent("ling");
    const d=rel.harmonic?0:(referenceB.x>=referenceA.x?rel.detune:-rel.detune);
    if(voiceAOn){
      tone(pA.freq,t,1.55,.065,"sine",0);
      tone(pA.freq*1.5,t,1.2,.028,"sine",0);
    }
    if(voiceBOn){
      tone(pB.freq,t,1.55,.06,"sine",d);
      tone(pB.freq*1.5,t,1.2,.025,"sine",d);
    }
  }

  const baseContribution=contribution;
  contribution=function(type,ordinal){
    if(type==="ling") return 0;
    return baseContribution(type,ordinal);
  };

  const baseDurationFor=durationFor;
  durationFor=function(type){
    if(type==="ling"){
      const beat=60/(+q("#tempo").value||108);
      const rate=+q("#dingRate").value||1;
      return 2*beat/Math.max(.01,rate);
    }
    return baseDurationFor(type);
  };

  const baseSoundEvent=soundEvent;
  soundEvent=async function(type,source="manual",record=true,bus="merc"){
    if(type!=="ling") return baseSoundEvent(type,source,record,bus);
    await ensureAudio();
    const {pA,pB,rel}=currentHarmony();
    lingPair(pA,pB,rel,audioCtx.currentTime,bus);
    if(record){eventTrain.push(type);renderTrain();}
    log(`LING · ${source}`);
  };

  playTrain=async function(events,token,cycle=0,kind="transport"){
    let e=0,ord=0;if(!events.length)return false;
    for(let i=0;i<events.length;i++){
      const valid=kind==="transport"?token===transportToken:token===performanceToken;
      if(!valid)return false;
      const type=events[i];
      if(kind==="transport")highlightTrainStep(i);
      await ensureAudio();
      if(type==="click"){
        click();e+=contribution(type,ord++);
      } else if(type==="ding"){
        const h=currentHarmony();dingPair(h.pA,h.pB,h.rel,audioCtx.currentTime,"merc");
        e+=contribution(type,ord++);
      } else if(type==="ling"){
        const h=currentHarmony();lingPair(h.pA,h.pB,h.rel,audioCtx.currentTime,"merc");
      } else {
        noBell();e=0;ord=0;
      }
      if(e>=threshold()){
        await sleep(65,token,kind);
        const still=kind==="transport"?token===transportToken:token===performanceToken;
        if(!still)return false;
        await ringBell(`${kind} threshold`,"merc");
        e=0;ord=0;
      }
      if(kind==="transport")q("#loopStatus").textContent=`Cycle ${cycle+1} · energy ${e.toFixed(2)} / ${threshold().toFixed(1)}`;
      if(!(await sleep(durationFor(type)*1000,token,kind)))return false;
    }
    if(kind==="transport")clearTrainHighlight();
    return true;
  };

  function addLingPad(){
    const grid=q('#ocarinaView .instrument-grid');
    if(grid && !grid.querySelector('[data-sound="ling"]')){
      const b=document.createElement('button');
      b.className='pad ling-pad';
      b.dataset.sound='ling';
      b.textContent='LING';
      b.addEventListener('click',()=>addEvent('ling'));
      grid.insertBefore(b,grid.querySelector('.no-bell-pad'));
    }
    const pg=q('.perform-pads');
    if(pg && !pg.querySelector('[data-perf-sound="ling"]')){
      const b=document.createElement('button');
      b.className='mini-pad';
      b.dataset.perfSound='ling';
      b.textContent='LING';
      b.addEventListener('click',()=>{if(q("#armPads").checked)soundEvent("ling","performance pad",false,"merc")});
      pg.insertBefore(b,pg.querySelector('[data-perf-sound="nobell"]'));
    }
  }
  addLingPad();

  const AH_KERNEL=[[0,0],[-3,6],[-6,3]];
  const KERNEL_NAMES=['AH','DING','BELL'];

  function drawTriangle2D(svg){
    if(!svg || svg.querySelector('.merkaba-kernel')) return;
    const NS='http://www.w3.org/2000/svg';
    const g=document.createElementNS(NS,'g');
    g.setAttribute('class','merkaba-kernel');
    g.setAttribute('transform','translate(730 510) scale(17 -17)');
    const p=document.createElementNS(NS,'polygon');
    p.setAttribute('points',AH_KERNEL.map(v=>v.join(',')).join(' '));
    p.setAttribute('fill','rgba(215,180,92,.05)');
    p.setAttribute('stroke','#d7b45c');
    p.setAttribute('stroke-width','.13');
    g.appendChild(p);
    AH_KERNEL.forEach((v,i)=>{
      const c=document.createElementNS(NS,'circle');
      c.setAttribute('cx',v[0]);c.setAttribute('cy',v[1]);c.setAttribute('r','.24');
      c.setAttribute('fill',i===0?'#f2f0ea':'#8ba7ff');
      g.appendChild(c);
      const t=document.createElementNS(NS,'text');
      t.setAttribute('x',v[0]+.32);t.setAttribute('y',v[1]-.32);
      t.setAttribute('font-size','.75');t.setAttribute('fill','#f2f0ea');
      t.setAttribute('transform',`scale(1 -1) translate(0 ${-2*v[1]})`);
      t.textContent=KERNEL_NAMES[i];
      g.appendChild(t);
    });
    svg.appendChild(g);
  }
  drawTriangle2D(q('#incidenceSvg'));
  drawTriangle2D(q('#performIncidenceSvg'));

  const baseDrawGeometry=drawGeometry;
  drawGeometry=function(canvas,ctx,performance=false){
    const result=baseDrawGeometry(canvas,ctx,performance);
    const w=canvas.width,h=canvas.height;
    const rel=(aA-aB);
    const cx=w/2,cy=h/2,scale=Math.min(w,h)*.026;
    const centered=[[3,-3],[0,3],[-3,0]];
    function tri(angle,color,alpha){
      const ca=Math.cos(angle),sa=Math.sin(angle);
      const pts=centered.map(([x,y])=>[
        cx+(x*ca-y*sa)*scale,
        cy+(x*sa+y*ca)*scale
      ]);
      ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=2.4;
      ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
      ctx.lineTo(pts[1][0],pts[1][1]);ctx.lineTo(pts[2][0],pts[2][1]);ctx.closePath();ctx.stroke();
      pts.forEach((p,i)=>{ctx.beginPath();ctx.arc(p[0],p[1],i===0?4.5:3.2,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();});
      ctx.restore();
    }
    tri(rel/2,'#d7b45c',.78);
    tri(-rel/2+Math.PI,'#8ba7ff',.58);

    ctx.save();
    ctx.fillStyle='rgba(242,240,234,.85)';
    ctx.font='12px ui-monospace';
    ctx.textAlign='center';
    ctx.fillText('AH = neutral registration · dual triangle = Merkaba hypothesis',cx,h-24);
    ctx.restore();
    return result;
  };

  const legend=document.createElement('p');
  legend.className='caption merkaba-caption';
  legend.innerHTML='<strong>Inner registration:</strong> AH (click) = neutral zero; DING = discrete contact; LING = sustained registration. Dual triangles are an exploratory Merkaba layer inside the existing dodecahedral shells.';
  const canvas=q('#geoCanvas');
  if(canvas) canvas.insertAdjacentElement('afterend',legend);

  const baseMakeMLD=makeMLD;
  makeMLD=function(){const d=baseMakeMLD();d.appVersion="2.2.0";return d;};
  const baseMakePMS=makePMS;
  makePMS=function(){const d=baseMakePMS();d.appVersion="2.2.0";return d;};

  wavRender=function(events){
    const sr=44100,beat=60/(+q("#tempo").value||108);
    const er=e=>e==="click"?+q("#clickRate").value:(e==="ding"||e==="ling")?+q("#dingRate").value:+q("#noBellRate").value;
    const dur=e=>e==="ling"?2*beat/Math.max(.01,er(e)||1):beat/Math.max(.01,er(e)||1);
    const total=Math.max(.8,events.reduce((s,e)=>s+dur(e),0)+.8),n=Math.ceil(total*sr),samples=new Float32Array(n);
    let at=0,energy=0,ord=0;const h=currentHarmony();
    function sine(start,freq,len,gain,det=0){const f=freq*Math.pow(2,det/1200),i0=Math.floor(start*sr),i1=Math.min(n,i0+Math.floor(len*sr));
      for(let i=i0;i<i1;i++){const tt=(i-i0)/sr;samples[i]+=Math.sin(2*Math.PI*f*tt)*gain*Math.exp(-4*tt/Math.max(.02,len));}}
    function noise(start,len,gain){const i0=Math.floor(start*sr),i1=Math.min(n,i0+Math.floor(len*sr));
      for(let i=i0;i<i1;i++){const tt=(i-i0)/sr;samples[i]+=(Math.random()*2-1)*gain*Math.max(0,1-tt/len);}}
    for(const e of events){
      if(e==="click"){
        noise(at,.02,.12);sine(at,220,.34,.05);sine(at,330,.28,.032);sine(at,440,.20,.018);
        energy+=contribution("click",ord++);
      } else if(e==="ding"){
        if(voiceAOn){sine(at,h.pA.freq,.72,.10);sine(at,h.pA.freq*2,.30,.025);}
        if(voiceBOn)sine(at,h.pB.freq,.72,.09,h.rel.harmonic?0:(referenceB.x>=referenceA.x?h.rel.detune:-h.rel.detune));
        energy+=contribution("ding",ord++);
      } else if(e==="ling"){
        const dd=h.rel.harmonic?0:(referenceB.x>=referenceA.x?h.rel.detune:-h.rel.detune);
        if(voiceAOn){sine(at,h.pA.freq,1.55,.065);sine(at,h.pA.freq*1.5,1.2,.028);}
        if(voiceBOn){sine(at,h.pB.freq,1.55,.06,dd);sine(at,h.pB.freq*1.5,1.2,.025,dd);}
      } else {
        sine(at,92,.18,.07);noise(at,.05,.05);energy=0;ord=0;
      }
      if(energy>=threshold()){
        const bt=at+.06;
        if(voiceAOn){sine(bt,h.pA.freq,1.8,.11);sine(bt,h.pA.freq*2,1.2,.05);}
        if(voiceBOn)sine(bt,h.pB.freq,1.8,.09,h.rel.harmonic?0:(referenceB.x>=referenceA.x?h.rel.detune:-h.rel.detune));
        energy=0;ord=0;
      }
      at+=dur(e);
    }
    let peak=0;for(const x of samples)peak=Math.max(peak,Math.abs(x));if(peak>.98){const s=.98/peak;for(let i=0;i<n;i++)samples[i]*=s;}
    const b=new ArrayBuffer(44+n*2),v=new DataView(b),ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    ws(0,"RIFF");v.setUint32(4,36+n*2,true);ws(8,"WAVE");ws(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ws(36,"data");v.setUint32(40,n*2,true);
    let oo=44;for(const x of samples){v.setInt16(oo,Math.max(-1,Math.min(1,x))*32767,true);oo+=2;}
    return new Blob([b],{type:"audio/wav"});
  };

  const baseDrawPerformIncidence=drawPerformIncidence;
  drawPerformIncidence=function(){
    baseDrawPerformIncidence();
    drawTriangle2D(q('#performIncidenceSvg'));
  };

  qa('.status').forEach(el=>{
    if(el.textContent.includes('MODEL:')) el.textContent='MODEL: v2.2.0';
  });
  const footer=[...document.querySelectorAll('footer span')].find(x=>x.textContent.includes('Musical Atlas Relational Lattice'));
  if(footer) footer.textContent='Musical Atlas Relational Lattice · v2.2.0';
})();
