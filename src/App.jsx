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
  return { cards: [], months: {} }
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

const S = { bg:"#0f172a", surface:"#1e293b", border:"#334155", text:"#e2e8f0", muted:"#64748b", accent:"#7c6af7" }

function NumInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <p style={{fontSize:11,color:S.muted,marginBottom:4}}>{label}</p>
      <input type="number" inputMode="decimal"
        style={{background:"#0f172a",color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:10,padding:"10px 12px",fontSize:14,boxSizing:"border-box"}}
        placeholder={placeholder||"0.00"} value={value} onChange={e=>onChange(e.target.value)} />
    </div>
  )
}

function ConfirmModal({ title, desc, onConfirm, onCancel }) {
  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:S.surface,borderRadius:20,padding:24,border:"1px solid "+S.border,width:"100%",maxWidth:320}}>
        <p style={{fontWeight:700,fontSize:15,marginBottom:6,color:S.text}}>{title}</p>
        <p style={{fontSize:12,color:S.muted,marginBottom:20}}>{desc}</p>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onConfirm} style={{flex:1,background:"#ef4444",color:"white",border:"none",borderRadius:12,padding:11,fontSize:13,fontWeight:600,cursor:"pointer"}}>ลบเลย</button>
          <button onClick={onCancel} style={{flex:1,background:"#334155",color:"white",border:"none",borderRadius:12,padding:11,fontSize:13,cursor:"pointer"}}>ยกเลิก</button>
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
  return (
    <span style={{fontSize:10,color:s.color,fontWeight:500}}>{s.label}</span>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [mk, setMk] = useState(toMonthKey())
  const [view, setView] = useState("home")
  const [activeCard, setActiveCard] = useState(null)
  const [editBill, setEditBill] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [syncStatus, setSyncStatus] = useState("offline")
  const saveTimer = useRef(null)

  const [cardForm, setCardForm] = useState({ name:"", limit:"", color:COLORS[0] })
  const [billForm, setBillForm] = useState({ bill:"", minPay:"", paid:"", remain:"" })
  const [itemForm, setItemForm] = useState({ label:"", amount:"", date:todayStr() })

  // Load: cloud first, fallback localStorage
  useEffect(() => {
    const init = async () => {
      setSyncStatus("syncing")
      const cloud = await loadFromCloud()
      if (cloud && cloud.cards) {
        setData(cloud)
        saveLocal(cloud)
        setSyncStatus("synced")
      } else {
        const local = loadLocal()
        setData(local)
        setSyncStatus(cloud === null ? "offline" : "synced")
      }
    }
    init()
  }, [])

  // Debounced save: local immediately, cloud after 1.5s
  const mutate = (newData) => {
    setData(newData)
    saveLocal(newData)
    setSyncStatus("syncing")
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await saveToCloud(newData)
        setSyncStatus("synced")
      } catch {
        setSyncStatus("error")
      }
    }, 1500)
  }

  const shiftMonth = (dir) => {
    const [y,m] = mk.split("-").map(Number)
    setMk(toMonthKey(new Date(y, m-1+dir, 1)))
  }

  const monthTotals = () => {
    if (!data) return { totalRemain:0, totalBill:0, totalPaid:0 }
    let totalRemain=0, totalBill=0, totalPaid=0
    data.cards.forEach(c => {
      const cm = getCardMonth(data, c.id, mk)
      const extra = (cm.items||[]).reduce((s,i)=>s+Number(i.amount),0)
      totalRemain += Number(c.remain ?? c.limit ?? 0)
      totalBill += Number(cm.bill||0) + extra
      totalPaid += Number(cm.paid||0)
    })
    return { totalRemain, totalBill, totalPaid }
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

  const doDeleteCard = () => {
    mutate({ ...data, cards:data.cards.filter(c=>c.id!==activeCard.id) })
    setConfirmDel(false)
    setView("home")
  }

  const openCard = (card) => {
    setActiveCard(card)
    const cm = getCardMonth(data, card.id, mk)
    setBillForm({ bill:cm.bill||"", minPay:cm.minPay||"", paid:cm.paid||"", remain:card.remain||"" })
    setEditBill(false)
    setConfirmDel(false)
    setView("card")
  }

  if (!data) return (
    <div style={{background:S.bg,color:S.muted,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexDirection:"column",gap:12}}>
      <div style={{width:32,height:32,border:"3px solid #334155",borderTopColor:S.accent,borderRadius:"50%",animation:"spin 1s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <p>กำลังโหลด...</p>
    </div>
  )

  // ── HOME ────────────────────────────────────────────────
  if (view === "home") {
    const { totalRemain, totalBill, totalPaid } = monthTotals()
    const totalUnpaid = Math.max(0, totalBill - totalPaid)
    return (
      <div style={{background:S.bg,minHeight:"100vh",color:S.text,paddingBottom:80}}>
        <div style={{padding:"48px 18px 16px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <p style={{fontSize:10,color:S.muted,letterSpacing:3,textTransform:"uppercase",margin:0}}>บัตรเครดิต</p>
            <SyncBadge status={syncStatus} />
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button onClick={()=>shiftMonth(-1)} style={{background:S.surface,border:"1px solid "+S.border,color:S.text,borderRadius:10,width:32,height:32,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
            <span style={{fontSize:17,fontWeight:700}}>{labelMonth(mk)}</span>
            <button onClick={()=>shiftMonth(1)} style={{background:S.surface,border:"1px solid "+S.border,color:S.text,borderRadius:10,width:32,height:32,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
          </div>
        </div>

        {data.cards.length > 0 && (
          <div style={{margin:"0 16px 18px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[
              {label:"วงเงินเหลือรวม", val:fmt(totalRemain), color:"#34d399"},
              {label:"ยอดรวมเดือนนี้", val:fmt(totalBill), color:"#fb923c"},
              {label:"ค้างจ่ายรวม", val:fmt(totalUnpaid), color:totalUnpaid>0?"#f87171":S.muted},
            ].map(s=>(
              <div key={s.label} style={{background:S.surface,borderRadius:14,padding:"10px 8px",border:"1px solid "+S.border,textAlign:"center"}}>
                <p style={{fontSize:8,color:S.muted,marginBottom:3,lineHeight:1.3}}>{s.label}</p>
                <p style={{fontSize:12,fontWeight:700,color:s.color}}>{s.val}</p>
              </div>
            ))}
          </div>
        )}

        <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:10}}>
          {data.cards.length === 0 && (
            <div style={{textAlign:"center",paddingTop:80,color:S.muted}}>
              <div style={{fontSize:44,marginBottom:14}}>💳</div>
              <p style={{fontSize:14}}>กด + เพื่อเพิ่มบัตรแรก</p>
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
                    <div style={{width:10,height:10,borderRadius:"50%",background:card.color}} />
                    <span style={{fontWeight:700,fontSize:15}}>{card.name}</span>
                  </div>
                  <span style={{fontSize:11,color:card.color,fontWeight:600}}>เหลือ {fmt(remain)}</span>
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
                      <p style={{fontSize:9,color:S.muted,marginBottom:2}}>{s.label}</p>
                      <p style={{fontSize:13,fontWeight:600,color:s.color}}>{s.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <button onClick={()=>setView("addCard")}
          style={{position:"fixed",bottom:28,right:20,width:52,height:52,borderRadius:"50%",background:S.accent,color:"white",fontSize:28,border:"none",cursor:"pointer",boxShadow:"0 4px 24px #7c6af755",display:"flex",alignItems:"center",justifyContent:"center",WebkitTapHighlightColor:"transparent"}}>+</button>
      </div>
    )
  }

  // ── ADD CARD ─────────────────────────────────────────────
  if (view === "addCard") return (
    <div style={{background:S.bg,minHeight:"100vh",color:S.text,padding:"48px 18px"}}>
      <button onClick={()=>setView("home")} style={{background:"none",border:"none",color:S.muted,fontSize:13,cursor:"pointer",marginBottom:24,padding:0}}>← กลับ</button>
      <h2 style={{fontSize:20,fontWeight:700,marginBottom:24}}>เพิ่มบัตร</h2>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <p style={{fontSize:11,color:S.muted,marginBottom:4}}>ชื่อบัตร</p>
          <input style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"10px 14px",fontSize:14,boxSizing:"border-box"}}
            placeholder="เช่น SCB, TMB, Shopee" value={cardForm.name}
            onChange={e=>setCardForm({...cardForm,name:e.target.value})} />
        </div>
        <div>
          <p style={{fontSize:11,color:S.muted,marginBottom:4}}>วงเงิน (บาท)</p>
          <input type="number" inputMode="decimal"
            style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"10px 14px",fontSize:14,boxSizing:"border-box"}}
            placeholder="เช่น 50000" value={cardForm.limit}
            onChange={e=>setCardForm({...cardForm,limit:e.target.value})} />
        </div>
        <div>
          <p style={{fontSize:11,color:S.muted,marginBottom:8}}>สีบัตร</p>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {COLORS.map(c=>(
              <button key={c} onClick={()=>setCardForm({...cardForm,color:c})}
                style={{width:34,height:34,borderRadius:"50%",background:c,border:cardForm.color===c?"3px solid white":"3px solid transparent",cursor:"pointer"}} />
            ))}
          </div>
        </div>
        <button onClick={doAddCard}
          style={{background:cardForm.name?S.accent:"#334155",color:"white",border:"none",borderRadius:14,padding:14,fontSize:14,fontWeight:600,cursor:"pointer",marginTop:8}}>
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
            <button onClick={()=>setView("home")} style={{background:"none",border:"none",color:S.muted,fontSize:13,cursor:"pointer",padding:0}}>← กลับ</button>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <SyncBadge status={syncStatus} />
              <button onClick={()=>setConfirmDel(true)} style={{background:"none",border:"none",color:"#f87171",fontSize:12,cursor:"pointer",padding:0}}>ลบบัตร</button>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:2}}>
            <div style={{width:12,height:12,borderRadius:"50%",background:card.color}} />
            <h2 style={{fontSize:22,fontWeight:700,margin:0}}>{card.name}</h2>
          </div>
          <p style={{fontSize:11,color:S.muted}}>{labelMonth(mk)}</p>
        </div>

        <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{background:S.surface,borderRadius:18,padding:18,border:"1px solid "+S.border}}>
            <p style={{fontSize:10,color:S.muted,marginBottom:4}}>วงเงินคงเหลือ</p>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <p style={{fontSize:30,fontWeight:800,color:remain<(card.limit||0)*0.2?"#f87171":"#34d399",margin:0}}>{fmt(remain)}</p>
              <p style={{fontSize:12,color:S.muted}}>/ {fmt(card.limit||0)}</p>
            </div>
          </div>

          <div style={{background:S.surface,borderRadius:18,padding:18,border:"1px solid "+S.border}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <p style={{fontSize:13,fontWeight:600,margin:0}}>ยอดเดือนนี้</p>
              <button onClick={()=>{ setBillForm({bill:cm.bill||"",minPay:cm.minPay||"",paid:cm.paid||"",remain:card.remain||""}); setEditBill(!editBill) }}
                style={{background:S.accent+"22",color:S.accent,border:"none",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>
                {editBill?"ปิด":"✏️ แก้ไข"}
              </button>
            </div>
            {editBill ? (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <NumInput label="ยอดแจ้งหนี้จากธนาคาร" value={billForm.bill} onChange={v=>setBillForm({...billForm,bill:v})} />
                <NumInput label="ขั้นต่ำที่ต้องจ่าย" value={billForm.minPay} onChange={v=>setBillForm({...billForm,minPay:v})} />
                <NumInput label="จ่ายจริงเดือนนี้" value={billForm.paid} onChange={v=>setBillForm({...billForm,paid:v})} />
                <NumInput label="วงเงินคงเหลือ (จากแอพธนาคาร)" value={billForm.remain} onChange={v=>setBillForm({...billForm,remain:v})} />
                <button onClick={doSaveBill}
                  style={{background:S.accent,color:"white",border:"none",borderRadius:12,padding:12,fontSize:13,fontWeight:600,cursor:"pointer",marginTop:4}}>
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
                  <div key={s.label} style={{background:"#0f172a",borderRadius:12,padding:"10px 12px"}}>
                    <p style={{fontSize:9,color:S.muted,marginBottom:3}}>{s.label}</p>
                    <p style={{fontSize:14,fontWeight:s.bold?800:600,color:s.color}}>{s.val}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{background:S.surface,borderRadius:18,padding:18,border:"1px solid "+S.border}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <p style={{fontSize:13,fontWeight:600,margin:0}}>รายการเพิ่มเติม</p>
              <button onClick={()=>setView("addItem")}
                style={{background:card.color+"22",color:card.color,border:"none",borderRadius:8,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>
                + เพิ่ม
              </button>
            </div>
            {(cm.items||[]).length===0 && (
              <p style={{fontSize:12,color:S.muted,textAlign:"center",padding:"6px 0"}}>ยังไม่มีรายการ</p>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(cm.items||[]).map(item=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0f172a",borderRadius:12,padding:"10px 12px"}}>
                  <div>
                    <p style={{fontSize:13,fontWeight:500,margin:0}}>{item.label}</p>
                    <p style={{fontSize:10,color:S.muted,marginTop:2}}>{item.date}</p>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <p style={{fontSize:13,fontWeight:600,color:"#fb923c"}}>{fmt(item.amount)}</p>
                    <button onClick={()=>doDeleteItem(item.id)} style={{background:"none",border:"none",color:S.muted,fontSize:14,cursor:"pointer",padding:0}}>✕</button>
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
        <button onClick={()=>setView("card")} style={{background:"none",border:"none",color:S.muted,fontSize:13,cursor:"pointer",marginBottom:24,padding:0}}>← กลับ</button>
        <h2 style={{fontSize:20,fontWeight:700,marginBottom:4}}>เพิ่มรายการ</h2>
        <p style={{fontSize:12,color:S.muted,marginBottom:24}}>{card.name} · {labelMonth(mk)}</p>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <p style={{fontSize:11,color:S.muted,marginBottom:4}}>รายการ</p>
            <input style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"10px 14px",fontSize:14,boxSizing:"border-box"}}
              placeholder="เช่น ค่าไฟ, ประกัน, เน็ต" value={itemForm.label}
              onChange={e=>setItemForm({...itemForm,label:e.target.value})} />
          </div>
          <div>
            <p style={{fontSize:11,color:S.muted,marginBottom:4}}>จำนวน (บาท)</p>
            <input type="number" inputMode="decimal"
              style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"10px 14px",fontSize:14,boxSizing:"border-box"}}
              placeholder="0.00" value={itemForm.amount}
              onChange={e=>setItemForm({...itemForm,amount:e.target.value})} />
          </div>
          <div>
            <p style={{fontSize:11,color:S.muted,marginBottom:4}}>วันที่</p>
            <input type="date"
              style={{background:S.surface,color:S.text,border:"1px solid "+S.border,width:"100%",borderRadius:12,padding:"10px 14px",fontSize:14,boxSizing:"border-box"}}
              value={itemForm.date} onChange={e=>setItemForm({...itemForm,date:e.target.value})} />
          </div>
          <button onClick={doAddItem}
            style={{background:itemForm.label&&itemForm.amount?card.color:"#334155",color:"white",border:"none",borderRadius:14,padding:14,fontSize:14,fontWeight:600,cursor:"pointer",marginTop:8}}>
            บันทึกรายการ
          </button>
        </div>
      </div>
    )
  }

  return null
}
