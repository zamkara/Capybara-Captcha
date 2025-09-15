"use client"
import { useState,useCallback } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { motion,useMotionValue,useTransform,animate } from "framer-motion"
const BASE_URL="https://yourCapybara.workers.dev"
const sha256Hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,"0")).join("")
const hasZeros=(h:string,n:number)=>h.startsWith("0".repeat(n))
export function HumanCaptcha({difficulty=3,duration=30,onSuccess,className=""}:{difficulty?:number;duration?:number;onSuccess?:(t:string)=>void;className?:string}) {
  const [verified,setVerified]=useState(false)
  const [loading,setLoading]=useState(false)
  const progress=useMotionValue(0)
  const percent=useTransform(progress,v=>`${Math.round(v)}%`)
  const reset=useCallback(()=>{setVerified(false);setLoading(false);progress.set(0)},[progress])
  const start=useCallback(async()=>{setLoading(true);setVerified(false);progress.set(0);try{const r=await fetch(`${BASE_URL}/api/challenge`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({difficulty,duration})});const{challenge,payload_token}=await r.json();const c=animate(progress,95,{duration:2.5,ease:"easeInOut"});let s=0;while(!(await sha256Hex(challenge.nonce+s)).startsWith("0".repeat(challenge.difficulty)))s++;c.stop();await animate(progress,100,{duration:0.8,ease:"easeOut"}).finished;const v=await fetch(`${BASE_URL}/api/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:challenge.id,solution:String(s),payload_token})});const d=await v.json();if(d.success||d.verified||d.status==="solved"){setVerified(true);onSuccess?.(d.token||"");setTimeout(reset,3000)}}catch(e){console.error(e)}finally{setLoading(false)}},[difficulty,duration,onSuccess,progress,reset])
  return<motion.button onClick={start} disabled={loading||verified} className={`relative flex items-center gap-6 px-4 py-3 bg-muted rounded-full border overflow-hidden ${className}`} whileHover={{scale:verified?1:1.02}} whileTap={{scale:verified?1:0.98}}>
    <motion.span key={verified?"ok":"not-ok"} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{duration:0.2}} className="font-medium">{verified?"Verified":"I'm human"}</motion.span>
    {verified?<Checkbox checked className="pointer-events-none"/>:loading?<motion.span className="relative z-10">{percent}</motion.span>:<Checkbox checked={false}/>}
    <motion.div className="absolute inset-0 bg-primary/10" initial={{width:"0%"}} animate={{width:verified?"100%":"0%"}} transition={{duration:0.3}}/>
  </motion.button>
}
