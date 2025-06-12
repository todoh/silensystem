import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import TWEEN from 'tween';

// --- CONSTANTES Y GLOBALES ---
const sceneContainer = document.getElementById('scene-container');
const groundSize = 300;
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
// **CORRECCIÓN: Se usa la CDN jsDelivr para la librería principal.**
const FFMPEG_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js';

let scene, camera, renderer, ground, controls, transformControls;
let raycaster, mouse;
let grassTexture;

// --- GESTIÓN DE ESTADO ---
const appState = {
    isRenderingVideo: false,
    placementMode: null,
    selectedObject: null,
    loadedGltfScene: null,
    loadedImageObject: null,
    allObjects: new Map(), // Map<uuid, THREE.Object3D>
    animatedTextures: [], // Texturas de GIF que necesitan actualización
    allAnimations: [], // Array de todas las animaciones de la escena
    animationSetupData: null // { object, startPosition }
};

// --- INICIALIZACIÓN ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    scene.fog = new THREE.Fog(0x333333, 150, 400);

    camera = new THREE.PerspectiveCamera(75, sceneContainer.clientWidth / sceneContainer.clientHeight, 0.1, 1000);
    camera.position.set(0, 40, 80);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sceneContainer.appendChild(renderer.domElement);
    
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; 
    controls.dampingFactor = 0.05;
    controls.target.set(0, 5, 0); 
    
    transformControls = new TransformControls(camera, renderer.domElement);
    scene.add(transformControls);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(50, 50, 30);
    dirLight.castShadow = true;
    scene.add(dirLight);
    
    grassTexture = createGrassTexture();
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, metalness: 0.1, roughness: 0.8 });
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    setupEventListeners();
    ensureFFmpegIsReady(); // Se encarga de cargar y activar el renderizador
    animate();
}

// --- LÓGICA DE LA UI Y DOM ---

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve(script);
        script.onerror = () => reject(new Error(`Error al cargar el script: ${src}`));
        document.head.appendChild(script);
    });
}

async function ensureFFmpegIsReady() {
    const renderBtn = document.getElementById('render-video-btn');
    renderBtn.disabled = true;
    renderBtn.textContent = '📹 Cargando Renderizador...';
    console.log("Intentando cargar la librería FFmpeg dinámicamente...");

    try {
        await loadScript(FFMPEG_URL);
        if (window.FFmpeg) {
            renderBtn.disabled = false;
            renderBtn.textContent = '📹 Renderizar a MP4';
            console.log('¡FFmpeg está listo!');
        } else {
             throw new Error('El script de FFmpeg se cargó pero window.FFmpeg no está definido.');
        }
    } catch (error) {
        console.error('FALLO CRÍTICO AL CARGAR FFMPEG:', error);
        renderBtn.textContent = '❌ Error de Renderizador';
        renderBtn.style.backgroundColor = '#be185d'; // Rojo para indicar error
        await showModal("No se pudo cargar la librería de renderizado. Revisa la consola (F12) para ver los errores. Podría ser un problema de red o un bloqueador de anuncios.");
    }
}

function setupEventListeners() {
    document.querySelectorAll('.btn-base[data-type]').forEach(btn => {
        btn.addEventListener('click', () => setPlacementMode(btn.dataset.type));
    });
    
    document.getElementById('export-btn').addEventListener('click', exportToPNG);
    document.getElementById('render-video-btn').addEventListener('click', renderVideo);
    document.getElementById('gltf-input').addEventListener('change', onGltfFileSelected);
    document.getElementById('image-input').addEventListener('change', onImageFileSelected);

    sceneContainer.addEventListener('pointerdown', onPointerDown, false);
    
    document.getElementById('ground-texture-toggle').addEventListener('change', (e) => {
        ground.material.map = e.target.checked ? grassTexture : null;
        ground.material.color.set(e.target.checked ? 0xffffff : 0x808080);
        ground.material.needsUpdate = true;
    });
    
    document.getElementById('play-btn').addEventListener('click', playAllAnimations);
    document.getElementById('pause-btn').addEventListener('click', pauseAllAnimations);
    document.getElementById('reset-btn').addEventListener('click', resetAllAnimations);

    transformControls.addEventListener('dragging-changed', event => {
        controls.enabled = !event.value;
    });
    
    window.addEventListener('resize', onWindowResize);
}

function updateInspector() {
    const content = document.getElementById('inspector-content');
    const { selectedObject, animationSetupData } = appState;

    if (selectedObject) {
        let animationButtonHTML = '';
        if (!animationSetupData) {
            animationButtonHTML = `<button id="setup-animation-btn" class="btn-base btn-danger mt-2">🎬 Añadir Animación</button>`;
        } else {
            animationButtonHTML = `<button id="set-endpoint-btn" class="btn-base btn-primary mt-2">🏁 Fijar Punto Final</button>`;
        }

        content.innerHTML = `
            <h3 class="font-bold text-lg mb-4">${selectedObject.userData.name}</h3>
            <div class="transform-controls">
                <button id="translate-btn" class="btn-base">Mover</button>
                <button id="rotate-btn" class="btn-base">Rotar</button>
            </div>
            <button id="drop-btn" class="btn-base mt-2">Dejar Caer</button>
            ${animationButtonHTML}
        `;
        document.getElementById('translate-btn').addEventListener('click', () => transformControls.setMode('translate'));
        document.getElementById('rotate-btn').addEventListener('click', () => transformControls.setMode('rotate'));
        document.getElementById('drop-btn').addEventListener('click', () => {
            if(appState.selectedObject) alignObjectToGround(appState.selectedObject);
        });
        
        const setupBtn = document.getElementById('setup-animation-btn');
        if (setupBtn) setupBtn.addEventListener('click', handleAnimationSetup);

        const endpointBtn = document.getElementById('set-endpoint-btn');
        if(endpointBtn) endpointBtn.addEventListener('click', createAnimation);

        const modeBtn = document.getElementById(`${transformControls.mode}-btn`);
        if(modeBtn) modeBtn.classList.add('active');

    } else {
        content.innerHTML = `<p class="text-zinc-400">Selecciona un objeto para editarlo.</p>`;
        appState.animationSetupData = null; 
    }
}

function updateObjectList() {
    const list = document.getElementById('object-list');
    list.innerHTML = '';
    appState.allObjects.forEach(object => {
        const li = document.createElement('li');
        li.id = `obj-${object.uuid}`;
        li.innerHTML = `
            <span data-uuid="${object.uuid}">${object.userData.name}</span>
            <button class="delete-btn" data-uuid="${object.uuid}">X</button>
        `;
        list.appendChild(li);
        
        if (appState.selectedObject && appState.selectedObject.uuid === object.uuid) {
            li.classList.add('selected');
        }

        li.querySelector('span').addEventListener('click', (e) => {
            const objectToFocus = appState.allObjects.get(e.target.dataset.uuid);
            selectObject(objectToFocus);
            focusOnObject(objectToFocus);
        });
        li.querySelector('.delete-btn').addEventListener('click', (e) => removeObject(e.currentTarget.dataset.uuid));
    });
}

// --- MODALES PERSONALIZADOS ---
function showModal(text, { isPrompt = false, defaultValue = '', showOk = true, showCancel = true } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const modalText = document.getElementById('modal-text');
        const modalProgress = document.getElementById('modal-progress');
        const modalInput = document.getElementById('modal-input');
        const okBtn = document.getElementById('modal-ok-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');
        
        modalText.textContent = text;
        modalProgress.textContent = '';
        modalInput.style.display = isPrompt ? 'block' : 'none';
        modalInput.value = defaultValue;
        okBtn.style.display = showOk ? 'block' : 'none';
        cancelBtn.style.display = showCancel ? 'block' : 'none';
        
        modal.style.display = 'flex';

        const onOk = () => {
            cleanup();
            resolve(isPrompt ? modalInput.value : true);
        };
        
        const onCancel = () => {
            cleanup();
            resolve(null);
        };
        
        function cleanup() {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        }
        
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

function updateModalProgress(text) {
     document.getElementById('modal-progress').textContent = text;
}

function hideModal() {
    document.getElementById('custom-modal').style.display = 'none';
}

// --- LÓGICA DE OBJETOS Y ESCENA ---

function setPlacementMode(type) {
    appState.placementMode = type;
    deselectObject();
    document.querySelectorAll('.btn-base[data-type].active').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.btn-base[data-type='${type}']`);
    if (btn) btn.classList.add('active');
}

function placeObject(point) {
    let newObject;
    let objectName = "Objeto";
    switch (appState.placementMode) {
        case 'tree': newObject = createTree(); objectName = "Árbol"; break;
        case 'red_flower': newObject = createFlower(0xff0000); objectName = "Flor Roja"; break;
        case 'yellow_flower': newObject = createFlower(0xffff00); objectName = "Flor Amarilla"; break;
        case 'pyramid': newObject = createPyramid(); objectName = "Pirámide"; break;
        case 'custom_gltf':
            if (appState.loadedGltfScene) {
                newObject = appState.loadedGltfScene.clone(true);
                objectName = appState.loadedGltfScene.userData.name || "Modelo GLB";
            }
            break;
        case 'custom_image':
            if (appState.loadedImageObject) {
                newObject = appState.loadedImageObject.clone();
                objectName = appState.loadedImageObject.userData.name || "Imagen";
            }
            break;
    }
    if (newObject) {
        newObject.position.copy(point);
        alignObjectToGround(newObject);
        scene.add(newObject);
        
        const existingNames = Array.from(appState.allObjects.values()).map(o => o.userData.name);
        let count = 1;
        let finalName = `${objectName} #${count}`;
        while(existingNames.includes(finalName)) {
            count++;
            finalName = `${objectName} #${count}`;
        }
        newObject.userData.name = finalName;
        
        appState.allObjects.set(newObject.uuid, newObject);
        updateObjectList();
        selectObject(newObject);
    }
    appState.placementMode = null;
    document.querySelectorAll('.btn-base[data-type].active').forEach(b => b.classList.remove('active'));
}

function selectObject(object) {
    if (appState.selectedObject === object) return;
    appState.selectedObject = object;
    transformControls.attach(object);
    updateInspector();
    updateObjectList();
}

function deselectObject() {
    if (!appState.selectedObject) return;
    appState.selectedObject = null;
    transformControls.detach();
    updateInspector();
    updateObjectList();
}

function removeObject(uuid) {
    const object = appState.allObjects.get(uuid);
    if (!object) return;

    appState.allAnimations = appState.allAnimations.filter(anim => anim.object.uuid !== uuid);
    updateTimelineUI();

    if (object.isMesh && object.material && object.material.map) {
        const textureIndex = appState.animatedTextures.indexOf(object.material.map);
        if (textureIndex > -1) {
            appState.animatedTextures.splice(textureIndex, 1);
        }
    }
    
    if (appState.selectedObject && appState.selectedObject.uuid === uuid) {
        deselectObject();
    }
    
    scene.remove(object);
    object.traverse(child => {
        if (child.isMesh) {
            child.geometry?.dispose();
            if (child.material) {
                 if (Array.isArray(child.material)) {
                    child.material.forEach(m => { m.map?.dispose(); m.dispose(); });
                } else {
                    child.material.map?.dispose();
                    child.material.dispose();
                }
            }
        }
    });
    appState.allObjects.delete(uuid);
    updateObjectList();
}

// --- SISTEMA DE ANIMACIÓN Y RENDERIZADO ---

async function handleAnimationSetup() {
    if (!appState.selectedObject) return;
    
    appState.animationSetupData = {
        object: appState.selectedObject,
        startPosition: appState.selectedObject.position.clone()
    };

    await showModal("Punto de inicio (A) fijado. Mueve el objeto a su destino (B) y pulsa el botón verde para continuar.");
    updateInspector();
}

async function createAnimation() {
    if (!appState.animationSetupData) return;

    const durationInput = await showModal("Introduce la duración del movimiento en segundos:", { isPrompt: true, defaultValue: "5" });

    if (durationInput === null) {
        appState.animationSetupData = null;
        updateInspector();
        return;
    }

    const duration = parseFloat(durationInput);
    if (isNaN(duration) || duration <= 0) {
        await showModal("Error: Introduce un número válido y positivo.");
        appState.animationSetupData = null;
        updateInspector();
        return;
    }
    
    const endPosition = appState.selectedObject.position.clone();
    const { object, startPosition } = appState.animationSetupData;

    appState.allAnimations.push({ object, startPosition, endPosition, duration });
    
    appState.animationSetupData = null;
    updateInspector();
    updateTimelineUI();
    resetAllAnimations(); 
}

function updateTimelineUI() {
    const tracksContainer = document.getElementById('timeline-tracks');
    tracksContainer.innerHTML = ''; 

    if (appState.allAnimations.length === 0) {
        tracksContainer.innerHTML = `<p class="text-zinc-400 text-sm">Añade una animación.</p>`;
        return;
    }

    appState.allAnimations.forEach((anim, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'animation-track';
        trackElement.textContent = `Anim #${index + 1}: ${anim.object.userData.name} (${anim.duration}s)`;
        tracksContainer.appendChild(trackElement);
    });
}

function playAllAnimations() {
    TWEEN.removeAll();
    
    appState.allAnimations.forEach(anim => {
        anim.object.position.copy(anim.startPosition);
        let currentPos = { ...anim.startPosition };
        new TWEEN.Tween(currentPos)
            .to({ ...anim.endPosition }, anim.duration * 1000)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onUpdate(() => {
                anim.object.position.set(currentPos.x, currentPos.y, currentPos.z);
            })
            .start();
    });
}

function pauseAllAnimations() {
    TWEEN.removeAll();
}

function resetAllAnimations() {
    TWEEN.removeAll();
    appState.allAnimations.forEach(anim => {
        anim.object.position.copy(anim.startPosition);
    });
}

async function renderVideo() {
    if (appState.allAnimations.length === 0) {
        await showModal("No hay animaciones para renderizar. Añade una animación primero.");
        return;
    }
    if (appState.isRenderingVideo) return;

    appState.isRenderingVideo = true;
    document.getElementById('render-video-btn').disabled = true;
    
    showModal("Iniciando renderizado...", { showOk: false, showCancel: false });

    try {
        const { createFFmpeg, fetchFile } = window.FFmpeg;

        const ffmpeg = createFFmpeg({
            log: true,
            // **CORRECCIÓN: Apuntar también el corePath a jsdelivr para consistencia.**
            corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.6/dist/ffmpeg-core.js',
        });
        
        ffmpeg.setLogger(({ type, message }) => {
            updateModalProgress(`[${type}] ${message}`);
            console.log(`[${type}] ${message}`);
        });
        
        updateModalProgress("Cargando ffmpeg-core...");
        await ffmpeg.load();

        const totalDuration = Math.max(...appState.allAnimations.map(a => a.duration), 0);
        const FPS = 30;
        const totalFrames = Math.ceil(totalDuration * FPS);

        TWEEN.removeAll();
        appState.allAnimations.forEach(anim => {
            anim.object.position.copy(anim.startPosition);
            let currentPos = { ...anim.startPosition };
            new TWEEN.Tween(currentPos)
                .to({ ...anim.endPosition }, anim.duration * 1000)
                .easing(TWEEN.Easing.Quadratic.InOut)
                .onUpdate(() => {
                    anim.object.position.set(currentPos.x, currentPos.y, currentPos.z);
                })
                .start(0);
        });

        for (let i = 0; i <= totalFrames; i++) {
            const time = i * (1000 / FPS);
            updateModalProgress(`Capturando fotograma ${i} / ${totalFrames}`);
            
            TWEEN.update(time);
            
            renderer.render(scene, camera);
            const frameDataUrl = renderer.domElement.toDataURL('image/png');
            ffmpeg.FS('writeFile', `frame-${String(i).padStart(5, '0')}.png`, await fetchFile(frameDataUrl));
        }
        
        updateModalProgress("Codificando vídeo con FFMPEG...");
        await ffmpeg.run('-r', String(FPS), '-i', 'frame-%05d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'escena_animada.mp4');
        
        updateModalProgress("Finalizando y preparando descarga...");
        const data = ffmpeg.FS('readFile', 'escena_animada.mp4');
        
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'escena_animada.mp4';
        a.click();
        URL.revokeObjectURL(url);
        
        hideModal();

    } catch (error) {
        console.error("Error durante el renderizado del vídeo:", error);
        await showModal("Ocurrió un error durante el renderizado. Revisa la consola para más detalles.");
    } finally {
        appState.isRenderingVideo = false;
        document.getElementById('render-video-btn').disabled = false;
        resetAllAnimations();
    }
}
        
// --- MANEJADORES DE EVENTOS Y BUCLE PRINCIPAL ---
function onPointerDown(event) {
    if (event.target.tagName !== 'CANVAS' || appState.isRenderingVideo) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (appState.placementMode) {
        const intersects = raycaster.intersectObject(ground);
        if (intersects.length > 0) placeObject(intersects[0].point);
    } else {
        const clickableObjects = Array.from(appState.allObjects.values());
        const intersects = raycaster.intersectObjects(clickableObjects, true);
        if (intersects.length > 0) {
            let objectToSelect = intersects[0].object;
            while (objectToSelect.parent && !appState.allObjects.has(objectToSelect.uuid)) {
                objectToSelect = objectToSelect.parent;
            }
            if (appState.allObjects.has(objectToSelect.uuid)) selectObject(objectToSelect);
        } else if (!transformControls.dragging) {
            deselectObject();
        }
    }
}

function onWindowResize() {
    camera.aspect = sceneContainer.clientWidth / sceneContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update(); 

    if (!appState.isRenderingVideo) {
        TWEEN.update();
    }

    for (const texture of appState.animatedTextures) {
        texture.needsUpdate = true;
    }

    renderer.render(scene, camera);
}

// --- IMPORTACIÓN Y CREACIÓN DE ASSETS ---

function onGltfFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    gltfLoader.load(url, (gltf) => {
        appState.loadedGltfScene = gltf.scene;
        const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;
        appState.loadedGltfScene.userData.name = fileName;
        appState.loadedGltfScene.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
        
        const container = document.getElementById('custom-model-container');
        container.innerHTML = `<button class="btn-base" data-type="custom_gltf">✨ ${fileName}</button>`;
        container.firstElementChild.addEventListener('click', () => setPlacementMode('custom_gltf'));
        URL.revokeObjectURL(url);
    }, undefined, (error) => console.error('Error al cargar GLB.', error));
}

function onImageFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;

    if (file.type === 'image/gif') {
        const canvas = document.createElement('canvas');
        gifler(url).animate(canvas);
        const texture = new THREE.CanvasTexture(canvas);
        appState.animatedTextures.push(texture);

        const tempImg = new Image();
        tempImg.onload = () => {
            const planeHeight = 10;
            const aspectRatio = tempImg.width / tempImg.height;
            canvas.width = tempImg.width;
            canvas.height = tempImg.height;
            const geometry = new THREE.PlaneGeometry(planeHeight * aspectRatio, planeHeight);
            const material = new THREE.MeshStandardMaterial({
                map: texture, transparent: true, side: THREE.DoubleSide, alphaTest: 0.5
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.userData.name = fileName;
            appState.loadedImageObject = mesh;
            
            const container = document.getElementById('custom-image-container');
            container.innerHTML = `<button class="btn-base" data-type="custom_image">🖼️ ${fileName}</button>`;
            container.firstElementChild.addEventListener('click', () => setPlacementMode('custom_image'));
        };
        tempImg.src = url;
    } else {
        textureLoader.load(url, (texture) => {
            const planeHeight = 10;
            const aspectRatio = texture.image.width / texture.image.height;
            const geometry = new THREE.PlaneGeometry(planeHeight * aspectRatio, planeHeight);
            const material = new THREE.MeshStandardMaterial({
                map: texture, transparent: true, side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.userData.name = fileName;
            appState.loadedImageObject = mesh;
            URL.revokeObjectURL(url);
            
            const container = document.getElementById('custom-image-container');
            container.innerHTML = `<button class="btn-base" data-type="custom_image">🖼️ ${fileName}</button>`;
            container.firstElementChild.addEventListener('click', () => setPlacementMode('custom_image'));
        });
    }
}

function alignObjectToGround(object) {
     const box = new THREE.Box3().setFromObject(object);
     const offset = box.min.y;
     object.position.y -= offset;
}

function focusOnObject(object) {
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
}

function exportToPNG() {
    const link = document.createElement('a');
    link.download = 'escena.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
}

// --- Fábricas de Objetos Primitivos y Texturas ---

function createTree() {
    const tree = new THREE.Group();
    const trunkHeight = Math.random() * 4 + 4;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.7, trunkHeight, 8),
        new THREE.MeshStandardMaterial({ color: 0x8B4513 })
    );
    trunk.position.y = trunkHeight / 2;
    const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(Math.random() * 1 + 2.5, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x006400 })
    );
    leaves.position.y = trunkHeight;
    leaves.scale.y = 0.7;
    tree.add(trunk, leaves);
    tree.traverse(child => { if(child.isMesh) child.castShadow = true; });
    return tree;
}

function createFlower(color) {
    const flower = new THREE.Group();
    const stemHeight = Math.random() * 0.4 + 0.2;
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, stemHeight, 5),
        new THREE.MeshStandardMaterial({ color: 0x008000 })
    );
    stem.position.y = stemHeight / 2;
    const petals = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.1, 0),
        new THREE.MeshStandardMaterial({ color: color || 0xff0000 })
    );
    petals.position.y = stemHeight;
    flower.add(stem, petals);
    flower.traverse(child => { if(child.isMesh) child.castShadow = true; });
    return flower;
}

function createPyramid() {
    const pyramid = new THREE.Mesh(
        new THREE.ConeGeometry(5, 8, 4),
        new THREE.MeshStandardMaterial({ map: createBrickTexture() })
    );
    pyramid.castShadow = true;
    return pyramid;
}

function createBrickTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#A9A9A9'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#696969'; ctx.lineWidth = 4;
    for (let y = 0; y < 256; y += 32) {
        for (let x = 0; x < 256; x += 64) {
            const offsetX = (y / 32) % 2 === 0 ? 0 : -32;
            ctx.fillStyle = '#B22222';
            ctx.fillRect(x + offsetX, y, 62, 30);
            ctx.strokeRect(x + offsetX, y, 62, 30);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
}

function createGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2E6930'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const height = Math.random() * 5 + 2;
        ctx.fillStyle = Math.random() < 0.5 ? '#38803A' : '#255227';
        ctx.fillRect(x, y, 1, height);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(32, 32);
    return texture;
}

// --- INICIAR APLICACIÓN ---
init();
