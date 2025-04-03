import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gameState, addChatMessage } from '/gameLogic.js'; // Import gameState and addChatMessage

// --- Three.js Variables ---
let scene, camera, renderer, controls;
const textureLoader = new THREE.TextureLoader();
const roomCache = new Map(); // Cache generated room meshes { roomId: THREE.Group }
const npcMeshes = new Map(); // Cache generated NPC meshes { npcId: THREE.Mesh }
let loadingOverlay, loadingText;

// Simple promise-based delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const GENERATION_DELAY = 4000; // 4 seconds between major generation steps (textures, objects)

// --- Initialization ---
export function initThreeScene(initialPlayerPos) {
    const viewport = document.getElementById('viewport');
    if (!viewport) {
        console.error("Viewport element not found!");
        return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2d2d2d);

    camera = new THREE.PerspectiveCamera(75, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
    camera.position.set(initialPlayerPos.x, initialPlayerPos.y, initialPlayerPos.z);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.appendChild(renderer.domElement);

    // Add loading overlay
    loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.className = 'hidden'; // Start hidden
    loadingText = document.createElement('span');
    loadingOverlay.appendChild(loadingText);
    viewport.appendChild(loadingOverlay); // Append to viewport

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1; // Slightly faster damping
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 20; // Reduced max distance for room focus
    controls.maxPolarAngle = Math.PI / 1.8; // Adjust viewing angle
    controls.target.set(0, 1, 0); // Initial target

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    if (!camera || !renderer || !viewport) return;
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

// --- Loading Indicator ---
function showLoading(message) {
    if (!loadingOverlay || !loadingText) return;
    loadingText.textContent = message;
    loadingOverlay.classList.remove('hidden');
    console.log("Loading:", message); // Log to console as well
}

function hideLoading() {
    if (!loadingOverlay) return;
    loadingOverlay.classList.add('hidden');
}

// --- Room Visuals ---

async function generateTexture(prompt, size = 1024) {
    addChatMessage(`Generating texture: ${prompt.split(':')[1].trim()}...`, 'system-message');
    try {
        const result = await websim.imageGen({
            prompt: `Seamless, tileable texture for a fantasy MUD. Style: retro 3D, low-poly aesthetic, slightly pixelated but clear. ${prompt}`,
            width: size,
            height: size,
        });
        const texture = await textureLoader.loadAsync(result.url);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
    } catch (error) {
        console.error("Texture Generation Error:", error);
        addChatMessage(`Failed to generate texture. Using default.`, 'error-message');
        // Return a default placeholder texture (e.g., simple color)
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#555'; // Default grey
        ctx.fillRect(0, 0, 64, 64);
        ctx.strokeStyle = '#777';
        ctx.strokeRect(0, 0, 64, 64);
        const defaultTexture = new THREE.CanvasTexture(canvas);
        defaultTexture.wrapS = THREE.RepeatWrapping;
        defaultTexture.wrapT = THREE.RepeatWrapping;
        return defaultTexture;
    }
}

async function generateObjectDescriptions(roomDescription) {
    addChatMessage("Imagining objects for the room...", 'system-message');
    try {
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Based on the MUD room description, list 2-4 simple, distinct objects commonly found in such a setting. Respond DIRECTLY with a JSON array of objects, each with 'name' (string, e.g., "wooden table"), 'description' (string, brief visual detail), and 'placement' (string, one of: 'center', 'wall', 'corner', 'random'). Example: [{"name": "torch", "description": "flickering wall torch", "placement": "wall"}] Follow this JSON schema: Array<{name: string, description: string, placement: string}>`
                 },
                { role: "user", content: roomDescription }
            ],
            json: true,
        });
        const result = JSON.parse(completion.content);
        if (!Array.isArray(result)) {
            console.warn("LLM did not return a valid object array, returning empty.");
            return [];
        }
        addChatMessage(`Identified objects: ${result.map(o=>o.name).join(', ')}.`, 'system-message');
        return result;
    } catch (error) {
        console.error("Object Description Error:", error);
        addChatMessage("Failed to imagine objects.", 'error-message');
        return [];
    }
}

// Placeholder geometry function - replace with LLM later if desired
function createPlaceholderGeometry(objectName) {
    const nameLower = objectName.toLowerCase();
    if (nameLower.includes('table') || nameLower.includes('counter') || nameLower.includes('stall')) return new THREE.BoxGeometry(2, 1, 1.5);
    if (nameLower.includes('chair') || nameLower.includes('stool')) return new THREE.BoxGeometry(0.6, 1.2, 0.6);
    if (nameLower.includes('barrel') || nameLower.includes('pot') || nameLower.includes('sack')) return new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    if (nameLower.includes('torch') || nameLower.includes('sign')) return new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6);
    if (nameLower.includes('chest') || nameLower.includes('crate')) return new THREE.BoxGeometry(1, 0.8, 0.8);
    if (nameLower.includes('fountain')) return new THREE.CylinderGeometry(1.5, 1.5, 0.5, 12);
    return new THREE.SphereGeometry(0.5, 8, 6); // Default sphere
}

function calculateObjectPosition(placement, roomSize) {
    const margin = 2; // Keep objects away from walls unless specified
    const halfWidth = roomSize.width / 2 - margin;
    const halfDepth = roomSize.depth / 2 - margin;
    const yPos = 0.5; // Base position roughly on floor

    switch (placement) {
        case 'center':
            return new THREE.Vector3(0, yPos, 0);
        case 'wall':
            const side = Math.floor(Math.random() * 4);
            if (side === 0) return new THREE.Vector3(Math.random() * roomSize.width * 0.8 - halfWidth, yPos, halfDepth - 0.1); // +Z wall
            if (side === 1) return new THREE.Vector3(Math.random() * roomSize.width * 0.8 - halfWidth, yPos, -halfDepth + 0.1); // -Z wall
            if (side === 2) return new THREE.Vector3(halfWidth - 0.1, yPos, Math.random() * roomSize.depth * 0.8 - halfDepth); // +X wall
            return new THREE.Vector3(-halfWidth + 0.1, yPos, Math.random() * roomSize.depth * 0.8 - halfDepth); // -X wall
        case 'corner':
            const corner = Math.floor(Math.random() * 4);
            if (corner === 0) return new THREE.Vector3(halfWidth - margin/2, yPos, halfDepth - margin/2); // +X +Z
            if (corner === 1) return new THREE.Vector3(-halfWidth + margin/2, yPos, halfDepth - margin/2); // -X +Z
            if (corner === 2) return new THREE.Vector3(halfWidth - margin/2, yPos, -halfDepth + margin/2); // +X -Z
            return new THREE.Vector3(-halfWidth + margin/2, yPos, -halfDepth + margin/2); // -X -Z
        case 'random':
        default:
            return new THREE.Vector3(
                (Math.random() - 0.5) * (roomSize.width - margin * 2),
                yPos,
                (Math.random() - 0.5) * (roomSize.depth - margin * 2)
            );
    }
}


async function createDetailedRoomVisuals(roomId) {
    const roomData = gameState.rooms[roomId];
    if (!roomData) return null;

    showLoading(`Generating room: ${roomId}...`);
    const roomGroup = new THREE.Group();
    roomGroup.name = `RoomGroup_${roomId}`;

    const roomSize = { width: 25, height: 15, depth: 25 }; // Slightly smaller default room size

    // 1. Generate Textures (with delay)
    showLoading(`Generating floor texture for ${roomId}...`);
    const floorTexture = await generateTexture(`Floor texture matching: ${roomData.description}`);
    floorTexture.repeat.set(5, 5); // Adjust tiling

    await delay(GENERATION_DELAY); // Wait

    showLoading(`Generating wall texture for ${roomId}...`);
    const wallTexture = await generateTexture(`Wall texture matching: ${roomData.description}`);
    wallTexture.repeat.set(5, 3); // Adjust tiling

    await delay(GENERATION_DELAY); // Wait

    showLoading(`Generating ceiling texture for ${roomId}...`);
    const ceilingTexture = await generateTexture(`Ceiling texture matching: ${roomData.description}`);
    ceilingTexture.repeat.set(5, 5); // Adjust tiling


    // 2. Create Room Geometry and Apply Textures
    showLoading(`Building room structure for ${roomId}...`);
    const roomGeometry = new THREE.BoxGeometry(roomSize.width, roomSize.height, roomSize.depth);
    const materials = [
        new THREE.MeshStandardMaterial({ map: wallTexture, side: THREE.BackSide, roughness: 0.9, metalness: 0.1 }), // Right (+x)
        new THREE.MeshStandardMaterial({ map: wallTexture, side: THREE.BackSide, roughness: 0.9, metalness: 0.1 }), // Left (-x)
        new THREE.MeshStandardMaterial({ map: ceilingTexture, side: THREE.BackSide, roughness: 0.9, metalness: 0.1 }), // Top (+y)
        new THREE.MeshStandardMaterial({ map: floorTexture, side: THREE.BackSide, roughness: 0.7, metalness: 0.2 }), // Bottom (-y)
        new THREE.MeshStandardMaterial({ map: wallTexture, side: THREE.BackSide, roughness: 0.9, metalness: 0.1 }), // Front (+z)
        new THREE.MeshStandardMaterial({ map: wallTexture, side: THREE.BackSide, roughness: 0.9, metalness: 0.1 })  // Back (-z)
    ];
    const roomMesh = new THREE.Mesh(roomGeometry, materials);
    roomMesh.position.y = roomSize.height / 2 - 0.1; // Position floor near y=0
    roomMesh.name = `RoomMesh_${roomId}`;
    roomGroup.add(roomMesh);


    // 3. Generate Object Descriptions (with delay)
    await delay(GENERATION_DELAY);
    showLoading(`Populating ${roomId} with objects...`);
    const objectDescriptions = await generateObjectDescriptions(roomData.description);
    roomData.objects = []; // Clear previous object data if regenerating

    // 4. Create and Texture Objects (with delays between object *textures*)
    for (const objDesc of objectDescriptions) {
        const objectGeometry = createPlaceholderGeometry(objDesc.name);
        // Delay before generating each object's texture
        await delay(GENERATION_DELAY / 2); // Shorter delay between object textures
        const objectTexture = await generateTexture(`Texture for a ${objDesc.description}`);
        const objectMaterial = new THREE.MeshStandardMaterial({
            map: objectTexture,
            roughness: 0.8,
            metalness: 0.1
        });
        const objectMesh = new THREE.Mesh(objectGeometry, objectMaterial);

        // Position object
        const position = calculateObjectPosition(objDesc.placement, roomSize);
         // Adjust Y based on geometry height to place it *on* the floor
        if (objectGeometry.parameters.height) {
             position.y = objectGeometry.parameters.height / 2;
        } else if (objectGeometry.parameters.radius) {
             position.y = objectGeometry.parameters.radius; // For spheres etc.
        } else {
             position.y = 0.5; // Default if height unknown
        }
        objectMesh.position.copy(position);

        objectMesh.name = `Object_${objDesc.name.replace(/\s+/g, '_')}`; // Make name safe
        roomGroup.add(objectMesh);

        // Store object data (including mesh reference) in game state
        roomData.objects.push({
            ...objDesc,
            mesh: objectMesh
        });
         addChatMessage(`Placed ${objDesc.name}.`, 'system-message');
    }

    hideLoading();
    addChatMessage(`Finished generating visuals for ${roomId}.`, 'system-message');
    return roomGroup;
}

// --- Scene Management ---

export async function ensureRoomIsGenerated(roomId) {
    const roomData = gameState.rooms[roomId];
    if (!roomData) {
        console.error(`Cannot generate room: Data for ${roomId} not found.`);
        addChatMessage(`Error: Cannot find data for room "${roomId}".`, 'error-message');
        return;
    }

    // If already generated or currently generating, do nothing here
    if (roomData.isGenerated || roomData.isGenerating) {
        // If it *was* generating but now finished, ensure it's displayed
        if(roomData.isGenerated && !roomCache.has(roomId)) {
             // This case shouldn't happen often but handles potential race conditions
             console.warn(`Room ${roomId} marked generated but not in cache. Re-adding.`);
             scene.add(roomData.mesh); // Re-add mesh from gameState
             roomCache.set(roomId, roomData.mesh);
        } else if (roomData.isGenerated) {
            displayRoom(roomId); // Ensure correct room is visible
        }
        return;
    }

    // Mark as generating
    roomData.isGenerating = true;
    let roomGroup = null;
    try {
        roomGroup = await createDetailedRoomVisuals(roomId);
    } catch (error) {
        console.error(`Error generating visuals for room ${roomId}:`, error);
        addChatMessage(`Error creating visuals for ${roomId}.`, 'error-message');
        // Potentially create a fallback placeholder room here
    } finally {
        roomData.isGenerating = false;
        hideLoading(); // Ensure loading is hidden even on error
    }

    if (roomGroup) {
        roomData.mesh = roomGroup; // Store the group reference in game state
        roomData.isGenerated = true;
        roomCache.set(roomId, roomGroup); // Add to cache
        scene.add(roomGroup); // Add the fully generated room to the scene
        displayRoom(roomId); // Call displayRoom again to ensure visibility and camera focus
    } else {
         addChatMessage(`Failed to display room ${roomId} after generation attempt.`, 'error-message');
    }
}


// This function now purely handles visibility and camera/controls
export function displayRoom(roomId) {
    const targetRoomData = gameState.rooms[roomId];
    if (!targetRoomData || !targetRoomData.isGenerated || !targetRoomData.mesh) {
        console.warn(`Attempted to display non-generated or invalid room: ${roomId}`);
        // Generation is handled by ensureRoomIsGenerated, called before this
        return;
    }

    // Hide all other cached rooms
    roomCache.forEach((mesh, id) => {
        if (id !== roomId && mesh) {
            mesh.visible = false;
        }
    });

    // Show the target room
    const targetMesh = roomCache.get(roomId);
    if (targetMesh) {
        targetMesh.visible = true;
        // Adjust controls target to the center of the room floor
        controls.target.set(0, 1, 0); // Look slightly above floor level
        controls.update();
    } else {
        console.error(`Mesh for generated room ${roomId} not found in cache!`);
         addChatMessage(`Error displaying visuals for ${roomId}.`, 'error-message');
    }
}


// --- NPC Visuals ---

export function addNPCToScene(npcData) {
    if (!npcData || !gameState.currentRoom || npcData.currentRoomId !== gameState.currentRoom.id) {
        // Don't add if NPC data missing, no current room, or NPC not in this room
        return;
    }

    // If NPC mesh already exists, just make it visible
    if (npcMeshes.has(npcData.id)) {
        const existingMesh = npcMeshes.get(npcData.id);
        existingMesh.visible = true;
        // Ensure it's parented to the correct room group
        const roomGroup = roomCache.get(npcData.currentRoomId);
        if (roomGroup && existingMesh.parent !== roomGroup) {
            roomGroup.add(existingMesh); // Add to current room's group
        }
        return;
    }

    // Create new NPC mesh
    const npcGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    const npcMaterial = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xaaaaaa + 0x444444,
        roughness: 0.7
    });
    const npcMesh = new THREE.Mesh(npcGeometry, npcMaterial);
    npcMesh.position.y = 0.5; // Base of capsule at y=0 (floor)

    // Position within the room
    const roomGroup = roomCache.get(npcData.currentRoomId);
    const roomSize = roomGroup?.children.find(c => c.name.startsWith('RoomMesh_'))?.geometry.parameters || { width: 20, depth: 20 }; // Get room size or default
    const margin = 4;
    const xOffset = (Math.random() - 0.5) * (roomSize.width - margin);
    const zOffset = (Math.random() - 0.5) * (roomSize.depth - margin);
    npcMesh.position.x = xOffset;
    npcMesh.position.z = zOffset;

    npcMesh.userData = { type: 'npc', id: npcData.id };
    npcMesh.name = `NPC_${npcData.id}`;

    // Add to cache and game state
    npcMeshes.set(npcData.id, npcMesh);
    npcData.mesh = npcMesh; // Link mesh back to game state NPC data

    // Add to the current room's group in the scene
    if (roomGroup) {
        roomGroup.add(npcMesh);
    } else {
        console.warn(`Could not find room group for ${npcData.currentRoomId} to add NPC ${npcData.id}`);
        // scene.add(npcMesh); // Add to main scene as fallback? Might cause issues.
    }

    npcMesh.visible = true; // Ensure visible
}

export function removeNPCFromScene(npcData) {
    if (!npcData || !npcMeshes.has(npcData.id)) return;

    const npcMesh = npcMeshes.get(npcData.id);
    npcMesh.visible = false; // Just hide, don't remove, allows faster re-display
    // We keep it parented to its room group even when hidden
}