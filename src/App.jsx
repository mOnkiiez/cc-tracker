import { useState, useEffect, useRef } from "react"
import { loadFromCloud, saveToCloud } from "./supabase"

const STORAGE_KEY = "cc-tracker-v1"
const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
const COLORS = ["#7c6af7","#f472b6","#fb923c","#34d399","#38bdf8","#f87171","#a78bfa","#2dd4bf"]

function toMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`
}
function labelMonth(key) {
  const [y,m] = key.split("-")
  return `${MONTHS_TH[+m-1]} ${+y+543}`
}
function fmt(n) {
  return Number(n||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})
}
function todayStr() { return new Date().toISOString().slice(0,10) }

function loadLocal() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r) } catch {}
  return { cards: [], months: {}, otherExpenses: {} }
}
function saveLocal(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch {}
}

function getMonth(data, mk) { return data.months[mk] || {} }
function getCardMonth(data, cardId, mk) {
  return getMonth(data, mk)[cardId] || { bill:0, minPay:0, paid:0, items:[] }
}
function setCardMonth(data, cardId, mk, val) {
  return { ...data, months: { ...data.months, [mk]: { ...getMonth(data, mk), [cardId]: val } } }
}
function getOtherExpenses(data, mk) {
  return (data.otherExpenses || {})[mk] || []
}
function setOtherExpenses(data, mk, list) {
  return { ...data, otherExpenses: { ...(data.otherExpenses||{}), [mk]: list } }
}

const S = { bg:"#0f172a", surface:"#1e293b", border:"#334155", text:"#e2e8f0", muted:"#64748b", accent:"#7c6af7" }

function NumInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <p style={{fontSize:13,color:S.muted,marginBottom:5}}>{label}</p>
      <input type="number" inputMode="decimal"
        style={{background:"#0f172a",color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:10,padding:"11px 12px",fontSize:15,boxSizing:"border-box"}}
        placeholder={placeholder||"0.00"} value={value} onChange={e=>onChange(e.target.value)} />
    </div>
  )
}

function ConfirmModal({ title, desc, onConfirm, onCancel }) {
  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:S.surface,borderRadius:20,padding:24,border:"1px solid "+S.border,width:"100%",maxWidth:320}}>
        <p style={{fontWeight:700,fontSize:16,marginBottom:6,color:S.text}}>{title}</p>
        <p style={{fontSize:13,color:S.muted,marginBottom:20}}>{desc}</p>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onConfirm} style={{flex:1,background:"#ef4444",color:"white",border:"none",borderRadius:12,padding:12,fontSize:14,fontWeight:600,cursor:"pointer"}}>ลบเลย</button>
          <button onClick={onCancel} style={{flex:1,background:"#334155",color:"white",border:"none",borderRadius:12,padding:12,fontSize:14,cursor:"pointer"}}>ยกเลิก</button>
        </div>
      </div>
    </div>
  )
}

function SyncBadge({ status }) {
  const map = {
    syncing: { color:"#fbbf24", label:"กำลังซิงก์..." },
    synced:  { color:"#34d399", label:"ซิงก์แล้ว ✓" },
    offline: { color:"#64748b", label:"offline" },
    error:   { color:"#f87171", label:"sync ไม่ได้" },
  }
  const s = map[status] || map.offline
  return <span style={{fontSize:11,color:s.color,fontWeight:500}}>{s.label}</span>
}

export default function App() {
  const [data, setData] = useState(null)
  const [mk, setMk] = useState(toMonthKey())
  const [view, setView] = useState("home")
  const [activeCard, setActiveCard] = useState(null)
  const [editBill, setEditBill] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [syncStatus, setSyncStatus] = useState("offline")
  const [showAddOther, setShowAddOther] = useState(false)
  const saveTimer = useRef(null)

  const [cardForm, setCardForm] = useState({ name:"", limit:"", color:COLORS[0] })
  const [billForm, setBillForm] = useState({ bill:"", minPay:"", paid:"", remain:"" })
  const [itemForm, setItemForm] = useState({ label:"", amount:"", date:todayStr() })
  const [otherForm, setOtherForm] = useState({ label:"", amount:"", date:todayStr() })

  useEffect(() => {
    const init = async () => {
      setSyncStatus("syncing")
      const cloud = await loadFromCloud()
      if (cloud && cloud.cards) {
        setData({ otherExpenses:{}, ...cloud })
        saveLocal({ otherExpenses:{}, ...cloud })
        setSyncStatus("synced")
      } else {
        setData(loadLocal())
        setSyncStatus(cloud === null ? "offline" : "synced")
      }
    }
    init()
  }, [])

  const mutate = (newData) => {
    setData(newData)
    saveLocal(newData)
    setSyncStatus("syncing")
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try { await saveToCloud(newData); setSyncStatus("synced") }
      catch { setSyncStatus("error") }
    }, 1500)
  }

  const shiftMonth = (dir) => {
    const [y,m] = mk.split("-").map(Number)
    setMk(toMonthKey(new Date(y, m-1+dir, 1)))
  }

  const monthTotals = () => {
    if (!data) return { totalRemain:0, totalCardBill:0, totalPaid:0, totalOther:0 }
    let totalRemain=0, totalCardBill=0, totalPaid=0
    data.cards.forEach(c => {
      const cm = getCardMonth(data, c.id, mk)
      const extra = (cm.items||[]).reduce((s,i)=>s+Number(i.amount),0)
      totalRemain += Number(c.remain ?? c.limit ?? 0)
      totalCardBill += Number(cm.bill||0) + extra
      totalPaid += Number(cm.paid||0)
    })
    const totalOther = getOtherExpenses(data, mk).reduce((s,e)=>s+Number(e.amount),0)
    return { totalRemain, totalCardBill, totalPaid, totalOther }
  }

  const doAddCard = () => {
    if (!cardForm.name) return
    const card = { id:Date.now()+"", name:cardForm.name, limit:Number(cardForm.limit)||0, remain:Number(cardForm.limit)||0, color:cardForm.color }
    mutate({ ...data, cards:[...data.cards, card] })
    setCardForm({ name:"", limit:"", color:COLORS[0] })
    setView("home")
  }

  const doSaveBill = () => {
    const cm = getCardMonth(data, activeCard.id, mk)
    const updated = { ...cm, bill:Number(billForm.bill)||0, minPay:Number(billForm.minPay)||0, paid:Number(billForm.paid)||0 }
    const cards = data.cards.map(c => c.id===activeCard.id ? {...c, remain:Number(billForm.remain)||0} : c)
    mutate(setCardMonth({...data,cards}, activeCard.id, mk, updated))
    setEditBill(false)
  }

  const doAddItem = () => {
    if (!itemForm.label || !itemForm.amount) return
    const cm = getCardMonth(data, activeCard.id, mk)
    const item = { id:Date.now()+"", label:itemForm.label, amount:Number(itemForm.amount), date:itemForm.date }
    mutate(setCardMonth(data, activeCard.id, mk, {...cm, items:[...(cm.items||[]), item]}))
    setItemForm({ label:"", amount:"", date:todayStr() })
    setView("card")
  }

  const doDeleteItem = (itemId) => {
    const cm = getCardMonth(data, activeCard.id, mk)
    mutate(setCardMonth(data, activeCard.id, mk, {...cm, items:(cm.items||[]).filter(i=>i.id!==itemId)}))
  }

  const doAddOther = () => {
    if (!otherForm.label || !otherForm.amount) return
    const list = getOtherExpenses(data, mk)
    const item = { id:Date.now()+"", label:otherForm.label, amount:Number(otherForm.amount), date:otherForm.date }
    mutate(setOtherExpenses(data, mk, [...list, item]))
    setOtherForm({ label:"", amount:"", date:todayStr() })
    setShowAddOther(false)
  }

  const doDeleteOther = (id) => {
    const list = getOtherExpenses(data, mk).filter(e=>e.id!==id)
    mutate(setOtherExpenses(data, mk, list))
  }

  const doDeleteCard = () => {
    mutate({ ...data, cards:data.cards.filter(c=>c.id!==activeCard.id) })
    setConfirmDel(false)
    setView("home")
  }

  const openCard = (card) => {
    setActiveCard(card)
    const cm = getCardMonth(data, card.id, mk)
    setBillForm({ bill:cm.bill||"", minPay:cm.minPay||"", paid:cm.paid||"", remain:card.remain||"" })
    setEditBill(false); setConfirmDel(false)
    setView("card")
  }

  if (!data) return (
    <div style={{background:S.bg,color:S.muted,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexDirection:"column",gap:12}}>
      <div style={{width:32,height:32,border:"3px solid #334155",borderTopColor:S.accent,borderRadius:"50%",animation:"spin 1s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <p>กำลังโหลด...</p>
    </div>
  )

  // ── HOME ─────────────────────────────────────────────────
  if (view === "home") {
    const { totalRemain, totalCardBill, totalPaid, totalOther } = monthTotals()
    const totalAllPaid = totalPaid + totalOther
    const otherList = getOtherExpenses(data, mk)

    return (
      <div style={{background:S.bg,minHeight:"100vh",color:S.text,paddingBottom:100}}>
        <div style={{padding:"48px 18px 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>shiftMonth(-1)} style={{background:S.surface,border:"1px solid "+S.border,color:S.text,borderRadius:10,width:34,height:34,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
              <span style={{fontSize:19,fontWeight:700}}>{labelMonth(mk)}</span>
              <button onClick={()=>shiftMonth(1)} style={{background:S.surface,border:"1px solid "+S.border,color:S.text,borderRadius:10,width:34,height:34,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
            </div>
            <SyncBadge status={syncStatus} />
          </div>
        </div>

        {/* Summary boxes */}
        {(data.cards.length > 0 || otherList.length > 0) && (
          <div style={{margin:"0 16px 16px",display:"flex",flexDirection:"column",gap:8}}>
            {/* row 1: วงเงิน + ยอดบัตร */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                {label:"วงเงินเหลือรวม", val:fmt(totalRemain), color:"#34d399"},
                {label:"ยอดรวมบัตรเดือนนี้", val:fmt(totalCardBill), color:"#fb923c"},
              ].map(s=>(
                <div key={s.label} style={{background:S.surface,borderRadius:14,padding:"12px 10px",border:"1px solid "+S.border,textAlign:"center"}}>
                  <p style={{fontSize:10,color:S.muted,marginBottom:4,lineHeight:1.3}}>{s.label}</p>
                  <p style={{fontSize:14,fontWeight:700,color:s.color}}>{s.val}</p>
                </div>
              ))}
            </div>
            {/* row 2: ยอดรวมที่จ่ายทั้งหมด full width */}
            <div style={{background:"#1a2744",borderRadius:14,padding:"14px 16px",border:"1px solid #2d3f6b",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <p style={{fontSize:11,color:"#93c5fd",marginBottom:3}}>ยอดรวมที่จ่ายทั้งหมด</p>
                <p style={{fontSize:10,color:S.muted}}>จ่ายบัตร {fmt(totalPaid)} + อื่นๆ {fmt(totalOther)}</p>
              </div>
              <p style={{fontSize:18,fontWeight:800,color:"#60a5fa"}}>{fmt(totalAllPaid)}</p>
            </div>
          </div>
        )}

        {/* Card list */}
        <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:10}}>
          {data.cards.length === 0 && otherList.length === 0 && (
            <div style={{textAlign:"center",paddingTop:60,color:S.muted}}>
              <div style={{fontSize:44,marginBottom:14}}>💳</div>
              <p style={{fontSize:15}}>กด + เพื่อเริ่มต้น</p>
            </div>
          )}
          {data.cards.map(card => {
            const cm = getCardMonth(data, card.id, mk)
            const extra = (cm.items||[]).reduce((s,i)=>s+Number(i.amount),0)
            const realBill = Number(cm.bill||0) + extra
            const paid = Number(cm.paid||0)
            const unpaid = Math.max(0, realBill - paid)
            const remain = Number(card.remain ?? card.limit ?? 0)
            const pct = card.limit ? Math.min(100,((card.limit-remain)/card.limit)*100) : 0
            return (
              <div key={card.id} onClick={()=>openCard(card)}
                style={{background:S.surface,borderRadius:18,padding:16,border:"1px solid "+S.border,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:11,height:11,borderRadius:"50%",background:card.color}} />
                    <span style={{fontWeight:700,fontSize:16}}>{card.name}</span>
                  </div>
                  <span style={{fontSize:12,color:card.color,fontWeight:600}}>เหลือ {fmt(remain)}</span>
                </div>
                <div style={{height:3,background:"#0f172a",borderRadius:4,marginBottom:12,overflow:"hidden"}}>
                  <div style={{height:"100%",width:pct+"%",background:card.color,borderRadius:4}} />
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,textAlign:"center"}}>
                  {[
                    {label:"ยอดเดือนนี้", val:fmt(realBill), color:"#fb923c"},
                    {label:"จ่ายแล้ว", val:fmt(paid), color:"#34d399"},
                    {label:"ค้างจ่าย", val:fmt(unpaid), color:unpaid>0?"#f87171":S.muted},
                  ].map(s=>(
                    <div key={s.label}>
                      <p style={{fontSize:10,color:S.muted,marginBottom:2}}>{s.label}</p>
                      <p style={{fontSize:14,fontWeight:600,color:s.color}}>{s.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Other expenses section */}
          {(otherList.length > 0 || showAddOther) && (
            <div style={{background:S.surface,borderRadius:18,padding:16,border:"1px solid "+S.border}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <p style={{fontSize:15,fontWeight:600,margin:0}}>ค่าใช้จ่ายอื่นๆ</p>
                <button onClick={()=>setShowAddOther(!showAddOther)}
                  style={{background:S.accent+"22",color:S.accent,border:"none",borderRadius:8,padding:"4px 10px",fontSize:12,cursor:"pointer"}}>
                  {showAddOther?"ปิด":"+ เพิ่ม"}
                </button>
              </div>
              {showAddOther && (
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14,padding:12,background:"#0f172a",borderRadius:12}}>
                  <div>
                    <p style={{fontSize:12,color:S.muted,marginBottom:4}}>รายการ</p>
                    <input style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:10,padding:"10px 12px",fontSize:14,boxSizing:"border-box"}}
                      placeholder="เช่น ให้แม่, ค่าน้ำมัน" value={otherForm.label}
                      onChange={e=>setOtherForm({...otherForm,label:e.target.value})} />
                  </div>
                  <div>
                    <p style={{fontSize:12,color:S.muted,marginBottom:4}}>จำนวน (บาท)</p>
                    <input type="number" inputMode="decimal"
                      style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:10,padding:"10px 12px",fontSize:14,boxSizing:"border-box"}}
                      placeholder="0.00" value={otherForm.amount}
                      onChange={e=>setOtherForm({...otherForm,amount:e.target.value})} />
                  </div>
                  <div>
                    <p style={{fontSize:12,color:S.muted,marginBottom:4}}>วันที่</p>
                    <input type="date"
                      style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:10,padding:"10px 12px",fontSize:14,boxSizing:"border-box"}}
                      value={otherForm.date} onChange={e=>setOtherForm({...otherForm,date:e.target.value})} />
                  </div>
                  <button onClick={doAddOther}
                    style={{background:otherForm.label&&otherForm.amount?S.accent:"#334155",color:"white",border:"none",borderRadius:10,padding:11,fontSize:14,fontWeight:600,cursor:"pointer"}}>
                    บันทึก
                  </button>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {otherList.map(e=>(
                  <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0f172a",borderRadius:12,padding:"10px 12px"}}>
                    <div>
                      <p style={{fontSize:14,fontWeight:500,margin:0}}>{e.label}</p>
                      <p style={{fontSize:11,color:S.muted,marginTop:2}}>{e.date}</p>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <p style={{fontSize:14,fontWeight:600,color:"#a78bfa"}}>{fmt(e.amount)}</p>
                      <button onClick={()=>doDeleteOther(e.id)} style={{background:"none",border:"none",color:S.muted,fontSize:15,cursor:"pointer",padding:0}}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FAB menu */}
        <div style={{position:"fixed",bottom:24,right:20,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:10}}>
          <button onClick={()=>{ setShowAddOther(true); window.scrollTo(0,999999) }}
            style={{background:"#1e293b",color:S.text,border:"1px solid #334155",borderRadius:24,padding:"10px 16px",fontSize:13,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 12px #00000055",whiteSpace:"nowrap"}}>
            + ค่าใช้จ่ายอื่นๆ
          </button>
          <button onClick={()=>setView("addCard")}
            style={{width:52,height:52,borderRadius:"50%",background:S.accent,color:"white",fontSize:28,border:"none",cursor:"pointer",boxShadow:"0 4px 24px #7c6af755",display:"flex",alignItems:"center",justifyContent:"center",WebkitTapHighlightColor:"transparent"}}>+</button>
        </div>
      </div>
    )
  }

  // ── ADD CARD ─────────────────────────────────────────────
  if (view === "addCard") return (
    <div style={{background:S.bg,minHeight:"100vh",color:S.text,padding:"48px 18px"}}>
      <button onClick={()=>setView("home")} style={{background:"none",border:"none",color:S.muted,fontSize:14,cursor:"pointer",marginBottom:24,padding:0}}>← กลับ</button>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:24}}>เพิ่มบัตร</h2>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div>
          <p style={{fontSize:13,color:S.muted,marginBottom:5}}>ชื่อบัตร</p>
          <input style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"11px 14px",fontSize:15,boxSizing:"border-box"}}
            placeholder="เช่น SCB, TMB, Shopee" value={cardForm.name}
            onChange={e=>setCardForm({...cardForm,name:e.target.value})} />
        </div>
        <div>
          <p style={{fontSize:13,color:S.muted,marginBottom:5}}>วงเงิน (บาท)</p>
          <input type="number" inputMode="decimal"
            style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"11px 14px",fontSize:15,boxSizing:"border-box"}}
            placeholder="เช่น 50000" value={cardForm.limit}
            onChange={e=>setCardForm({...cardForm,limit:e.target.value})} />
        </div>
        <div>
          <p style={{fontSize:13,color:S.muted,marginBottom:8}}>สีบัตร</p>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {COLORS.map(c=>(
              <button key={c} onClick={()=>setCardForm({...cardForm,color:c})}
                style={{width:36,height:36,borderRadius:"50%",background:c,border:cardForm.color===c?"3px solid white":"3px solid transparent",cursor:"pointer"}} />
            ))}
          </div>
        </div>
        <button onClick={doAddCard}
          style={{background:cardForm.name?S.accent:"#334155",color:"white",border:"none",borderRadius:14,padding:15,fontSize:15,fontWeight:600,cursor:"pointer",marginTop:8}}>
          เพิ่มบัตร
        </button>
      </div>
    </div>
  )

  // ── CARD DETAIL ──────────────────────────────────────────
  if (view === "card" && activeCard) {
    const card = data.cards.find(c=>c.id===activeCard.id) || activeCard
    const cm = getCardMonth(data, card.id, mk)
    const extra = (cm.items||[]).reduce((s,i)=>s+Number(i.amount),0)
    const realBill = Number(cm.bill||0) + extra
    const paid = Number(cm.paid||0)
    const unpaid = Math.max(0, realBill - paid)
    const remain = Number(card.remain ?? card.limit ?? 0)

    return (
      <div style={{background:S.bg,minHeight:"100vh",color:S.text,paddingBottom:80}}>
        {confirmDel && <ConfirmModal title={`ลบบัตร "${card.name}"?`} desc="รายการและประวัติทั้งหมดจะหายไป" onConfirm={doDeleteCard} onCancel={()=>setConfirmDel(false)} />}

        <div style={{padding:"48px 18px 16px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <button onClick={()=>setView("home")} style={{background:"none",border:"none",color:S.muted,fontSize:14,cursor:"pointer",padding:0}}>← กลับ</button>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <SyncBadge status={syncStatus} />
              <button onClick={()=>setConfirmDel(true)} style={{background:"none",border:"none",color:"#f87171",fontSize:13,cursor:"pointer",padding:0}}>ลบบัตร</button>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
            <div style={{width:13,height:13,borderRadius:"50%",background:card.color}} />
            <h2 style={{fontSize:23,fontWeight:700,margin:0}}>{card.name}</h2>
          </div>
          <p style={{fontSize:12,color:S.muted}}>{labelMonth(mk)}</p>
        </div>

        <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{background:S.surface,borderRadius:18,padding:18,border:"1px solid "+S.border}}>
            <p style={{fontSize:11,color:S.muted,marginBottom:4}}>วงเงินคงเหลือ</p>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <p style={{fontSize:32,fontWeight:800,color:remain<(card.limit||0)*0.2?"#f87171":"#34d399",margin:0}}>{fmt(remain)}</p>
              <p style={{fontSize:13,color:S.muted}}>/ {fmt(card.limit||0)}</p>
            </div>
          </div>

          <div style={{background:S.surface,borderRadius:18,padding:18,border:"1px solid "+S.border}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <p style={{fontSize:14,fontWeight:600,margin:0}}>ยอดเดือนนี้</p>
              <button onClick={()=>{ setBillForm({bill:cm.bill||"",minPay:cm.minPay||"",paid:cm.paid||"",remain:card.remain||""}); setEditBill(!editBill) }}
                style={{background:S.accent+"22",color:S.accent,border:"none",borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>
                {editBill?"ปิด":"✏️ แก้ไข"}
              </button>
            </div>
            {editBill ? (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <NumInput label="ยอดแจ้งหนี้จากธนาคาร" value={billForm.bill} onChange={v=>setBillForm({...billForm,bill:v})} />
                <NumInput label="ขั้นต่ำที่ต้องจ่าย" value={billForm.minPay} onChange={v=>setBillForm({...billForm,minPay:v})} />
                <NumInput label="จ่ายจริงเดือนนี้" value={billForm.paid} onChange={v=>setBillForm({...billForm,paid:v})} />
                <NumInput label="วงเงินคงเหลือ (จากแอพธนาคาร)" value={billForm.remain} onChange={v=>setBillForm({...billForm,remain:v})} />
                <button onClick={doSaveBill}
                  style={{background:S.accent,color:"white",border:"none",borderRadius:12,padding:13,fontSize:14,fontWeight:600,cursor:"pointer",marginTop:4}}>
                  บันทึก
                </button>
              </div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  {label:"ยอดแจ้งหนี้", val:fmt(cm.bill||0), color:S.text},
                  {label:"รายการเพิ่มเติม", val:fmt(extra), color:"#fb923c"},
                  {label:"ยอดรวม", val:fmt(realBill), color:"#fb923c", bold:true},
                  {label:"ขั้นต่ำ", val:fmt(cm.minPay||0), color:"#fbbf24"},
                  {label:"จ่ายจริง", val:fmt(paid), color:"#34d399"},
                  {label:"ค้างจ่าย", val:fmt(unpaid), color:unpaid>0?"#f87171":S.muted},
                ].map(s=>(
                  <div key={s.label} style={{background:"#0f172a",borderRadius:12,padding:"11px 12px"}}>
                    <p style={{fontSize:10,color:S.muted,marginBottom:3}}>{s.label}</p>
                    <p style={{fontSize:15,fontWeight:s.bold?800:600,color:s.color}}>{s.val}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{background:S.surface,borderRadius:18,padding:18,border:"1px solid "+S.border}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <p style={{fontSize:14,fontWeight:600,margin:0}}>รายการเพิ่มเติม</p>
              <button onClick={()=>setView("addItem")}
                style={{background:card.color+"22",color:card.color,border:"none",borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>
                + เพิ่ม
              </button>
            </div>
            {(cm.items||[]).length===0 && (
              <p style={{fontSize:13,color:S.muted,textAlign:"center",padding:"6px 0"}}>ยังไม่มีรายการ</p>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(cm.items||[]).map(item=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0f172a",borderRadius:12,padding:"11px 12px"}}>
                  <div>
                    <p style={{fontSize:14,fontWeight:500,margin:0}}>{item.label}</p>
                    <p style={{fontSize:11,color:S.muted,marginTop:2}}>{item.date}</p>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <p style={{fontSize:14,fontWeight:600,color:"#fb923c"}}>{fmt(item.amount)}</p>
                    <button onClick={()=>doDeleteItem(item.id)} style={{background:"none",border:"none",color:S.muted,fontSize:15,cursor:"pointer",padding:0}}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── ADD ITEM ─────────────────────────────────────────────
  if (view === "addItem" && activeCard) {
    const card = data.cards.find(c=>c.id===activeCard.id) || activeCard
    return (
      <div style={{background:S.bg,minHeight:"100vh",color:S.text,padding:"48px 18px"}}>
        <button onClick={()=>setView("card")} style={{background:"none",border:"none",color:S.muted,fontSize:14,cursor:"pointer",marginBottom:24,padding:0}}>← กลับ</button>
        <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>เพิ่มรายการ</h2>
        <p style={{fontSize:13,color:S.muted,marginBottom:24}}>{card.name} · {labelMonth(mk)}</p>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div>
            <p style={{fontSize:13,color:S.muted,marginBottom:5}}>รายการ</p>
            <input style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"11px 14px",fontSize:15,boxSizing:"border-box"}}
              placeholder="เช่น ค่าไฟ, ประกัน, เน็ต" value={itemForm.label}
              onChange={e=>setItemForm({...itemForm,label:e.target.value})} />
          </div>
          <div>
            <p style={{fontSize:13,color:S.muted,marginBottom:5}}>จำนวน (บาท)</p>
            <input type="number" inputMode="decimal"
              style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"11px 14px",fontSize:15,boxSizing:"border-box"}}
              placeholder="0.00" value={itemForm.amount}
              onChange={e=>setItemForm({...itemForm,amount:e.target.value})} />
          </div>
          <div>
            <p style={{fontSize:13,color:S.muted,marginBottom:5}}>วันที่</p>
            <input type="date"
              style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"11px 14px",fontSize:15,boxSizing:"border-box"}}
              value={itemForm.date} onChange={e=>setItemForm({...itemForm,date:e.target.value})} />
          </div>
          <button onClick={doAddItem}
            style={{background:itemForm.label&&itemForm.amount?card.color:"#334155",color:"white",border:"none",borderRadius:14,padding:15,fontSize:15,fontWeight:600,cursor:"pointer",marginTop:8}}>
            บันทึกรายการ
          </button>
        </div>
      </div>
    )
  }

  return null
}
