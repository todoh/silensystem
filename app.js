import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { 
    getFirestore, collection, doc, setDoc, getDoc, onSnapshot, 
    updateDoc, arrayUnion, arrayRemove, serverTimestamp,
    query, where // Add query and where here
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

// --- INITIALIZATION OF SERVICES ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- DOM REFERENCES ---
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

// Chat DOM elements
const p2pChatContainer = document.getElementById('p2p-chat-container');
const chatToggleBtn = p2pChatContainer.querySelector('.chat-toggle-btn');
const chatMessages = document.getElementById('chat-messages');
const chatMessageInput = document.getElementById('chat-message-input');
const sendChatMessageBtn = document.getElementById('send-chat-message-btn');
const callControls = document.querySelector('.call-controls'); // Referencia a los controles de llamada
const localVideoWrapper = document.querySelector('.video-wrapper.local'); // Referencia a la miniatura de la cámara local

// --- GLOBAL STATE VARIABLES ---
let currentUser = null;
let peer = null;
let localStream = null;
let currentCall = null;
let incomingCallData = null;
let userUnsubscribe = null;
let usersUnsubscribe = null;
let callsUnsubscribe = null;
let dataChannel = null; // PeerJS DataChannel for chat
let statusUpdateInterval = null; // Variable para almacenar el ID del intervalo de actualización de estado

// --- SCREEN MANAGEMENT FUNCTIONS ---
function showScreen(screen) {
    loginScreen.classList.remove('active');
    mainScreen.classList.remove('active');
    videoCallScreen.classList.remove('active');
    screen.classList.add('active');

    // Controlar la visibilidad de los elementos de llamada/chat
    if (screen !== videoCallScreen) {
        if (callControls) callControls.style.display = 'none';
        if (localVideoWrapper) localVideoWrapper.style.display = 'none';
        if (p2pChatContainer) p2pChatContainer.style.display = 'none';
    } else {
        // Mostrar solo cuando está en la pantalla de videollamada
        if (callControls) callControls.style.display = 'flex';
        if (localVideoWrapper) localVideoWrapper.style.display = 'flex';
        if (p2pChatContainer) p2pChatContainer.style.display = 'flex';
    }
}

// --- AUTHENTICATION AND USER LOGIC ---
loginBtnGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        // The onAuthStateChanged observer will handle the rest.
    } catch (error) {
        console.error("Error during Google sign-in:", error);
        displayNotification("Failed to sign in with Google. Please try again.", 'error');
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
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        // Asegurarse de que el nombre de usuario siempre tenga un valor
        const usernameToSet = user.displayName || user.email || 'Usuario Desconocido';

        if (!userDoc.exists()) {
            await setDoc(userRef, {
                uid: user.uid,
                username: usernameToSet, // Usar el nombre con fallback
                photoURL: user.photoURL,
                email: user.email,
                isOnline: true,
                lastSeen: serverTimestamp(),
                friends: [],
                friendRequests: []
            });
        } else {
            await updateDoc(userRef, {
                isOnline: true,
                lastSeen: serverTimestamp(),
                username: usernameToSet, // Actualizar el nombre con fallback
                photoURL: user.photoURL
            });
        }
       
        initializeAppData(user.uid);
        showScreen(mainScreen);

        // Iniciar el intervalo de actualización de estado si no está ya activo
        if (!statusUpdateInterval) {
            statusUpdateInterval = setInterval(updateUserStatus, 40000); // Actualiza cada 40 segundos
        }

    } else {
        // Al cerrar sesión o no estar autenticado, limpiar el intervalo
        if (statusUpdateInterval) {
            clearInterval(statusUpdateInterval);
            statusUpdateInterval = null;
        }
        cleanUp();
        showScreen(loginScreen);
    }
});

// Función para actualizar el estado del usuario en Firestore (heartbeat)
async function updateUserStatus() {
    if (currentUser && currentUser.uid) {
        const userRef = doc(db, 'users', currentUser.uid);
        try {
            await updateDoc(userRef, {
                isOnline: true,
                lastSeen: serverTimestamp()
            });
            console.log('User status updated:', currentUser.username);
        } catch (error) {
            console.error('Error updating user status:', error);
        }
    }
}

function cleanUp() {
    if (userUnsubscribe) userUnsubscribe();
    if (usersUnsubscribe) usersUnsubscribe();
    if (callsUnsubscribe) callsUnsubscribe();
    
    if (peer) peer.destroy();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (dataChannel) dataChannel.close();
    
    // Clear the status update interval on cleanup
    if (statusUpdateInterval) {
        clearInterval(statusUpdateInterval);
        statusUpdateInterval = null;
    }

    currentUser = null;
    peer = null;
    localStream = null;
    currentCall = null;
    dataChannel = null;
    
    allUsersList.innerHTML = '';
    friendsList.innerHTML = '';
    friendRequestsList.innerHTML = '';
    chatMessages.innerHTML = ''; // Clear chat messages

    // Asegurar que los controles y videos estén ocultos al limpiar
    if (callControls) callControls.style.display = 'none';
    if (localVideoWrapper) localVideoWrapper.style.display = 'none';
    if (p2pChatContainer) p2pChatContainer.style.display = 'none';
}

// --- MAIN APPLICATION LOGIC ---

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
    usersUnsubscribe = onSnapshot(usersQuery, async (snapshot) => {
        const allUsers = [];
        const now = Date.now();
        const OFFLINE_THRESHOLD_MS = 50 * 1000; // 50 segundos

        snapshot.forEach(doc => {
            const userData = doc.data();
            // Si el usuario tiene lastSeen y ha pasado el umbral, marcar como offline si estaba online
            // NOTA IMPORTANTE: Hemos eliminado la escritura a Firestore aquí para evitar conflictos.
            // La actualización a isOnline: false para usuarios inactivos debe gestionarse
            // por su propio cliente (si se desconecta) o por reglas de seguridad/funciones de servidor.
            if (userData.lastSeen && userData.isOnline) {
                const lastSeenTime = userData.lastSeen.toDate().getTime(); // Convertir Timestamp a milisegundos
                if (now - lastSeenTime > OFFLINE_THRESHOLD_MS) {
                    // Si el usuario está por encima del umbral de offline, lo consideramos offline para esta interfaz
                    // NO actualizamos el documento del otro usuario desde aquí.
                    userData.isOnline = false; // Solo actualizamos la copia local para renderizado
                }
            }
            allUsers.push(userData);
        });
        
        // Filtrar para mostrar SOLO usuarios online en "Usuarios en la Red"
        const onlineUsersForList = allUsers.filter(user => user.isOnline && user.uid !== currentUser.uid);
        renderAllUsers(onlineUsersForList);

        // La lista de amigos puede mostrar amigos offline, pero solo permitir llamar a los online
        renderFriends(allUsers); 
    });
}

function renderAllUsers(users) {
    allUsersList.innerHTML = '';
    users.forEach(user => {
        // Excluir el usuario actual de la lista 'Todos los Usuarios'
        if (!currentUser || user.uid === currentUser.uid) return;
        
        const isFriend = currentUser.friends.some(f => f.uid === user.uid);
        const hasSentRequest = currentUser.friendRequests.some(req => req.uid === user.uid);
        
        const li = document.createElement('li');
        // Solo renderizar si el usuario está online (esto ya lo filtra la llamada a renderAllUsers)
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
        // El botón de llamada solo se renderiza si el amigo está online
        if (friend.isOnline) {
            li.innerHTML = `
                <div>
                    <span class="status-indicator online"></span>
                    <span>${friend.username}</span>
                </div>
                <div class="user-actions">
                    <button class="btn-call" data-uid="${friend.uid}"><i class="fas fa-phone"></i></button>
                </div>
            `;
            friendsList.appendChild(li);
        } else {
            // Si el amigo está offline, aún lo mostramos en la lista de amigos, pero sin el botón de llamada interactivo
            li.innerHTML = `
                <div>
                    <span class="status-indicator offline"></span>
                    <span>${friend.username}</span>
                </div>
                <div class="user-actions">
                    <!-- Ya no se renderiza un botón deshabilitado aquí, simplemente no hay botón -->
                </div>
            `;
            friendsList.appendChild(li);
        }
    });
    
    // Adjuntar escuchadores de eventos solo a los botones que existen (los que están online)
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
    displayNotification('Friend request sent.', 'success');
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
    displayNotification('Friend request accepted!', 'success');
}

async function declineFriendRequest({uid, username}) {
    const userRef = doc(db, 'users', currentUser.uid);
    await updateDoc(userRef, {
        friendRequests: arrayRemove({ uid, username })
    });
    displayNotification('Friend request declined.', 'info');
}

function initializePeerConnection() {
    if (peer) peer.destroy();
    if (!currentUser) return;
    
    peer = new Peer(currentUser.uid);

    peer.on('open', id => console.log('PeerJS connected with ID:', id));

    peer.on('call', call => {
        currentCall = call;
        showScreen(videoCallScreen);
        call.answer(localStream);
        call.on('stream', remoteStream => { remoteVideo.srcObject = remoteStream; });
        call.on('close', endCall);
        setupDataChannel(call); // Setup data channel for incoming call
    });
    
    peer.on('error', err => console.error("PeerJS Error:", err)); 
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
        console.error("Error getting local stream:", err);
        displayNotification("Could not access camera or microphone.", 'error');
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
    
    currentCall = peer.call(recipientUid, localStream, {metadata: {initiator: true}}); // Add metadata to identify initiator
    showScreen(videoCallScreen);

    currentCall.on('stream', remoteStream => { remoteVideo.srcObject = remoteStream; });
    currentCall.on('close', endCall);
    setupDataChannel(currentCall, true); // Setup data channel for outgoing call
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
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    chatMessages.innerHTML = ''; // Clear chat on call end
    showScreen(mainScreen); // Return to main screen
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

// --- P2P CHAT LOGIC ---

function setupDataChannel(call, isInitiator = false) {
    if (isInitiator) {
        // Para el que llama, crea el canal de datos
        dataChannel = call.peerConnection.createDataChannel('chat');
        console.log('DataChannel created (initiator):', dataChannel);
    } else {
        // Para el receptor, escucha el canal de datos
        call.peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            console.log('DataChannel received (receiver):', dataChannel);
            dataChannel.onopen = () => console.log('DataChannel is open!');
            dataChannel.onclose = () => console.log('DataChannel is closed!');
            dataChannel.onerror = (err) => console.error('DataChannel error:', err);
            dataChannel.onmessage = (event) => displayMessage(event.data, 'other');
        };
    }

    if (dataChannel) {
        dataChannel.onmessage = (event) => displayMessage(event.data, 'other');
        dataChannel.onopen = () => console.log('DataChannel is open!');
        dataChannel.onclose = () => console.log('DataChannel is closed!');
        dataChannel.onerror = (err) => console.error('DataChannel error:', err);
    }
}

sendChatMessageBtn.addEventListener('click', sendMessage);
chatMessageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = chatMessageInput.value.trim();
    if (message && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(message);
        displayMessage(message, 'self');
        chatMessageInput.value = '';
    } else if (dataChannel && dataChannel.readyState !== 'open') {
        console.warn('DataChannel is not open. Cannot send message.');
        // Optionally display a message to the user
    } else {
        console.warn('No active data channel to send message.');
    }
}

function displayMessage(message, type) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', type);
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
}

// Chat toggle functionality
chatToggleBtn.addEventListener('click', () => {
    p2pChatContainer.classList.toggle('minimized');
    if (!p2pChatContainer.classList.contains('minimized')) {
        chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom when maximized
    }
});

// Custom notification/alert function
function displayNotification(message, type) {
    const notificationContainer = document.getElementById('notification-container');
    if (!notificationContainer) {
        // Create container if it doesn't exist
        const div = document.createElement('div');
        div.id = 'notification-container';
        document.body.appendChild(div);
    }

    const notification = document.createElement('div');
    notification.classList.add('notification', type);
    notification.textContent = message;
    notificationContainer.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}
