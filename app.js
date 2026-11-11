
import {initializeApp} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  initializeFirestore,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  arrayUnion
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

function msg(id,t){
  $(id).textContent=t||"";
}

function isOwnerId(uid){
  return uid===OWNER_UID;
}

function err(e){
  const m={
    "auth/invalid-email":"البريد الإلكتروني غير صحيح",
    "auth/weak-password":"كلمة المرور لازم تكون 6 أحرف على الأقل",
    "auth/email-already-in-use":"هذا البريد مسجل مسبقاً",
    "auth/invalid-credential":"البريد أو كلمة المرور غير صحيحة",
    "auth/operation-not-allowed":"طريقة الدخول غير مفعّلة في Firebase",
    "auth/network-request-failed":"تأكد من الإنترنت أو الـVPN"
  };

  return m[e.code]||e.message;
}

function makeInviteCode(){
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    b=>b.toString(16).padStart(2,"0")
  ).join("");
}

async function profile(u,n){
  nick=(n||u.displayName||u.email?.split("@")[0]||"زائر")
    .trim()
    .slice(0,24);

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

async function checkOwner(u){
  const roleSnap=await getDoc(doc(db,"roles",u.uid));

  isOwner=roleSnap.exists()
    && roleSnap.data().role==="owner";
}

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

// عرض اسم العضو مع شارة المالك
function renderName(element,uid,name){
  element.replaceChildren();

  element.append(
    document.createTextNode(name||"مستخدم")
  );

  if(isOwnerId(uid)){
    const badge=document.createElement("span");

    badge.textContent=" 👑";
    badge.style.color="#D4AF37";
    badge.style.fontSize="18px";
    badge.style.fontWeight="bold";

    element.append(badge);
  }
}

// عرض الرسائل
function renderMessage(x,u){
  const el=document.createElement("div");

  el.className="msg"+(
    x.senderId===u.uid?" mine":""
  );

  const n=document.createElement("div");
  n.className="name";

  renderName(
    n,
    x.senderId,
    x.nickname||"مستخدم"
  );

  const b=document.createElement("div");
  b.className="body";
  b.textContent=x.text||"";

  const tm=document.createElement("div");
  tm.className="time";

  tm.textContent=x.createdAt?.toDate
    ?x.createdAt.toDate().toLocaleTimeString(
      "ar-IQ",
      {hour:"2-digit",minute:"2-digit"}
    )
    :"الآن";

  el.append(n,b,tm);

  $("messages").append(el);
}

// متابعة الرسائل
function watchMessages(u){
  if(stopMessages)stopMessages();

  const q=query(
    collection(db,"messages"),
    where("roomId","==",currentRoom),
    orderBy("createdAt","asc")
  );

  stopMessages=onSnapshot(q,s=>{
    const area=$("messages");

    area.replaceChildren();

    s.forEach(d=>{
      renderMessage(d.data(),u);
    });

    area.scrollTop=area.scrollHeight;

  },e=>{
    msg("chatMsg","تعذر تحديث الرسائل: "+err(e));
  });
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

    general.onclick=()=>{
      switchRoom("general","الغرفة العامة",u);
    };

    list.append(general);

    s.forEach(d=>{
      const r=d.data();

      const b=document.createElement("button");

      b.className="roomChoice"+
        (currentRoom===d.id?" selected":"");

      const crown=isOwnerId(r.ownerId)?" 👑":"";

      b.textContent=
        (r.isPrivate?"🔒 ":"💬 ")+
        (r.name||"غرفة")+
        crown;

      if(isOwnerId(r.ownerId)){
        b.style.color="#D4AF37";
      }

      b.onclick=()=>{
        switchRoom(d.id,r.name||"غرفة",u);
      };

      list.append(b);
    });

  },e=>{
    msg("chatMsg","تعذر تحميل الغرف: "+err(e));
  });
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

      const name=document.createElement("span");

      renderName(
        name,
        d.id,
        data.name||"زائر"
      );

      row.append(dot,name);
      list.append(row);

      count++;
    });

    $("onlineCount").textContent=String(count);

    if(!count){
      const empty=document.createElement("small");

      empty.textContent=
        "ماكو أعضاء آخرين ظاهرين حالياً";

      list.append(empty);
    }

  },e=>{
    msg("chatMsg","تعذر تحميل قائمة المتصلين: "+err(e));
  });
}

// الانتقال بين الغرف
function switchRoom(id,name,u){
  currentRoom=id;
  roomName=name;

  $("roomTitle").textContent=name;

  $("roomSubtitle").textContent=
    id==="general"
      ?"احچي باحترام وخلي اللمة حلوة"
      :"محادثة أعضاء الغرفة";

  watchMessages(u);
  watchRooms(u);

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

    const ref=await addDoc(
      collection(db,"rooms"),
      {
        name,
        isPrivate:true,
        ownerId:u.uid,
        members:[u.uid],
        inviteCode:code,
        createdAt:serverTimestamp()
      }
    );

    await setDoc(
      doc(db,"roomInvites",code),
      {
        roomId:ref.id,
        roomName:name,
        ownerId:u.uid,
        createdAt:serverTimestamp()
      }
    );

    $("newRoomName").value="";

    msg(
      "roomMsg",
      "تم إنشاء الغرفة. رمز الدعوة: "+code
    );

    switchRoom(ref.id,name,u);

  }catch(e){
    msg("roomMsg","تعذر إنشاء الغرفة: "+err(e));
  }
}

// الانضمام إلى غرفة بالدعوة
async function joinRoom(){
  const u=auth.currentUser;

  const code=$("inviteCode").value.trim().toLowerCase();

  if(!u||!code){
    msg("roomMsg","اكتب رمز الدعوة");
    return;
  }

  try{
    const invite=await getDoc(
      doc(db,"roomInvites",code)
    );

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

    if(!isOwner && room.inviteCode!==code){
      throw Error("رمز الدعوة غير صالح لهذه الغرفة");
    }

    if(!isOwner && !room.members.includes(u.uid)){
      await updateDoc(roomRef,{
        members:arrayUnion(u.uid)
      });
    }

    $("inviteCode").value="";

    msg("roomMsg","تم الدخول إلى الغرفة");

    switchRoom(
      data.roomId,
      data.roomName||"غرفة",
      u
    );

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
      await setDoc(
        doc(db,"users",u.uid),
        {
          status:"offline",
          updatedAt:serverTimestamp()
        },
        {merge:true}
      );
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

  $("message").value="";

  try{
    await addDoc(
      collection(db,"messages"),
      {
        roomId:currentRoom,
        senderId:u.uid,
        nickname:nick||u.displayName||"زائر",
        text:t,
        createdAt:serverTimestamp()
      }
    );

    msg("chatMsg","");

  }catch(x){
    $("message").value=t;

    msg(
      "chatMsg",
      "لم تُرسل الرسالة: "+err(x)
    );
  }
};

$("createRoom").onclick=createRoom;
$("joinRoom").onclick=joinRoom;

// متابعة حالة تسجيل الدخول
onAuthStateChanged(auth,async u=>{
  if(!u){
    isOwner=false;

    if(stopMessages)stopMessages();
    if(stopRooms)stopRooms();
    if(stopUsers)stopUsers();

    if(heartbeat)clearInterval(heartbeat);

    $("chat").classList.add("hidden");
    $("auth").classList.remove("hidden");

    return;
  }

  try{
    if(!nick){
      await profile(u,u.displayName);
    }

    await checkOwner(u);

    $("auth").classList.add("hidden");
    $("chat").classList.remove("hidden");

    if(isOwner){
      $("who").textContent=
        "👑 OWNER | "+(nick||u.displayName||"AHMED");

      $("who").style.color="#D4AF37";
      $("who").style.fontWeight="bold";

    }else{
      $("who").textContent=
        nick||u.displayName||"زائر";

      $("who").style.color="";
      $("who").style.fontWeight="";
    }

    setPresence();

    watchMessages(u);
    watchRooms(u);
    watchUsers(u);

  }catch(e){
    msg("chatMsg",err(e));
  }
});
