
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
const db=initializeFirestore(app,{
  experimentalAutoDetectLongPolling:true
});

const $=id=>document.getElementById(id);

let nick="";
let stopMessages=null;
let stopRooms=null;
let stopUsers=null;
let currentRoom="general";
let roomName="الغرفة العامة";
let heartbeat=null;

let isOwner=false;
let myRole="member";
let viewedUserId=null;
let blockedFromGeneral=false;

const placeholder="data:image/svg+xml,"+encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#29251e"/><circle cx="50" cy="36" r="19" fill="#c49b3b"/><path d="M12 100c2-27 17-40 38-40s36 13 38 40" fill="#c49b3b"/></svg>'
);

function msg(id,t){
  $(id).textContent=t||"";
}

function isOwnerId(uid){
  return uid===OWNER_UID;
}

function canModerate(){
  return isOwner||myRole==="admin"||myRole==="moderator";
}

function canFullBan(){
  return isOwner||myRole==="admin";
}

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

  return Array.from(
    bytes,b=>b.toString(16).padStart(2,"0")
  ).join("");
}

function safeImageURL(value){
  if(typeof value!=="string"||!value.trim())return "";

  try{
    const u=new URL(value.trim());
    return u.protocol==="https:"?u.href:"";
  }catch{
    return "";
  }
}

function roleName(role){
  if(role==="owner")return "👑 OWNER";
  if(role==="admin")return "🛡️ ADMIN";
  if(role==="moderator")return "🔰 MODERATOR";
  return "عضو";
}

// قراءة رتبة المستخدم والتحقق من انتهائها
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
  ){
    myRole=data.role;
  }
}

// التحقق من الحظر الكامل
async function checkFullBan(uid){
  const snap=await getDoc(doc(db,"bans",uid));

  if(!snap.exists())return false;

  const data=snap.data();

  if(data.permanent===true)return true;

  if(data.expiresAt?.toDate){
    return data.expiresAt.toDate().getTime()>Date.now();
  }

  return false;
}

// التحقق من منع العامة
async function checkGeneralBlock(uid){
  const snap=await getDoc(doc(db,"generalBlocks",uid));
  return snap.exists();
}

// الملف الشخصي
async function profile(u,n){
  nick=(n||u.displayName||u.email?.split("@")[0]||"زائر")
    .trim().slice(0,24);

  if(u.displayName!==nick){
    await updateProfile(u,{displayName:nick});
  }

  await setDoc(doc(db,"users",u.uid),{
    name:nick,
    email:u.email||"",
    status:"online",
    updatedAt:serverTimestamp()
  },{merge:true});
}

// تحديث حالة الاتصال
function setPresence(){
  const u=auth.currentUser;
  if(!u)return;

  const ref=doc(db,"users",u.uid);

  setDoc(ref,{
    name:nick||u.displayName||"زائر",
    status:"online",
    updatedAt:serverTimestamp()
  },{merge:true}).catch(()=>{});

  if(heartbeat)clearInterval(heartbeat);

  heartbeat=setInterval(()=>{
    setDoc(ref,{
      status:"online",
      updatedAt:serverTimestamp()
    },{merge:true}).catch(()=>{});
  },60000);
}

// الصورة الشخصية
function makeAvatar(uid,url,large=false){
  const img=document.createElement("img");

  img.className=large?"profileAvatar":"profilePic";
  img.src=safeImageURL(url)||placeholder;
  img.alt="صورة العضو";

  img.onerror=()=>{
    img.src=placeholder;
  };

  img.title="عرض الملف الشخصي";
  img.onclick=()=>openProfile(uid);

  return img;
}

// الاسم والتاج
function renderName(element,uid,name,role="member"){
  element.replaceChildren();
  element.append(document.createTextNode(name||"مستخدم"));

  let badgeText="";
  let badgeColor="#aaa";

  if(uid===OWNER_UID){
    badgeText=" 👑";
    badgeColor="#D4AF37";
  }else if(role==="admin"){
    badgeText=" 🛡️";
    badgeColor="#e6c36a";
  }else if(role==="moderator"){
    badgeText=" 🔰";
    badgeColor="#8fc7e8";
  }

  if(badgeText){
    const badge=document.createElement("span");
    badge.textContent=badgeText;
    badge.style.color=badgeColor;
    badge.style.fontWeight="bold";
    element.append(badge);
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

    let targetRole="member";

    if(uid===OWNER_UID){
      targetRole="owner";
    }else{
      const roleSnap=await getDoc(doc(db,"roles",uid));

      if(roleSnap.exists()){
        const rd=roleSnap.data();

        if(
          rd.expiresAt?.toDate &&
          rd.expiresAt.toDate().getTime()>Date.now()
        ){
          targetRole=rd.role;
        }
      }
    }

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

    const showModeration=
      canModerate() &&
      !own &&
      uid!==OWNER_UID;

    $("moderationPanel").classList.toggle(
      "hidden",!showModeration
    );

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

// خيارات الإدارة حسب الرتبة والغرفة
function updateModerationOptions(){
  const select=$("moderationAction");
  const duration=$("moderationDuration");

  const options=[
    ["mute","كتم في العامة",true],
    ["generalBlock","منع من العامة",true],
    ["unmute","رفع الكتم",true],
    ["unblockGeneral","رفع منع العامة",true]
  ];

  if(currentRoom!=="general"){
    options.push(["roomKick","طرد من الغرفة الخاصة",true]);
  }

  if(canFullBan()){
    options.push(["fullBan","حظر كامل مؤقت",true]);
  }

  if(isOwner){
    options.push(["permanentBan","حظر كامل دائم",true]);
  }

  if(canFullBan()){
    options.push(["unban","رفع الحظر الكامل",true]);
  }

  select.replaceChildren();

  options.forEach(([value,label])=>{
    const option=document.createElement("option");
    option.value=value;
    option.textContent=label;
    select.append(option);
  });

  duration.disabled=false;

  select.onchange=()=>{
    const permanent=select.value==="permanentBan";
    duration.disabled=permanent;
  };

  select.dispatchEvent(new Event("change"));
}

// إغلاق الملف الشخصي
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

// حفظ الملف الشخصي
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
      customStatus,
      updatedAt:serverTimestamp()
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
  const u=auth.currentUser;
  const target= viewedUserId;

  if(!u||!target)return;

  if(!canModerate()){
    msg("moderationMsg","ليس لديك صلاحية الإدارة");
    return;
  }

  if(target===u.uid||target===OWNER_UID){
    msg("moderationMsg","لا يمكنك تنفيذ هذا الإجراء على هذا العضو");
    return;
  }

  const action=$("moderationAction").value;
  const duration=Number($("moderationDuration").value);
  const reason=$("moderationReason").value.trim().slice(0,200);

  const button=$("applyModeration");
  button.disabled=true;
  msg("moderationMsg","جارٍ تنفيذ الإجراء...");

  try{
    const now=Date.now();
    const expiresAt=Timestamp.fromDate(
      new Date(now+duration*60000)
    );

    const base={
      reason,
      by:u.uid,
      createdAt:serverTimestamp()
    };

    if(action==="mute"){
      await setDoc(doc(db,"mutes",target),{
        ...base,
        durationMinutes:duration,
        expiresAt
      });

      msg("moderationMsg","تم كتم العضو بنجاح ✓");
    }

    else if(action==="generalBlock"){
      await setDoc(doc(db,"generalBlocks",target),base);

      msg("moderationMsg","تم منع العضو من العامة ✓");
    }

    else if(action==="roomKick"){
      if(currentRoom==="general"){
        throw Error("اختر غرفة خاصة أولاً");
      }

      const roomRef=doc(db,"rooms",currentRoom);
      const roomSnap=await getDoc(roomRef);

      if(!roomSnap.exists()){
        throw Error("الغرفة غير موجودة");
      }

      const members=roomSnap.data().members||[];

      if(!members.includes(target)){
        throw Error("العضو ليس في هذه الغرفة");
      }

      await updateDoc(roomRef,{
        members:arrayRemove(target)
      });

      msg("moderationMsg","تم طرد العضو من الغرفة ✓");
    }

    else if(action==="fullBan"){
      if(!canFullBan()){
        throw Error("هذه الصلاحية للمالك والأدمن فقط");
      }

      await setDoc(doc(db,"bans",target),{
        ...base,
        permanent:false,
        durationMinutes:duration,
        expiresAt
      });

      msg("moderationMsg","تم الحظر الكامل المؤقت ✓");
    }

    else if(action==="permanentBan"){
      if(!isOwner){
        throw Error("الحظر الدائم للمالك فقط");
      }

      await setDoc(doc(db,"bans",target),{
        ...base,
        permanent:true
      });

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
      if(!canFullBan()){
        throw Error("ليس لديك صلاحية رفع الحظر الكامل");
      }

      const banSnap=await getDoc(doc(db,"bans",target));

      if(banSnap.exists()&&banSnap.data().permanent===true&&!isOwner){
        throw Error("رفع الحظر الدائم للمالك فقط");
      }

      await deleteDoc(doc(db,"bans",target));
      msg("moderationMsg","تم رفع الحظر الكامل ✓");
    }

    else{
      throw Error("نوع الإجراء غير معروف");
    }

  }catch(e){
    msg("moderationMsg","تعذر تنفيذ الإجراء: "+err(e));
  }finally{
    button.disabled=false;
  }
};

// عرض الرسائل
function renderMessage(x,u){
  const el=document.createElement("div");

  el.className="msg"+(x.senderId===u.uid?" mine":"");

  const header=document.createElement("div");
  header.style.display="flex";
  header.style.alignItems="center";
  header.style.gap="8px";

  const avatar=makeAvatar(x.senderId,x.photoURL);

  const n=document.createElement("div");
  n.className="name";

  renderName(n,x.senderId,x.nickname||"مستخدم",x.senderRole||"member");

  header.append(avatar,n);

  const b=document.createElement("div");
  b.className="body";
  b.textContent=x.text||"";

  const tm=document.createElement("div");
  tm.className="time";

  tm.textContent=x.createdAt?.toDate
    ?x.createdAt.toDate().toLocaleTimeString(
      "ar-IQ",{hour:"2-digit",minute:"2-digit"}
    )
    :"الآن";

  el.append(header,b,tm);
  $("messages").append(el);
}

// متابعة الرسائل
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

// متابعة الغرف
function watchRooms(u){
  if(stopRooms)stopRooms();

  const q=isOwner
    ?query(collection(db,"rooms"))
    :query(
      collection(db,"rooms"),
      where("members","array-contains",u.uid)
    );

  stopRooms=onSnapshot(q,s=>{
    const list=$("roomList");
    list.replaceChildren();

    const general=document.createElement("button");
    general.className="roomChoice"+
      (currentRoom==="general"?" selected":"");

    general.textContent="🌐 الغرفة العامة";

    general.onclick=()=>switchRoom(
      "general","الغرفة العامة",u
    );

    list.append(general);

    s.forEach(d=>{
      const r=d.data();
      const b=document.createElement("button");

      b.className="roomChoice"+
        (currentRoom===d.id?" selected":"");

      b.textContent=(r.isPrivate?"🔒 ":"💬 ")+
        (r.name||"غرفة")+
        (isOwnerId(r.ownerId)?" 👑":"");

      if(isOwnerId(r.ownerId)){
        b.style.color="#D4AF37";
      }

      b.onclick=()=>switchRoom(d.id,r.name||"غرفة",u);
      list.append(b);
    });

  },e=>msg("chatMsg","تعذر تحميل الغرف: "+err(e)));
}

// قائمة المتصلين
function watchUsers(u){
  if(stopUsers)stopUsers();

  const q=query(
    collection(db,"users"),
    where("status","==","online")
  );

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

      const name=document.createElement("div");
      name.className="name";

      renderName(name,d.id,data.name||"زائر",data.role||"member");

      const status=document.createElement("small");
      status.style.color="#aaa";
      status.textContent=data.customStatus||"متصل الآن";

      details.append(name,status);
      row.append(dot,avatar,details);
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

// تبديل الغرفة
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

  if(viewedUserId){
    updateModerationOptions();
  }

  msg("chatMsg","");
}

// إنشاء غرفة خاصة
async function createRoom(){
  const u=auth.currentUser;
  const name=$("newRoomName").value.trim();

  if(!u||!name){
    msg("roomMsg","اكتب اسم الغرفة أولاً");
    return;
  }

  if(name.length>30){
    msg("roomMsg","اسم الغرفة يجب ألا يتجاوز 30 حرفاً");
    return;
  }

  try{
    const code=makeInviteCode();

    const ref=await addDoc(collection(db,"rooms"),{
      name,
      isPrivate:true,
      ownerId:u.uid,
      members:[u.uid],
      inviteCode:code,
      createdAt:serverTimestamp()
    });

    await setDoc(doc(db,"roomInvites",code),{
      roomId:ref.id,
      roomName:name,
      ownerId:u.uid,
      createdAt:serverTimestamp()
    });

    $("newRoomName").value="";

    msg("roomMsg","تم إنشاء الغرفة. رمز الدعوة: "+code);

    switchRoom(ref.id,name,u);

  }catch(e){
    msg("roomMsg","تعذر إنشاء الغرفة: "+err(e));
  }
}

// الانضمام إلى غرفة خاصة
async function joinRoom(){
  const u=auth.currentUser;
  const code=$("inviteCode").value.trim().toLowerCase();

  if(!u||!code){
    msg("roomMsg","اكتب رمز الدعوة");
    return;
  }

  try{
    const invite=await getDoc(doc(db,"roomInvites",code));

    if(!invite.exists()){
      throw Error("رمز الدعوة غير صحيح");
    }

    const data=invite.data();

    const roomRef=doc(db,"rooms",data.roomId);
    const roomSnap=await getDoc(roomRef);

    if(!roomSnap.exists()){
      throw Error("الغرفة غير موجودة");
    }

    const room=roomSnap.data();

    if(!isOwner&&room.inviteCode!==code){
      throw Error("رمز الدعوة غير صالح لهذه الغرفة");
    }

    if(!isOwner&&!room.members.includes(u.uid)){
      await updateDoc(roomRef,{
        members:arrayUnion(u.uid)
      });
    }

    $("inviteCode").value="";
    msg("roomMsg","تم الدخول إلى الغرفة");

    switchRoom(data.roomId,data.roomName||"غرفة",u);

  }catch(e){
    msg("roomMsg","تعذر الانضمام: "+err(e));
  }
}

// التسجيل
$("register").onclick=async()=>{
  try{
    if(!$("nick").value.trim()){
      throw Error("اكتب الاسم الظاهر أولاً");
    }

    const r=await createUserWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("pass").value
    );

    await profile(r.user,$("nick").value);
    msg("authMsg","");

  }catch(e){
    msg("authMsg",err(e));
  }
};

// تسجيل الدخول
$("login").onclick=async()=>{
  try{
    const r=await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("pass").value
    );

    await profile(r.user,$("nick").value);
    msg("authMsg","");

  }catch(e){
    msg("authMsg",err(e));
  }
};

// الدخول كزائر
$("guest").onclick=async()=>{
  try{
    if(!$("nick").value.trim()){
      throw Error("اكتب اسماً مستعاراً أولاً");
    }

    const r=await signInAnonymously(auth);

    await profile(r.user,$("nick").value);
    msg("authMsg","");

  }catch(e){
    msg("authMsg",err(e));
  }
};

// تسجيل الخروج
$("logout").onclick=async()=>{
  try{
    const u=auth.currentUser;

    if(u){
      await setDoc(doc(db,"users",u.uid),{
        status:"offline",
        updatedAt:serverTimestamp()
      },{merge:true});
    }

    if(heartbeat)clearInterval(heartbeat);

    await signOut(auth);

  }catch(e){
    msg("chatMsg",err(e));
  }
};

// إرسال الرسائل
$("send").onsubmit=async e=>{
  e.preventDefault();

  const t=$("message").value.trim();
  const u=auth.currentUser;

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

        if(
          mute.expiresAt?.toDate &&
          mute.expiresAt.toDate().getTime()>Date.now()
        ){
          const remaining=Math.ceil(
            (mute.expiresAt.toDate().getTime()-Date.now())/60000
          );

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

// متابعة تسجيل الدخول
onAuthStateChanged(auth,async u=>{
  if(!u){
    isOwner=false;
    myRole="member";
    blockedFromGeneral=false;

    if(stopMessages)stopMessages();
    if(stopRooms)stopRooms();
    if(stopUsers)stopUsers();
    if(heartbeat)clearInterval(heartbeat);

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

    if(!nick){
      await profile(u,u.displayName);
    }

    blockedFromGeneral=await checkGeneralBlock(u.uid);

    $("auth").classList.add("hidden");
    $("chat").classList.remove("hidden");

    if(isOwner){
      $("who").textContent="👑 OWNER | "+(nick||u.displayName||"AHMED");
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
