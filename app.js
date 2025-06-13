import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { 
    getFirestore, collection, doc, setDoc, getDoc, onSnapshot, 
    updateDoc, arrayUnion, arrayRemove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { 
    getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAfK_AOq-Pc2bzgXEzIEZ1ESWvnhMJUvwI",
  authDomain: "enraya-51670.firebaseapp.com",
  databaseURL: "https://enraya-51670-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "enraya-51670",
  storageBucket: "enraya-51670.firebasestorage.app",
  messagingSenderId: "103343380727",
  appId: "1:103343380727:web:b2fa02aee03c9506915bf2",
  measurementId: "G-2G31LLJY1T"
};

// --- INICIALIZACIÓN DE SERVICIOS ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- REFERENCIAS AL DOM ---
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const videoCallScreen = document.getElementById('video-call-screen');
const loginBtnGoogle = document.getElementById('login-btn-google');
const logoutBtn = document.getElementById('logout-btn');
const currentUsernameSpan = document.getElementById('current-username');
const allUsersList = document.getElementById('all-users-list');
const friendsList = document.getElementById('friends-list');
const friendRequestsList = document.getElementById('friend-requests-list');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleCameraBtn = document.getElementById('toggle-camera-btn');
const endCallBtn = document.getElementById('end-call-btn');
const incomingCallModal = document.getElementById('incoming-call-modal');
const callerNameSpan = document.getElementById('caller-name');
const acceptCallBtn = document.getElementById('accept-call-btn');
const declineCallBtn = document.getElementById('decline-call-btn');

// --- VARIABLES DE ESTADO GLOBAL ---
let currentUser = null;
let peer = null;
let localStream = null;
let currentCall = null;
let incomingCallData = null;
let userUnsubscribe = null;
let usersUnsubscribe = null;
let callsUnsubscribe = null;

// --- FUNCIONES DE GESTIÓN DE PANTALLAS ---
function showScreen(screen) {
    loginScreen.classList.remove('active');
    mainScreen.classList.remove('active');
    videoCallScreen.classList.remove('active');
    screen.classList.add('active');
}

// --- LÓGICA DE AUTENTICACIÓN Y USUARIO ---
loginBtnGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        // El observer onAuthStateChanged se encargará del resto.
    } catch (error) {
        console.error("Error durante el inicio de sesión con Google:", error);
        alert("No se pudo iniciar sesión con Google. Inténtalo de nuevo.");
    }
});

logoutBtn.addEventListener('click', async () => {
    if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, { isOnline: false, lastSeen: serverTimestamp() });
    }
    await signOut(auth);
    cleanUp();
    showScreen(loginScreen);
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Usuario está autenticado con Google
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            // Es un nuevo usuario, crear su documento en Firestore
            await setDoc(userRef, {
                uid: user.uid,
                username: user.displayName, // Nombre de la cuenta de Google
                photoURL: user.photoURL,   // Foto de perfil de Google
                email: user.email,         // Email de Google
                isOnline: true,
                lastSeen: serverTimestamp(),
                friends: [],
                friendRequests: []
            });
        } else {
            // Usuario existente, marcar como online
            await updateDoc(userRef, {
                isOnline: true,
                lastSeen: serverTimestamp(),
                username: user.displayName, // Actualizar por si ha cambiado
                photoURL: user.photoURL     // Actualizar por si ha cambiado
            });
        }
       
        initializeAppData(user.uid);
        showScreen(mainScreen);

    } else {
        // Usuario está deslogueado
        cleanUp();
        showScreen(loginScreen);
    }
});

function cleanUp() {
    if (userUnsubscribe) userUnsubscribe();
    if (usersUnsubscribe) usersUnsubscribe();
    if (callsUnsubscribe) callsUnsubscribe();
    
    if (peer) peer.destroy();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    currentUser = null;
    peer = null;
    localStream = null;
    currentCall = null;
    
    allUsersList.innerHTML = '';
    friendsList.innerHTML = '';
    friendRequestsList.innerHTML = '';
}

// --- LÓGICA PRINCIPAL DE LA APLICACIÓN (el resto del código no necesita cambios) ---

async function initializeAppData(uid) {
    const userRef = doc(db, 'users', uid);
    
    userUnsubscribe = onSnapshot(userRef, (doc) => {
        currentUser = doc.data();
        currentUsernameSpan.textContent = currentUser.username;
        renderFriendRequests(currentUser.friendRequests || []);
        initializePeerConnection();
        listenForIncomingCalls();
    });

    const usersQuery = collection(db, 'users');
    usersUnsubscribe = onSnapshot(usersQuery, (snapshot) => {
        const allUsers = [];
        snapshot.forEach(doc => allUsers.push(doc.data()));
        renderAllUsers(allUsers);
        renderFriends(allUsers);
    });
}

function renderAllUsers(users) {
    allUsersList.innerHTML = '';
    users.forEach(user => {
        if (!currentUser || user.uid === currentUser.uid) return;
        const isFriend = currentUser.friends.some(f => f.uid === user.uid);
        const hasSentRequest = currentUser.friendRequests.some(req => req.uid === user.uid);
        
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <span class="status-indicator ${user.isOnline ? 'online' : 'offline'}"></span>
                <span>${user.username}</span>
            </div>
            <div class="user-actions">
                ${!isFriend && !hasSentRequest ? `<button class="btn-add" data-uid="${user.uid}"><i class="fas fa-user-plus"></i></button>` : ''}
            </div>
        `;
        allUsersList.appendChild(li);
    });

    allUsersList.querySelectorAll('.btn-add').forEach(button => {
        button.addEventListener('click', (e) => sendFriendRequest(e.currentTarget.dataset.uid));
    });
}

function renderFriends(allUsers) {
    friendsList.innerHTML = '';
    if (!currentUser) return;
    const myFriends = allUsers.filter(user => currentUser.friends.some(f => f.uid === user.uid));
    
    myFriends.forEach(friend => {
        const li = document.createElement('li');
        li.innerHTML = `
             <div>
                <span class="status-indicator ${friend.isOnline ? 'online' : 'offline'}"></span>
                <span>${friend.username}</span>
            </div>
            <div class="user-actions">
                ${friend.isOnline ? `<button class="btn-call" data-uid="${friend.uid}"><i class="fas fa-phone"></i></button>` : ''}
            </div>
        `;
        friendsList.appendChild(li);
    });
    
    friendsList.querySelectorAll('.btn-call').forEach(button => {
        button.addEventListener('click', (e) => initiateCall(e.currentTarget.dataset.uid));
    });
}

function renderFriendRequests(requests) {
    friendRequestsList.innerHTML = '';
    requests.forEach(req => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${req.username}</span>
            <div class="request-actions">
                <button class="btn-accept" data-uid="${req.uid}" data-username="${req.username}"><i class="fas fa-check"></i></button>
                <button class="btn-decline" data-uid="${req.uid}" data-username="${req.username}"><i class="fas fa-times"></i></button>
            </div>
        `;
        friendRequestsList.appendChild(li);
    });

    friendRequestsList.querySelectorAll('.btn-accept').forEach(btn => {
        btn.addEventListener('click', (e) => acceptFriendRequest(e.currentTarget.dataset));
    });
    friendRequestsList.querySelectorAll('.btn-decline').forEach(btn => {
        btn.addEventListener('click', (e) => declineFriendRequest(e.currentTarget.dataset));
    });
}

async function sendFriendRequest(recipientUid) {
    if (recipientUid === currentUser.uid) return;
    
    const recipientRef = doc(db, 'users', recipientUid);
    await updateDoc(recipientRef, {
        friendRequests: arrayUnion({
            uid: currentUser.uid,
            username: currentUser.username
        })
    });
    alert('Solicitud de amistad enviada.');
}

async function acceptFriendRequest({uid, username}) {
    const userRef = doc(db, 'users', currentUser.uid);
    const friendRef = doc(db, 'users', uid);

    await updateDoc(userRef, {
        friends: arrayUnion({ uid, username }),
        friendRequests: arrayRemove({ uid, username })
    });
    
    await updateDoc(friendRef, {
        friends: arrayUnion({ uid: currentUser.uid, username: currentUser.username })
    });
}

async function declineFriendRequest({uid, username}) {
    const userRef = doc(db, 'users', currentUser.uid);
    await updateDoc(userRef, {
        friendRequests: arrayRemove({ uid, username })
    });
}

function initializePeerConnection() {
    if (peer) peer.destroy();
    if (!currentUser) return;
    
    peer = new Peer(currentUser.uid);

    peer.on('open', id => console.log('PeerJS conectado con ID:', id));

    peer.on('call', call => {
        currentCall = call;
        showScreen(videoCallScreen);
        call.answer(localStream);
        call.on('stream', remoteStream => { remoteVideo.srcObject = remoteStream; });
        call.on('close', endCall);
    });
    
    peer.on('error', err => console.error("Error de PeerJS:", err));
}

async function startLocalStream() {
    try {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        return true;
    } catch (err) {
        console.error("Error al obtener stream local:", err);
        alert("No se pudo acceder a la cámara o micrófono.");
        return false;
    }
}

async function initiateCall(recipientUid) {
    if (!await startLocalStream()) return;
    
    const callRef = doc(collection(db, 'calls'));
    await setDoc(callRef, {
        callerId: currentUser.uid,
        callerName: currentUser.username,
        recipientId: recipientUid,
        status: 'ringing',
        createdAt: serverTimestamp()
    });
    
    currentCall = peer.call(recipientUid, localStream);
    showScreen(videoCallScreen);

    currentCall.on('stream', remoteStream => { remoteVideo.srcObject = remoteStream; });
    currentCall.on('close', endCall);
}

function listenForIncomingCalls() {
    if (callsUnsubscribe) callsUnsubscribe();
    if (!currentUser) return;
    
    const q = collection(db, "calls");
    const qFiltered = query(q, where("recipientId", "==", currentUser.uid), where("status", "==", "ringing"));
    
    callsUnsubscribe = onSnapshot(qFiltered, (snapshot) => {
        if (!snapshot.empty) {
            const callDoc = snapshot.docs[0];
            incomingCallData = { id: callDoc.id, ...callDoc.data() };
            callerNameSpan.textContent = incomingCallData.callerName;
            incomingCallModal.classList.add('active');
        } else {
            incomingCallModal.classList.remove('active');
        }
    });
}

acceptCallBtn.addEventListener('click', async () => {
    if (!await startLocalStream()) return;
    
    incomingCallModal.classList.remove('active');
    
    const callRef = doc(db, 'calls', incomingCallData.id);
    await updateDoc(callRef, { status: 'answered' });
});

declineCallBtn.addEventListener('click', async () => {
    incomingCallModal.classList.remove('active');
    const callRef = doc(db, 'calls', incomingCallData.id);
    await updateDoc(callRef, { status: 'declined' });
    incomingCallData = null;
});

async function endCall() {
    if (currentCall) currentCall.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    currentCall = null;
    showScreen(mainScreen);
}

endCallBtn.addEventListener('click', endCall);

toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        toggleMicBtn.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        toggleMicBtn.classList.toggle('active-red', !audioTrack.enabled);
    }
});

toggleCameraBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        toggleCameraBtn.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.toggle('active-red', !videoTrack.enabled);
    }
});
