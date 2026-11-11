
import {initializeApp} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
  getAuth,onAuthStateChanged,createUserWithEmailAndPassword,
  signInWithEmailAndPassword,signInAnonymously,signOut,updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  initializeFirestore,collection,addDoc,query,where,orderBy,
  onSnapshot,serverTimestamp,doc,setDoc,getDoc,updateDoc,
  arrayUnion,arrayRemove,deleteDoc,Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig={
  apiKey:"AIzaSyAe6C7CzXbPT0I1FfuOPIxeHqVc2-BKa6k",
  authDomain:"shat-arabi-iraqi.firebaseapp.com",
  projectId:"shat-arabi-iraqi",
  storageBucket:"shat-arabi-iraqi.firebasestorage.app",
  messagingSenderId:"303969132738",
  appId:"1:303969132738:web:a12efb0a8cb1864bb99b5b"
};

const OWNER_UID="dvdFivbIZ9P7gsDZmFx0RLqtWcB2";
const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=initializeFirestore(app,{experimentalAutoDetectLongPolling:true});
const $=id=>document.getElementById(id);

let nick="",stopMessages=null,stopRooms=null,stopUsers=null,stopMyRole=null;
let currentRoom="general",roomName="الغرفة العامة",heartbeat=null;
let isOwner=false,myRole="member",viewedUserId=null,blockedFromGeneral=false;
let roleCache=new Map();
let openMenu=null;

const placeholder="data:image/svg+xml,"+encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#29251e"/><circle cx="50" cy="36" r="19" fill="#c49b3b"/><path d="M12 100c2-27 17-40 38-40s36 13 38 40" fill="#c49b3b"/></svg>'
);

function msg(id,t){
  const el=$(id);
  if(el)el.textContent=t||"";
}
function isOwnerId(uid){return uid===OWNER_UID;}
function canModerate(){return isOwner||myRole==="admin"||myRole==="moderator";}
function canFullBan(){return isOwner||myRole==="admin";}

function err(e){
  const m={
    "auth/invalid-email":"البريد الإلكتروني غير صحيح",
    "auth/weak-password":"كلمة المرور لازم تكون 6 أحرف على الأقل",
    "auth/email-already-in-use":"هذا البريد مسجل مسبقاً",
    "auth/invalid-credential":"البريد أو كلمة المرور غير صحيحة",
    "auth/operation-not-allowed":"طريقة الدخول غير مفعّلة في Firebase",
    "auth/network-request-failed":"تأكد من الإنترنت أو الـVPN",
    "permission-denied":"ما عندك صلاحية لتنفيذ هذا الإجراء",
    "failed-precondition":"توجد مشكلة في إعدادات قاعدة البيانات"
  };
  return m[e.code]||e.message||"حدث خطأ غير معروف";
}

function makeInviteCode(){
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}

function safeImageURL(value){
  if(typeof value!=="string"||!value.trim())return "";
  try{
    const u=new URL(value.trim());
    return u.protocol==="https:"?u.href:"";
  }catch{return "";}
}

function roleName(role){
  if(role==="owner")return "👑 OWNER";
  if(role==="admin")return "🛡️ ADMIN";
  if(role==="moderator")return "🔰 MODERATOR";
  return "عضو";
}

function addCalendarMonths(date,months){
  const d=new Date(date),day=d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth()+months);
  const lastDay=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(day,lastDay));
  return d;
}

// قراءة رتبة أي عضو مع تخزينها مؤقتاً
async function getMemberRole(uid){
  if(uid===OWNER_UID)return "owner";
  if(roleCache.has(uid))return roleCache.get(uid);

  try{
    const snap=await getDoc(doc(db,"roles",uid));
    let role="member";

    if(snap.exists()){
      const data=snap.data();
      if(
        data.expiresAt?.toDate &&
        data.expiresAt.toDate().getTime()>Date.now() &&
        ["admin","moderator"].includes(data.role)
      )role=data.role;
    }

    roleCache.set(uid,role);
    return role;
  }catch(e){
    console.error("تعذر قراءة رتبة العضو:",e);
    return "member";
  }
}

// تحديد من يستطيع إدارة العضو المستهدف
async function canManageMember(uid){
  if(!auth.currentUser||uid===auth.currentUser.uid||uid===OWNER_UID)return false;
  if(isOwner)return true;

  if(myRole!=="admin"&&myRole!=="moderator")return false;

  const targetRole=await getMemberRole(uid);

  if(myRole==="admin"){
    return targetRole==="member"||targetRole==="moderator";
  }

  return targetRole==="member";
}

async function loadMyRole(u){
  isOwner=isOwnerId(u.uid);
  myRole="member";
  if(isOwner)return;

  const snap=await getDoc(doc(db,"roles",u.uid));
  if(!snap.exists())return;

  const data=snap.data();
  if(
    data.expiresAt?.toDate &&
    data.expiresAt.toDate().getTime()>Date.now() &&
    ["admin","moderator"].includes(data.role)
  )myRole=data.role;
}

function watchMyRole(u){
  if(stopMyRole)stopMyRole();
  if(isOwner)return;

  stopMyRole=onSnapshot(doc(db,"roles",u.uid),snap=>{
    let newRole="member";

    if(snap.exists()){
      const data=snap.data();
      if(
        data.expiresAt?.toDate &&
        data.expiresAt.toDate().getTime()>Date.now() &&
        ["admin","moderator"].includes(data.role)
      )newRole=data.role;
    }

    myRole=newRole;
    updateWho();
    refreshMemberMenus();
  },e=>console.error("Role listener:",e));
}

function updateWho(){
  const u=auth.currentUser;
  if(!u)return;

  if(isOwner){
    $("who").textContent="👑 OWNER | "+(nick||u.displayName||"OWNER");
    $("who").style.color="#D4AF37";
    $("who").style.fontWeight="bold";
  }else if(myRole==="admin"){
    $("who").textContent="🛡️ ADMIN | "+(nick||u.displayName||"");
    $("who").style.color="#e6c36a";
    $("who").style.fontWeight="bold";
  }else if(myRole==="moderator"){
    $("who").textContent="🔰 MODERATOR | "+(nick||u.displayName||"");
    $("who").style.color="#8fc7e8";
    $("who").style.fontWeight="bold";
  }else{
    $("who").textContent=nick||u.displayName||"زائر";
    $("who").style.color="";
    $("who").style.fontWeight="";
  }

  // إدارة الرتب أصبحت من قائمة النقاط الثلاث
  const panel=$("ownerPanel");
  if(panel)panel.classList.add("hidden");
}

async function checkFullBan(uid){
  const snap=await getDoc(doc(db,"bans",uid));
  if(!snap.exists())return false;
  const data=snap.data();
  if(data.permanent===true)return true;
  return !!(
    data.expiresAt?.toDate &&
    data.expiresAt.toDate().getTime()>Date.now()
  );
}

async function checkGeneralBlock(uid){
  const snap=await getDoc(doc(db,"generalBlocks",uid));
  return snap.exists();
}

async function profile(u,n){
  nick=(n||u.displayName||u.email?.split("@")[0]||"زائر").trim().slice(0,24);
  if(u.displayName!==nick)await updateProfile(u,{displayName:nick});

  await setDoc(doc(db,"users",u.uid),{
    name:nick,email:u.email||"",status:"online",updatedAt:serverTimestamp()
  },{merge:true});
}

function setPresence(){
  const u=auth.currentUser;
  if(!u)return;
  const ref=doc(db,"users",u.uid);

  setDoc(ref,{
    name:nick||u.displayName||"زائر",
    status:"online",updatedAt:serverTimestamp()
  },{merge:true}).catch(()=>{});

  if(heartbeat)clearInterval(heartbeat);
  heartbeat=setInterval(()=>{
    setDoc(ref,{status:"online",updatedAt:serverTimestamp()},{merge:true}).catch(()=>{});
  },60000);
}

function makeAvatar(uid,url,large=false){
  const img=document.createElement("img");
  img.className=large?"profileAvatar":"profilePic";
  img.src=safeImageURL(url)||placeholder;
  img.alt="صورة العضو";
  img.onerror=()=>{img.src=placeholder;};
  img.title="عرض الملف الشخصي";
  img.onclick=()=>openProfile(uid);
  return img;
}

function renderName(element,uid,name,role="member"){
  element.replaceChildren();
  element.append(document.createTextNode(name||"مستخدم"));

  let badgeText="",badgeColor="#aaa";
  if(uid===OWNER_UID){badgeText=" 👑";badgeColor="#D4AF37";}
  else if(role==="admin"){badgeText=" 🛡️";badgeColor="#e6c36a";}
  else if(role==="moderator"){badgeText=" 🔰";badgeColor="#8fc7e8";}

  if(badgeText){
    const badge=document.createElement("span");
    badge.textContent=badgeText;
    badge.style.color=badgeColor;
    badge.style.fontWeight="bold";
    element.append(badge);
  }
}

// تصميم قائمة النقاط الثلاث
function menuStyle(menu){
  Object.assign(menu.style,{
    position:"fixed",
    zIndex:"99999",
    minWidth:"190px",
    maxWidth:"230px",
    padding:"7px",
    background:"#171510",
    border:"1px solid #b89436",
    borderRadius:"10px",
    boxShadow:"0 8px 25px #000b",
    display:"flex",
    flexDirection:"column",
    gap:"4px",
    direction:"rtl"
  });
}

function menuButton(label,callback,color="#eee"){
  const b=document.createElement("button");
  b.type="button";
  b.textContent=label;
  Object.assign(b.style,{
    width:"100%",padding:"10px",
    border:"0",borderRadius:"7px",
    background:"#252117",color,
    textAlign:"right",cursor:"pointer",
    fontSize:"13px"
  });
  b.onmouseenter=()=>b.style.background="#40351d";
  b.onmouseleave=()=>b.style.background="#252117";
  b.onclick=async()=>{
    closeMemberMenu();
    await callback();
  };
  return b;
}

function closeMemberMenu(){
  if(openMenu){
    openMenu.remove();
    openMenu=null;
  }
}

document.addEventListener("click",e=>{
  if(openMenu&&!openMenu.contains(e.target)&&!e.target.closest(".memberMenuTrigger")){
    closeMemberMenu();
  }
});

async function showMemberMenu(uid,name,anchor){
  closeMemberMenu();

  const menu=document.createElement("div");
  menu.className="memberMenu";
  menuStyle(menu);
  openMenu=menu;

  const heading=document.createElement("div");
  heading.textContent=name||"العضو";
  Object.assign(heading.style,{
    color:"#D4AF37",fontWeight:"bold",
    padding:"8px",borderBottom:"1px solid #55451f"
  });
  menu.append(heading);

  menu.append(menuButton("👤 عرض الملف الشخصي",()=>openProfile(uid)));

  const allowed=await canManageMember(uid);

  if(allowed){
    menu.append(menuButton("🔇 كتم في العامة",()=>openModeration(uid,"mute")));
    menu.append(menuButton("🔊 رفع الكتم",()=>openModeration(uid,"unmute")));
    menu.append(menuButton("🚫 منع من العامة",()=>openModeration(uid,"generalBlock")));
    menu.append(menuButton("解除 رفع منع العامة",()=>openModeration(uid,"unblockGeneral")));

    if(currentRoom!=="general"){
      menu.append(menuButton("👢 طرد من الغرفة الخاصة",()=>openModeration(uid,"roomKick")));
    }

    if(canFullBan()){
      menu.append(menuButton("⛔ حظر كامل مؤقت",()=>openModeration(uid,"fullBan")));
      menu.append(menuButton("♻️ رفع الحظر الكامل",()=>openModeration(uid,"unban")));
    }

    if(isOwner){
      menu.append(menuButton("⛔ حظر كامل دائم",()=>openModeration(uid,"permanentBan"),"#ff9999"));
      menu.append(menuButton("🛡️ تعيين أدمن",()=>assignRoleFromMenu(uid,"admin"),"#e6c36a"));
      menu.append(menuButton("🔰 تعيين مشرف",()=>assignRoleFromMenu(uid,"moderator"),"#8fc7e8"));
      menu.append(menuButton("↩️ سحب الرتبة",()=>revokeRoleFromMenu(uid),"#ffcc88"));
    }
  }

  menu.append(menuButton("إغلاق القائمة",closeMemberMenu,"#D4AF37"));
  document.body.append(menu);

  const rect=anchor.getBoundingClientRect();
  let left=Math.max(8,Math.min(rect.left,window.innerWidth-240));
  let top=rect.bottom+5;

  if(top+menu.offsetHeight>window.innerHeight-8){
    top=Math.max(8,rect.top-menu.offsetHeight-5);
  }

  menu.style.left=left+"px";
  menu.style.top=top+"px";
}

function createMemberMenuButton(uid,name){
  const b=document.createElement("button");
  b.type="button";
  b.className="memberMenuTrigger";
  b.textContent="⋮";
  b.title="خيارات العضو";
  Object.assign(b.style,{
    background:"transparent",
    border:"1px solid #8c702d",
    color:"#D4AF37",
    borderRadius:"6px",
    width:"27px",
    height:"27px",
    cursor:"pointer",
    fontSize:"19px",
    lineHeight:"20px",
    flexShrink:"0"
  });
  b.onclick=e=>{
    e.stopPropagation();
    showMemberMenu(uid,name,b);
  };
  return b;
}

async function refreshMemberMenus(){
  // تحديث الشارة والقوائم عند تغير رتبة المستخدم الحالي
  if(stopUsers&&auth.currentUser)watchUsers(auth.currentUser);
  if(auth.currentUser)watchMessages(auth.currentUser);
}

// تعيين رتبة من قائمة العضو - للمالك فقط
async function assignRoleFromMenu(uid,role){
  if(!isOwner||uid===OWNER_UID)return;

  const answer=prompt("اختر مدة الرتبة بالأشهر:\n1 = شهر\n3 = ثلاثة أشهر\n12 = سنة","1");
  if(answer===null)return;

  const months=Number(answer);
  if(![1,3,12].includes(months)){
    alert("المدة يجب أن تكون 1 أو 3 أو 12 شهراً");
    return;
  }

  try{
    const userSnap=await getDoc(doc(db,"users",uid));
    const name=userSnap.exists()?(userSnap.data().name||"عضو"):"عضو";
    const expiry=addCalendarMonths(new Date(),months);

    await setDoc(doc(db,"roles",uid),{
      role,name,
      expiresAt:Timestamp.fromDate(expiry),
      assignedAt:serverTimestamp(),
      assignedBy:auth.currentUser.uid
    });

    roleCache.delete(uid);
    alert("تم تعيين "+roleName(role)+" بنجاح لمدة "+months+" شهر.");
    refreshMemberMenus();
  }catch(e){
    alert("تعذر تعيين الرتبة: "+err(e));
  }
}

async function revokeRoleFromMenu(uid){
  if(!isOwner||uid===OWNER_UID)return;
  if(!confirm("هل تريد سحب رتبة هذا العضو وإعادته إلى عضو عادي؟"))return;

  try{
    await deleteDoc(doc(db,"roles",uid));
    roleCache.delete(uid);
    alert("تم سحب الرتبة بنجاح.");
    refreshMemberMenus();
  }catch(e){
    alert("تعذر سحب الرتبة: "+err(e));
  }
}

// فتح نافذة الملف الشخصي مع اختيار إجراء الإدارة
async function openModeration(uid,action){
  await openProfile(uid);
  if(!$("profileModal")||$("profileModal").classList.contains("hidden"))return;

  const select=$("moderationAction");
  if(select){
    const exists=[...select.options].some(o=>o.value===action);
    if(exists)select.value=action;
  }
}

// عرض الملف الشخصي
async function openProfile(uid){
  try{
    const snap=await getDoc(doc(db,"users",uid));
    if(!snap.exists()){
      alert("لم يتم العثور على ملف هذا العضو");
      return;
    }

    const data=snap.data();
    viewedUserId=uid;
    const targetRole=await getMemberRole(uid);

    $("viewName").textContent=data.name||"مستخدم";
    $("viewRole").textContent=roleName(targetRole);
    $("viewStatus").textContent=data.customStatus||"لا توجد حالة حالياً";
    $("viewAvatar").src=safeImageURL(data.photoURL)||placeholder;
    $("viewCover").src=safeImageURL(data.coverURL)||"";
    $("viewCover").style.display=safeImageURL(data.coverURL)?"block":"none";

    const own=uid===auth.currentUser?.uid;
    $("editProfile").classList.toggle("hidden",!own);

    if(own){
      $("avatarURL").value=data.photoURL||"";
      $("coverURL").value=data.coverURL||"";
      $("customStatus").value=data.customStatus||"";
      msg("profileMsg","");
    }

    const showModeration=await canManageMember(uid);
    $("moderationPanel").classList.toggle("hidden",!showModeration);

    if(showModeration){
      msg("moderationMsg","");
      $("moderationReason").value="";
      updateModerationOptions();
    }

    $("profileModal").classList.remove("hidden");
  }catch(e){
    alert("تعذر فتح الملف الشخصي: "+err(e));
  }
}

function updateModerationOptions(){
  const select=$("moderationAction");
  const duration=$("moderationDuration");
  if(!select||!duration)return;

  const options=[
    ["mute","كتم في العامة"],
    ["generalBlock","منع من العامة"],
    ["unmute","رفع الكتم"],
    ["unblockGeneral","رفع منع العامة"]
  ];

  if(currentRoom!=="general")options.push(["roomKick","طرد من الغرفة الخاصة"]);
  if(canFullBan())options.push(["fullBan","حظر كامل مؤقت"]);
  if(isOwner)options.push(["permanentBan","حظر كامل دائم"]);
  if(canFullBan())options.push(["unban","رفع الحظر الكامل"]);

  select.replaceChildren();
  options.forEach(([value,label])=>{
    const option=document.createElement("option");
    option.value=value;
    option.textContent=label;
    select.append(option);
  });

  duration.disabled=false;
  select.onchange=()=>{duration.disabled=select.value==="permanentBan";};
  select.dispatchEvent(new Event("change"));
}

$("closeProfile").onclick=()=>{
  $("profileModal").classList.add("hidden");
  viewedUserId=null;
};

$("profileModal").addEventListener("click",e=>{
  if(e.target===$("profileModal")){
    $("profileModal").classList.add("hidden");
    viewedUserId=null;
  }
});

$("saveProfile").onclick=async()=>{
  const u=auth.currentUser;
  if(!u||viewedUserId!==u.uid)return;

  const photoURL=$("avatarURL").value.trim();
  const coverURL=$("coverURL").value.trim();
  const customStatus=$("customStatus").value.trim();

  if(photoURL&&!safeImageURL(photoURL)){
    msg("profileMsg","رابط الصورة الشخصية غير صحيح. استخدم HTTPS");
    return;
  }
  if(coverURL&&!safeImageURL(coverURL)){
    msg("profileMsg","رابط الغلاف غير صحيح. استخدم HTTPS");
    return;
  }
  if(customStatus.length>100){
    msg("profileMsg","الحالة يجب ألا تتجاوز 100 حرف");
    return;
  }

  try{
    await setDoc(doc(db,"users",u.uid),{
      photoURL:safeImageURL(photoURL),
      coverURL:safeImageURL(coverURL),
      customStatus,updatedAt:serverTimestamp()
    },{merge:true});

    $("viewAvatar").src=safeImageURL(photoURL)||placeholder;
    $("viewCover").src=safeImageURL(coverURL)||"";
    $("viewCover").style.display=coverURL?"block":"none";
    $("viewStatus").textContent=customStatus||"لا توجد حالة حالياً";
    msg("profileMsg","تم حفظ التغييرات بنجاح ✓");
  }catch(e){
    msg("profileMsg","تعذر الحفظ: "+err(e));
  }
};

// تنفيذ أوامر الإدارة
$("applyModeration").onclick=async()=>{
  const u=auth.currentUser,target=viewedUserId;
  if(!u||!target)return;

  if(!await canManageMember(target)){
    msg("moderationMsg","ليس لديك صلاحية إدارة هذا العضو");
    return;
  }

  const action=$("moderationAction").value;
  const duration=Number($("moderationDuration").value);
  const reason=$("moderationReason").value.trim().slice(0,200);
  const button=$("applyModeration");

  button.disabled=true;
  msg("moderationMsg","جارٍ تنفيذ الإجراء...");

  try{
    const expiresAt=Timestamp.fromDate(new Date(Date.now()+duration*60000));
    const base={reason,by:u.uid,createdAt:serverTimestamp()};

    if(action==="mute"){
      if(currentRoom!=="general")throw Error("الكتم متاح في الغرفة العامة فقط");
      await setDoc(doc(db,"mutes",target),{...base,durationMinutes:duration,expiresAt});
      msg("moderationMsg","تم كتم العضو بنجاح ✓");
    }
    else if(action==="generalBlock"){
      await setDoc(doc(db,"generalBlocks",target),base);
      msg("moderationMsg","تم منع العضو من العامة ✓");
    }
    else if(action==="roomKick"){
      if(currentRoom==="general")throw Error("اختر غرفة خاصة أولاً");
      const roomRef=doc(db,"rooms",currentRoom);
      const roomSnap=await getDoc(roomRef);
      if(!roomSnap.exists())throw Error("الغرفة غير موجودة");
      const roomData=roomSnap.data();
      if(roomData.ownerId===target)throw Error("لا يمكن طرد مالك الغرفة");
      if(!(roomData.members||[]).includes(target))throw Error("العضو ليس في هذه الغرفة");
      await updateDoc(roomRef,{members:arrayRemove(target)});
      msg("moderationMsg","تم طرد العضو من الغرفة ✓");
    }
    else if(action==="fullBan"){
      if(!canFullBan())throw Error("هذه الصلاحية للمالك والأدمن فقط");
      await setDoc(doc(db,"bans",target),{...base,permanent:false,durationMinutes:duration,expiresAt});
      msg("moderationMsg","تم الحظر الكامل المؤقت ✓");
    }
    else if(action==="permanentBan"){
      if(!isOwner)throw Error("الحظر الدائم للمالك فقط");
      await setDoc(doc(db,"bans",target),{...base,permanent:true});
      msg("moderationMsg","تم الحظر الكامل الدائم ✓");
    }
    else if(action==="unmute"){
      await deleteDoc(doc(db,"mutes",target));
      msg("moderationMsg","تم رفع الكتم ✓");
    }
    else if(action==="unblockGeneral"){
      await deleteDoc(doc(db,"generalBlocks",target));
      msg("moderationMsg","تم رفع منع العامة ✓");
    }
    else if(action==="unban"){
      if(!canFullBan())throw Error("ليس لديك صلاحية رفع الحظر الكامل");
      const banSnap=await getDoc(doc(db,"bans",target));
      if(banSnap.exists()&&banSnap.data().permanent===true&&!isOwner){
        throw Error("رفع الحظر الدائم للمالك فقط");
      }
      await deleteDoc(doc(db,"bans",target));
      msg("moderationMsg","تم رفع الحظر الكامل ✓");
    }
    else throw Error("نوع الإجراء غير معروف");

  }catch(e){
    msg("moderationMsg","تعذر تنفيذ الإجراء: "+err(e));
  }finally{
    button.disabled=false;
  }
};

// عرض الرسائل مع تاج الرتبة وقائمة النقاط الثلاث
function renderMessage(x,u){
  const el=document.createElement("div");
  el.className="msg"+(x.senderId===u.uid?" mine":"");

  const header=document.createElement("div");
  Object.assign(header.style,{
    display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"
  });

  const avatar=makeAvatar(x.senderId,x.photoURL);
  const n=document.createElement("div");
  n.className="name";
  renderName(n,x.senderId,x.nickname||"مستخدم",x.senderRole||"member");

  header.append(avatar,n);

  if(x.senderId!==u.uid){
    const menuBtn=createMemberMenuButton(x.senderId,x.nickname||"مستخدم");
    header.append(menuBtn);
  }

  getMemberRole(x.senderId).then(role=>{
    renderName(n,x.senderId,x.nickname||"مستخدم",role);
  });

  const b=document.createElement("div");
  b.className="body";
  b.textContent=x.text||"";

  const tm=document.createElement("div");
  tm.className="time";
  tm.textContent=x.createdAt?.toDate
    ?x.createdAt.toDate().toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"})
    :"الآن";

  el.append(header,b,tm);
  $("messages").append(el);
}

function watchMessages(u){
  if(stopMessages)stopMessages();
  stopMessages=null;
  $("messages").replaceChildren();

  if(currentRoom==="general"&&blockedFromGeneral){
    msg("chatMsg","أنت ممنوع من دخول الغرفة العامة حتى يرفع المشرف الحظر.");
    return;
  }

  const q=query(
    collection(db,"messages"),
    where("roomId","==",currentRoom),
    orderBy("createdAt","asc")
  );

  stopMessages=onSnapshot(q,s=>{
    const area=$("messages");
    area.replaceChildren();
    s.forEach(d=>renderMessage(d.data(),u));
    area.scrollTop=area.scrollHeight;
  },e=>msg("chatMsg","تعذر تحديث الرسائل: "+err(e)));
}

function watchRooms(u){
  if(stopRooms)stopRooms();

  const q=isOwner
    ?query(collection(db,"rooms"))
    :query(collection(db,"rooms"),where("members","array-contains",u.uid));

  stopRooms=onSnapshot(q,s=>{
    const list=$("roomList");
    list.replaceChildren();

    const general=document.createElement("button");
    general.className="roomChoice"+(currentRoom==="general"?" selected":"");
    general.textContent="🌐 الغرفة العامة";
    general.onclick=()=>switchRoom("general","الغرفة العامة",u);
    list.append(general);

    s.forEach(d=>{
      const r=d.data(),b=document.createElement("button");
      b.className="roomChoice"+(currentRoom===d.id?" selected":"");
      b.textContent=(r.isPrivate?"🔒 ":"💬 ")+(r.name||"غرفة")+(isOwnerId(r.ownerId)?" 👑":"");
      if(isOwnerId(r.ownerId))b.style.color="#D4AF37";
      b.onclick=()=>switchRoom(d.id,r.name||"غرفة",u);
      list.append(b);
    });
  },e=>msg("chatMsg","تعذر تحميل الغرف: "+err(e)));
}

// قائمة المتصلين مع زر النقاط الثلاث
function watchUsers(u){
  if(stopUsers)stopUsers();

  const q=query(collection(db,"users"),where("status","==","online"));

  stopUsers=onSnapshot(q,s=>{
    const list=$("onlineList");
    list.replaceChildren();
    let count=0;

    s.forEach(d=>{
      if(d.id===u.uid)return;
      const data=d.data();

      const row=document.createElement("div");
      row.className="onlineUser";

      const dot=document.createElement("span");
      dot.className="dot";

      const avatar=makeAvatar(d.id,data.photoURL);

      const details=document.createElement("div");
      details.style.minWidth="0";
      details.style.flex="1";

      const name=document.createElement("div");
      name.className="name";
      renderName(name,d.id,data.name||"زائر",data.role||"member");

      getMemberRole(d.id).then(role=>{
        renderName(name,d.id,data.name||"زائر",role);
      });

      const status=document.createElement("small");
      status.style.color="#aaa";
      status.textContent=data.customStatus||"متصل الآن";

      details.append(name,status);
      row.append(dot,avatar,details);
      row.append(createMemberMenuButton(d.id,data.name||"زائر"));
      list.append(row);
      count++;
    });

    $("onlineCount").textContent=String(count);

    if(!count){
      const empty=document.createElement("small");
      empty.textContent="ماكو أعضاء آخرين ظاهرين حالياً";
      list.append(empty);
    }
  },e=>msg("chatMsg","تعذر تحميل قائمة المتصلين: "+err(e)));
}

async function switchRoom(id,name,u){
  if(id==="general"){
    try{
      blockedFromGeneral=await checkGeneralBlock(u.uid);
    }catch(e){
      msg("chatMsg","تعذر التحقق من صلاحية دخول العامة: "+err(e));
      return;
    }
    if(blockedFromGeneral){
      msg("chatMsg","أنت ممنوع من دخول الغرفة العامة حتى يرفع المشرف الحظر.");
      return;
    }
  }

  currentRoom=id;
  roomName=name;
  $("roomTitle").textContent=name;
  $("roomSubtitle").textContent=id==="general"
    ?"احچي باحترام وخلي اللمة حلوة"
    :"محادثة أعضاء الغرفة";

  watchMessages(u);
  watchRooms(u);
  if(viewedUserId)updateModerationOptions();
  msg("chatMsg","");
}

async function createRoom(){
  const u=auth.currentUser;
  const name=$("newRoomName").value.trim();

  if(!u||!name){msg("roomMsg","اكتب اسم الغرفة أولاً");return;}
  if(name.length>30){msg("roomMsg","اسم الغرفة يجب ألا يتجاوز 30 حرفاً");return;}

  try{
    const code=makeInviteCode();
    const ref=await addDoc(collection(db,"rooms"),{
      name,isPrivate:true,ownerId:u.uid,members:[u.uid],
      inviteCode:code,createdAt:serverTimestamp()
    });

    await setDoc(doc(db,"roomInvites",code),{
      roomId:ref.id,roomName:name,ownerId:u.uid,createdAt:serverTimestamp()
    });

    $("newRoomName").value="";
    msg("roomMsg","تم إنشاء الغرفة. رمز الدعوة: "+code);
    switchRoom(ref.id,name,u);
  }catch(e){
    msg("roomMsg","تعذر إنشاء الغرفة: "+err(e));
  }
}

async function joinRoom(){
  const u=auth.currentUser;
  const code=$("inviteCode").value.trim().toLowerCase();
  if(!u||!code){msg("roomMsg","اكتب رمز الدعوة");return;}

  try{
    const invite=await getDoc(doc(db,"roomInvites",code));
    if(!invite.exists())throw Error("رمز الدعوة غير صحيح");

    const data=invite.data();
    const roomRef=doc(db,"rooms",data.roomId);
    let alreadyMember=false;

    try{
      const existingRoom=await getDoc(roomRef);
      if(existingRoom.exists()){
        alreadyMember=(existingRoom.data().members||[]).includes(u.uid);
      }else throw Error("الغرفة غير موجودة");
    }catch(readError){
      if(readError.code!=="permission-denied")throw readError;
    }

    if(!isOwner&&!alreadyMember){
      await updateDoc(roomRef,{members:arrayUnion(u.uid)});
    }

    $("inviteCode").value="";
    msg("roomMsg","تم الدخول إلى الغرفة");
    switchRoom(data.roomId,data.roomName||"غرفة",u);
  }catch(e){
    msg("roomMsg","تعذر الانضمام: "+err(e));
  }
}

$("register").onclick=async()=>{
  try{
    if(!$("nick").value.trim())throw Error("اكتب الاسم الظاهر أولاً");
    const r=await createUserWithEmailAndPassword(auth,$("email").value.trim(),$("pass").value);
    await profile(r.user,$("nick").value);
    msg("authMsg","");
  }catch(e){msg("authMsg",err(e));}
};

$("login").onclick=async()=>{
  try{
    const r=await signInWithEmailAndPassword(auth,$("email").value.trim(),$("pass").value);
    await profile(r.user,$("nick").value);
    msg("authMsg","");
  }catch(e){msg("authMsg",err(e));}
};

$("guest").onclick=async()=>{
  try{
    if(!$("nick").value.trim())throw Error("اكتب اسماً مستعاراً أولاً");
    const r=await signInAnonymously(auth);
    await profile(r.user,$("nick").value);
    msg("authMsg","");
  }catch(e){msg("authMsg",err(e));}
};

$("logout").onclick=async()=>{
  try{
    const u=auth.currentUser;
    if(u){
      await setDoc(doc(db,"users",u.uid),{
        status:"offline",updatedAt:serverTimestamp()
      },{merge:true});
    }
    if(heartbeat)clearInterval(heartbeat);
    await signOut(auth);
  }catch(e){msg("chatMsg",err(e));}
};

$("send").onsubmit=async e=>{
  e.preventDefault();
  const t=$("message").value.trim(),u=auth.currentUser;
  if(!t||!u)return;

  if(currentRoom==="general"){
    try{
      blockedFromGeneral=await checkGeneralBlock(u.uid);
      if(blockedFromGeneral){
        msg("chatMsg","أنت ممنوع من الكتابة في الغرفة العامة.");
        return;
      }

      const muteSnap=await getDoc(doc(db,"mutes",u.uid));
      if(muteSnap.exists()){
        const mute=muteSnap.data();
        if(mute.expiresAt?.toDate&&mute.expiresAt.toDate().getTime()>Date.now()){
          const remaining=Math.ceil((mute.expiresAt.toDate().getTime()-Date.now())/60000);
          msg("chatMsg","أنت مكتوم حالياً. الوقت المتبقي تقريباً "+remaining+" دقيقة.");
          return;
        }
      }
    }catch(x){
      msg("chatMsg","تعذر التحقق من الكتم: "+err(x));
      return;
    }
  }

  $("message").value="";
  try{
    const userSnap=await getDoc(doc(db,"users",u.uid));
    const userData=userSnap.exists()?userSnap.data():{};
    await addDoc(collection(db,"messages"),{
      roomId:currentRoom,
      senderId:u.uid,
      nickname:nick||u.displayName||"زائر",
      photoURL:userData.photoURL||"",
      text:t,
      createdAt:serverTimestamp()
    });
    msg("chatMsg","");
  }catch(x){
    $("message").value=t;
    msg("chatMsg","لم تُرسل الرسالة: "+err(x));
  }
};

$("createRoom").onclick=createRoom;
$("joinRoom").onclick=joinRoom;

onAuthStateChanged(auth,async u=>{
  if(!u){
    isOwner=false;
    myRole="member";
    blockedFromGeneral=false;
    roleCache.clear();

    if(stopMessages)stopMessages();
    if(stopRooms)stopRooms();
    if(stopUsers)stopUsers();
    if(stopMyRole)stopMyRole();

    stopMessages=stopRooms=stopUsers=stopMyRole=null;
    if(heartbeat)clearInterval(heartbeat);
    closeMemberMenu();

    const panel=$("ownerPanel");
    if(panel)panel.classList.add("hidden");

    $("chat").classList.add("hidden");
    $("auth").classList.remove("hidden");
    $("profileModal").classList.add("hidden");
    return;
  }

  try{
    await loadMyRole(u);

    const banned=await checkFullBan(u.uid);
    if(banned){
      msg("authMsg","هذا الحساب محظور من استخدام الشات.");
      await signOut(auth);
      return;
    }

    if(!nick)await profile(u,u.displayName);
    blockedFromGeneral=await checkGeneralBlock(u.uid);

    $("auth").classList.add("hidden");
    $("chat").classList.remove("hidden");

    updateWho();
    watchMyRole(u);
    setPresence();
    watchMessages(u);
    watchRooms(u);
    watchUsers(u);

    if(blockedFromGeneral){
      msg("chatMsg","أنت ممنوع من دخول الغرفة العامة، ويمكنك استخدام الغرف المسموح بها.");
    }
  }catch(e){
    msg("authMsg","تعذر تشغيل الحساب: "+err(e));
  }
});
