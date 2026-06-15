"use strict";
/* The `store` object (get/set/delete/list) is provided by store.js, which is
   loaded before this file. It routes shared data to Firebase (if configured)
   and keeps each player's own bankroll in their browser. */

const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const fmt=n=>Math.round(n).toLocaleString("en-US");
const KEY="sex3bet:v1", SHARED=false;
const CFGKEY="sex3bet:config:v1";

let S={ id:"", name:"", balance:1000, wagered:0, biggest:0, deposited:1000, season:null };
let CFG=null;            // {ownerId, pinHash, locked}
let adminUnlocked=false; // unlocked this session via PIN
let mem=false;

function hashPin(s){ let h=5381; for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return h.toString(36); }
function isLocked(){ return !!(CFG && CFG.locked); }
function isAdmin(){ return CFG ? (CFG.ownerId===S.id || adminUnlocked) : true; }

let toastTimer=null;
function toast(t){ const el=$("#toast"); el.textContent=t; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),3200); }

async function load(){ try{ const r=await store.get(KEY,SHARED); if(r&&r.value) S=Object.assign(S,JSON.parse(r.value)); }catch(e){} if(!S.id) S.id=Math.random().toString(36).slice(2,10); if(S.deposited==null) S.deposited=S.balance; }
async function loadCfg(){ try{ const r=await store.get(CFGKEY,true); if(r&&r.value) CFG=JSON.parse(r.value); }catch(e){} }
async function saveCfg(){ try{ await store.set(CFGKEY,JSON.stringify(CFG),true); }catch(e){} }
async function save(){ try{ await store.set(KEY,JSON.stringify(S),SHARED); }catch(e){ mem=true; updateMemTag(); } }
function updateMemTag(){ $("#memTag").innerHTML = "Play money only — no real cash, no deposits, no payouts. Just for fun with the server. Your handle and stats are shared to the leaderboard with everyone who opens this page."+(mem?"<br>(Storage off — bankroll and board won't save this session.)":""); }

function renderWallet(){ $("#balAmt").textContent=fmt(S.balance); $("#stWager").textContent=fmt(S.wagered); $("#stBig").textContent=fmt(S.biggest); }
function addWager(a){ S.wagered+=a; }
function recordWin(profit){ if(profit>S.biggest) S.biggest=profit; }
function canBet(a){ return a>0 && a<=S.balance; }
function debit(a){ S.balance-=a; renderWallet(); }
function credit(a){ S.balance+=a; renderWallet(); }
function commit(){ renderWallet(); save(); pushLeaderboardDebounced(); }

/* amount helper buttons */
$$("[data-amt]").forEach(b=>b.onclick=()=>{
  const inp=$("#"+b.dataset.amt); let v=Number(inp.value)||0;
  if(b.dataset.op==="half") v=Math.max(1,Math.floor(v/2));
  if(b.dataset.op==="double") v=v*2;
  if(b.dataset.op==="max") v=Math.floor(S.balance);
  inp.value=Math.max(1,v);
});

/* nav */
$$(".navitem").forEach(n=>n.onclick=()=>{
  $$(".navitem").forEach(x=>x.classList.toggle("on",x===n));
  $$(".game").forEach(g=>g.classList.remove("on"));
  $("#g-"+n.dataset.game).classList.add("on");
  if(n.dataset.game==="leaderboard") renderLeaderboard();
  if(n.dataset.game==="admin") renderAdmin();
  if(n.dataset.game==="crash") crashTabOpened();
});

/* faucet / reset */
const ov=$("#ov"); let ovMode="faucet";
function renderChipBtn(){ const b=$("#faucetBtn"); const restricted=isLocked()&&!isAdmin(); b.classList.toggle("locked",restricted); b.title= restricted? "Locked — ask the owner for chips" : "Add play chips"; }
$("#faucetBtn").onclick=()=>{
  if(isLocked() && !isAdmin()){ toast("Chips are locked — ask the owner for a top-up."); return; }
  ovMode="faucet"; $("#ovTitle").textContent="Top up your chips"; $("#ovText").textContent="These are play chips — no real money, no payouts."; $("#ovOk").textContent="Add 1,000"; ov.classList.add("on");
};
$("#resetBtn").onclick=()=>{
  if(isLocked() && !isAdmin()){ toast("Resets are locked — only the owner can do that."); return; }
  ovMode="reset"; $("#ovTitle").textContent="Reset bankroll?"; $("#ovText").textContent="Sets your balance back to 1,000 and clears your stats."; $("#ovOk").textContent="Reset"; ov.classList.add("on");
};
$("#ovCancel").onclick=()=>ov.classList.remove("on");
ov.onclick=e=>{ if(e.target===ov) ov.classList.remove("on"); };
$("#ovOk").onclick=()=>{ if(ovMode==="faucet"){ S.balance+=1000; S.deposited+=1000; } else { S.balance=1000; S.wagered=0; S.biggest=0; S.deposited=1000; } commit(); ov.classList.remove("on"); };

/* ===================================================== BLACKJACK */
const BJ={ active:false, deck:[], player:[], dealer:[], staked:0, done:false };
const SUITS=["♠","♥","♦","♣"], RANKS=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
function freshDeck(){ const d=[]; for(const s of SUITS) for(const r of RANKS) d.push({r,s}); for(let i=d.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[d[i],d[j]]=[d[j],d[i]];} return d; }
function cardVal(c){ if(c.r==="A") return 11; if(["K","Q","J"].includes(c.r)) return 10; return +c.r; }
function handVal(cards){ let t=0,a=0; for(const c of cards){ t+=cardVal(c); if(c.r==="A")a++; } while(t>21&&a>0){t-=10;a--;} return t; }
function cardHTML(c,hidden){ if(hidden) return `<div class="card back"></div>`; const red=(c.s==="♥"||c.s==="♦"); return `<div class="card ${red?'red':''}"><div class="r">${c.r}</div><div class="s">${c.s}</div></div>`; }
function bjRender(reveal){
  $("#bjPlayer").innerHTML=BJ.player.map(c=>cardHTML(c,false)).join("");
  $("#bjDealer").innerHTML=BJ.dealer.map((c,i)=>cardHTML(c,(i===1&&!reveal))).join("");
  $("#bjPlayerVal").textContent=BJ.player.length?handVal(BJ.player):"—";
  $("#bjDealerVal").textContent= reveal?(BJ.dealer.length?handVal(BJ.dealer):"—") : (BJ.dealer.length?cardVal(BJ.dealer[0]):"—");
}
function bjSetMsg(t,cls){ const m=$("#bjMsg"); m.textContent=t; m.className="msg "+(cls||""); }
$("#bjDeal").onclick=()=>{
  if(BJ.active) return;
  const bet=Math.floor(Number($("#bjBet").value)||0);
  if(!canBet(bet)){ bjSetMsg("Not enough chips for that bet.","lose"); return; }
  debit(bet); addWager(bet); BJ.staked=bet; BJ.active=true; BJ.done=false;
  BJ.deck=freshDeck(); BJ.player=[BJ.deck.pop(),BJ.deck.pop()]; BJ.dealer=[BJ.deck.pop(),BJ.deck.pop()];
  $("#bjActions").style.display="grid"; $("#bjDeal").style.display="none";
  $("#bjDouble").disabled=!canBet(bet);
  bjRender(false); bjSetMsg("Hit or stand.","");
  // naturals
  const pBJ=handVal(BJ.player)===21, dBJ=handVal(BJ.dealer)===21;
  if(pBJ||dBJ){ bjFinish(); }
};
$("#bjHit").onclick=()=>{ if(!BJ.active||BJ.done) return; BJ.player.push(BJ.deck.pop()); $("#bjDouble").disabled=true; bjRender(false); if(handVal(BJ.player)>=21) bjStand(); };
$("#bjDouble").onclick=()=>{
  if(!BJ.active||BJ.done||BJ.player.length!==2) return;
  if(!canBet(BJ.staked)){ bjSetMsg("Not enough chips to double.","lose"); return; }
  debit(BJ.staked); addWager(BJ.staked); BJ.staked*=2;
  BJ.player.push(BJ.deck.pop()); bjRender(false); bjStand();
};
function bjStand(){ if(!BJ.active||BJ.done) return; bjFinish(); }
$("#bjStand").onclick=bjStand;
function bjFinish(){
  BJ.done=true;
  // dealer draws to 17 (unless player already busted)
  const pv=handVal(BJ.player);
  if(pv<=21){ while(handVal(BJ.dealer)<17) BJ.dealer.push(BJ.deck.pop()); }
  bjRender(true);
  const dv=handVal(BJ.dealer);
  const pBJ=(pv===21&&BJ.player.length===2), dBJ=(dv===21&&BJ.dealer.length===2);
  let payout=0, txt="", cls="";
  if(pBJ&&dBJ){ payout=BJ.staked; txt="Push — both blackjack."; cls="push"; }
  else if(pBJ){ payout=Math.round(BJ.staked*2.5); txt="Blackjack! Pays 3:2 🎉"; cls="win"; }
  else if(pv>21){ payout=0; txt="Bust. You lose."; cls="lose"; }
  else if(dv>21){ payout=BJ.staked*2; txt="Dealer busts — you win!"; cls="win"; }
  else if(pv>dv){ payout=BJ.staked*2; txt="You win!"; cls="win"; }
  else if(pv<dv){ payout=0; txt="Dealer wins."; cls="lose"; }
  else { payout=BJ.staked; txt="Push."; cls="push"; }
  if(payout>0){ credit(payout); recordWin(payout-BJ.staked); }
  bjSetMsg(txt,cls);
  BJ.active=false; $("#bjActions").style.display="none"; $("#bjDeal").style.display="block";
  commit();
}

/* ===================================================== MINES */
const M={ active:false, mines:[], revealed:[], count:3, bet:0, picks:0 };
(function initMines(){ const sel=$("#mMines"); for(let i=1;i<=24;i++){ const o=document.createElement("option"); o.value=i;o.textContent=i+(i===1?" mine":" mines"); sel.appendChild(o);} sel.value=3; })();
function minesMult(picks,mines){ let m=1; const safe=25-mines; for(let i=0;i<picks;i++){ m*=(25-i)/(safe-i); } return m*0.99; }
function mBuildGrid(){
  const g=$("#mGrid"); g.innerHTML="";
  for(let i=0;i<25;i++){ const b=document.createElement("button"); b.className="tile"; b.dataset.i=i; b.disabled=true; b.onclick=()=>mPick(i); g.appendChild(b); }
}
mBuildGrid();
// render cheat btn once DOM is ready (isAdmin() needs CFG, so also called after boot)
document.addEventListener("DOMContentLoaded", ()=>mRenderCheatBtn());
let mCheatOn=false;
function mApplyCheat(){
  $$("#mGrid .tile").forEach((t,i)=>{
    t.classList.toggle("cheat-mine", mCheatOn && M.active && M.mines.includes(i) && !t.classList.contains("mine") && !t.classList.contains("safe"));
  });
}
function mRenderCheatBtn(){
  const existing=$("#mCheatBtn");
  if(!isAdmin()){ if(existing) existing.remove(); return; }
  if(existing){ existing.textContent=mCheatOn?"👁 Hide bombs":"👁 Peek (owner)"; return; }
  const btn=document.createElement("button");
  btn.id="mCheatBtn"; btn.className="secondary"; btn.style.cssText="margin-top:12px;width:100%;font-size:12px;opacity:.6";
  btn.textContent="👁 Peek (owner)";
  btn.onclick=()=>{ mCheatOn=!mCheatOn; mApplyCheat(); mRenderCheatBtn(); };
  $("#mStart").parentNode.insertBefore(btn, $("#mStart").nextSibling);
}
function mInfo(){
  const nextMult=M.active?minesMult(M.picks+1,M.count):0;
  $("#mNext").textContent=M.active?("+"+(nextMult-minesMult(M.picks,M.count)>=0? nextMult.toFixed(2):nextMult.toFixed(2))+"×"):"—";
  $("#mNext").textContent=M.active?nextMult.toFixed(2)+"×":"—";
  const cur=M.active&&M.picks>0?minesMult(M.picks,M.count):1;
  $("#mMult").textContent=cur.toFixed(2)+"×";
  $("#mCashVal").textContent=(M.active&&M.picks>0)?fmt(M.bet*cur):"—";
}
$("#mStart").onclick=()=>{
  if(M.active) return;
  const bet=Math.floor(Number($("#mBet").value)||0);
  if(!canBet(bet)){ $("#mMsg").textContent="Not enough chips."; $("#mMsg").className="msg lose"; return; }
  M.count=+$("#mMines").value; M.bet=bet; M.picks=0; M.active=true; M.revealed=[];
  debit(bet); addWager(bet);
  // place mines
  const idx=[...Array(25).keys()]; for(let i=idx.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[idx[i],idx[j]]=[idx[j],idx[i]];}
  M.mines=idx.slice(0,M.count);
  $$("#mGrid .tile").forEach(t=>{ t.className="tile"; t.textContent=""; t.disabled=false; });
  $("#mStart").style.display="none"; $("#mCash").style.display="block"; $("#mMines").disabled=true;
  $("#mMsg").textContent=""; mInfo(); mApplyCheat(); commit();
};
function mPick(i){
  if(!M.active||M.revealed.includes(i)) return;
  const t=$$("#mGrid .tile")[i];
  if(M.mines.includes(i)){
    // boom
    t.classList.add("mine"); t.textContent="💣";
    mReveal(true); M.active=false;
    $("#mStart").style.display="block"; $("#mCash").style.display="none"; $("#mMines").disabled=false;
    $("#mMsg").textContent="Boom 💥 lost "+fmt(M.bet)+"."; $("#mMsg").className="msg lose";
    mInfo(); commit(); return;
  }
  M.revealed.push(i); M.picks++;
  t.classList.remove("cheat-mine"); t.classList.add("safe"); t.textContent="💎"; t.disabled=true;
  if(M.revealed.length===25-M.count){ mCashout(true); }
  else{ mApplyCheat(); mInfo(); }
}
function mReveal(showAll){ $$("#mGrid .tile").forEach((t,i)=>{ t.disabled=true; t.classList.remove("cheat-mine"); if(M.mines.includes(i)&&!t.classList.contains("mine")){ t.textContent="💣"; t.classList.add("dim"); } }); }
function mCashout(auto){
  if(!M.active||M.picks===0){ if(!auto){ $("#mMsg").textContent="Reveal a tile first."; } return; }
  const mult=minesMult(M.picks,M.count); const win=Math.round(M.bet*mult);
  credit(win); recordWin(win-M.bet); M.active=false;
  mReveal(true);
  $("#mStart").style.display="block"; $("#mCash").style.display="none"; $("#mMines").disabled=false;
  $("#mMsg").textContent="Cashed out "+fmt(win)+" ("+mult.toFixed(2)+"×) 🎉"; $("#mMsg").className="msg win";
  mInfo(); commit();
}
$("#mCash").onclick=()=>mCashout(false);
mInfo();

/* ===================================================== PLINKO */
const PTAB={
  8:{ low:[5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6], med:[13,3,1.3,0.7,0.4,0.7,1.3,3,13], high:[29,4,1.5,0.3,0.2,0.3,1.5,4,29] },
  12:{ low:[10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10], med:[24,5,2,1.4,0.6,0.4,0.2,0.4,0.6,1.4,2,5,24], high:[58,8,3,2,0.7,0.2,0.2,0.2,0.7,2,3,8,58] },
  16:{ low:[16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16], med:[110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110], high:[1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000] }
};
let pRisk="low", pRows=12;
$$("#pRisk button").forEach(b=>b.onclick=()=>{ $$("#pRisk button").forEach(x=>x.classList.toggle("on",x===b)); pRisk=b.dataset.risk; pDraw(); });
$$("#pRows button").forEach(b=>b.onclick=()=>{ $$("#pRows button").forEach(x=>x.classList.toggle("on",x===b)); pRows=+b.dataset.rows; pDraw(); });
const pcv=$("#plinkoCanvas"), pctx=pcv.getContext("2d");
let balls=[], pAnim=false;
function pPegPos(){
  const W=pcv.width,topY=40,botY=pcv.height-70, gapY=(botY-topY)/pRows;
  const pegs=[];
  for(let r=0;r<pRows;r++){ const n=r+2, rowW=(n-1)*36, x0=W/2-rowW/2; const row=[]; for(let c=0;c<n;c++) row.push({x:x0+c*36,y:topY+r*gapY}); pegs.push(row); }
  return {pegs,topY,botY,gapY,W};
}
function pDraw(){
  const {pegs,botY,W}=pPegPos(); const tab=PTAB[pRows][pRisk];
  pctx.clearRect(0,0,W,pcv.height);
  // pegs
  pctx.fillStyle="#3a516b";
  pegs.forEach(row=>row.forEach(p=>{ pctx.beginPath(); pctx.arc(p.x,p.y,3.2,0,7); pctx.fill(); }));
  // buckets
  const n=tab.length, bw=Math.min(40,(W-20)/n), startX=W/2-(n*bw)/2;
  for(let i=0;i<n;i++){ const v=tab[i]; const t=Math.min(1,Math.log(v+1)/Math.log(150)); 
    const col=v>=2?`rgb(${230},${120-t*60},${60})`:(v>=1?`rgb(${230},${190},${70})`:`rgb(${40},${160},${90})`);
    pctx.fillStyle=col; const x=startX+i*bw; pctx.beginPath(); pctx.roundRect(x+1,botY+8,bw-2,30,6); pctx.fill();
    pctx.fillStyle="#0b1118"; pctx.font="bold "+(n>13?9:11)+"px ui-monospace,monospace"; pctx.textAlign="center";
    pctx.fillText(v+"×",x+bw/2,botY+28);
  }
  // balls
  pctx.fillStyle="#fff";
  balls.forEach(b=>{ pctx.beginPath(); pctx.arc(b.x,b.y,5,0,7); pctx.fill(); });
}
function pLoop(){
  const {pegs,topY,botY,gapY,W}=pPegPos(); const tab=PTAB[pRows][pRisk];
  let alive=false;
  balls.forEach(b=>{
    if(b.done) return; alive=true;
    b.y+=4.2;
    const r=Math.min(pRows, Math.floor((b.y-topY)/gapY)+1);
    if(r>b.row && r<=pRows){ b.row=r; b.dir=Math.random()<0.5?-1:1; if(b.dir>0)b.rights++; b.tx+=b.dir*18; }
    b.x+=(b.tx-b.x)*0.25;
    if(b.y>=botY){ b.y=botY; b.done=true; pResolve(b,tab); }
  });
  pDraw();
  if(alive) requestAnimationFrame(pLoop); else { pAnim=false; balls=balls.filter(b=>performance.now()-b.t<1500); }
}
function pResolve(b,tab){
  const idx=Math.max(0,Math.min(tab.length-1,b.rights));
  const mult=tab[idx]; const win=Math.round(b.bet*mult);
  credit(win); if(win-b.bet>0) recordWin(win-b.bet);
  const m=$("#pMsg"); m.textContent=mult+"× → "+fmt(win); m.className="msg "+(win>=b.bet?"win":"lose");
  commit();
}
$("#pDrop").onclick=()=>{
  const bet=Math.floor(Number($("#pBet").value)||0);
  if(!canBet(bet)){ $("#pMsg").textContent="Not enough chips."; $("#pMsg").className="msg lose"; return; }
  debit(bet); addWager(bet); commit();
  balls.push({x:pcv.width/2,y:20,tx:pcv.width/2,row:0,rights:0,dir:0,bet,done:false,t:performance.now()});
  if(!pAnim){ pAnim=true; requestAnimationFrame(pLoop); }
};
if(!CanvasRenderingContext2D.prototype.roundRect){ CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath();return this;}; }
pDraw();

/* ===================================================== ROULETTE */
const WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const REDS=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const isRed=n=>REDS.has(n);
let rBets=[]; // {key,label,test,payout,amount}
let rSpinning=false, rRot=0;
const rcv=$("#rouletteWheel"), rctx=rcv.getContext("2d");
function drawWheel(rot){
  const cx=120,cy=120,R=116; rctx.clearRect(0,0,240,240);
  const seg=2*Math.PI/37;
  for(let i=0;i<37;i++){ const n=WHEEL[i]; const a0=rot+i*seg-Math.PI/2-seg/2, a1=a0+seg;
    rctx.beginPath(); rctx.moveTo(cx,cy); rctx.arc(cx,cy,R,a0,a1); rctx.closePath();
    rctx.fillStyle= n===0?"#1f8f4a":(isRed(n)?"#e23b54":"#16222f"); rctx.fill();
    rctx.save(); rctx.translate(cx,cy); rctx.rotate(a0+seg/2); rctx.fillStyle="#fff"; rctx.font="bold 10px ui-monospace,monospace"; rctx.textAlign="center"; rctx.fillText(n,R-12,3); rctx.restore();
  }
  rctx.beginPath(); rctx.arc(cx,cy,40,0,7); rctx.fillStyle="#0e1620"; rctx.fill(); rctx.strokeStyle="#33485f"; rctx.lineWidth=2; rctx.stroke();
}
drawWheel(0);
function buildRouletteBoard(){
  const tbl=$("#rTable");
  const zero=document.createElement("div"); zero.className="rcell green zero"; zero.textContent="0"; zero.onclick=()=>rPlace("straight:0","0",n=>n===0,35,zero); tbl.appendChild(zero);
  // rows top->bottom: 3,6,9... ; standard layout columns. We'll lay 1..36 in 3 rows of 12.
  const order=[]; for(let row=2;row>=0;row--){ for(let c=0;c<12;c++){ order.push(c*3+row+1); } }
  order.forEach(n=>{ const d=document.createElement("div"); d.className="rcell "+(isRed(n)?"red":"black"); d.textContent=n; d.onclick=()=>rPlace("straight:"+n,String(n),x=>x===n,35,d); tbl.appendChild(d); });
  const out=$("#rOutside");
  const outs=[
    ["1st 12","dozen1",n=>n>=1&&n<=12,2],["2nd 12","dozen2",n=>n>=13&&n<=24,2],["3rd 12","dozen3",n=>n>=25&&n<=36,2],
    ["1-18","low",n=>n>=1&&n<=18,1],["EVEN","even",n=>n!==0&&n%2===0,1],["RED","red",n=>isRed(n),1],
    ["BLACK","black",n=>n!==0&&!isRed(n),1],["ODD","odd",n=>n%2===1,1],["19-36","high",n=>n>=19&&n<=36,1],
  ];
  outs.forEach(([lbl,key,test,pay])=>{ const d=document.createElement("div"); d.className="rbet"+(key==="red"?" ":"")+(key==="red"?"":""); if(key==="red")d.style.background="var(--redbet)"; if(key==="black")d.style.background="var(--blackbet)"; d.textContent=lbl; d.onclick=()=>rPlace(key,lbl,test,pay,d); out.appendChild(d); });
}
buildRouletteBoard();
function rPlace(key,label,test,payout,el){
  if(rSpinning) return;
  const chip=Math.floor(Number($("#rChip").value)||0);
  if(!canBet(chip)){ rMsg("Not enough chips for that chip size.","lose"); return; }
  debit(chip); addWager(chip); commit();
  let b=rBets.find(x=>x.key===key);
  if(b){ b.amount+=chip; } else { b={key,label,test,payout,amount:chip,el}; rBets.push(b); }
  rRenderChips(); rUpdateTotal();
}
function rRenderChips(){
  $$(".chipdot").forEach(c=>c.remove());
  rBets.forEach(b=>{ const dot=document.createElement("span"); dot.className="chipdot"; dot.textContent=fmt(b.amount); b.el.appendChild(dot); });
}
function rUpdateTotal(){ const t=rBets.reduce((s,b)=>s+b.amount,0); $("#rTotal").textContent=fmt(t); $("#rSpin").disabled=t<=0||rSpinning; }
function rMsg(t,cls){ const m=$("#rMsg"); m.textContent=t; m.className="msg "+(cls||""); }
$("#rClear").onclick=()=>{ if(rSpinning) return; const refund=rBets.reduce((s,b)=>s+b.amount,0); if(refund){ credit(refund); S.wagered-=refund; commit(); } rBets=[]; rRenderChips(); rUpdateTotal(); rMsg("Bets cleared.",""); };
$("#rSpin").onclick=()=>{
  if(rSpinning||!rBets.length) return;
  rSpinning=true; $("#rSpin").disabled=true;
  const result=WHEEL[Math.random()*37|0];
  const idx=WHEEL.indexOf(result), seg=2*Math.PI/37;
  const target=(2*Math.PI*6) + (2*Math.PI - idx*seg); // land idx at top pointer
  const start=rRot, dur=3400, t0=performance.now();
  (function anim(now){
    const p=Math.min(1,(now-t0)/dur); const e=1-Math.pow(1-p,3);
    rRot=start+(target-(start%(2*Math.PI)))*e; drawWheel(rRot);
    if(p<1) requestAnimationFrame(anim); else rResolve(result);
  })(t0);
};
function rResolve(result){
  $("#rResult").textContent=result; $("#rResult").style.color= result===0?"#27d17a":(isRed(result)?"#ff6b7e":"#cdd9e6");
  let won=0, hits=[];
  rBets.forEach(b=>{ if(b.test(result)){ const back=b.amount*(b.payout+1); won+=back; if(back-b.amount>0) recordWin(back-b.amount); hits.push(b.label); } });
  if(won>0){ credit(won); rMsg("Landed "+result+" — won "+fmt(won)+"! ("+hits.join(", ")+")","win"); }
  else rMsg("Landed "+result+". No luck this time.","lose");
  rBets=[]; rRenderChips(); rUpdateTotal();
  rSpinning=false; commit();
}

/* ===================================================== IDENTITY + LEADERBOARD */
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderName(){ $("#namePill").textContent = S.name ? ("@"+S.name) : "Set name"; }

const nameOv=$("#nameOv");
function openName(){ $("#nameInput").value=S.name||""; nameOv.classList.add("on"); setTimeout(()=>$("#nameInput").focus(),40); }
$("#namePill").onclick=openName;
nameOv.onclick=e=>{ if(e.target===nameOv && S.name) nameOv.classList.remove("on"); };
$("#nameSave").onclick=()=>{ const v=$("#nameInput").value.trim().slice(0,20); if(!v) return; const renamed=S.name&&S.name!==v; if(renamed) clearOldEntry(); S.name=v; renderName(); commit(); pushLeaderboard(); nameOv.classList.remove("on"); if($("#g-leaderboard").classList.contains("on")) renderLeaderboard(); };
$("#nameInput").addEventListener("keydown",e=>{ if(e.key==="Enter") $("#nameSave").click(); });
function clearOldEntry(){ /* name is keyed by stable id, so renaming just overwrites — nothing to clear */ }

function lbEntry(){ return { id:S.id, name:S.name, biggest:Math.round(S.biggest), balance:Math.round(S.balance), net:Math.round(S.balance-S.deposited), wagered:Math.round(S.wagered), updatedAt:Date.now() }; }
function pushLeaderboard(){ if(!S.name) return; try{ store.set("sex3bet:lb:"+S.id, JSON.stringify(lbEntry()), true); }catch(e){} }
let lbTimer=null; function pushLeaderboardDebounced(){ if(!S.name) return; clearTimeout(lbTimer); lbTimer=setTimeout(pushLeaderboard,1200); }

async function fetchLeaderboard(){
  const out=[];
  try{
    const res=await store.list("sex3bet:lb:",true);
    const keys=(res&&res.keys)||[];
    for(const k of keys){
      const key = typeof k==="string" ? k : (k&&k.key);
      if(!key) continue;
      try{ const r=await store.get(key,true); if(r&&r.value) out.push(JSON.parse(r.value)); }catch(e){}
    }
  }catch(e){}
  return out;
}

let lbSort="biggest";
$$(".lb-sort button").forEach(b=>b.onclick=()=>{ $$(".lb-sort button").forEach(x=>x.classList.toggle("on",x===b)); lbSort=b.dataset.sort; renderLeaderboard(); });
$("#lbRefresh").onclick=()=>renderLeaderboard();

function syncBanner(){
  if(window.SHARED_MODE!=="local") return "";
  return '<div class="sync-warn">⚠ Shared sync is off — this board only shows you. Add a Firebase config in <code>store.js</code> (see README) so the whole crew shows up and the owner lock binds everyone.</div>';
}
async function renderLeaderboard(){
  const body=$("#lbBody");
  body.innerHTML='<div class="lb-empty">Loading the board…</div>';
  let rows=await fetchLeaderboard();
  // make sure the local player shows even before first debounce write
  if(S.name && !rows.some(r=>r.id===S.id)) rows.push(lbEntry());
  if(!rows.length){ body.innerHTML=syncBanner()+'<div class="lb-empty">No players on the board yet.<br>Win something and you\'ll show up here.</div>'; return; }
  rows.sort((a,b)=>(b[lbSort]||0)-(a[lbSort]||0));
  const medals=["🥇","🥈","🥉"];
  body.innerHTML = syncBanner() +
    '<div class="lb-row lb-h"><span>#</span><span>Player</span><span class="lb-num">Biggest win</span><span class="lb-num">Net</span><span class="lb-num">Balance</span></div>' +
    rows.map((r,i)=>{
      const me=r.id===S.id, net=r.net||0, nc=net>0?"up":net<0?"down":"flat";
      const rank = i<3 ? `<span class="lb-rank medal">${medals[i]}</span>` : `<span class="lb-rank">${i+1}</span>`;
      return `<div class="lb-row${me?' me':''}">${rank}<span class="lb-name">${esc(r.name||"anon")}${me?' <em>you</em>':''}</span>`+
        `<span class="lb-num gold">${fmt(r.biggest||0)}</span>`+
        `<span class="lb-num ${nc}">${net>0?'+':''}${fmt(net)}</span>`+
        `<span class="lb-num">${fmt(r.balance||0)}</span></div>`;
    }).join("");
}

/* ===================================================== ADMIN / GRANTS */
async function grantTo(targetId, amount){
  amount=Math.floor(amount);
  if(!(amount>0)){ toast("Enter a positive amount."); return; }
  if(targetId===S.id){ S.balance+=amount; S.deposited+=amount; commit(); toast("Added "+fmt(amount)+" to your stack."); renderAdmin(); return; }
  const gid=Math.random().toString(36).slice(2,9);
  try{
    await store.set("sex3bet:grant:"+targetId+":"+gid, JSON.stringify({amount, from:S.name||"owner", ts:Date.now()}), true);
    toast("Sent "+fmt(amount)+" chips — they'll land on their next refresh.");
  }catch(e){ toast("Couldn't send (storage off)."); }
}
async function grantAll(amount){
  const rows=await fetchLeaderboard();
  let count=0;
  for(const r of rows){ if(r.id){ await grantTo(r.id, amount); count++; } }
  if(!rows.some(r=>r.id===S.id)){ await grantTo(S.id, amount); count++; }
  toast("Handed "+fmt(amount)+" to "+count+" player"+(count===1?"":"s")+".");
}
async function claimGrants(){
  if(!S.id) return;
  try{
    const res=await store.list("sex3bet:grant:"+S.id+":",true);
    const keys=(res&&res.keys)||[]; let total=0;
    for(const k of keys){
      const key=typeof k==="string"?k:(k&&k.key); if(!key) continue;
      try{ const r=await store.get(key,true); if(r&&r.value){ total+=JSON.parse(r.value).amount||0; } }catch(e){}
      try{ await store.delete(key,true); }catch(e){}
    }
    if(total>0){ S.balance+=total; S.deposited+=total; commit(); toast("You received "+fmt(total)+" chips from the owner! 🎁"); }
  }catch(e){}
}

// Players pick up a board-wide reset by comparing their season to the owner's.
async function syncSeason(){
  await loadCfg();
  if(!CFG || CFG.season==null) return;
  if(S.season==null){ S.season=CFG.season; save(); return; } // first run: adopt, don't wipe
  if(S.season!==CFG.season){
    S.balance=1000; S.wagered=0; S.biggest=0; S.deposited=1000; S.season=CFG.season;
    commit();
    toast("New season — everyone's back to 1,000 chips. 🧹");
    if($("#g-leaderboard").classList.contains("on")) renderLeaderboard();
    if($("#g-admin").classList.contains("on")) renderAdmin();
  }
}

// Owner: wipe the shared board + pending grants and bump the season so all clients reset.
async function newSeason(){
  try{
    for(const pfx of ["sex3bet:lb:","sex3bet:grant:"]){
      const res=await store.list(pfx,true);
      for(const k of (res&&res.keys)||[]){ const key=typeof k==="string"?k:(k&&k.key); if(key){ try{ await store.delete(key,true); }catch(e){} } }
    }
  }catch(e){}
  CFG.season=(CFG.season||1)+1; await saveCfg();
  S.balance=1000; S.wagered=0; S.biggest=0; S.deposited=1000; S.season=CFG.season;
  commit();
  toast("New season! Board wiped, everyone reset to 1,000.");
  renderAdmin();
}

async function renderAdmin(){
  const box=$("#adminBody");
  // unclaimed board
  if(!CFG){
    box.innerHTML=`<div class="admin-card">
      <h4>Claim this board</h4>
      <p>Right now anyone can give themselves chips. Claim ownership to lock that down — then only you (and anyone you share the PIN with) can hand out chips.</p>
      <div class="admin-row">
        <div class="grow"><label>Set an owner PIN</label><input type="password" id="adPin" placeholder="4+ characters"></div>
        <button class="primary" id="adClaim" style="width:auto;padding:13px 18px">Claim &amp; lock</button>
      </div>
    </div>`;
    $("#adClaim").onclick=async()=>{ const p=$("#adPin").value.trim(); if(p.length<4){ toast("PIN needs 4+ characters."); return; } CFG={ownerId:S.id, pinHash:hashPin(p), locked:true, season:1}; await saveCfg(); S.season=1; adminUnlocked=true; renderChipBtn(); toast("Board claimed — you're the owner."); renderAdmin(); };
    return;
  }
  // locked, not admin -> unlock prompt
  if(!isAdmin()){
    box.innerHTML=`<div class="admin-card">
      <h4>Owner controls are locked</h4>
      <p>Only the owner can hand out chips. If that's you, enter the PIN to unlock the controls on this device.</p>
      <div class="admin-row">
        <div class="grow"><label>Owner PIN</label><input type="password" id="adPin" placeholder="enter PIN"></div>
        <button class="primary" id="adUnlock" style="width:auto;padding:13px 18px">Unlock</button>
      </div>
    </div>`;
    $("#adUnlock").onclick=()=>{ const p=$("#adPin").value.trim(); if(hashPin(p)===CFG.pinHash){ adminUnlocked=true; renderChipBtn(); toast("Unlocked. You can hand out chips now."); renderAdmin(); } else { toast("Wrong PIN."); } };
    return;
  }
  // admin view
  const rows=await fetchLeaderboard();
  if(!rows.some(r=>r.id===S.id) && S.name) rows.unshift({id:S.id,name:S.name+" (you)"});
  const opts=rows.map(r=>`<option value="${esc(r.id)}">${esc(r.name||"anon")}</option>`).join("") || `<option value="">No players yet</option>`;
  const lockOn=CFG.locked;
  box.innerHTML=`<div class="admin-card">
    <span class="badge-owner">${CFG.ownerId===S.id?"You own this board":"Admin unlocked"}</span>
    ${syncBanner()}
    <div class="lock-state ${lockOn?'on':'off'}">
      <span class="dot"></span>
      <span>Self-serve chips are ${lockOn?'<b style="color:var(--accent)">locked</b> — players must ask you':'<b style="color:var(--gold)">open</b> — anyone can top themselves up'}</span>
      <button class="pill-toggle" id="adLock">${lockOn?'Unlock for all':'Lock it down'}</button>
    </div>

    <div class="admin-sec">
      <h4>Hand out chips</h4>
      <p>Send chips to a player on the board. They get them on their next refresh.</p>
      <div class="admin-row">
        <div class="grow"><label>Player</label><select id="adWho">${opts}</select></div>
        <div style="width:120px"><label>Amount</label><input type="number" id="adAmt" value="1000" min="1" step="1"></div>
        <button class="primary" id="adGrant" style="width:auto;padding:13px 18px">Grant</button>
      </div>
      <button class="secondary" id="adGrantAll" style="margin-top:10px">Give this amount to everyone</button>
    </div>

    <div class="admin-sec">
      <h4>Change PIN</h4>
      <div class="admin-row">
        <div class="grow"><input type="password" id="adNewPin" placeholder="new PIN (4+ chars)"></div>
        <button class="pill-toggle" id="adSavePin">Update PIN</button>
      </div>
    </div>

    <div class="admin-sec">
      <h4>New season</h4>
      <p>Wipes the leaderboard and resets <b>every</b> player back to 1,000 chips. Players reset within ~20s or on their next load.</p>
      <div id="seasonBox"><button class="secondary danger" id="adSeason">Reset everyone &amp; wipe board</button></div>
    </div>
  </div>`;
  $("#adLock").onclick=async()=>{ CFG.locked=!CFG.locked; await saveCfg(); renderChipBtn(); renderAdmin(); };
  $("#adGrant").onclick=()=>{ const who=$("#adWho").value; const amt=Number($("#adAmt").value)||0; if(!who){ toast("No player selected."); return; } grantTo(who, amt); };
  $("#adGrantAll").onclick=()=>{ const amt=Number($("#adAmt").value)||0; if(amt>0) grantAll(amt); };
  $("#adSavePin").onclick=async()=>{ const p=$("#adNewPin").value.trim(); if(p.length<4){ toast("PIN needs 4+ characters."); return; } CFG.pinHash=hashPin(p); await saveCfg(); toast("PIN updated."); $("#adNewPin").value=""; };
  $("#adSeason").onclick=()=>{ $("#seasonBox").innerHTML='<span style="font-size:13px;color:var(--red);margin-right:8px">Reset everyone for real?</span><button class="secondary danger" id="adSeasonYes" style="width:auto;display:inline-block;padding:10px 16px">Yes, wipe it</button> <button class="pill-toggle" id="adSeasonNo">Cancel</button>'; $("#adSeasonYes").onclick=newSeason; $("#adSeasonNo").onclick=renderAdmin; };
}

/* ===================================================== WHEEL */
const WHEEL_SEGS=(()=>{
  const s=[
    ...Array(24).fill(null).map(()=>({mult:0,  color:'#c0392b',label:'0×'})),
    ...Array(12).fill(null).map(()=>({mult:1.5, color:'#1a6ea8',label:'1.5×'})),
    ...Array(8).fill(null).map(()=>({mult:2,   color:'#7d3c98',label:'2×'})),
    ...Array(5).fill(null).map(()=>({mult:3,   color:'#d35400',label:'3×'})),
    ...Array(3).fill(null).map(()=>({mult:5,   color:'#1e8449',label:'5×'})),
    ...Array(1).fill(null).map(()=>({mult:10,  color:'#b7950b',label:'10×'})),
    ...Array(1).fill(null).map(()=>({mult:20,  color:'#f5c451',label:'20×'})),
  ];
  for(let i=s.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[s[i],s[j]]=[s[j],s[i]];}
  return s;
})();
(function(){
  const counts={};
  WHEEL_SEGS.forEach(s=>{counts[s.label]=(counts[s.label]||0)+1;});
  $('#wsOdds').innerHTML=Object.entries(counts)
    .sort((a,b)=>parseFloat(a[0])-parseFloat(b[0]))
    .map(([label,n])=>{const seg=WHEEL_SEGS.find(s=>s.label===label);
      return `<span class="ws-chip" style="background:${seg.color}">${label}<small>${n}</small></span>`;})
    .join('');
})();
const wsCv=$('#wsCanvas'), wsCtx=wsCv.getContext('2d');
let wsRot=0, wsSpinning=false;
function drawWS(rot){
  const cx=wsCv.width/2,cy=wsCv.height/2,R=cx-14;
  wsCtx.clearRect(0,0,wsCv.width,wsCv.height);
  const seg=2*Math.PI/WHEEL_SEGS.length;
  WHEEL_SEGS.forEach((s,i)=>{
    const a0=rot+i*seg-Math.PI/2,a1=a0+seg;
    wsCtx.beginPath();wsCtx.moveTo(cx,cy);wsCtx.arc(cx,cy,R,a0,a1);wsCtx.closePath();
    wsCtx.fillStyle=s.color;wsCtx.fill();
    wsCtx.strokeStyle='rgba(0,0,0,.25)';wsCtx.lineWidth=.5;wsCtx.stroke();
    wsCtx.save();wsCtx.translate(cx,cy);wsCtx.rotate(a0+seg/2);
    wsCtx.fillStyle='rgba(255,255,255,.9)';wsCtx.font='bold 8px ui-monospace,monospace';wsCtx.textAlign='center';
    wsCtx.fillText(s.label,R-16,3);wsCtx.restore();
  });
  wsCtx.beginPath();wsCtx.arc(cx,cy,26,0,7);wsCtx.fillStyle='#0b1118';wsCtx.fill();
  wsCtx.strokeStyle='#19e36b';wsCtx.lineWidth=2.5;wsCtx.stroke();
}
drawWS(0);
function wsMsg(t,c){const m=$('#wsMsg');m.textContent=t;m.className='msg '+(c||'');}
$('#wsSpin').onclick=()=>{
  if(wsSpinning)return;
  const bet=Math.floor(Number($('#wsBet').value)||0);
  if(!canBet(bet)){wsMsg('Not enough chips.','lose');return;}
  const ridx=Math.random()*WHEEL_SEGS.length|0;
  debit(bet);addWager(bet);
  wsSpinning=true;$('#wsSpin').disabled=true;
  const segAng=2*Math.PI/WHEEL_SEGS.length;
  const normRot=((wsRot%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
  const targetAngle=((2*Math.PI-ridx*segAng-segAng/2)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
  const spinAmt=(targetAngle-normRot+2*Math.PI)%(2*Math.PI)+2*Math.PI*8;
  const startRot=wsRot,endRot=wsRot+spinAmt;
  const dur=3800,t0=performance.now();
  (function anim(now){
    const p=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-p,4);
    wsRot=startRot+(endRot-startRot)*e;drawWS(wsRot);
    if(p<1){requestAnimationFrame(anim);}else{
      const s=WHEEL_SEGS[ridx],win=Math.round(bet*s.mult);
      if(win>0){credit(win);recordWin(win-bet);}
      wsMsg(s.mult===0?'No win. Try again!':s.mult>=2?`${s.label} — won ${fmt(win)}! 🎉`:`${s.label} — won ${fmt(win)}.`,s.mult===0?'lose':s.mult>=2?'win':'push');
      wsSpinning=false;$('#wsSpin').disabled=false;commit();
    }
  })(t0);
};

/* ===================================================== ROCK PAPER SCISSORS */
const RPS_BEATS={rock:'scissors',paper:'rock',scissors:'paper'};
const RPS_EMOJI={rock:'🪨',paper:'📄',scissors:'✂️'};
let rpsStreak=0;
function rpsMsg(t,c){const m=$('#rpsMsg');m.textContent=t;m.className='msg '+(c||'');}
function rpsPlay(pick){
  const bet=Math.floor(Number($('#rpsBet').value)||0);
  if(!canBet(bet)){rpsMsg('Not enough chips.','lose');return;}
  const house=Object.keys(RPS_EMOJI)[Math.random()*3|0];
  debit(bet);addWager(bet);
  $('#rpsYou').textContent=RPS_EMOJI[pick];
  $('#rpsHouse').textContent='⏳';
  setTimeout(()=>{
    $('#rpsHouse').textContent=RPS_EMOJI[house];
    let win=0,txt='',cls='';
    if(pick===house){win=bet;txt='Tie — bet returned.';cls='push';}
    else if(RPS_BEATS[pick]===house){win=bet*2;txt=`${RPS_EMOJI[pick]} beats ${RPS_EMOJI[house]}! Won ${fmt(win)}!`;cls='win';rpsStreak++;recordWin(bet);}
    else{txt=`${RPS_EMOJI[house]} beats ${RPS_EMOJI[pick]}. You lose.`;cls='lose';rpsStreak=0;}
    if(win>0)credit(win);
    rpsMsg(txt,cls);
    $('#rpsStreak').textContent=rpsStreak;
    $('#rpsStreak').className='rps-streak'+(rpsStreak>=3?' hot':'');
    commit();
  },600);
}
$$('.rps-btn').forEach(b=>b.onclick=()=>rpsPlay(b.dataset.rps));

/* ===================================================== CRASH */
let crState='idle'; // idle | betting | live | cashed | crashed
let crBet=0,crCrashPt=1,crMult=1,crBetPending=false;
let crTick=0,crTimer=null,crHistory=[];
const crCv=$('#crCanvas'),crCtx=crCv.getContext('2d');
const crW=crCv.width,crH=crCv.height;
function genCrashPt(){
  const r=Math.random();
  if(r<0.01)return 1.00;
  return Math.max(1.01,Math.floor(9901/(100-Math.floor(r*100)))/100);
}
function drawCrash(){
  crCtx.clearRect(0,0,crW,crH);
  crCtx.fillStyle='#0b1118';crCtx.fillRect(0,0,crW,crH);
  if(!crHistory.length)return;
  const maxMult=Math.max(2,crHistory[crHistory.length-1]*1.2);
  const toX=t=>14+(crW-28)*(t/Math.max(1,crHistory.length-1));
  const toY=m=>crH-14-(crH-28)*((m-1)/(maxMult-1));
  crCtx.beginPath();crCtx.strokeStyle=crState==='crashed'?'#f0556a':'#19e36b';crCtx.lineWidth=2.5;
  crHistory.forEach((m,i)=>{i===0?crCtx.moveTo(toX(i),toY(m)):crCtx.lineTo(toX(i),toY(m));});
  crCtx.stroke();
  // glow fill
  crCtx.beginPath();
  crHistory.forEach((m,i)=>{i===0?crCtx.moveTo(toX(i),toY(m)):crCtx.lineTo(toX(i),toY(m));});
  crCtx.lineTo(toX(crHistory.length-1),crH-14);crCtx.lineTo(toX(0),crH-14);crCtx.closePath();
  crCtx.fillStyle=crState==='crashed'?'rgba(240,85,106,.07)':'rgba(25,227,107,.07)';crCtx.fill();
  // axis labels
  crCtx.fillStyle='#546476';crCtx.font='11px ui-monospace,monospace';crCtx.textAlign='left';
  crCtx.fillText('1.00×',4,crH-16);
  crCtx.textAlign='right';
  crCtx.fillText(maxMult.toFixed(2)+'×',crW-4,18);
}
function crSetMult(m){
  const el=$('#crMult');
  el.textContent=m.toFixed(2)+'×';
  el.className='crash-mult'+(crState==='crashed'?' crashed':crState==='cashed'?' cashed':'');
}
function crStop(crashed){
  clearInterval(crTimer);crTimer=null;
  crState=crashed?'crashed':'cashed';
  if(crashed){
    crSetMult(crCrashPt);
    $('#crMsg').textContent=`Crashed at ${crCrashPt.toFixed(2)}×. ${crBetPending?'Bet lost.':''}`;
    $('#crMsg').className='msg lose';
    crBetPending=false;
  }
  drawCrash();
  $('#crCashBtn').style.display='none';
  setTimeout(()=>{
    crState='idle';crMult=1;crTick=0;crHistory=[];
    crSetMult(1);drawCrash();
    $('#crBetBtn').style.display='block';
    if(crBetPending){
      $('#crMsg').textContent='Bet placed — waiting for next round.';
      $('#crMsg').className='msg push';
    }else{
      $('#crMsg').textContent='Place a bet to join the next round.';
      $('#crMsg').className='msg';
    }
  },2200);
}
function crStartRound(){
  crCrashPt=genCrashPt();crMult=1;crTick=0;crHistory=[1];crState='live';
  crSetMult(1);drawCrash();
  if(crBetPending){
    crBet=Math.floor(Number($('#crBet').value)||0);
    debit(crBet);addWager(crBet);
    $('#crCashBtn').style.display='block';
    $('#crMsg').textContent='Running! Cash out before it crashes.';
    $('#crMsg').className='msg win';
  }
  crTimer=setInterval(()=>{
    crTick++;
    crMult=Math.pow(1.06,crTick)*1;
    crHistory.push(crMult);
    crSetMult(crMult);
    // auto cashout
    const autoVal=parseFloat($('#crAuto').value);
    if(crBetPending&&!isNaN(autoVal)&&crMult>=autoVal){crCashout();return;}
    if(crMult>=crCrashPt){crStop(true);}
    else drawCrash();
  },120);
}
function crCashout(){
  if(!crBetPending||crState!=='live')return;
  const win=Math.round(crBet*crMult);
  credit(win);recordWin(win-crBet);crBetPending=false;
  crState='cashed';
  $('#crCashBtn').style.display='none';
  $('#crMsg').textContent=`Cashed out at ${crMult.toFixed(2)}× — won ${fmt(win)}! 🎉`;
  $('#crMsg').className='msg win';
  commit();
}
function crashTabOpened(){
  if(crState==='idle'&&!crTimer){
    // kick off the first round after a short delay
    setTimeout(crStartRound,1200);
  }
}
$('#crBetBtn').onclick=()=>{
  const bet=Math.floor(Number($('#crBet').value)||0);
  if(!canBet(bet)){$('#crMsg').textContent='Not enough chips.';$('#crMsg').className='msg lose';return;}
  crBetPending=true;crBet=bet;
  $('#crBetBtn').style.display='none';
  $('#crMsg').textContent='Bet placed — waiting for next round to start.';
  $('#crMsg').className='msg push';
  if(crState==='idle'&&!crTimer)setTimeout(crStartRound,1200);
};
$('#crCashBtn').onclick=crCashout;
$('#crAutoClear').onclick=()=>{$('#crAuto').value='';};
drawCrash();

/* ===================================================== GUMMY BEAR CROSS */
const GC_LANES=8;
const GC_DANGER=[.14,.17,.20,.23,.26,.29,.33,.37]; // prob of getting hit per lane
function gcMult(n){ // fair payout for clearing n lanes with house edge
  let m=1;for(let i=0;i<n;i++)m/=(1-GC_DANGER[i]);
  return Math.round(m*.96*100)/100;
}
const GC_EMOJIS_CAR=['🚗','🚕','🏎️','🚙'];
const gcCv=$('#gcCanvas'),gcCtx=gcCv.getContext('2d');
const gcW=gcCv.width,gcH=gcCv.height;
let gcActive=false,gcLaneNum=0,gcBetAmt=0;
let gcCars=[]; // [{lane,x,speed,emoji,width}]
let gcBearY=0,gcBearTargetY=0,gcBearAnim=false;
let gcResult=null; // null | 'safe' | 'hit' | 'win'
let gcAnimFrame=null;
const LANE_H=(gcH-60)/GC_LANES,SAFE_H=30;
function gcLaneY(lane){ return gcH-SAFE_H-lane*LANE_H; } // bottom of lane
function gcBearDrawY(){ return gcH-SAFE_H+6; } // bear start row center
function gcInitCars(){
  gcCars=[];
  for(let l=0;l<GC_LANES;l++){
    const n=1+Math.floor(Math.random()*2);
    for(let c=0;c<n;c++){
      const dir=Math.random()<.5?1:-1;
      gcCars.push({lane:l,x:dir>0?-60:gcW+60,speed:dir*(1.2+Math.random()*1.8),emoji:GC_EMOJIS_CAR[Math.random()*GC_EMOJIS_CAR.length|0]});
    }
  }
}
function gcDraw(){
  gcCtx.clearRect(0,0,gcW,gcH);
  // road bg
  gcCtx.fillStyle='#1a1f2e';gcCtx.fillRect(0,0,gcW,gcH);
  // lanes
  for(let l=0;l<GC_LANES;l++){
    const y=gcLaneY(l);
    gcCtx.fillStyle=l%2===0?'#1e2435':'#222840';
    gcCtx.fillRect(0,y-LANE_H,gcW,LANE_H);
    // lane dashes
    gcCtx.setLineDash([18,14]);gcCtx.strokeStyle='rgba(255,255,255,.07)';gcCtx.lineWidth=1.5;
    gcCtx.beginPath();gcCtx.moveTo(0,y-LANE_H/2);gcCtx.lineTo(gcW,y-LANE_H/2);gcCtx.stroke();
    gcCtx.setLineDash([]);
    // multiplier label
    const lLabel=gcActive&&gcLaneNum>l?'✓':gcMult(l+1).toFixed(2)+'×';
    gcCtx.fillStyle=gcActive&&gcLaneNum>l?'#19e36b':'rgba(255,255,255,.3)';
    gcCtx.font='bold 12px ui-monospace,monospace';gcCtx.textAlign='right';
    gcCtx.fillText(lLabel,gcW-8,y-LANE_H/2+4);
    // lane number
    gcCtx.fillStyle='rgba(255,255,255,.18)';gcCtx.font='11px ui-monospace,monospace';gcCtx.textAlign='left';
    gcCtx.fillText('L'+(l+1),6,y-LANE_H/2+4);
  }
  // safe zones
  gcCtx.fillStyle='#1a2e1a';gcCtx.fillRect(0,gcH-SAFE_H,gcW,SAFE_H);
  gcCtx.fillStyle='#1a2e1a';gcCtx.fillRect(0,0,gcW,gcH-SAFE_H-GC_LANES*LANE_H);
  if(gcActive||gcResult){
    // safe zone text
    gcCtx.fillStyle=gcResult==='win'?'#19e36b':'rgba(255,255,255,.2)';
    gcCtx.font='bold 11px sans-serif';gcCtx.textAlign='center';
    gcCtx.fillText(gcResult==='win'?'🏁 WINNER!':'START',gcW/2,gcH-8);
    gcCtx.fillStyle='#19e36b';
    gcCtx.fillText('🏁 FINISH',gcW/2,gcH-SAFE_H-GC_LANES*LANE_H+18);
  }
  // cars
  gcCtx.font='22px sans-serif';gcCtx.textAlign='center';
  gcCars.forEach(c=>{
    if(!gcActive&&gcResult===null)return;
    const y=gcLaneY(c.lane)-LANE_H/2+8;
    gcCtx.fillText(c.emoji,c.x,y);
  });
  // bear
  const bearX=gcW/2;
  const bearY=gcActive||gcResult?gcBearY:gcH-SAFE_H/2+8;
  gcCtx.font='28px sans-serif';gcCtx.textAlign='center';
  if(gcResult==='hit'){
    gcCtx.save();gcCtx.translate(bearX,bearY);gcCtx.rotate(Math.sin(Date.now()*.05)*.3);
    gcCtx.fillText('💥',0,0);gcCtx.restore();
  }else{
    gcCtx.fillText('🐻',bearX,bearY);
  }
  // overlay messages
  if(!gcActive&&gcResult===null&&!gcLaneNum){
    gcCtx.fillStyle='rgba(0,0,0,.55)';gcCtx.fillRect(0,0,gcW,gcH);
    gcCtx.fillStyle='#fff';gcCtx.font='bold 22px sans-serif';gcCtx.textAlign='center';
    gcCtx.fillText('Press Start to play',gcW/2,gcH/2);
    gcCtx.fillStyle='#7e93aa';gcCtx.font='14px sans-serif';
    gcCtx.fillText('Get the gummy bear across 8 lanes',gcW/2,gcH/2+30);
  }
}
function gcAnimLoop(){
  if(gcBearAnim){
    gcBearY+=(gcBearTargetY-gcBearY)*.18;
    if(Math.abs(gcBearY-gcBearTargetY)<0.5){gcBearY=gcBearTargetY;gcBearAnim=false;}
  }
  gcCars.forEach(c=>{
    c.x+=c.speed;
    if(c.speed>0&&c.x>gcW+80)c.x=-60;
    if(c.speed<0&&c.x<-80)c.x=gcW+60;
  });
  gcDraw();
  gcAnimFrame=requestAnimationFrame(gcAnimLoop);
}
function gcStopAnim(){if(gcAnimFrame){cancelAnimationFrame(gcAnimFrame);gcAnimFrame=null;}}
function gcUpdateInfo(){
  const n=gcLaneNum,m=n>0?gcMult(n):1;
  $('#gcLane').textContent=`${n} / ${GC_LANES}`;
  $('#gcMult').textContent=m.toFixed(2)+'×';
  $('#gcVal').textContent=n>0?fmt(Math.round(gcBetAmt*m)):'—';
}
$('#gcStart').onclick=()=>{
  const bet=Math.floor(Number($('#gcBet').value)||0);
  if(!canBet(bet)){$('#gcMsg').textContent='Not enough chips.';$('#gcMsg').className='msg lose';return;}
  gcBetAmt=bet;gcLaneNum=0;gcResult=null;gcActive=true;
  debit(bet);addWager(bet);
  gcInitCars();
  gcBearY=gcH-SAFE_H/2+8;gcBearTargetY=gcBearY;gcBearAnim=false;
  $('#gcStart').style.display='none';
  $('#gcCross').style.display='block';
  $('#gcCash').style.display='none';
  $('#gcInfo').style.display='flex';
  $('#gcMsg').textContent='Click Run to cross the next lane!';
  $('#gcMsg').className='msg';
  gcUpdateInfo();
  gcStopAnim();gcAnimLoop();
  commit();
};
$('#gcCross').onclick=()=>{
  if(!gcActive||gcBearAnim)return;
  const lane=gcLaneNum;
  const hit=Math.random()<GC_DANGER[lane];
  gcLaneNum++;
  // animate bear up to new lane
  gcBearTargetY=gcLaneY(lane)-LANE_H/2+8;gcBearAnim=true;
  if(hit){
    gcResult='hit';gcActive=false;
    setTimeout(()=>{
      gcStopAnim();
      $('#gcCross').style.display='none';
      $('#gcCash').style.display='none';
      $('#gcStart').style.display='block';
      $('#gcInfo').style.display='none';
      $('#gcMsg').textContent=`Splat on lane ${gcLaneNum}! 💥 Lost ${fmt(gcBetAmt)}.`;
      $('#gcMsg').className='msg lose';
      gcDraw();commit();
    },800);
  }else{
    gcUpdateInfo();
    if(gcLaneNum===GC_LANES){
      // made it all the way!
      gcResult='win';gcActive=false;
      const mult=gcMult(GC_LANES);const win=Math.round(gcBetAmt*mult);
      credit(win);recordWin(win-gcBetAmt);
      setTimeout(()=>{
        gcStopAnim();
        $('#gcCross').style.display='none';
        $('#gcCash').style.display='none';
        $('#gcStart').style.display='block';
        $('#gcInfo').style.display='none';
        $('#gcMsg').textContent=`Made it across! ${mult.toFixed(2)}× — won ${fmt(win)}! 🎉`;
        $('#gcMsg').className='msg win';
        gcDraw();commit();
      },600);
    }else{
      $('#gcMsg').textContent=`Lane ${gcLaneNum} cleared! Keep going or cash out.`;
      $('#gcMsg').className='msg win';
      if(gcLaneNum===1)$('#gcCash').style.display='block'; // show cashout after first clear
    }
  }
};
$('#gcCash').onclick=()=>{
  if(!gcActive||gcLaneNum===0)return;
  const mult=gcMult(gcLaneNum);const win=Math.round(gcBetAmt*mult);
  credit(win);recordWin(win-gcBetAmt);gcActive=false;gcResult='win';
  gcStopAnim();
  $('#gcCross').style.display='none';
  $('#gcCash').style.display='none';
  $('#gcStart').style.display='block';
  $('#gcInfo').style.display='none';
  $('#gcMsg').textContent=`Cashed out after ${gcLaneNum} lanes! ${mult.toFixed(2)}× — won ${fmt(win)}! 🎉`;
  $('#gcMsg').className='msg win';
  gcDraw();commit();
};
// neutral helper to get css var value (used in gummy draw)
function var_(v){return getComputedStyle(document.documentElement).getPropertyValue('--'+v).trim()||'#7e93aa';}
gcDraw();


/* ===================================================== BOOT */
(async()=>{
  await load(); await loadCfg();
  renderWallet(); renderName(); renderChipBtn(); mRenderCheatBtn(); updateMemTag(); mInfo();
  if(!S.name) openName(); else pushLeaderboard();
  await syncSeason();
  await claimGrants();
  setInterval(()=>{ syncSeason(); claimGrants(); }, 20000);
})();
