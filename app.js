import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getFirestore, collection, doc, setDoc, getDoc, onSnapshot,
    updateDoc, arrayUnion, arrayRemove, serverTimestamp,
    query, where
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
    getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup
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

// --- INITIALIZE SERVICES ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider(); // Google Auth Provider instance

// --- DOM REFERENCES ---
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const videoCallScreen = document.getElementById('video-call-screen');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const currentUsernameSpan = document.getElementById('current-username');
const allUsersList = document.getElementById('all-users-list');
const friendsList = document.getElementById('friends-list');
const friendRequestsList = document.getElementById('friend-requests-list');

// Video Call UI Elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleCameraBtn = document.getElementById('toggle-camera-btn');
const toggleScreenShareBtn = document.getElementById('toggle-screen-share-btn');
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

// --- GLOBAL STATE VARIABLES ---
let currentUser = null;
let peer = null;
let localStream = null;
let currentCall = null;
let incomingCallData = null;
let userUnsubscribe = null;
let usersUnsubscribe = null;
let callsUnsubscribe = null;
let dataConnection = null; // Variable for PeerJS data connection
let isSharingScreen = false; // New state to control screen sharing

let peerInitAttempts = 0;
const MAX_PEER_INIT_ATTEMPTS = 5;

// --- SCREEN MANAGEMENT FUNCTIONS ---
function showScreen(screen) {
    loginScreen.classList.remove('active');
    mainScreen.classList.remove('active');
    videoCallScreen.classList.remove('active');
    screen.classList.add('active');
}

// --- FUNCTION TO SHOW TEMPORARY MESSAGES (replaces alert) ---
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

// --- AUTHENTICATION AND USER LOGIC ---

// Event handler for Google login button
googleLoginBtn.addEventListener('click', async () => {
    try {
        // Sign in with Google popup
        console.log("Attempting Google Sign-In...");
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        console.log("Google user authenticated. UID:", user.uid, "Display Name:", user.displayName);

        // The onAuthStateChanged listener will handle creating/updating the user profile in Firestore
        // and navigating to the main screen.
        showMessage(`¡Bienvenido, ${user.displayName}!`, 'success');

    } catch (error) {
        console.error("Error during Google Sign-In:", error);
        // Handle specific errors like popup closed by user
        if (error.code === 'auth/popup-closed-by-user') {
            showMessage("El inicio de sesión fue cancelado.", 'info');
        } else {
            showMessage("No se pudo iniciar sesión con Google. Inténtalo de nuevo.", 'error');
        }
    }
});


logoutBtn.addEventListener('click', async () => {
    try {
        if (currentUser) {
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, { isOnline: false, lastSeen: serverTimestamp() });
            console.log("Online status updated to offline.");
        }
        await auth.signOut(); // Use auth.signOut() to log out
        cleanUp();
        showScreen(loginScreen);
        showMessage("Sesión cerrada correctamente.", 'info');
    } catch (error) {
        console.error("Error logging out:", error);
        showMessage("Error al cerrar sesión. Inténtalo de nuevo.", 'error');
    }
});

// onAuthStateChanged will trigger every time the authentication state changes
onAuthStateChanged(auth, async (user) => {
    console.log("onAuthStateChanged triggered. Initial user object:", user);

    if (user) {
        // User logged in (Google user)
        currentUser = { uid: user.uid }; // Initialize currentUser with UID for the first query
        console.log("User detected. UID:", user.uid);

        // Get user profile from Firestore
        const userRef = doc(db, 'users', user.uid);
        try {
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                // If the document exists, update currentUser with Firestore data
                currentUser = userDoc.data();
                console.log("User profile loaded from Firestore:", currentUser.username);
                // Update username and online status if necessary
                if (currentUser.username !== user.displayName || currentUser.isOnline !== true) {
                    await updateDoc(userRef, { username: user.displayName, isOnline: true, lastSeen: serverTimestamp() });
                    currentUser.username = user.displayName; // Update local object
                    currentUser.isOnline = true;
                    console.log("Username and online status updated in Firestore and locally.");
                }
            } else {
                // This will happen for new Google users
                const username = user.displayName || user.email || `User_${user.uid.substring(0, 5)}`; // Fallback for username
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
                    lastSeen: new Date(), // Use new Date() since serverTimestamp() is async
                    friends: [],
                    friendRequests: []
                };
                showMessage(`Welcome, ${username}!`, 'success');
                console.log("New Google user profile created in Firestore.");
            }
            initializeAppData(currentUser.uid);
            showScreen(mainScreen);

        } catch (firestoreError) {
            console.error("Error interacting with Firestore in onAuthStateChanged:", firestoreError);
            showMessage(`Error loading/creating user profile: ${firestoreError.message}.`, 'error', 7000);
            await auth.signOut(); // Force logout in case of serious error
            cleanUp();
            showScreen(loginScreen);
        }
    } else {
        // No authenticated user (after logout or first page load)
        console.log("No authenticated user. Showing login screen.");
        cleanUp();
        showScreen(loginScreen);
    }
});


function cleanUp() {
    if (userUnsubscribe) { userUnsubscribe(); console.log("userUnsubscribe deactivated."); }
    if (usersUnsubscribe) { usersUnsubscribe(); console.log("usersUnsubscribe deactivated."); }
    if (callsUnsubscribe) { callsUnsubscribe(); console.log("callsUnsubscribe deactivated."); }

    if (peer) { 
        if (dataConnection) {
            dataConnection.close();
            dataConnection = null;
            console.log("PeerJS DataConnection closed.");
        }
        peer.destroy(); 
        peer = null; // Ensure peer is null after destroy
        console.log("PeerJS destroyed."); 
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null; // Ensure localStream is null after stopping
        console.log("Local stream stopped.");
    }

    currentUser = null;
    currentCall = null;
    incomingCallData = null; // Clear incoming call data
    isSharingScreen = false; // Reset screen sharing state

    allUsersList.innerHTML = '';
    friendsList.innerHTML = '';
    friendRequestsList.innerHTML = '';
    chatMessagesContainer.innerHTML = ''; // Clear chat messages
    p2pChatContainer.classList.add('minimized'); // Minimize chat on cleanup
    toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Reset chat toggle icon to up
    console.log("Application state cleaned up.");

    // Reset peer initialization attempts
    peerInitAttempts = 0;
}

// --- MAIN APPLICATION LOGIC ---

async function initializeAppData(uid) {
    console.log("initializeAppData: Starting for UID:", uid);
    const userRef = doc(db, 'users', uid);

    userUnsubscribe = onSnapshot(userRef, (doc) => {
        console.log("onSnapshot userRef: currentUser data updated.");
        currentUser = doc.data();
        if (currentUser) {
            currentUsernameSpan.textContent = currentUser.username;
            renderFriendRequests(currentUser.friendRequests || []);
            initializePeerConnection(); // Initialize PeerJS here
            listenForIncomingCalls();
        } else {
            console.warn("onSnapshot userRef: currentUser is null or undefined. This should not happen if the user is authenticated.");
            cleanUp(); // Something went wrong, force logout.
            showScreen(loginScreen);
        }
    }, (error) => {
        console.error("Error in onSnapshot of currentUser:", error);
        showMessage("Error al cargar tu perfil de usuario. Intenta recargar.", 'error', 5000);
        cleanUp();
        showScreen(loginScreen);
    });

    const usersQuery = collection(db, 'users');
    usersUnsubscribe = onSnapshot(usersQuery, (snapshot) => {
        console.log("onSnapshot usersQuery: Updating all users list.");
        const allUsers = [];
        snapshot.forEach(doc => allUsers.push(doc.data()));
        renderAllUsers(allUsers);
        renderFriends(allUsers);
    }, (error) => {
        console.error("Error in onSnapshot of allUsers:", error);
        showMessage("Error al cargar la lista de usuarios.", 'error', 5000);
    });
}

function renderAllUsers(users) {
    allUsersList.innerHTML = '';
    // Filter to only show online users, excluding the current user
    const onlineUsers = users.filter(user => user.isOnline && user.uid !== currentUser.uid);

    onlineUsers.forEach(user => {
        const isFriend = currentUser.friends.some(f => f.uid === user.uid);
        const hasSentRequest = (user.friendRequests || []).some(req => req.uid === currentUser.uid); // Check if *they* have sent a request to *me*

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
        console.warn("renderFriends: currentUser is null, cannot render friends.");
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
        showMessage('Friend request sent.', 'success');
    } catch (error) {
        console.error("Error sending friend request:", error);
        showMessage("Could not send friend request.", 'error');
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
        showMessage(`You are now friends with ${username}!`, 'success');
    } catch (error) {
        console.error("Error accepting friend request:", error);
        showMessage("Could not accept friend request.", 'error');
    }
}

async function declineFriendRequest({uid, username}) {
    const userRef = doc(db, 'users', currentUser.uid);
    try {
        await updateDoc(userRef, {
            friendRequests: arrayRemove({ uid, username })
        });
        showMessage(`Request from ${username} declined.`, 'info');
    } catch (error) {
        console.error("Error declining friend request:", error);
        showMessage("Could not decline friend request.", 'error');
    }
}

function initializePeerConnection() {
    if (!currentUser || !currentUser.uid) {
        console.warn("initializePeerConnection: currentUser or currentUser.uid is null, cannot initialize PeerJS.");
        return;
    }

    // If PeerJS is already initialized with the correct ID, just ensure data connection state.
    if (peer && peer.id && peer.id.startsWith(currentUser.uid)) {
        console.log("PeerJS already initialized for current UID. Reusing.");
        if (dataConnection && dataConnection.open) {
            p2pChatContainer.classList.remove('minimized');
            toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
        }
        return;
    }

    // Destroy existing peer connection if it's there but not properly set up
    if (peer) {
        peer.destroy();
        peer = null;
        console.log("Existing PeerJS destroyed to reinitialize.");
    }

    peerInitAttempts++;
    if (peerInitAttempts > MAX_PEER_INIT_ATTEMPTS) {
        console.error("Max PeerJS initialization attempts reached. Please check browser settings or reload.");
        showMessage("Could not connect to video server. Please check your browser's ad-blocker or try reloading the page.", 'error', 10000);
        return;
    }

    // Create a unique Peer ID by appending a random string to the UID
    const peerId = currentUser.uid + '-' + Math.random().toString(36).substring(2, 8);
    
    peer = new Peer(peerId);
    console.log(`PeerJS: Attempting to connect with ID: ${peerId} (Attempt ${peerInitAttempts})`);

    peer.on('open', id => {
        console.log('PeerJS connected with ID:', id);
        peerInitAttempts = 0; // Reset attempts on successful connection
    });

    peer.on('call', call => {
        console.log("PeerJS: Incoming call detected.", call);
        currentCall = call;
        showScreen(videoCallScreen);

        // Try to get local stream BEFORE answering the call
        startLocalStream().then(streamStarted => {
            if (streamStarted) {
                call.answer(localStream); // Answer the call with the local stream
                console.log("PeerJS: Call answered with local stream.");
            } else {
                console.error("PeerJS: Could not start local stream to answer the call.");
                showMessage("Could not answer the call: camera/microphone not available.", 'error');
                call.close(); // Close the P2P call if cannot answer
                endCall(); // End the call in the UI
                return;
            }
        });

        call.on('stream', remoteStream => { 
            remoteVideo.srcObject = remoteStream;
            console.log("PeerJS: Remote stream received.");
        });
        call.on('close', () => {
            console.log("PeerJS: Video call closed.");
            endCall();
        });
        call.on('error', err => {
            console.error("PeerJS: Error in incoming call:", err);
            showMessage(`Error during incoming call: ${err.message || err}`, 'error', 5000);
            endCall();
        });
        showMessage("Call in progress...", 'info');
    });

    // Handle incoming data connections for chat
    peer.on('connection', (conn) => {
        console.log("PeerJS: Incoming data connection:", conn.peer);
        // Close any previous data connection before establishing a new one
        if (dataConnection && dataConnection.open) {
            dataConnection.close();
            console.log("Previous DataConnection closed to accept a new one.");
        }
        dataConnection = conn;
        setupDataConnectionListeners(dataConnection);
    });

    peer.on('error', err => {
        console.error("PeerJS Error:", err);
        // Specifically handle "ID taken" error (eW) or other connection issues
        if (err.type === 'peer-unavailable' || err.type === 'disconnected' || err.type === 'network' || err.type === 'browser-incompatible' || err.type === 'unavailable' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'eW') {
             console.warn(`PeerJS error of type ${err.type}. Retrying initialization...`);
             showMessage(`Connection error (PeerJS): ${err.message || err}. Retrying...`, 'warning', 3000);
             setTimeout(initializePeerConnection, 2000); // Retry after 2 seconds
        } else {
            showMessage(`Connection error (PeerJS): ${err.message || err}`, 'error', 5000);
            cleanUp(); // Force cleanUp if a severe error occurs
            showScreen(loginScreen);
        }
    });
}

async function startLocalStream() {
    try {
        // Stop any existing local stream (camera or screen)
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            console.log("Stopping existing local stream.");
        }
        isSharingScreen = false; // Reset screen sharing state

        // Check if elements exist before attempting to modify them (important for hidden UI)
        if (toggleScreenShareBtn) toggleScreenShareBtn.classList.remove('active-red'); // Deactivate the button
        
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideo) localVideo.srcObject = localStream;
        console.log("Local stream (camera/microphone) started successfully.");
        return true;
    }
    catch (err) {
        console.error("Error getting local stream (camera/microphone):", err);
        showMessage("Could not access camera or microphone. Make sure to grant permissions and that they are not in use by another application.", 'error', 5000);
        return false;
    }
}

async function startScreenShare() {
    try {
        // If already sharing screen, stop it
        if (isSharingScreen && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // Go back to camera
            if (localVideo) localVideo.srcObject = localStream;
            if (currentCall && currentCall.localStream) { // Check if currentCall and localStream exist on the call object
                currentCall.replaceTrack(
                    currentCall.localStream.getVideoTracks()[0],
                    localStream.getVideoTracks()[0],
                    currentCall.localStream
                );
            }
            isSharingScreen = false;
            if (toggleScreenShareBtn) toggleScreenShareBtn.classList.remove('active-red');
            showMessage("Screen sharing stopped. Returning to camera.", 'info');
            return;
        }

        // If there is already an active camera stream, stop it before sharing screen
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        localStream = screenStream; // Update local stream to screen
        if (localVideo) localVideo.srcObject = localStream;

        // If there is an active call, replace the video track
        if (currentCall && currentCall.localStream) {
            const videoTrack = currentCall.localStream.getVideoTracks()[0];
            const newVideoTrack = screenStream.getVideoTracks()[0];
            if (videoTrack && newVideoTrack) {
                currentCall.replaceTrack(videoTrack, newVideoTrack, currentCall.localStream);
                console.log("Video track replaced by screen stream.");
            } else {
                console.warn("Could not replace video track in active call.");
            }
        }

        isSharingScreen = true;
        if (toggleScreenShareBtn) toggleScreenShareBtn.classList.add('active-red');
        showMessage("You are sharing your screen.", 'success');

        // Listen if the user stops sharing via the browser
        localStream.getVideoTracks()[0].onended = () => {
            console.log("Screen sharing stopped by the user.");
            startLocalStream(); // Go back to camera when sharing ends
        };

    } catch (err) {
        console.error("Error starting screen sharing:", err);
        showMessage("Could not share screen. Make sure to grant permissions.", 'error', 5000);
        // If there's an error, try to go back to camera if we weren't already sharing.
        if (!isSharingScreen) {
             startLocalStream();
        }
    }
}


async function initiateCall(recipientUid, recipientUsername) {
    if (!currentUser) {
        showMessage("You are not logged in to initiate a call.", 'error');
        return;
    }
    // Pre-check to avoid calling oneself (although Firestore rules already prevent this)
    if (recipientUid === currentUser.uid) {
        showMessage("You cannot call yourself.", 'info');
        return;
    }

    // Start local stream (camera/microphone) before any call or Firestore operations
    // This ensures there's always a base stream, even if screen isn't shared initially.
    if (!await startLocalStream()) {
        console.warn("Could not start local stream for the call.");
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
        console.log("Call document created in Firestore:", callRef.id);
    } catch (firestoreError) {
        console.error("Error creating call document in Firestore:", firestoreError);
        showMessage(`Error starting call: ${firestoreError.message}.`, 'error');
        endCall(); // Ensure cleanup if call creation fails
        return;
    }

    // Start PeerJS video call with the current localStream
    currentCall = peer.call(recipientUid, localStream);
    showScreen(videoCallScreen);
    showMessage(`Calling ${recipientUsername}...`, 'info');

    currentCall.on('stream', remoteStream => { 
        if (remoteVideo) remoteVideo.srcObject = remoteStream; 
        console.log("Remote stream received during outgoing call.");
    });
    currentCall.on('close', () => {
        console.log("Outgoing call closed.");
        endCall();
    });
    currentCall.on('error', err => {
        console.error("Error in P2P call (outgoing):", err);
        showMessage(`Error during call: ${err.message || err}`, 'error', 5000);
        endCall();
    });

    // Start data connection for chat (if not already active)
    // Close any previous data connection if it exists and is different
    if (dataConnection && dataConnection.peer !== recipientUid) {
        dataConnection.close();
        dataConnection = null;
        console.log("Previous DataConnection closed when initiating a new call.");
    }
    // Establish a new data connection if it doesn't exist or if it's for a new recipient
    if (!dataConnection || dataConnection.peer !== recipientUid || !dataConnection.open) {
        dataConnection = peer.connect(recipientUid);
        setupDataConnectionListeners(dataConnection);
        console.log("PeerJS: Attempting to connect dataConnection with:", recipientUid);
    } else {
        console.log("DataConnection already exists and is open with the current recipient. Reusing.");
        p2pChatContainer.classList.remove('minimized'); // Maximize chat if there's already a connection
        toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
}

function listenForIncomingCalls() {
    if (callsUnsubscribe) { callsUnsubscribe(); console.log("callsUnsubscribe (incoming) deactivated."); }
    if (!currentUser) {
        console.warn("listenForIncomingCalls: currentUser is null, cannot listen for incoming calls.");
        return;
    }

    const q = collection(db, "calls");
    const qFiltered = query(q, where("recipientId", "==", currentUser.uid), where("status", "==", "ringing"));

    console.log("Listening for incoming calls for UID:", currentUser.uid);
    callsUnsubscribe = onSnapshot(qFiltered, (snapshot) => {
        if (!snapshot.empty) {
            const callDoc = snapshot.docs[0];
            incomingCallData = { id: callDoc.id, ...callDoc.data() };
            if (callerNameSpan) callerNameSpan.textContent = incomingCallData.callerName;
            if (incomingCallModal) incomingCallModal.classList.add('active');
            showMessage(`Incoming call from ${incomingCallData.callerName}!`, 'info', 4000);
            console.log("Incoming call detected:", incomingCallData.callerName);
        } else {
            if (incomingCallModal) incomingCallModal.classList.remove('active');
            // Only clear incomingCallData if the modal was active to avoid premature clearing
            if (incomingCallData) {
                console.log("No active incoming calls, closing modal if it was open.");
                incomingCallData = null;
            }
        }
    }, (error) => {
        console.error("Error listening for incoming calls:", error);
        showMessage("There was a problem detecting incoming calls.", 'error', 5000);
        // Do not force logout here, it's just a listening issue.
    });
}

if (acceptCallBtn) {
    acceptCallBtn.addEventListener('click', async () => {
        if (!incomingCallData) {
            console.warn("acceptCallBtn: No incoming call data to accept.");
            return;
        }
        if (!await startLocalStream()) {
            console.warn("Could not start local stream to accept the call.");
            if (incomingCallData) {
                const callRef = doc(db, 'calls', incomingCallData.id);
                try {
                    await updateDoc(callRef, { status: 'failed_accept' });
                    console.log("Call status updated to 'failed_accept' due to stream failure.");
                } catch (updateErr) {
                    console.error("Error updating call status to failed_accept:", updateErr);
                }
                incomingCallData = null;
            }
            if (incomingCallModal) incomingCallModal.classList.remove('active');
            return;
        }

        if (incomingCallModal) incomingCallModal.classList.remove('active');
        const callRef = doc(db, 'calls', incomingCallData.id);
        try {
            await updateDoc(callRef, { status: 'answered' });
            console.log("Call status updated to 'answered'.");
        } catch (error) {
            console.error("Error updating call status to 'answered':", error);
            showMessage("Error accepting the call in the database.", 'error');
        }
        showMessage("Call accepted.", 'success');
        // The PeerJS logic to answer the call is already handled in peer.on('call')
        // We don't need to call peer.call() here, as the call was already initiated by the caller
        // and our peer.on('call') is answering it.

        // Attempt to establish data connection for chat with the caller
        if (!dataConnection || dataConnection.peer !== incomingCallData.callerId || !dataConnection.open) {
            dataConnection = peer.connect(incomingCallData.callerId);
            setupDataConnectionListeners(dataConnection);
            console.log("PeerJS: Attempting to connect dataConnection with caller:", incomingCallData.callerId);
        } else {
            console.log("DataConnection already exists and is open with the caller. Reusing.");
            if (p2pChatContainer) p2pChatContainer.classList.remove('minimized'); // Maximize chat if already connected
            if (toggleChatBtn) toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
        }
    });
}


if (declineCallBtn) {
    declineCallBtn.addEventListener('click', async () => {
        if (!incomingCallData) {
            console.warn("declineCallBtn: No incoming call data to decline.");
            return;
        }
        if (incomingCallModal) incomingCallModal.classList.remove('active');
        const callRef = doc(db, 'calls', incomingCallData.id);
        try {
            await updateDoc(callRef, { status: 'declined' });
            console.log("Call status updated to 'declined'.");
        } catch (error) {
            console.error("Error updating call status to 'declined':", error);
            showMessage("Could not decline the call in the database.", 'error');
        }
        incomingCallData = null;
        showMessage("Call declined.", 'info');
    });
}

async function endCall() {
    if (currentCall) {
        currentCall.close();
        console.log("currentCall closed.");
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        console.log("localStream stopped.");
    }
    if (dataConnection) {
        dataConnection.close();
        dataConnection = null;
        console.log("PeerJS DataConnection closed.");
    }

    if (remoteVideo) remoteVideo.srcObject = null;
    if (localVideo) localVideo.srcObject = null;
    currentCall = null;
    incomingCallData = null; // Clear incoming call data
    isSharingScreen = false; // Reset screen sharing state
    if (toggleScreenShareBtn) toggleScreenShareBtn.classList.remove('active-red'); // Deactivate the button

    if (chatMessagesContainer) chatMessagesContainer.innerHTML = ''; // Clear chat messages
    if (p2pChatContainer) p2pChatContainer.classList.add('minimized'); // Minimize chat
    if (toggleChatBtn) toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Reset chat toggle icon to up
    
    showScreen(mainScreen);
    showMessage("Call ended.", 'info');
    console.log("endCall function completed.");
}

if (endCallBtn) endCallBtn.addEventListener('click', endCall);

if (toggleMicBtn) {
    toggleMicBtn.addEventListener('click', () => {
        if (!localStream) {
            console.warn("toggleMicBtn: localStream not available.");
            return;
        }
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleMicBtn.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
            toggleMicBtn.classList.toggle('active-red', !audioTrack.enabled);
            showMessage(`Microphone ${audioTrack.enabled ? 'activated' : 'muted'}.`, 'info');
            console.log(`Microphone: ${audioTrack.enabled ? 'activated' : 'muted'}.`);
        } else {
            console.warn("toggleMicBtn: Audio track not found.");
        }
    });
}

if (toggleCameraBtn) {
    toggleCameraBtn.addEventListener('click', () => {
        if (!localStream) {
            console.warn("toggleCameraBtn: localStream not available.");
            return;
        }
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleCameraBtn.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
            toggleCameraBtn.classList.toggle('active-red', !videoTrack.enabled);
            showMessage(`Camera ${videoTrack.enabled ? 'activated' : 'deactivated'}.`, 'info');
            console.log(`Camera: ${videoTrack.enabled ? 'activated' : 'deactivated'}.`);
        } else {
            console.warn("toggleCameraBtn: Video track not found.");
        }
    });
}

// Listener for the new screen share button
if (toggleScreenShareBtn) toggleScreenShareBtn.addEventListener('click', startScreenShare);


// --- P2P CHAT LOGIC ---

function setupDataConnectionListeners(conn) {
    conn.on('open', () => {
        console.log("DataConnection opened with:", conn.peer);
        showMessage("Chat connected.", 'success', 2000);
        // Ensure chat is maximized when connection opens
        if (p2pChatContainer) p2pChatContainer.classList.remove('minimized'); 
        if (toggleChatBtn) toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>'; // Icon to minimize
    });

    conn.on('data', (data) => {
        console.log("Chat message received:", data);
        addChatMessage(data, 'other');
    });

    conn.on('close', () => {
        console.log("DataConnection closed.");
        showMessage("Chat disconnected.", 'info', 2000);
        if (chatMessagesContainer) chatMessagesContainer.innerHTML = ''; // Clear chat on disconnect
        if (p2pChatContainer) p2pChatContainer.classList.add('minimized'); // Minimize chat
        if (toggleChatBtn) toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Icon to maximize
    });

    conn.on('error', (err) => {
        console.error("Error in DataConnection:", err);
        showMessage(`Chat error: ${err.message || err}`, 'error', 5000);
    });
}

if (sendChatMessageBtn) sendChatMessageBtn.addEventListener('click', sendMessage);
if (chatMessageInput) {
    chatMessageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
}

function sendMessage() {
    const message = chatMessageInput.value.trim();
    if (message.length > 0 && dataConnection && dataConnection.open) {
        dataConnection.send(message);
        addChatMessage(message, 'self');
        if (chatMessageInput) chatMessageInput.value = ''; // Clear input
        if (chatMessagesContainer) chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight; // Scroll to bottom
    } else if (!dataConnection || !dataConnection.open) {
        showMessage("No active chat connection.", 'error', 2000);
    }
}

function addChatMessage(message, type) {
    if (!chatMessagesContainer) {
        console.warn("addChatMessage: chatMessagesContainer is null.");
        return;
    }
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
if (toggleChatBtn) {
    toggleChatBtn.addEventListener('click', () => {
        if (p2pChatContainer) {
            p2pChatContainer.classList.toggle('minimized');
            // Change icon based on state
            if (p2pChatContainer.classList.contains('minimized')) {
                toggleChatBtn.innerHTML = '<i class="fas fa-chevron-up"></i>'; // Icon to maximize
            } else {
                toggleChatBtn.innerHTML = '<i class="fas fa-chevron-down"></i>'; // Icon to minimize
            }
            // Ensure scroll is reset to the bottom if maximized
            if (!p2pChatContainer.classList.contains('minimized')) {
                if (chatMessagesContainer) chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
            }
        }
    });
}
