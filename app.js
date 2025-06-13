import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getFirestore, collection, doc, setDoc, getDoc, onSnapshot,
    updateDoc, arrayUnion, arrayRemove, serverTimestamp,
    query, where
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
    getAuth, onAuthStateChanged, signInAnonymously // Solo signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

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
const usernameInput = document.getElementById('username-input');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const currentUsernameSpan = document.getElementById('current-username');
const allUsersList = document.getElementById('all-users-list');
const friendsList = document.getElementById('friends-list');
const friendRequestsList = document.getElementById('friend-requests-list');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleCameraBtn = document.getElementById('toggle-camera-btn');
const toggleScreenShareBtn = document.getElementById('toggle-screen-share-btn'); // Nuevo botón
const endCallBtn = document.getElementById('end-call-btn');
const incomingCallModal = document.getElementById('incoming-call-modal');
const callerNameSpan = document.getElementById('caller-name');
const acceptCallBtn = document.getElementById('accept-call-btn');
const declineCallBtn = document.getElementById('decline-call-btn');
const appContainer = document.getElementById('app-container');

// Chat DOM elements
const p2pChatContainer = document.getElementById('p2p-chat-container');
const toggleChatBtn = document.getElementById('toggle-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const chatMessageInput = document.getElementById('chat-message-input');
const sendChatMessageBtn = document.getElementById('send-chat-message-btn');
// const attachImageInput = document.getElementById('attach-image-input'); // Para futura implementación de subida de archivo
// const attachImageBtn = document.getElementById('attach-image-btn'); // Para futura implementación de subida de archivo


// --- VARIABLES DE ESTADO GLOBAL ---
let currentUser = null;
let peer = null;
let localStream = null;
let currentCall = null;
let incomingCallData = null;
let userUnsubscribe = null;
let usersUnsubscribe = null;
let callsUnsubscribe = null;
let dataConnection = null; // Variable para la conexión de datos PeerJS
let isSharingScreen = false; // Nuevo estado para controlar la compartición de pantalla


// --- FUNCIONES DE GESTIÓN DE PANTALLAS ---
function showScreen(screen) {
    loginScreen.classList.remove('active');
    mainScreen.classList.remove('active');
    videoCallScreen.classList.remove('active');
    screen.classList.add('active');
}

// --- FUNCION PARA MOSTRAR MENSAJES TEMPORALES (reemplaza alert) ---
function showMessage(message, type = 'info', duration = 3000) {
    const messageModal = document.createElement('div');
    messageModal.classList.add('app-message-modal', type);
    messageModal.textContent = message;

    Object.assign(messageModal.style, {
        position: 'fixed',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        borderRadius: '8px',
        color: '#fff',
        zIndex: '9999',
        textAlign: 'center',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        opacity: '0',
        transition: 'opacity 0.3s ease-in-out',
        pointerEvents: 'none'
    });

    if (type === 'error') {
        messageModal.style.backgroundColor = '#dc3545';
    } else if (type === 'success') {
        messageModal.style.backgroundColor = '#28a745';
    } else {
        messageModal.style.backgroundColor = '#007bff';
    }

    appContainer.appendChild(messageModal);

    setTimeout(() => {
        messageModal.style.opacity = '1';
    }, 10);

    setTimeout(() => {
        messageModal.style.opacity = '0';
        messageModal.addEventListener('transitionend', () => messageModal.remove());
    }, duration);
}

// --- LÓGICA DE AUTENTICACIÓN Y USUARIO ---

// Escucha los cambios en el campo de texto del nombre de usuario para habilitar/deshabilitar el botón de login
usernameInput.addEventListener('input', () => {
    // Habilita el botón si el campo tiene al menos un carácter no vacío
    loginBtn.disabled = usernameInput.value.trim().length === 0;
});

// Manejador del botón "Entrar" para el inicio de sesión anónimo
loginBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (username.length === 0) {
        showMessage("Por favor, ingresa un nombre de usuario.", 'error');
        return;
    }

    try {
        // Iniciar sesión anónimamente con Firebase
        console.log("Iniciando signInAnonymously...");
        const userCredential = await signInAnonymously(auth);
        const user = userCredential.user;
        console.log("Usuario autenticado anónimamente. UID:", user.uid);

        // Guardar o actualizar el perfil del usuario en Firestore
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
            uid: user.uid,
            username: username,
            isOnline: true,
            lastSeen: serverTimestamp(),
            friends: [],
            friendRequests: []
        }, { merge: true }); // Usar merge:true para no sobrescribir si el UID ya existe

        console.log("Perfil de usuario en Firestore actualizado/creado para:", username);
        // La pantalla se mostrará y los listeners se inicializarán en onAuthStateChanged
        showMessage(`¡Bienvenido, ${username}!`, 'success');

    } catch (error) {
        console.error("Error durante el inicio de sesión anónimo o al guardar el perfil:", error);
        showMessage("No se pudo iniciar sesión. Inténtalo de nuevo.", 'error');
    }
});


logoutBtn.addEventListener('click', async () => {
    try {
        if (currentUser) {
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, { isOnline: false, lastSeen: serverTimestamp() });
            console.log("Estado online actualizado a offline.");
        }
        await auth.signOut(); // Usa auth.signOut() para cerrar sesión de cualquier tipo
        cleanUp();
        showScreen(loginScreen);
        showMessage("Sesión cerrada correctamente.", 'info');
        // Limpiar el campo de entrada y deshabilitar el botón al salir
        usernameInput.value = '';
        loginBtn.disabled = true;
    } catch (error) {
        console.error("Error al cerrar sesión:", error);
        showMessage("Error al cerrar sesión. Inténtalo de nuevo.", 'error');
    }
});

// onAuthStateChanged se disparará cada vez que el estado de autenticación cambie
onAuthStateChanged(auth, async (user) => {
    console.log("onAuthStateChanged disparado. Objeto user inicial:", user);

    if (user) {
        // Usuario logueado (ya sea anónimo o por otro método si se añade)
        currentUser = { uid: user.uid }; // Inicializa currentUser con el UID para la primera consulta
        console.log("Usuario detectado. UID:", user.uid);

        // Intenta cargar el perfil completo desde Firestore.
        // Si no existe, significa que es un nuevo usuario anónimo que acaba de iniciar sesión
        // y necesitamos crear su perfil con el nombre de usuario de la caja de texto.
        const userRef = doc(db, 'users', user.uid);
        try {
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                // Si el documento existe, actualiza currentUser con los datos de Firestore
                currentUser = userDoc.data();
                console.log("Perfil de usuario cargado desde Firestore:", currentUser.username);
                // Si el nombre de usuario del input no coincide con el del perfil, actualízalo
                // Esto es útil si el usuario cierra sesión y vuelve a entrar con otro nombre en el input
                const enteredUsername = usernameInput.value.trim();
                if (enteredUsername && currentUser.username !== enteredUsername) {
                    await updateDoc(userRef, { username: enteredUsername, isOnline: true, lastSeen: serverTimestamp() });
                    currentUser.username = enteredUsername; // Actualizar el objeto local
                    console.log("Nombre de usuario actualizado en Firestore y localmente.");
                } else if (currentUser.isOnline !== true) {
                    // Si el usuario no estaba marcado como online, actualiza su estado
                     await updateDoc(userRef, { isOnline: true, lastSeen: serverTimestamp() });
                     console.log("Estado online actualizado a true.");
                }

            } else {
                // Esto ocurrirá para usuarios anónimos que se autentican por primera vez
                // o si el documento de usuario fue eliminado.
                const username = usernameInput.value.trim();
                if (username.length > 0) {
                    await setDoc(userRef, {
                        uid: user.uid,
                        username: username,
                        isOnline: true,
                        lastSeen: serverTimestamp(),
                        friends: [],
                        friendRequests: []
                    });
                    currentUser = {
                        uid: user.uid,
                        username: username,
                        isOnline: true,
                        lastSeen: new Date(), // Usar new Date() ya que serverTimestamp() es asíncrono
                        friends: [],
                        friendRequests: []
                    };
                    console.log("Nuevo perfil de usuario anónimo creado en Firestore.");
                } else {
                    console.error("No se pudo obtener el nombre de usuario para un nuevo usuario anónimo.");
                    // Forzar cierre de sesión si no hay nombre de usuario para el nuevo perfil
                    await auth.signOut();
                    cleanUp();
                    showScreen(loginScreen);
                    showMessage("Error: No se pudo establecer el nombre de usuario.", 'error');
                    return;
                }
            }
            initializeAppData(currentUser.uid);
            showScreen(mainScreen);

        } catch (firestoreError) {
            console.error("Error al interactuar con Firestore en onAuthStateChanged:", firestoreError);
            showMessage(`Error al cargar/crear perfil de usuario: ${firestoreError.message}.`, 'error', 7000);
            await auth.signOut(); // Forzar cierre de sesión en caso de error grave
            cleanUp();
            showScreen(loginScreen);
        }
    } else {
        // No hay usuario autenticado (después de logout o al cargar la página por primera vez)
        console.log("No hay usuario autenticado. Mostrando pantalla de login.");
        cleanUp();
        showScreen(loginScreen);
    }
});


function cleanUp() {
    if (userUnsubscribe) { userUnsubscribe(); console.log("userUnsubscribe desactivado."); }
    if (usersUnsubscribe) { usersUnsubscribe(); console.log("usersUnsubscribe desactivado."); }
    if (callsUnsubscribe) { callsUnsubscribe(); console.log("callsUnsubscribe desactivado."); }

    if (peer) { 
        if (dataConnection) {
            dataConnection.close();
            dataConnection = null;
            console.log("PeerJS DataConnection cerrada.");
        }
        peer.destroy(); 
        console.log("PeerJS destruido."); 
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        console.log("Stream local detenido.");
    }

    currentUser = null;
    peer = null;
    localStream = null;
    currentCall = null;
    incomingCallData = null; // Limpiar los datos de la llamada entrante
    isSharingScreen = false; // Resetear estado de compartir pantalla
    toggleScreenShareBtn.classList.remove('active-red'); // Desactivar el botón

    allUsersList.innerHTML = '';
    friendsList.innerHTML = '';
    friendRequestsList.innerHTML = '';
    chatMessagesContainer.innerHTML = ''; // Limpiar mensajes del chat
    p2pChatContainer.classList.add('minimized'); // Minimizar chat al limpiar
    toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Reset chat toggle icon to up
    console.log("Estado de la aplicación limpiado.");
}

// --- LÓGICA PRINCIPAL DE LA APLICACIÓN (el resto del código no necesita cambios) ---

async function initializeAppData(uid) {
    console.log("initializeAppData: Iniciando para UID:", uid);
    const userRef = doc(db, 'users', uid);

    userUnsubscribe = onSnapshot(userRef, (doc) => {
        console.log("onSnapshot userRef: Datos de currentUser actualizados.");
        currentUser = doc.data();
        if (currentUser) {
            currentUsernameSpan.textContent = currentUser.username;
            renderFriendRequests(currentUser.friendRequests || []);
            initializePeerConnection();
            listenForIncomingCalls();
        } else {
            console.warn("onSnapshot userRef: currentUser es nulo o indefinido. Esto no debería pasar si el usuario está autenticado.");
            cleanUp(); // Algo salió mal, forzar cierre de sesión.
            showScreen(loginScreen);
        }
    }, (error) => {
        console.error("Error en onSnapshot de currentUser:", error);
        showMessage("Error al cargar tu perfil de usuario. Intenta recargar.", 'error', 5000);
        cleanUp();
        showScreen(loginScreen);
    });

    const usersQuery = collection(db, 'users');
    usersUnsubscribe = onSnapshot(usersQuery, (snapshot) => {
        console.log("onSnapshot usersQuery: Actualizando lista de todos los usuarios.");
        const allUsers = [];
        snapshot.forEach(doc => allUsers.push(doc.data()));
        renderAllUsers(allUsers);
        renderFriends(allUsers);
    }, (error) => {
        console.error("Error en onSnapshot de allUsers:", error);
        showMessage("Error al cargar la lista de usuarios.", 'error', 5000);
    });
}

function renderAllUsers(users) {
    allUsersList.innerHTML = '';
    users.forEach(user => {
        // Asegúrate de que currentUser esté definido antes de usarlo
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
    if (!currentUser) {
        console.warn("renderFriends: currentUser es nulo, no se pueden renderizar amigos.");
        return;
    }
    const myFriends = allUsers.filter(user => currentUser.friends.some(f => f.uid === user.uid));

    myFriends.forEach(friend => {
        const li = document.createElement('li');
        li.innerHTML = `
             <div>
                <span class="status-indicator ${friend.isOnline ? 'online' : 'offline'}"></span>
                <span>${friend.username}</span>
            </div>
            <div class="user-actions">
                ${friend.isOnline ? `<button class="btn-call" data-uid="${friend.uid}" data-username="${friend.username}"><i class="fas fa-phone"></i></button>` : ''}
            </div>
        `;
        friendsList.appendChild(li);
    });

    friendsList.querySelectorAll('.btn-call').forEach(button => {
        button.addEventListener('click', (e) => initiateCall(e.currentTarget.dataset.uid, e.currentTarget.dataset.username));
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
    try {
        await updateDoc(recipientRef, {
            friendRequests: arrayUnion({
                uid: currentUser.uid,
                username: currentUser.username
            })
        });
        showMessage('Solicitud de amistad enviada.', 'success');
    } catch (error) {
        console.error("Error al enviar solicitud de amistad:", error);
        showMessage("No se pudo enviar la solicitud de amistad.", 'error');
    }
}

async function acceptFriendRequest({uid, username}) {
    const userRef = doc(db, 'users', currentUser.uid);
    const friendRef = doc(db, 'users', uid);

    try {
        await updateDoc(userRef, {
            friends: arrayUnion({ uid, username }),
            friendRequests: arrayRemove({ uid, username })
        });

        await updateDoc(friendRef, {
            friends: arrayUnion({ uid: currentUser.uid, username: currentUser.username })
        });
        showMessage(`¡Ahora eres amigo de ${username}!`, 'success');
    } catch (error) {
        console.error("Error al aceptar solicitud de amistad:", error);
        showMessage("No se pudo aceptar la solicitud de amistad.", 'error');
    }
}

async function declineFriendRequest({uid, username}) {
    const userRef = doc(db, 'users', currentUser.uid);
    try {
        await updateDoc(userRef, {
            friendRequests: arrayRemove({ uid, username })
        });
        showMessage(`Solicitud de ${username} rechazada.`, 'info');
    } catch (error) {
        console.error("Error al rechazar solicitud de amistad:", error);
        showMessage("No se pudo rechazar la solicitud de amistad.", 'error');
    }
}

function initializePeerConnection() {
    if (peer) {
        // No destruir Peer si ya está inicializado.
        // Solo destruir si se necesita una nueva conexión con un nuevo ID de usuario.
        if (peer.id !== currentUser.uid) {
            peer.destroy();
            peer = null; // Establecer a null para permitir una nueva inicialización
            console.log("PeerJS existente destruido porque el UID cambió.");
        } else {
            console.log("PeerJS ya inicializado para el UID actual. Reutilizando.");
            // Si la conexión de datos ya está abierta, asegurarnos de que el chat esté maximizado
            if (dataConnection && dataConnection.open) {
                 p2pChatContainer.classList.remove('minimized');
                 toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            }
            return; // Salir si ya está inicializado y con el mismo UID
        }
    }
    if (!currentUser) {
        console.warn("initializePeerConnection: currentUser es nulo, no se puede inicializar PeerJS.");
        return;
    }

    peer = new Peer(currentUser.uid);
    console.log('PeerJS: Intentando conectar con ID:', currentUser.uid);

    peer.on('open', id => {
        console.log('PeerJS conectado con ID:', id);
    });

    peer.on('call', call => {
        console.log("PeerJS: Llamada entrante detectada.", call);
        currentCall = call;
        showScreen(videoCallScreen);

        // Intenta obtener el stream local ANTES de responder la llamada
        startLocalStream().then(streamStarted => {
            if (streamStarted) {
                call.answer(localStream); // Responde la llamada con el stream local
                console.log("PeerJS: Llamada respondida con stream local.");
            } else {
                console.error("PeerJS: No se pudo iniciar el stream local para responder la llamada.");
                showMessage("No se pudo responder la llamada: cámara/micrófono no disponibles.", 'error');
                call.close(); // Cierra la llamada P2P si no se puede responder
                endCall(); // Finalizar la llamada en la UI
                return;
            }
        });

        call.on('stream', remoteStream => { 
            remoteVideo.srcObject = remoteStream;
            console.log("PeerJS: Stream remoto recibido.");
        });
        call.on('close', () => {
            console.log("PeerJS: Llamada de video cerrada.");
            endCall();
        });
        call.on('error', err => {
            console.error("PeerJS: Error en la llamada entrante:", err);
            showMessage(`Error durante la llamada entrante: ${err.message || err}`, 'error', 5000);
            endCall();
        });
        showMessage("Llamada en curso...", 'info');
    });

    // Manejar conexiones de datos entrantes para el chat
    peer.on('connection', (conn) => {
        console.log("PeerJS: Conexión de datos entrante:", conn.peer);
        // Cerrar cualquier conexión de datos anterior antes de establecer una nueva
        if (dataConnection && dataConnection.open) {
            dataConnection.close();
            console.log("DataConnection anterior cerrada para aceptar una nueva.");
        }
        dataConnection = conn;
        setupDataConnectionListeners(dataConnection);
    });

    peer.on('error', err => {
        console.error("Error de PeerJS:", err);
        showMessage(`Error de conexión (PeerJS): ${err.message || err}`, 'error', 5000);
        cleanUp(); // Forzar cleanUp si PeerJS falla.
        showScreen(loginScreen);
    });
}

async function startLocalStream() {
    try {
        // Detener cualquier stream local existente (cámara o pantalla)
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            console.log("Deteniendo stream local existente.");
        }
        isSharingScreen = false; // Resetear estado de compartir pantalla
        toggleScreenShareBtn.classList.remove('active-red'); // Desactivar el botón
        
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        console.log("Stream local (cámara/micrófono) iniciado con éxito.");
        return true;
    }
    catch (err) {
        console.error("Error al obtener stream local (cámara/micrófono):", err);
        showMessage("No se pudo acceder a la cámara o micrófono. Asegúrate de dar permisos y que no estén en uso por otra aplicación.", 'error', 5000);
        return false;
    }
}

async function startScreenShare() {
    try {
        // Si ya estamos compartiendo pantalla, detenerla
        if (isSharingScreen && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // Volver a la cámara
            localVideo.srcObject = localStream;
            currentCall.replaceTrack(
                currentCall.localStream.getVideoTracks()[0],
                localStream.getVideoTracks()[0],
                currentCall.localStream
            );
            isSharingScreen = false;
            toggleScreenShareBtn.classList.remove('active-red');
            showMessage("Compartición de pantalla detenida. Volviendo a la cámara.", 'info');
            return;
        }

        // Si ya hay un stream de cámara activo, detenerlo antes de compartir pantalla
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        localStream = screenStream; // Actualizar el stream local a la pantalla
        localVideo.srcObject = localStream;

        // Si ya hay una llamada activa, reemplazar la pista de video
        if (currentCall && currentCall.localStream) {
            const videoTrack = currentCall.localStream.getVideoTracks()[0];
            const newVideoTrack = screenStream.getVideoTracks()[0];
            if (videoTrack && newVideoTrack) {
                currentCall.replaceTrack(videoTrack, newVideoTrack, currentCall.localStream);
                console.log("Pista de video reemplazada por stream de pantalla.");
            } else {
                console.warn("No se pudo reemplazar la pista de video en la llamada activa.");
            }
        }

        isSharingScreen = true;
        toggleScreenShareBtn.classList.add('active-red');
        showMessage("Estás compartiendo tu pantalla.", 'success');

        // Escuchar si el usuario detiene la compartición a través del navegador
        localStream.getVideoTracks()[0].onended = () => {
            console.log("Compartición de pantalla detenida por el usuario.");
            startLocalStream(); // Volver a la cámara cuando la compartición finalice
        };

    } catch (err) {
        console.error("Error al iniciar la compartición de pantalla:", err);
        showMessage("No se pudo compartir la pantalla. Asegúrate de dar permisos.", 'error', 5000);
        // Si hay un error, intentar volver a la cámara si no estábamos compartiendo ya.
        if (!isSharingScreen) {
             startLocalStream();
        }
    }
}


async function initiateCall(recipientUid, recipientUsername) {
    if (!currentUser) {
        showMessage("No estás logueado para iniciar una llamada.", 'error');
        return;
    }
    // Pre-chequeo para evitar llamar a uno mismo (aunque las reglas de Firestore ya lo evitan)
    if (recipientUid === currentUser.uid) {
        showMessage("No puedes llamarte a ti mismo.", 'info');
        return;
    }

    // Iniciar stream local (cámara/micrófono) antes de cualquier operación de llamada o Firestore
    // Esto asegura que siempre haya un stream base, incluso si no se comparte pantalla inicialmente.
    if (!await startLocalStream()) {
        console.warn("No se pudo iniciar stream local para la llamada.");
        return;
    }

    const callRef = doc(collection(db, 'calls'));
    try {
        await setDoc(callRef, {
            callerId: currentUser.uid,
            callerName: currentUser.username,
            recipientId: recipientUid,
            status: 'ringing',
            createdAt: serverTimestamp()
        });
        console.log("Documento de llamada creado en Firestore:", callRef.id);
    } catch (firestoreError) {
        console.error("Error al crear documento de llamada en Firestore:", firestoreError);
        showMessage(`Error al iniciar la llamada: ${firestoreError.message}.`, 'error');
        endCall(); // Asegurarse de limpiar si falla la creación de la llamada
        return;
    }

    // Iniciar la llamada de video PeerJS con el localStream actual
    currentCall = peer.call(recipientUid, localStream);
    showScreen(videoCallScreen);
    showMessage(`Llamando a ${recipientUsername}...`, 'info');

    currentCall.on('stream', remoteStream => { 
        remoteVideo.srcObject = remoteStream; 
        console.log("Stream remoto recibido durante llamada saliente.");
    });
    currentCall.on('close', () => {
        console.log("Llamada saliente cerrada.");
        endCall();
    });
    currentCall.on('error', err => {
        console.error("Error en la llamada P2P (saliente):", err);
        showMessage(`Error durante la llamada: ${err.message || err}`, 'error', 5000);
        endCall();
    });

    // Iniciar conexión de datos para el chat (si no está ya activa)
    // Cerrar cualquier conexión de datos anterior si existiera y fuera diferente
    if (dataConnection && dataConnection.peer !== recipientUid) {
        dataConnection.close();
        dataConnection = null;
        console.log("DataConnection anterior cerrada al iniciar una nueva llamada.");
    }
    // Establecer una nueva conexión de datos si no existe o si es para un nuevo destinatario
    if (!dataConnection || dataConnection.peer !== recipientUid || !dataConnection.open) {
        dataConnection = peer.connect(recipientUid);
        setupDataConnectionListeners(dataConnection);
        console.log("PeerJS: Intentando conectar dataConnection con:", recipientUid);
    } else {
        console.log("DataConnection ya existe y está abierta con el destinatario actual. Reutilizando.");
        p2pChatContainer.classList.remove('minimized'); // Maximizar chat si ya hay conexión
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
}

function listenForIncomingCalls() {
    if (callsUnsubscribe) { callsUnsubscribe(); console.log("callsUnsubscribe (entrantes) desactivado."); }
    if (!currentUser) {
        console.warn("listenForIncomingCalls: currentUser es nulo, no se puede escuchar llamadas entrantes.");
        return;
    }

    const q = collection(db, "calls");
    const qFiltered = query(q, where("recipientId", "==", currentUser.uid), where("status", "==", "ringing"));

    console.log("Escuchando llamadas entrantes para UID:", currentUser.uid);
    callsUnsubscribe = onSnapshot(qFiltered, (snapshot) => {
        if (!snapshot.empty) {
            const callDoc = snapshot.docs[0];
            incomingCallData = { id: callDoc.id, ...callDoc.data() };
            callerNameSpan.textContent = incomingCallData.callerName;
            incomingCallModal.classList.add('active');
            showMessage(`Llamada entrante de ${incomingCallData.callerName}!`, 'info', 4000);
            console.log("Llamada entrante detectada:", incomingCallData.callerName);
        } else {
            incomingCallModal.classList.remove('active');
            // Solo limpiar incomingCallData si el modal estaba activo para evitar limpiar prematuramente
            if (incomingCallData) {
                console.log("No hay llamadas entrantes activas, cerrando modal si estaba abierto.");
                incomingCallData = null;
            }
        }
    }, (error) => {
        console.error("Error al escuchar llamadas entrantes:", error);
        showMessage("Hubo un problema al detectar llamadas entrantes.", 'error', 5000);
        // No forzar cierre de sesión aquí, solo es un problema de escucha.
    });
}

acceptCallBtn.addEventListener('click', async () => {
    if (!incomingCallData) {
        console.warn("acceptCallBtn: No hay datos de llamada entrante para aceptar.");
        return;
    }
    if (!await startLocalStream()) {
        console.warn("No se pudo iniciar stream local para aceptar la llamada.");
        if (incomingCallData) {
            const callRef = doc(db, 'calls', incomingCallData.id);
            try {
                await updateDoc(callRef, { status: 'failed_accept' });
                console.log("Estado de llamada actualizado a 'failed_accept' por fallo de stream.");
            } catch (updateErr) {
                console.error("Error al actualizar estado de llamada a failed_accept:", updateErr);
            }
            incomingCallData = null;
        }
        incomingCallModal.classList.remove('active');
        return;
    }

    incomingCallModal.classList.remove('active');
    const callRef = doc(db, 'calls', incomingCallData.id);
    try {
        await updateDoc(callRef, { status: 'answered' });
        console.log("Estado de llamada actualizado a 'answered'.");
    } catch (error) {
        console.error("Error al actualizar estado de llamada a 'answered':", error);
        showMessage("Error al aceptar la llamada en la base de datos.", 'error');
    }
    showMessage("Llamada aceptada.", 'success');
    // La lógica de PeerJS para responder la llamada ya se maneja en peer.on('call')
    // No necesitamos llamar a peer.call() aquí, ya que la llamada ya fue iniciada por el llamante
    // y nuestro peer.on('call') la está respondiendo.

    // Intentar establecer la conexión de datos para el chat con el caller
    if (!dataConnection || dataConnection.peer !== incomingCallData.callerId || !dataConnection.open) {
        dataConnection = peer.connect(incomingCallData.callerId);
        setupDataConnectionListeners(dataConnection);
        console.log("PeerJS: Intentando conectar dataConnection con el llamante:", incomingCallData.callerId);
    } else {
        console.log("DataConnection ya existe y está abierta con el llamante. Reutilizando.");
        p2pChatContainer.classList.remove('minimized'); // Maximizar chat si ya hay conexión
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
});

declineCallBtn.addEventListener('click', async () => {
    if (!incomingCallData) {
        console.warn("declineCallBtn: No hay datos de llamada entrante para rechazar.");
        return;
    }
    incomingCallModal.classList.remove('active');
    const callRef = doc(db, 'calls', incomingCallData.id);
    try {
        await updateDoc(callRef, { status: 'declined' });
        console.log("Estado de llamada actualizado a 'declined'.");
    } catch (error) {
        console.error("Error al actualizar estado de llamada a 'declined':", error);
        showMessage("No se pudo rechazar la llamada en la base de datos.", 'error');
    }
    incomingCallData = null;
    showMessage("Llamada rechazada.", 'info');
});

async function endCall() {
    if (currentCall) {
        currentCall.close();
        console.log("currentCall cerrado.");
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        console.log("localStream detenido.");
    }
    if (dataConnection) {
        dataConnection.close();
        dataConnection = null;
        console.log("PeerJS DataConnection cerrada.");
    }

    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    currentCall = null;
    incomingCallData = null; // Limpiar datos de la llamada entrante
    isSharingScreen = false; // Resetear estado de compartir pantalla
    toggleScreenShareBtn.classList.remove('active-red'); // Desactivar el botón

    chatMessagesContainer.innerHTML = ''; // Limpiar mensajes del chat
    p2pChatContainer.classList.add('minimized'); // Minimizar chat
    toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Reset chat toggle icon to up
    
    showScreen(mainScreen);
    showMessage("Llamada finalizada.", 'info');
    console.log("Función endCall completada.");
}

endCallBtn.addEventListener('click', endCall);

toggleMicBtn.addEventListener('click', () => {
    if (!localStream) {
        console.warn("toggleMicBtn: localStream no disponible.");
        return;
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        toggleMicBtn.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        toggleMicBtn.classList.toggle('active-red', !audioTrack.enabled);
        showMessage(`Micrófono ${audioTrack.enabled ? 'activado' : 'silenciado'}.`, 'info');
        console.log(`Micrófono: ${audioTrack.enabled ? 'activado' : 'silenciado'}.`);
    } else {
        console.warn("toggleMicBtn: No se encontró la pista de audio.");
    }
});

toggleCameraBtn.addEventListener('click', () => {
    if (!localStream) {
        console.warn("toggleCameraBtn: localStream no disponible.");
        return;
    }
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        toggleCameraBtn.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.toggle('active-red', !videoTrack.enabled);
        showMessage(`Cámara ${videoTrack.enabled ? 'activada' : 'desactivada'}.`, 'info');
        console.log(`Cámara: ${videoTrack.enabled ? 'activada' : 'desactivada'}.`);
    } else {
        console.warn("toggleCameraBtn: No se encontró la pista de video.");
    }
});

// Listener para el nuevo botón de compartir pantalla
toggleScreenShareBtn.addEventListener('click', startScreenShare);


// --- LÓGICA DE CHAT P2P ---

function setupDataConnectionListeners(conn) {
    conn.on('open', () => {
        console.log("DataConnection abierta con:", conn.peer);
        showMessage("Chat conectado.", 'success', 2000);
        // Asegúrate de que el chat esté maximizado cuando la conexión se abre
        p2pChatContainer.classList.remove('minimized'); 
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>'; // Icono para minimizar
    });

    conn.on('data', (data) => {
        console.log("Mensaje de chat recibido:", data);
        addChatMessage(data, 'other');
    });

    conn.on('close', () => {
        console.log("DataConnection cerrada.");
        showMessage("Chat desconectado.", 'info', 2000);
        chatMessagesContainer.innerHTML = ''; // Limpiar chat al desconectar
        p2pChatContainer.classList.add('minimized'); // Minimizar chat
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Icono para maximizar
    });

    conn.on('error', (err) => {
        console.error("Error en DataConnection:", err);
        showMessage(`Error en el chat: ${err.message || err}`, 'error', 5000);
    });
}

sendChatMessageBtn.addEventListener('click', sendMessage);
chatMessageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = chatMessageInput.value.trim();
    if (message.length > 0 && dataConnection && dataConnection.open) {
        dataConnection.send(message);
        addChatMessage(message, 'self');
        chatMessageInput.value = ''; // Limpiar el input
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight; // Scroll al final
    } else if (!dataConnection || !dataConnection.open) {
        showMessage("No hay conexión de chat activa.", 'error', 2000);
    }
}

function addChatMessage(message, type) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', type);

    // Regular expression to detect URLs (http/https)
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    // Check for image URLs specifically (common image extensions)
    const imageRegex = /\.(jpeg|jpg|gif|png|webp|bmp)$/i;

    // Replace URLs with clickable links or image tags
    const processedMessage = message.replace(urlRegex, (url) => {
        // Simple validation for URL format
        try {
            new URL(url); // Check if it's a valid URL
            if (imageRegex.test(url)) {
                // It's an image URL, create an <img> tag with a fallback
                return `<img src="${url}" alt="Imagen enviada" onerror="this.onerror=null;this.src='https://placehold.co/150x100/333/fff?text=Imagen+no+cargada';"/>`;
            } else {
                // It's a general URL, create an <a> tag
                return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
            }
        } catch (e) {
            // If it's not a valid URL, return the original text
            return url;
        }
    });

    messageElement.innerHTML = processedMessage;
    chatMessagesContainer.appendChild(messageElement);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight; // Auto-scroll
}

// Toggle chat minimization
toggleChatBtn.addEventListener('click', () => {
    p2pChatContainer.classList.toggle('minimized');
    // Change icon based on state
    if (p2pChatContainer.classList.contains('minimized')) {
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Icono para maximizar
    } else {
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>'; // Icono para minimizar
    }
    // Asegurar que el scroll se resetee al final si se maximiza
    if (!p2pChatContainer.classList.contains('minimized')) {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
});
